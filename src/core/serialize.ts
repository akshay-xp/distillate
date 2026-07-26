import { crc32 } from "./crc32.js";

export const FORMAT_VERSION = 1;

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

export function readHeader(frame: Uint8Array): ReadResult {
  return {
    version: frame[4] ?? 0,
    type: frame[5] ?? 0,
    flags: frame[6] ?? 0,
    body: frame.subarray(HEADER_SIZE, frame.length - TRAILER_SIZE),
  };
}
