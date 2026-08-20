import { BlockedBloomFilter, ParamError } from "distillate/blocked";
import { BloomFilter } from "distillate/bloom";
import { BinaryFuse8, BinaryFuseBuildError } from "distillate/fuse";

import { RATE_MESSAGE, toNumber } from "../../lib/form.js";

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
  /** Miss-set keys `has()` claims are members. */
  falsePositives: number;
  measuredFpr: number;
}

/** What one structure says about one queried key. */
export type Verdict =
  "member" | "false positive" | "absent" | "added after build";

/** One query, answered by all three structures at once. */
export interface Lookup {
  key: string;
  inserted: boolean;
  verdicts: Record<StructureKey, Verdict>;
}

/** What happened to one key added after the build. */
export interface InsertReport {
  key: string;
  keyCount: number;
  /** Why Binary Fuse could not take it. Always set: it is static. */
  fuseRefusal: string;
}

/** A snapshot of the whole playground, enough to render it. */
export interface PlaygroundReport {
  keyCount: number;
  target: number;
  /** Size of the miss set the rate was measured over. */
  probeCount: number;
  structures: Record<StructureKey, StructureReport>;
}

export type BuildResult =
  { ok: true; playground: Playground } | { ok: false; message: string };

/** How many never-inserted keys the measured rate is averaged over. */
export const PROBE_COUNT = 20_000;

/** Most keys the playground will build from. Past this it refuses rather than wedge the tab. */
export const MAX_KEYS = 100_000;

const KEY_COUNT_MESSAGE = `Key count must be a whole number between 1 and ${MAX_KEYS.toLocaleString("en-US")}. The playground builds real filters in your browser, so it stops there.`;

// Members and probes are told apart by prefix, so the miss set is disjoint
// from the key set by construction rather than by a filtering pass.
function memberKeys(count: number): string[] {
  const keys = new Array<string>(count);
  for (let i = 0; i < count; i += 1) keys[i] = `key-${String(i)}`;
  return keys;
}

function probeKeys(): string[] {
  const keys = new Array<string>(PROBE_COUNT);
  for (let i = 0; i < PROBE_COUNT; i += 1) keys[i] = `miss-${String(i)}`;
  return keys;
}

interface Filters {
  bloom: BloomFilter;
  blocked: BlockedBloomFilter;
  fuse8: BinaryFuse8;
}

function describe(
  filter: { has: (key: string) => boolean; bitsPerKey: number },
  held: readonly string[],
  probes: readonly string[],
  buildCount: number,
): StructureReport {
  let missing = 0;
  for (const key of held) if (!filter.has(key)) missing += 1;
  let falsePositives = 0;
  for (const probe of probes) if (filter.has(probe)) falsePositives += 1;
  return {
    heldKeys: held.length,
    missing,
    bitsPerKey: filter.bitsPerKey,
    // Neither filter reallocates on add, so space stays priced at the build.
    totalBytes: Math.ceil((filter.bitsPerKey * buildCount) / 8),
    falsePositives,
    measuredFpr: falsePositives / probes.length,
  };
}

/**
 * Turns an error the library threw into something a reader can act on.
 *
 * @throws the original error if it is not one the page knows how to explain.
 */
export function toMessage(error: unknown): string {
  if (error instanceof ParamError) return error.message;
  // The library says only "binary fuse construction failed", which is true and
  // useless. Peeling retries 100 deterministic seeds, so the same key set fails
  // the same way every time and a different key count is the only way out.
  if (error instanceof BinaryFuseBuildError) {
    return "Binary Fuse could not build from this key set: the peeling step did not converge. Change the key count and try again.";
  }
  throw error;
}

/** A built set of filters over generated keys, ready to be queried. */
export class Playground {
  /** Keys the fuse filter was built from. Fixed: it cannot take any more. */
  readonly #built: string[];
  /** Everything the two bloom filters hold, the build set plus late arrivals. */
  readonly #keys: string[];
  /** The same keys as a set, to answer one query without walking anything. */
  readonly #inserted: Set<string>;
  /** Just the late arrivals, so a query can tell them from the build set. */
  readonly #late = new Set<string>();
  readonly #probes: string[];
  readonly #target: number;
  readonly #filters: Filters;

  private constructor(keys: string[], target: number, filters: Filters) {
    this.#built = keys;
    this.#keys = [...keys];
    this.#inserted = new Set(keys);
    this.#probes = probeKeys();
    this.#target = target;
    this.#filters = filters;
  }

  /** Builds all three structures from `keyCount` generated keys. */
  static build(keyCount: unknown, target: unknown): BuildResult {
    const n = toNumber(keyCount);
    if (!Number.isInteger(n) || n < 1 || n > MAX_KEYS) {
      return { ok: false, message: KEY_COUNT_MESSAGE };
    }
    // Only non-numeric input is caught here. What counts as a usable rate is
    // the library's to say, and it says it well enough to show verbatim.
    const epsilon = toNumber(target);
    if (Number.isNaN(epsilon)) return { ok: false, message: RATE_MESSAGE };

    const keys = memberKeys(n);
    let filters: Filters;
    try {
      filters = {
        bloom: BloomFilter.from(keys, epsilon),
        blocked: BlockedBloomFilter.from(keys, epsilon),
        fuse8: BinaryFuse8.from(keys),
      };
    } catch (error) {
      return { ok: false, message: toMessage(error) };
    }
    return { ok: true, playground: new Playground(keys, epsilon, filters) };
  }

  /**
   * Adds one key. The bloom filters take it; Binary Fuse is static and cannot,
   * so the reason comes back rather than being thrown.
   */
  insert(key: string): InsertReport {
    if (!this.#inserted.has(key)) {
      this.#filters.bloom.add(key);
      this.#filters.blocked.add(key);
      this.#keys.push(key);
      this.#inserted.add(key);
      this.#late.add(key);
    }
    return {
      key,
      keyCount: this.#keys.length,
      fuseRefusal: `Binary Fuse is static: it was built from ${this.#built.length.toLocaleString("en-US")} keys in one pass and has no add. To include this key you rebuild the whole filter. Classic and Blocked Bloom took it.`,
    };
  }

  /** Answers one query across all three structures. */
  lookup(key: string): Lookup {
    const inserted = this.#inserted.has(key);
    const late = this.#late.has(key);
    const verdict = (filter: { has: (k: string) => boolean }): Verdict => {
      if (!filter.has(key)) return "absent";
      return inserted ? "member" : "false positive";
    };
    const { bloom, blocked, fuse8 } = this.#filters;
    return {
      key,
      inserted,
      verdicts: {
        bloom: verdict(bloom),
        blocked: verdict(blocked),
        // A key the fuse filter never saw is outside its build, not a false
        // negative. Saying so is the whole point of showing it.
        fuse8: late ? "added after build" : verdict(fuse8),
      },
    };
  }

  report(): PlaygroundReport {
    const { bloom, blocked, fuse8 } = this.#filters;
    // A probe the reader has since inserted is a member, so it leaves the miss
    // set rather than being counted as a false positive.
    const probes =
      this.#late.size === 0
        ? this.#probes
        : this.#probes.filter((p) => !this.#late.has(p));
    const n = this.#built.length;
    return {
      keyCount: this.#keys.length,
      target: this.#target,
      probeCount: probes.length,
      structures: {
        bloom: describe(bloom, this.#keys, probes, n),
        blocked: describe(blocked, this.#keys, probes, n),
        fuse8: describe(fuse8, this.#built, probes, n),
      },
    };
  }
}
