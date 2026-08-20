import { BlockedBloomFilter } from "distillate/blocked";
import { BloomFilter } from "distillate/bloom";
import { BinaryFuse8 } from "distillate/fuse";

/** The three shipped structures, side by side over one key set. */
export type StructureKey = "bloom" | "blocked" | "fuse8";

/** What one structure did with the key set it was given. */
export interface StructureReport {
  /** Keys this structure holds. */
  heldKeys: number;
  /** Held keys `has()` cannot find. Always zero: these filters have no false negatives. */
  missing: number;
  bitsPerKey: number;
  totalBytes: number;
}

/** A snapshot of the whole playground, enough to render it. */
export interface PlaygroundReport {
  keyCount: number;
  target: number;
  structures: Record<StructureKey, StructureReport>;
}

export type BuildResult =
  { ok: true; playground: Playground } | { ok: false; message: string };

function memberKeys(count: number): string[] {
  const keys = new Array<string>(count);
  for (let i = 0; i < count; i += 1) keys[i] = `key-${String(i)}`;
  return keys;
}

interface Filters {
  bloom: BloomFilter;
  blocked: BlockedBloomFilter;
  fuse8: BinaryFuse8;
}

function describe(
  filter: { has: (key: string) => boolean; bitsPerKey: number },
  keys: readonly string[],
): StructureReport {
  let missing = 0;
  for (const key of keys) if (!filter.has(key)) missing += 1;
  return {
    heldKeys: keys.length,
    missing,
    bitsPerKey: filter.bitsPerKey,
    totalBytes: Math.ceil((filter.bitsPerKey * keys.length) / 8),
  };
}

/** A built set of filters over generated keys, ready to be queried. */
export class Playground {
  readonly #keys: string[];
  readonly #target: number;
  readonly #filters: Filters;

  private constructor(keys: string[], target: number, filters: Filters) {
    this.#keys = keys;
    this.#target = target;
    this.#filters = filters;
  }

  /** Builds all three structures from `keyCount` generated keys. */
  static build(keyCount: number, target: number): BuildResult {
    const keys = memberKeys(keyCount);
    return {
      ok: true,
      playground: new Playground(keys, target, {
        bloom: BloomFilter.from(keys, target),
        blocked: BlockedBloomFilter.from(keys, target),
        fuse8: BinaryFuse8.from(keys),
      }),
    };
  }

  report(): PlaygroundReport {
    return {
      keyCount: this.#keys.length,
      target: this.#target,
      structures: {
        bloom: describe(this.#filters.bloom, this.#keys),
        blocked: describe(this.#filters.blocked, this.#keys),
        fuse8: describe(this.#filters.fuse8, this.#keys),
      },
    };
  }
}
