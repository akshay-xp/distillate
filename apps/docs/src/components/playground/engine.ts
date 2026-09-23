import { BlockedBloomFilter, ParamError } from "distillate/blocked";
import { BloomFilter } from "distillate/bloom";
import { CountMinSketch } from "distillate/countmin";
import { CuckooFilter, CuckooFullError } from "distillate/cuckoo";
import { BinaryFuse8, BinaryFuseBuildError } from "distillate/fuse";
import { ScalableBloomFilter } from "distillate/scalable";

import { RATE_MESSAGE, toNumber } from "../../lib/form.js";

/** The five shipped filters, side by side over one key set. */
export type StructureKey =
  "bloom" | "blocked" | "fuse8" | "scalable" | "cuckoo";

/** What one structure did with the key set it was given. */
export interface StructureReport {
  /** Keys this structure holds. */
  heldKeys: number;
  /** Held keys `has()` cannot find. Always zero: these filters have no false negatives. */
  missing: number;
  bitsPerKey: number;
  totalBytes: number;
  /** Tables the structure holds. Only Scalable Bloom ever has more than one. */
  stages: number;
  /** Miss-set keys `has()` claims are members. */
  falsePositives: number;
  measuredFpr: number;
}

/** What the sketch says about one key, beside what is actually true. */
export interface CountReport {
  key: string;
  /** Occurrences actually recorded, which the page tracks itself. */
  trueCount: number;
  /** The sketch's answer, never below `trueCount`. */
  estimate: number;
  /** `estimate - trueCount`, the thing worth looking at. */
  overestimate: number;
  /** Everything the sketch has recorded, the denominator of its bound. */
  total: number;
}

/** What one structure says about one queried key. */
export type Verdict =
  "member" | "false positive" | "absent" | "added after build";

/** One query, answered by all five structures at once. */
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

export type GrowResult =
  | {
      ok: true;
      keyCount: number;
      /** Added keys Cuckoo had no room for. It is sized for the build. */
      cuckooRefused: number;
    }
  | { ok: false; message: string };

export type RemoveResult =
  | {
      ok: true;
      key: string;
      /** Why the other filters kept the key. */
      refusal: string;
    }
  | { ok: false; message: string };

/**
 * Failure probability the sketch is built at. Fixed rather than exposed: the
 * page already asks for one error knob, and a second would be the only control
 * here that does not change what any other structure does.
 */
const COUNTMIN_DELTA = 0.01;

/** How many never-inserted keys the measured rate is averaged over. */
export const PROBE_COUNT = 20_000;

/** Most keys the playground will build from. Past this it refuses rather than wedge the tab. */
export const MAX_KEYS = 100_000;

const KEY_COUNT_MESSAGE = `Key count must be a whole number between 1 and ${MAX_KEYS.toLocaleString("en-US")}. The playground builds real filters in your browser, so it stops there.`;

const GROW_MESSAGE = `Keys to add must be a whole number of at least 1, and the total held must stay at or under ${MAX_KEYS.toLocaleString("en-US")}. The playground builds real filters in your browser, so it stops there.`;

const DELETE_REFUSAL =
  "Classic, Blocked and Scalable Bloom set bits shared with other keys, so they cannot take one back; Binary Fuse is static. They still hold it.";

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
  countmin: CountMinSketch;
  blocked: BlockedBloomFilter;
  fuse8: BinaryFuse8;
  scalable: ScalableBloomFilter;
  cuckoo: CuckooFilter;
}

