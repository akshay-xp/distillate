import { fromBase64, toBase64 } from "./base64.js";
import { crc32 } from "./crc32.js";

export const FORMAT_VERSION = 3;

/** Hash variant recorded in the low nibble of the header flags byte. */
export const HASH_MURMUR128 = 0;

const HEADER_SIZE = 8;
const TRAILER_SIZE = 4;

export interface Header {
  version: number;
  type: number;
  flags: number;
}

/**
 * Allocates a full frame once, hands `fill` a writable view over the body region
 * (and a `DataView` scoped to it), then seals the CRC trailer. The body view
 * aliases the frame's buffer, so callers write fields and payload straight into
 * the frame with no intermediate body allocation or copy.
 */
export function writeFrame(
  header: Header,
  bodyLength: number,
  fill: (body: Uint8Array, view: DataView) => void,
): Uint8Array {
  const frame = new Uint8Array(HEADER_SIZE + bodyLength + TRAILER_SIZE);
  frame[0] = 0x41;
  frame[1] = 0x4d;
  frame[2] = 0x51;
  frame[3] = 0x46;
  frame[4] = header.version;
  frame[5] = header.type;
  frame[6] = header.flags;
  frame[7] = 0;

  const body = frame.subarray(HEADER_SIZE, HEADER_SIZE + bodyLength);
  fill(body, new DataView(frame.buffer, HEADER_SIZE, bodyLength));

  const crc = crc32(frame.subarray(0, HEADER_SIZE + bodyLength));
  new DataView(frame.buffer, frame.byteOffset, frame.byteLength).setUint32(
    HEADER_SIZE + bodyLength,
    crc,
    true,
  );
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

export class SerializationError extends Error {
  override readonly name: string = "SerializationError";
}
export class TruncatedError extends SerializationError {
  override readonly name = "TruncatedError";
}
export class BadMagicError extends SerializationError {
  override readonly name = "BadMagicError";
}
export class UnknownVersionError extends SerializationError {
  override readonly name = "UnknownVersionError";
}
export class UnknownHashVariantError extends SerializationError {
  override readonly name = "UnknownHashVariantError";
}
export class ChecksumError extends SerializationError {
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
  return fromBase64(o.data);
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
  if (
    frame[0] !== 0x41 ||
    frame[1] !== 0x4d ||
    frame[2] !== 0x51 ||
    frame[3] !== 0x46
  ) {
    throw new BadMagicError("frame does not start with the AMQF magic");
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
