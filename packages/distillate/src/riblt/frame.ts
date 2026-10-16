import {
  FORMAT_VERSION,
  HASH_MURMUR128,
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
      const sums = PARAMS_SIZE;
      const checks = sums + 8 * count;
      const counts = checks + 8 * count;
      for (let i = 0; i < count; i++) {
        next(SCRATCH);
        view.setUint32(sums + 8 * i, SCRATCH[0] ?? 0, true);
        view.setUint32(sums + 8 * i + 4, SCRATCH[1] ?? 0, true);
        view.setUint32(checks + 8 * i, SCRATCH[2] ?? 0, true);
        view.setUint32(checks + 8 * i + 4, SCRATCH[3] ?? 0, true);
        view.setUint32(counts + 4 * i, SCRATCH[4] ?? 0, true);
      }
    },
  );
}
