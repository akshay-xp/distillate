import { fromBase64, toBase64 } from "./base64.js";
import { crc32 } from "./crc32.js";

export const FORMAT_VERSION = 4;

/** Hash variant recorded in the low nibble of the header flags byte. */
export const HASH_MURMUR128 = 0;

/** Frame sentinel, the ASCII bytes `DSTL`. Superseded `AMQF` in format v4. */
const MAGIC = Uint8Array.of(0x44, 0x53, 0x54, 0x4c);

/**
 * Header layout: magic (4) | version | type | flags | reserved | bodyLength
 * (u32 LE at 8) | reserved (4 at 12). The trailing reserved word keeps the
 * body 8-byte aligned and leaves room for fields to be added without another
 * breaking bump.
 */
const HEADER_SIZE = 16;
const BODY_LENGTH_OFFSET = 8;
const TRAILER_SIZE = 4;

export interface Header {
  version: number;
  type: number;
  flags: number;
}

/**
 * Allocates a full frame once, stamps the header (including the declared body
 * length, so a reader can frame the payload without knowing its type), hands
 * `fill` a writable view over the body region (and a `DataView` scoped to it),
 * then seals the CRC trailer. The body view aliases the frame's buffer, so
 * callers write fields and payload straight into the frame with no intermediate
 * body allocation or copy.
 */
export function writeFrame(
  header: Header,
  bodyLength: number,
  fill: (body: Uint8Array, view: DataView) => void,
): Uint8Array {
  const frame = new Uint8Array(HEADER_SIZE + bodyLength + TRAILER_SIZE);
  const frameView = new DataView(
    frame.buffer,
    frame.byteOffset,
    frame.byteLength,
  );
  frame.set(MAGIC, 0);
  frame[4] = header.version;
  frame[5] = header.type;
  frame[6] = header.flags;
  frame[7] = 0;
  frameView.setUint32(BODY_LENGTH_OFFSET, bodyLength, true);

  const body = frame.subarray(HEADER_SIZE, HEADER_SIZE + bodyLength);
  fill(body, new DataView(frame.buffer, HEADER_SIZE, bodyLength));

  const crc = crc32(frame.subarray(0, HEADER_SIZE + bodyLength));
  frameView.setUint32(HEADER_SIZE + bodyLength, crc, true);
  return frame;
}

/** Convenience adapter for callers that already hold the full body bytes. */
export function writeHeader(header: Header, body: Uint8Array): Uint8Array {
  return writeFrame(header, body.length, (b) => {
    b.set(body);
  });
}

export interface ReadResult extends Header {
  body: Uint8Array;
}

/**
 * Base class for every defect `fromBytes` and `fromJSON` reject. Thrown
 * directly when a JSON envelope is malformed: not an object, missing the
 * `"distillate"` tag, missing `data`, or `data` that is not valid base64.
 * Catch this to handle any decode failure at once, or a subclass to tell the
 * causes apart. The input is corrupt or foreign, so discard it; retrying the
 * same bytes cannot succeed.
 */
export class SerializationError extends Error {
  /** Discriminates this error from other `Error`s. */
  override readonly name: string = "SerializationError";
}

/**
 * Thrown when a frame is shorter than its header plus trailer, or when its
 * body length does not match the length its declared params imply. The bytes
 * were cut short in transit or storage; re-fetch the whole frame.
 */
export class TruncatedError extends SerializationError {
  /** Discriminates this error from other `Error`s. */
  override readonly name = "TruncatedError";
}

/**
 * Thrown when a frame does not start with the four-byte `DSTL` magic, so it
 * was never produced by `toBytes`. Frames written before format version 4
 * carry the older `AMQF` magic and are rejected here; re-serialize them with
 * the version you run. Otherwise check that the bytes really are a distillate
 * frame and not another payload, a text encoding of one, or a slice taken at
 * the wrong offset.
 */
export class BadMagicError extends SerializationError {
  /** Discriminates this error from other `Error`s. */
  override readonly name = "BadMagicError";
}

/**
 * Thrown when a frame or JSON envelope declares a format version this release
 * does not read. A reader must be at least as new as the producer, so upgrade
 * `distillate` or re-serialize the data with the version you run.
 */
export class UnknownVersionError extends SerializationError {
  /** Discriminates this error from other `Error`s. */
  override readonly name = "UnknownVersionError";
}

