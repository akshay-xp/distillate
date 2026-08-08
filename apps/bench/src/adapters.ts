import { BloomFilter as BloomFiltersBloom } from "bloom-filters";
import { BloomFilter as JasonBloom } from "bloomfilter";
import { BloomFilter } from "distillate/bloom";

import type { Insertable } from "./harness.js";

export const TARGET_FPR = 0.01;

export interface BuiltFilter {
  has(key: string): boolean;
  bitsPerKey: number;
}

export interface Adapter {
  name: string;
  create(n: number): Insertable;
  build(keys: readonly string[]): BuiltFilter;
}

export const distillateBloomAdapter: Adapter = {
  name: "distillate/bloom",
  create: (n) => BloomFilter.create(n, TARGET_FPR),
  build(keys) {
    const f = BloomFilter.create(keys.length, TARGET_FPR);
    for (const key of keys) f.add(key);
    return { has: (key) => f.has(key), bitsPerKey: f.bitsPerKey };
  },
};

export const bloomFiltersAdapter: Adapter = {
  name: "bloom-filters",
  create: (n) => BloomFiltersBloom.create(n, TARGET_FPR),
  build(keys) {
    const f = BloomFiltersBloom.create(keys.length, TARGET_FPR);
    for (const key of keys) f.add(key);
    return { has: (key) => f.has(key), bitsPerKey: f.size / keys.length };
  },
};

export function optimalMK(n: number, eps: number): { m: number; k: number } {
  const m = Math.ceil((-n * Math.log(eps)) / Math.LN2 ** 2);
  const k = Math.max(1, Math.round((m / n) * Math.LN2));
  return { m, k };
}

export const bloomfilterAdapter: Adapter = {
  name: "bloomfilter",
  create(n) {
    const { m, k } = optimalMK(n, TARGET_FPR);
    const f = new JasonBloom(m, k);
    return { add: (key) => f.add(key), has: (key) => f.test(key) };
  },
  build(keys) {
    const { m, k } = optimalMK(keys.length, TARGET_FPR);
    const f = new JasonBloom(m, k);
    for (const key of keys) f.add(key);
    const actualBits = (f as unknown as { m: number }).m;
    return { has: (key) => f.test(key), bitsPerKey: actualBits / keys.length };
  },
};

export const adapters: Adapter[] = [
  distillateBloomAdapter,
  bloomFiltersAdapter,
  bloomfilterAdapter,
];
