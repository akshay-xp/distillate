import { adapters as bloomAdapters } from "./adapters.js";
import type { Adapter } from "./adapters.js";

export type Alphabet = "ascii" | "non-ascii";

export const KEYLENGTH_LENGTHS = [4, 8, 12, 13, 16, 32, 128, 512];
export const KEYLENGTH_ALPHABETS: Alphabet[] = ["ascii", "non-ascii"];
export const KEYLENGTH_N = 100_000;
// One pass over 100k keys takes a few milliseconds, so a single pass is noisy
// and the first one in a process runs before the JIT has settled.
export const KEYLENGTH_WARM_PASSES = 2;
export const KEYLENGTH_TIMED_PASSES = 5;

// The index's digits. Neither prefix nor filler uses them, so the index is the
// only run of digits in a key and keys never collide.
const DIGITS =
  "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ+/";
const PREFIX: Record<Alphabet, string> = { ascii: "", "non-ascii": "é" };
const FILLER: Record<Alphabet, string> = { ascii: ".", "non-ascii": "漢" };

function digits(i: number): string {
  let out = "";
  do {
    out = DIGITS[i % 64]! + out;
    i = Math.floor(i / 64);
  } while (i > 0);
  return out;
}

/**
 * `n` distinct keys of exactly `length` UTF-16 units: a prefix (`é` for
 * non-ASCII keys), a unique base-64 index, then filler. Base 64 fits 100k keys
 * in three digits, so even 4-character non-ASCII keys hold one. The keys are
 * flattened through JSON: V8 keeps a concatenation of 13+ chars as a rope,
 * where `charCodeAt` costs more, and keys from a parser, network or database
 * arrive flat.
 */
export function keyLengthKeys(
  length: number,
  alphabet: Alphabet,
  n: number,
): string[] {
  const keys = new Array<string>(n);
  for (let i = 0; i < n; i++) {
    keys[i] = (PREFIX[alphabet] + digits(i)).padEnd(length, FILLER[alphabet]);
  }
  return JSON.parse(JSON.stringify(keys)) as string[];
}

export interface KeyLengthRow {
  name: string;
  length: number;
  alphabet: Alphabet;
  addOpsPerSec: number;
  hasOpsPerSec: number;
}

const rate = (n: number, ms: number): number => n / (ms / 1000);

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

/** Time one pass of `add` over the keys into a fresh filter, then `has`. */
function timePass(
  adapter: Adapter,
  keys: string[],
): { addMs: number; hasMs: number } {
  const f = adapter.create(keys.length);
  let started = performance.now();
  for (const key of keys) f.add(key);
  const addMs = performance.now() - started;

  let held = 0;
  started = performance.now();
  for (const key of keys) if (f.has(key)) held++;
  const hasMs = performance.now() - started;
  if (held !== keys.length) throw new Error(`${adapter.name} lost keys`);
  return { addMs, hasMs };
}

export function keyLengthRows(
  lengths: number[],
  alphabets: Alphabet[],
  n: number,
  adapters: Adapter[] = bloomAdapters,
): KeyLengthRow[] {
  const rows: KeyLengthRow[] = [];
  for (const alphabet of alphabets) {
    for (const length of lengths) {
      const keys = keyLengthKeys(length, alphabet, n);
      for (const adapter of adapters) {
        for (let p = 0; p < KEYLENGTH_WARM_PASSES; p++) timePass(adapter, keys);
        const passes = Array.from({ length: KEYLENGTH_TIMED_PASSES }, () =>
          timePass(adapter, keys),
        );
        rows.push({
          name: adapter.name,
          length,
          alphabet,
          addOpsPerSec: rate(n, median(passes.map((t) => t.addMs))),
          hasOpsPerSec: rate(n, median(passes.map((t) => t.hasMs))),
        });
      }
    }
  }
  return rows;
}