/**
 * Thrown when a frame's flags nibble names a hash this release cannot
 * reproduce, so its stored bits are unreadable. Rebuild the filter from the
 * source keys with the version you run.
 */
export class UnknownHashVariantError extends SerializationError {
  /** Discriminates this error from other `Error`s. */
  override readonly name = "UnknownHashVariantError";
}

/**
 * Thrown when a frame's CRC32 trailer does not match its contents, so the
 * bytes were corrupted after they were written. Discard them and re-fetch;
 * the payload cannot be trusted even where it still parses.
 */
export class ChecksumError extends SerializationError {
  /** Discriminates this error from other `Error`s. */
  override readonly name = "ChecksumError";
}

const JSON_TAG = "distillate";

/** JSON-friendly envelope for a filter: the binary frame, base64-encoded. */
export interface FilterJSON {
  /** Format tag; always `"distillate"`. */
  $: string;
  /** Binary format version. */
  v: number;
  /** Base64 of the `toBytes` frame. */
  data: string;
}

/** Wraps a serialized frame in the JSON envelope. */
export function toJSONEnvelope(bytes: Uint8Array): FilterJSON {
  return { $: JSON_TAG, v: FORMAT_VERSION, data: toBase64(bytes) };
}

/**
 * Validates a JSON envelope and returns the raw frame bytes for a structure's
 * own `fromBytes` to decode. Throws {@link SerializationError} on any envelope
 * defect; the frame itself is checked downstream.
 */
export function fromJSONEnvelope(value: unknown): Uint8Array {
  if (value === null || typeof value !== "object") {
    throw new SerializationError("not a distillate filter JSON object");
  }
  const o = value as Record<string, unknown>;
  if (o.$ !== JSON_TAG) {
    throw new SerializationError(`expected "$":"${JSON_TAG}"`);
  }
  if (o.v !== FORMAT_VERSION) {
    throw new UnknownVersionError(
      `unsupported JSON version ${String(o.v)}, expected ${String(FORMAT_VERSION)}`,
    );
  }
  if (typeof o.data !== "string") {
    throw new SerializationError('missing string "data"');
  }
  try {
    return fromBase64(o.data);
  } catch {
    throw new SerializationError("envelope data is not valid base64");
  }
}

/** Byte-wise equality of two frames; the basis for structure `equals`. */
export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Asserts a frame body is long enough to hold its fixed params block, so the
 * params can be read without running off the end.
 */
export function assertMinBodyLength(
  actual: number,
  min: number,
  context: string,
): void {
  if (actual < min) {
    throw new TruncatedError(
      `${context}: body of ${String(actual)} bytes is shorter than the ${String(min)}-byte params block`,
    );
  }
}

/**
 * Asserts a frame body is exactly the length its declared params imply, so a
 * hostile or truncated frame is rejected before any backing store is allocated.
 */
export function assertBodyLength(
  actual: number,
  expected: number,
  context: string,
): void {
  if (actual !== expected) {
    throw new TruncatedError(
      `${context}: body of ${String(actual)} bytes does not match the declared params (expected ${String(expected)})`,
    );
  }
}

export function readHeader(frame: Uint8Array): ReadResult {
  if (frame.length < HEADER_SIZE + TRAILER_SIZE) {
    throw new TruncatedError(
      `frame of ${String(frame.length)} bytes is shorter than the minimum ${String(HEADER_SIZE + TRAILER_SIZE)}`,
    );
  }
  for (let i = 0; i < MAGIC.length; i++) {
    if (frame[i] !== MAGIC[i]) {
      throw new BadMagicError("frame does not start with the DSTL magic");
    }
  }
  const version = frame[4] ?? 0;
  if (version !== FORMAT_VERSION) {
    throw new UnknownVersionError(
      `unsupported format version ${String(version)}`,
    );
  }

  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  const expected = view.getUint32(frame.length - TRAILER_SIZE, true);
  const actual = crc32(frame.subarray(0, frame.length - TRAILER_SIZE));
  if (expected !== actual) {
    throw new ChecksumError("frame CRC32 does not match its contents");
  }

  return {
    version,
    type: frame[5] ?? 0,
    flags: frame[6] ?? 0,
    body: frame.subarray(HEADER_SIZE, frame.length - TRAILER_SIZE),
  };
}
