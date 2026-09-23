/**
 * Stream generators and scoring for frequency structures, the counting
 * counterpart to the membership helpers in `fpr.ts`.
 */

/** Occurrences of each distinct key in `stream`. */
export function truthOf(stream: readonly string[]): Map<string, number> {
  const truth = new Map<string, number>();
  for (const key of stream) truth.set(key, (truth.get(key) ?? 0) + 1);
  return truth;
}

// xorshift32: a seeded generator, so a failing accuracy run reproduces exactly.
function rng(seed: number): () => number {
  let x = seed | 0 || 1;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 0x100000000;
  };
}

/**
 * `events` keys drawn from a Zipf distribution over `distinct` keys: rank `i`
 * appears with probability proportional to `1 / (i + 1) ** exponent`.
 *
 * This is the shape a frequency sketch exists for. A uniform stream spreads
 * counts evenly and hides the collisions between a heavy key and the many
 * light keys sharing its column, which is where a Count-Min estimate is
 * actually tested.
 */
export function zipfStream(
  seed: number,
  distinct: number,
  events: number,
  exponent: number,
): string[] {
  // Cumulative weights once, then one binary search per event.
  const cdf = new Float64Array(distinct);
  let total = 0;
  for (let i = 0; i < distinct; i++) {
    total += 1 / (i + 1) ** exponent;
    cdf[i] = total;
  }

  const next = rng(seed);
  const out = new Array<string>(events);
  for (let e = 0; e < events; e++) {
    const target = next() * total;
    let lo = 0;
    let hi = distinct - 1;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if ((cdf[mid] ?? 0) < target) lo = mid + 1;
      else hi = mid;
    }
    out[e] = `key:${String(lo)}`;
  }
  return out;
}

/** `events` keys drawn uniformly from `distinct` keys. */
export function uniformStream(
  seed: number,
  distinct: number,
  events: number,
): string[] {
  const next = rng(seed);
  const out = new Array<string>(events);
  for (let e = 0; e < events; e++) {
    out[e] = `key:${String(Math.floor(next() * distinct))}`;
  }
  return out;
}

/** A 64-character prefix, so keys differ only in their tail. */
const PREFIX = "p".repeat(64);

/**
 * `events` keys sharing a long common prefix and differing only in a numeric
 * suffix. Catches a hash that under-mixes the head of a key.
 */
export function prefixedStream(
  seed: number,
  distinct: number,
  events: number,
): string[] {
  return uniformStream(seed, distinct, events).map(
    (key) => `${PREFIX}${key.slice(4)}`,
  );
}

/** How a sketch's estimates score against the truth. */
export interface Overestimate {
  /** Keys whose estimate exceeded the bound. */
  violations: number;
  /** Distinct keys scored. */
  keys: number;
  /** Mean overestimate across distinct keys. */
  mean: number;
  /** Largest overestimate seen. */
  max: number;
}

/**
 * Scores `count` against `truth`: how far each estimate sits above the true
 * occurrence count, and how many exceeded `bound`.
 *
 * Throws on an underestimate rather than recording it, since that is the one
 * outcome the structure rules out and it should fail loudly wherever it shows
 * up rather than being averaged into a mean.
 */
export function scoreOverestimate(
  count: (key: string) => number,
  truth: Map<string, number>,
  bound: number,
): Overestimate {
  let violations = 0;
  let sum = 0;
  let max = 0;
  for (const [key, actual] of truth) {
    const over = count(key) - actual;
    if (over < 0) {
      throw new Error(
        `underestimate for ${key}: ${String(count(key))} below ${String(actual)}`,
      );
    }
    if (over > bound) violations++;
    sum += over;
    if (over > max) max = over;
  }
  return { violations, keys: truth.size, mean: sum / truth.size, max };
}
