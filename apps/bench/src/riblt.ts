import { RibltDecoder, RibltEncoder } from "distillate/riblt";

import { InvertibleBloomFilter } from "./incumbent.js";
import { median } from "./keylength.js";

export interface ReconcileResult {
  /** Building the sender's side and producing everything it sends. */
  sendMs: number;
  /** Building the receiver's side and decoding what arrived. */
  receiveMs: number;
  /** Bytes the sender shipped, in the library's own form. */
  bytes: number;
  /** Coded symbols sent; null where the library sends a whole table. */
  symbols: number | null;
  decoded: boolean;
  /** Keys found only on the sender's side, and only on the receiver's. */
  onlyA: number;
  onlyB: number;
}

export interface ReconcileAdapter {
  name: string;
  /** Reconciles sender `a` into receiver `b`, which differ by `d` keys. */
  run(a: string[], b: string[], d: number): ReconcileResult;
}

/** Symbols per frame, the guide's suggestion. */
export const RIBLT_FRAME = 64;

export const distillateReconcileAdapter: ReconcileAdapter = {
  name: "distillate/riblt",
  run(a, b) {
    let started = performance.now();
    const encoder = RibltEncoder.from(a);
    let sendMs = performance.now() - started;
    started = performance.now();
    const decoder = RibltDecoder.from(b);
    let receiveMs = performance.now() - started;

    let bytes = 0;
    let symbols = 0;
    let decoded = false;
    while (!decoded) {
      started = performance.now();
      const frame = encoder.take(RIBLT_FRAME);
      sendMs += performance.now() - started;
      bytes += frame.length;
      symbols += RIBLT_FRAME;
      started = performance.now();
      decoded = decoder.push(frame);
      receiveMs += performance.now() - started;
    }
    return {
      sendMs,
      receiveMs,
      bytes,
      symbols,
      decoded,
      onlyA: decoder.remote().length,
      onlyB: decoder.local().length,
    };
  },
};

/**
 * `bloom-filters` v3's IBLT, sized by its own `create(d, 0.01)` from the true
 * difference, which no real caller knows. Keys go in as `Buffer`s, as it
 * requires. The sender ships its whole table, as `saveAsJSON`.
 */
export const incumbentReconcileAdapter: ReconcileAdapter = {
  name: "bloom-filters",
  run(a, b, d) {
    let started = performance.now();
    const sender = InvertibleBloomFilter.create(d, 0.01);
    for (const key of a) sender.add(Buffer.from(key));
    const bytes = JSON.stringify(sender.saveAsJSON()).length;
    const sendMs = performance.now() - started;

    started = performance.now();
    const receiver = InvertibleBloomFilter.create(d, 0.01);
    for (const key of b) receiver.add(Buffer.from(key));
    const result = sender.substract(receiver).decode();
    const receiveMs = performance.now() - started;
    return {
      sendMs,
      receiveMs,
      bytes,
      symbols: null,
      decoded: result.success,
      onlyA: result.additional.length,
      onlyB: result.missing.length,
    };
  },
};

export const reconcileAdapters: ReconcileAdapter[] = [
  distillateReconcileAdapter,
  incumbentReconcileAdapter,
];

/** Keys per side and keys that differ; d cannot exceed what both sides hold. */
export const RIBLT_CASES: [number, number][] = [
  [10_000, 10],
  [10_000, 1000],
  [1_000_000, 10],
  [1_000_000, 1000],
  [1_000_000, 100_000],
];

export const RIBLT_WARM_PASSES = 1;
export const RIBLT_TIMED_PASSES = 3;

export interface RibltRow {
  name: string;
  keys: number;
  d: number;
  sendMs: number;
  receiveMs: number;
  symbols: number | null;
  bytes: number;
  decoded: boolean;
  /** Why the case did not finish, such as running out of memory. */
  failure?: string;
}

const keysOf = (prefix: string, n: number): string[] =>
  Array.from({ length: n }, (_, i) => `${prefix}:${String(i)}`);

export function ribltRows(
  cases: [number, number][],
  adapters: ReconcileAdapter[] = reconcileAdapters,
): RibltRow[] {
  const rows: RibltRow[] = [];
  for (const [keys, d] of cases) {
    // Each side holds `keys`, half the difference its own. Built once and
    // shared by every library.
    const shared = keysOf("s", keys - Math.ceil(d / 2));
    const a = [...shared, ...keysOf("a", Math.ceil(d / 2))];
    const b = [...shared, ...keysOf("b", Math.floor(d / 2))];

    for (const adapter of adapters) {
      for (let p = 0; p < RIBLT_WARM_PASSES; p++) adapter.run(a, b, d);
      const timed = Array.from({ length: RIBLT_TIMED_PASSES }, () =>
        adapter.run(a, b, d),
      );
      const last = timed.at(-1) ?? adapter.run(a, b, d);
      rows.push({
        name: adapter.name,
        keys,
        d,
        sendMs: median(timed.map((t) => t.sendMs)),
        receiveMs: median(timed.map((t) => t.receiveMs)),
        symbols: last.symbols,
        bytes: last.bytes,
        decoded: timed.every((t) => t.decoded),
      });
    }
  }
  return rows;
}
