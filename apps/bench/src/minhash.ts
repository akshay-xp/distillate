import { MinHash } from "distillate/minhash";
import { Minhash as PackageMinhash } from "minhash";

import { Hashing, MinHashFactory } from "./incumbent.js";

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