function describe(
  filter: { has: (key: string) => boolean; bitsPerKey: number },
  held: readonly string[],
  probes: readonly string[],
  bits: number,
  stages = 1,
): StructureReport {
  let missing = 0;
  for (const key of held) if (!filter.has(key)) missing += 1;
  let falsePositives = 0;
  for (const probe of probes) if (filter.has(probe)) falsePositives += 1;
  return {
    heldKeys: held.length,
    missing,
    bitsPerKey: filter.bitsPerKey,
    totalBytes: Math.ceil(bits / 8),
    stages,
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
  /** Everything the Bloom filters hold, the build set plus late arrivals. */
  readonly #keys: string[];
  /** The same keys as a set, to answer one query without walking anything. */
  readonly #inserted: Set<string>;
  /** Just the late arrivals, so a query can tell them from the build set. */
  readonly #late = new Set<string>();
  readonly #probes: string[];
  readonly #target: number;
  readonly #filters: Filters;
  /** Inserted keys Cuckoo does not hold: refused when full, or deleted. */
  readonly #notInCuckoo = new Set<string>();
  /** Set by the first refused add; see #addToCuckoo. */
  #cuckooFull = false;
  /** Keys generated so far, so growth continues the `key-<i>` sequence. */
  #generated: number;
  /** Occurrences per key, so the panel can show the sketch's error exactly. */
  readonly #counts = new Map<string, number>();

  private constructor(keys: string[], target: number, filters: Filters) {
    this.#built = keys;
    this.#generated = keys.length;
    this.#keys = [...keys];
    this.#inserted = new Set(keys);
    this.#probes = probeKeys();
    this.#target = target;
    this.#filters = filters;
    for (const key of keys) this.#counts.set(key, 1);
  }

  /** Builds all five structures from `keyCount` generated keys. */
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
        scalable: ScalableBloomFilter.from(keys, epsilon),
        cuckoo: CuckooFilter.from(keys, epsilon),
        countmin: CountMinSketch.from(keys, epsilon, COUNTMIN_DELTA),
      };
    } catch (error) {
      return { ok: false, message: toMessage(error) };
    }
    return { ok: true, playground: new Playground(keys, epsilon, filters) };
  }

  /**
   * Adds one key. The Bloom filters take it; Binary Fuse is static and cannot,
   * so the reason comes back rather than being thrown.
   */
  insert(key: string): InsertReport {
    this.#add(key);
    return {
      key,
      keyCount: this.#keys.length,
      fuseRefusal: `Binary Fuse is static: it was built from ${this.#built.length.toLocaleString("en-US")} keys in one pass and has no add. To include this key you rebuild the whole filter. Classic, Blocked, Scalable Bloom and Cuckoo took it.`,
    };
  }

  /** Adds `count` more generated keys, enough to carry the filters past their build. */
  grow(count: unknown): GrowResult {
    const n = toNumber(count);
    if (!Number.isInteger(n) || n < 1 || this.#keys.length + n > MAX_KEYS) {
      return { ok: false, message: GROW_MESSAGE };
    }
    const refusedBefore = this.#notInCuckoo.size;
    const end = this.#generated + n;
    for (; this.#generated < end; this.#generated += 1) {
      this.#add(`key-${String(this.#generated)}`);
    }
    return {
      ok: true,
      keyCount: this.#keys.length,
      cuckooRefused: this.#notInCuckoo.size - refusedBefore,
    };
  }

  /**
   * Deletes one key from Cuckoo, the only filter here that can. Only a key
   * Cuckoo holds is deleted: any other can share a held key's fingerprint and
   * would remove that one instead, so the refusal comes back as a message.
   */
  remove(key: string): RemoveResult {
    if (!this.#inserted.has(key) || this.#notInCuckoo.has(key)) {
      return {
        ok: false,
        message: `Cuckoo can only delete keys it holds, and "${key}" is not one of them. Only delete keys you added and have not already deleted: any other key can share a held key's fingerprint, and deleting it would remove that key instead.`,
      };
    }
    this.#filters.cuckoo.delete(key);
    this.#notInCuckoo.add(key);
    // A freed slot means a later add may fit again.
    this.#cuckooFull = false;
    return { ok: true, key, refusal: DELETE_REFUSAL };
  }

  #add(key: string): void {
    if (this.#inserted.has(key)) {
      // Deleted from Cuckoo only: the Bloom filters still hold it.
      if (this.#notInCuckoo.delete(key)) this.#addToCuckoo(key);
      return;
    }
    this.#filters.bloom.add(key);
    this.#filters.blocked.add(key);
    this.#filters.scalable.add(key);
    this.#addToCuckoo(key);
    this.#keys.push(key);
    this.#inserted.add(key);
    this.#late.add(key);
  }

  // A full Cuckoo refuses rather than drops a key it holds, so the key is
  // recorded as not held and every earlier one is still found. Once one add
  // is refused the table is at its load limit and nearly every later add
  // would fail too, each after 500 kicks and an undo, so the playground stops
  // offering keys until a delete frees a slot.
  #addToCuckoo(key: string): void {
    if (this.#cuckooFull) {
      this.#notInCuckoo.add(key);
      return;
    }
    try {
      this.#filters.cuckoo.add(key);
    } catch (error) {
      if (!(error instanceof CuckooFullError)) throw error;
      this.#notInCuckoo.add(key);
      this.#cuckooFull = true;
    }
  }

  /** Answers one query across all five structures. */
  lookup(key: string): Lookup {
    const inserted = this.#inserted.has(key);
    const late = this.#late.has(key);
    const verdict = (
      filter: { has: (k: string) => boolean },
      held = inserted,
    ): Verdict => {
      if (!filter.has(key)) return "absent";
      return held ? "member" : "false positive";
    };
    const { bloom, blocked, fuse8, scalable, cuckoo } = this.#filters;
    return {
      key,
      inserted,
      verdicts: {
        bloom: verdict(bloom),
        blocked: verdict(blocked),
        // A key the fuse filter never saw is outside its build, not a false
        // negative. Saying so is the whole point of showing it.
        fuse8: late ? "added after build" : verdict(fuse8),
        scalable: verdict(scalable),
        // A key Cuckoo refused or had deleted is not one it holds.
        cuckoo: verdict(cuckoo, inserted && !this.#notInCuckoo.has(key)),
      },
    };
  }

  /** What the sketch says about `key`, beside the count the page recorded. */
  estimate(key: string): CountReport {
    const trueCount = this.#counts.get(key) ?? 0;
    const estimate = this.#filters.countmin.count(key);
    return {
      key,
      trueCount,
      estimate,
      overestimate: estimate - trueCount,
      total: this.#filters.countmin.total,
    };
  }

  report(): PlaygroundReport {
    const { bloom, blocked, fuse8, scalable, cuckoo } = this.#filters;
    // A probe the reader has since inserted is a member, so it leaves the miss
    // set rather than being counted as a false positive.
    const probes =
      this.#late.size === 0
        ? this.#probes
        : this.#probes.filter((p) => !this.#late.has(p));
    // Only Scalable Bloom allocates on add; the rest stay priced at the build.
    const n = this.#built.length;
    return {
      keyCount: this.#keys.length,
      target: this.#target,
      probeCount: probes.length,
      structures: {
        bloom: describe(bloom, this.#keys, probes, bloom.bitsPerKey * n),
        blocked: describe(blocked, this.#keys, probes, blocked.bitsPerKey * n),
        fuse8: describe(fuse8, this.#built, probes, fuse8.bitsPerKey * n),
        scalable: describe(
          scalable,
          this.#keys,
          probes,
          scalable.m,
          scalable.stages,
        ),
        cuckoo: describe(
          cuckoo,
          this.#keys.filter((k) => !this.#notInCuckoo.has(k)),
          probes,
          cuckoo.m,
        ),
      },
    };
  }
}
