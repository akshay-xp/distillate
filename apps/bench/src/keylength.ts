import { adapters as bloomAdapters } from "./adapters.js";
import type { Adapter } from "./adapters.js";

export type Alphabet = "ascii" | "non-ascii";

export const KEYLENGTH_LENGTHS = [8, 16, 32, 128, 512];
export const KEYLENGTH_ALPHABETS: Alphabet[] = ["ascii", "non-ascii"];
export const KEYLENGTH_N = 100_000;

const FILLER: Record<Alphabet, string> = { ascii: "k", "non-ascii": "é漢" };

/**
 * `n` distinct keys of exactly `length` UTF-16 units. Each is a unique index
 * padded with the alphabet's filler, then flattened through JSON: V8 keeps a
 * concatenation of 13+ chars as a rope, where `charCodeAt` costs more, and
 * keys from a parser, network or database arrive flat.
 */
export function keyLengthKeys(
  length: number,
  alphabet: Alphabet,
  n: number,
): string[] {
  const keys = new Array<string>(n);
  for (let i = 0; i < n; i++) {
    keys[i] = `${i.toString(36)}:`.padEnd(length, FILLER[alphabet]);
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
        // One untimed pass, so the first row isn't charged for JIT warm-up.
        const warm = adapter.create(n);
        for (const key of keys) warm.add(key);
        for (const key of keys) warm.has(key);

        const f = adapter.create(n);
        let started = performance.now();
        for (const key of keys) f.add(key);
        const addMs = performance.now() - started;

        let held = 0;
        started = performance.now();
        for (const key of keys) if (f.has(key)) held++;
        const hasMs = performance.now() - started;
        if (held !== n) throw new Error(`${adapter.name} lost keys`);

        rows.push({
          name: adapter.name,
          length,
          alphabet,
          addOpsPerSec: rate(n, addMs),
          hasOpsPerSec: rate(n, hasMs),
        });
      }
    }
  }
  return rows;
}
