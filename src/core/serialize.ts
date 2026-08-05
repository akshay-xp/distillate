import { crc32 } from "./crc32.js";

export const FORMAT_VERSION = 2;

/** Hash variant recorded in the low nibble of the header flags byte. */
export const HASH_MURMUR64 = 0;
export const HASH_MURMUR32 = 1;

const HEADER_SIZE = 8;
const TRAILER_SIZE = 4;

export interface Header {
  version: number;
  type: number;
  flags: number;
}

export function writeHeader(header: Header, body: Uint8Array): Uint8Array {
  const frame = new Uint8Array(HEADER_SIZE + body.length + TRAILER_SIZE);
  frame[0] = 0x41;
  frame[1] = 0x4d;
  frame[2] = 0x51;
  frame[3] = 0x46;
  frame[4] = header.version;
  frame[5] = header.type;
  frame[6] = header.flags;
  frame[7] = 0;
  frame.set(body, HEADER_SIZE);

  const crc = crc32(frame.subarray(0, HEADER_SIZE + body.length));
  new DataView(frame.buffer, frame.byteOffset, frame.byteLength).setUint32(
    HEADER_SIZE + body.length,
    crc,
    true,
  );
  return frame;
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
