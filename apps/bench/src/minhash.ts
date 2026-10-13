import { MinHash } from "distillate/minhash";
import { Minhash as PackageMinhash } from "minhash";

import { Hashing, MinHashFactory } from "./incumbent.js";
import { median } from "./keylength.js";

export interface SimilaritySketch {
  add(item: string): void;
  /** Estimated Jaccard similarity with a sketch from the same family. */
  jaccard(other: SimilaritySketch): number;
  /** Bytes the sketch serializes to, each library in its own form. */
  bytes(): number;
  /** Slots in the signature, read back from the library. */
  k: number;
}

export interface SimilarityAdapter {
  name: string;
  /**
   * Sketches that can be compared with each other. Each library needs its
   * sketches to share hash functions: distillate a seed, `bloom-filters` a
   * factory, `minhash` the permutations its seed generates.
   */
  family(k: number): () => SimilaritySketch;
}

/** Slots every library is built with. */
export const MINHASH_K = 128;

type Wrapped<T> = SimilaritySketch & { inner: T };

export const distillateMinHashAdapter: SimilarityAdapter = {
  name: "distillate/minhash",
  family(k) {
    return (): Wrapped<MinHash> => {
      const inner = new MinHash({ k });
      return {
        inner,
        add: (item) => {
          inner.add(item);
        },
        jaccard: (other) => inner.jaccard((other as Wrapped<MinHash>).inner),
        bytes: () => inner.toBytes().length,
        k: inner.k,
      };
    };
  },
};

/**
 * `bloom-filters` hashes numbers only, each at most the factory's `maxValue`,
 * so a caller with strings has to turn them into integers first. Its own
 * `Hashing.hashAsInt` is the obvious tool, but it returns a 64-bit xxhash as a
 * double, past both `maxValue` and 2^53, so it is reduced to 32 bits here to
 * fit a 32-bit `maxValue`.
 *
 * Its slots are `(a * x + b) % c` in doubles, with `a` and `b` drawn from
 * lodash's unseeded `random`: a fresh factory hashes differently every run, so
 * its error column moves between runs where the others do not.
 */
export const incumbentMinHashAdapter: SimilarityAdapter = {
  name: "bloom-filters",
  family(k) {
    const factory = new MinHashFactory(k, 2 ** 32 - 1);
    const hashing = new Hashing();
    return () => {
      const inner = factory.create();
      return {
        inner,
        add: (item) => {
          inner.add(hashing.hashAsInt(item) % 2 ** 32);
        },
        jaccard: (other) =>
          inner.compareWith((other as Wrapped<typeof inner>).inner),
        bytes: () => JSON.stringify(inner.saveAsJSON()).length,
        k: inner.nbHashes,
      } satisfies Wrapped<typeof inner>;
    };
  },
};

/**
 * `minhash` has no serializer; its signature is a plain array, so the JSON of
 * that array is what a caller would persist.
 */
export const packageMinHashAdapter: SimilarityAdapter = {
  name: "minhash",
  family(k) {
    return (): Wrapped<PackageMinhash> => {
      const inner = new PackageMinhash({ numPerm: k });
      return {
        inner,
        add: (item) => {
          inner.update(item);
        },
        jaccard: (other) =>
          inner.jaccard((other as Wrapped<PackageMinhash>).inner),
        bytes: () => JSON.stringify(inner.hashvalues).length,
        k: inner.numPerm,
      };
    };
  },
};

export const similarityAdapters: SimilarityAdapter[] = [
  distillateMinHashAdapter,
  incumbentMinHashAdapter,
  packageMinHashAdapter,
];

/** Items per sketch, a thousand to a hundred thousand. */
export const MINHASH_SET_SIZES = [1_000, 10_000, 100_000];

export const MINHASH_WARM_PASSES = 2;
export const MINHASH_TIMED_PASSES = 5;

/** Pairs the error columns average over, each at J = 0.5. */
const ERROR_PAIRS = 20;

export interface MinHashRow {
  name: string;
  items: number;
  bytes: number;
  /** Mean of |estimate - J| over the pairs. */
  meanAbsError: number;
  /** Largest |estimate - J| seen. */
  maxAbsError: number;
  addOpsPerSec: number;
}

const keys = (prefix: string, n: number): string[] =>
  Array.from({ length: n }, (_, i) => `${prefix}:${String(i)}`);

export function minHashRows(
  sizes: number[],
  adapters: SimilarityAdapter[] = similarityAdapters,
): MinHashRow[] {
  const rows: MinHashRow[] = [];
  for (const items of sizes) {
    const stream = keys("add", items);
    // Pairs whose union holds `items` keys: half shared, a quarter each side's
    // own, so J = 0.5. Built once and shared by every library.
    const pairs = Array.from({ length: ERROR_PAIRS }, (_, p) => {
      const shared = keys(`p${String(p)}s`, items / 2);
      return [
        [...shared, ...keys(`p${String(p)}a`, items / 4)],
        [...shared, ...keys(`p${String(p)}b`, items / 4)],
      ];
    });

    for (const adapter of adapters) {
      const create = adapter.family(MINHASH_K);
      const sketchOf = (list: string[]): SimilaritySketch => {
        const s = create();
        for (const item of list) s.add(item);
        return s;
      };

      // A fresh sketch every pass, so each times the same work from empty.
      const pass = (): { s: SimilaritySketch; ms: number } => {
        const s = create();
        const started = performance.now();
        for (const item of stream) s.add(item);
        return { s, ms: performance.now() - started };
      };
      for (let p = 0; p < MINHASH_WARM_PASSES; p++) pass();
      const timed = Array.from({ length: MINHASH_TIMED_PASSES }, pass);
      const addMs = median(timed.map((t) => t.ms));
      const last = timed.at(-1)?.s ?? pass().s;

      let sum = 0;
      let max = 0;
      for (const [a = [], b = []] of pairs) {
        const err = Math.abs(sketchOf(a).jaccard(sketchOf(b)) - 0.5);
        sum += err;
        if (err > max) max = err;
      }

      rows.push({
        name: adapter.name,
        items,
        bytes: last.bytes(),
        meanAbsError: sum / pairs.length,
        maxAbsError: max,
        addOpsPerSec: items / (addMs / 1000),
      });
    }
  }
  return rows;
}
