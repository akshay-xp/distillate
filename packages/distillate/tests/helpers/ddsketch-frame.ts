/**
 * A reader of DDSketch frame type 10's payload, written from the documented
 * layout rather than shared with the code under test, so tests can check the
 * bytes and forge frames without trusting the encoder they check.
 */
export interface Block {
  /** Byte offset of the block within the body. */
  at: number;
  contiguous: boolean;
  f64: boolean;
  n: number;
  start: number;
  /** Non-empty bins as [index, count], ascending. */
  bins: number[][];
  /** Bytes the block occupies, padding included. */
  size: number;
}

export const PARAMS = 64;
export const BLOCK_HEADER = 16;

export function readBlock(body: DataView, at: number): Block {
  const layout = body.getUint8(at);
  const contiguous = (layout & 1) === 1;
  const f64 = (layout & 2) === 2;
  const n = body.getUint32(at + 4, true);
  const start = body.getInt32(at + 8, true);
  const width = f64 ? 8 : 4;
  const count = (i: number): number =>
    f64
      ? body.getFloat64(at + BLOCK_HEADER + 8 * i, true)
      : body.getUint32(at + BLOCK_HEADER + 4 * i, true);
  const bins: number[][] = [];
  for (let i = 0; i < n; i++) {
    if (contiguous) {
      if (count(i) !== 0) bins.push([start + i, count(i)]);
    } else {
      const index = body.getInt32(at + BLOCK_HEADER + width * n + 4 * i, true);
      bins.push([index, count(i)]);
    }
  }
  const data = contiguous ? width * n : (width + 4) * n;
  return {
    at,
    contiguous,
    f64,
    n,
    start,
    bins,
    size: BLOCK_HEADER + Math.ceil(data / 8) * 8,
  };
}

/** Both sign blocks of a frame, and its zero count. */
export function readFrameBins(frame: Uint8Array): {
  positive: Block;
  negative: Block;
  zeroCount: number;
} {
  const length = new DataView(frame.buffer, frame.byteOffset).getUint32(
    8,
    true,
  );
  const body = new DataView(frame.buffer, frame.byteOffset + 16, length);
  const positive = readBlock(body, PARAMS);
  const negative = readBlock(body, PARAMS + positive.size);
  return { positive, negative, zeroCount: body.getFloat64(56, true) };
}
