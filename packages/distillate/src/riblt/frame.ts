import {
  assertBodyLength,
  assertMinBodyLength,
  assertParamsPadding,
  FORMAT_VERSION,
  HASH_MURMUR128,
  readHeader,
  SerializationError,
  UnknownHashVariantError,
  writeFrame,
} from "../core/serialize.js";

/** DSTL frame type for a batch of RIBLT coded symbols. */
const TYPE = 12;

/**
 * Body layout: seed (u32 LE) | start index (u32 LE) | count (u32 LE) | 4 bytes
 * padding, then `count` symbol sums (u64 LE), `count` checksum sums (u64 LE)
 * and `count` counts (i32 LE). Columns rather than 20-byte records, so every
 * lane starts aligned and a foreign reader can map each as a typed slice.
 */
const PARAMS_SIZE = 16;
const PARAMS_FIELDS_END = 12;

// Reused per symbol so writing a frame allocates only the frame.
const SCRATCH = new Uint32Array(5);

/**
 * Writes a frame of `count` coded symbols starting at index `start`, drawing
 * each from `next` (which fills sum lo, sum hi, checksum lo, checksum hi,
 * count as u32).
 */
export function writeSymbols(
  seed: number,
  start: number,
  count: number,
  next: (out: Uint32Array) => void,
): Uint8Array {
  return writeFrame(
    { version: FORMAT_VERSION, type: TYPE, flags: HASH_MURMUR128 },
    PARAMS_SIZE,
    20 * count,
    (_, view) => {
      view.setUint32(0, seed, true);
      view.setUint32(4, start, true);
      view.setUint32(8, count, true);
      for (let i = 0; i < count; i++) {
        next(SCRATCH);
        writeSymbolAt(view, count, i, SCRATCH);
      }
    },
  );
}

/** A frame's params and a view over its body, columns at their offsets. */
export interface Symbols {
  seed: number;
  start: number;
  count: number;
  view: DataView;
}

/**
 * Reads a frame written by {@link writeSymbols}, refusing one of another type
 * or hash variant, or whose body disagrees with its count.
 */
export function readSymbols(bytes: Uint8Array): Symbols {
  const { type, flags, body } = readHeader(bytes);
  if (type !== TYPE) {
    throw new SerializationError(
      `expected DSTL type ${String(TYPE)}, got ${String(type)}`,
    );
  }
  if ((flags & 0x0f) !== HASH_MURMUR128) {
    throw new UnknownHashVariantError(
      `unsupported hash variant ${String(flags & 0x0f)}`,
    );
  }
  assertMinBodyLength(body.length, PARAMS_SIZE, "riblt");
  assertParamsPadding(body, PARAMS_FIELDS_END, PARAMS_SIZE, "riblt");
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const count = view.getUint32(8, true);
  assertBodyLength(body.length, PARAMS_SIZE + 20 * count, "riblt");
  return {
    seed: view.getUint32(0, true),
    start: view.getUint32(4, true),
    count,
    view,
  };
}

// Byte offsets of the three columns in a body of `count` symbols.
const sumsAt = (i: number): number => PARAMS_SIZE + 8 * i;
const checksAt = (count: number, i: number): number =>
  PARAMS_SIZE + 8 * count + 8 * i;
const countsAt = (count: number, i: number): number =>
  PARAMS_SIZE + 16 * count + 4 * i;

function writeSymbolAt(
  view: DataView,
  count: number,
  i: number,
  symbol: Uint32Array,
): void {
  view.setUint32(sumsAt(i), symbol[0] ?? 0, true);
  view.setUint32(sumsAt(i) + 4, symbol[1] ?? 0, true);
  view.setUint32(checksAt(count, i), symbol[2] ?? 0, true);
  view.setUint32(checksAt(count, i) + 4, symbol[3] ?? 0, true);
  view.setUint32(countsAt(count, i), symbol[4] ?? 0, true);
}

/**
 * Copies symbol `i` of a `count`-symbol frame into `out` (sum lo, sum hi,
 * checksum lo, checksum hi, count as u32).
 */
export function readSymbolAt(
  view: DataView,
  count: number,
  i: number,
  out: Uint32Array,
): void {
  out[0] = view.getUint32(sumsAt(i), true);
  out[1] = view.getUint32(sumsAt(i) + 4, true);
  out[2] = view.getUint32(checksAt(count, i), true);
  out[3] = view.getUint32(checksAt(count, i) + 4, true);
  out[4] = view.getUint32(countsAt(count, i), true);
}
