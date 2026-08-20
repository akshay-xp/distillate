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
  keys: readonly string[],
  probes: readonly string[],
): StructureReport {
  let missing = 0;
  for (const key of keys) if (!filter.has(key)) missing += 1;
  let falsePositives = 0;
  for (const probe of probes) if (filter.has(probe)) falsePositives += 1;
  return {
    heldKeys: keys.length,
    missing,
    bitsPerKey: filter.bitsPerKey,
    totalBytes: Math.ceil((filter.bitsPerKey * keys.length) / 8),
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
  readonly #keys: string[];
  readonly #probes: string[];
  readonly #target: number;
  readonly #filters: Filters;

  private constructor(keys: string[], target: number, filters: Filters) {
    this.#keys = keys;
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

  report(): PlaygroundReport {
    const { bloom, blocked, fuse8 } = this.#filters;
    return {
      keyCount: this.#keys.length,
      target: this.#target,
      probeCount: this.#probes.length,
      structures: {
        bloom: describe(bloom, this.#keys, this.#probes),
        blocked: describe(blocked, this.#keys, this.#probes),
        fuse8: describe(fuse8, this.#keys, this.#probes),
      },
    };
  }
}
