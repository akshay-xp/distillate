import { assertProbability } from "../core/params.js";

/** Which approximation of the logarithm a mapping bins values by. */
export type MappingKind = "log";

/**
 * Maps a positive value to the integer index of the bin holding it, and an
 * index back to a value within `relativeAccuracy` of everything in that bin.
 */
export interface IndexMapping {
  /** Which approximation of the logarithm the mapping uses. */
  readonly kind: MappingKind;
  /** The base the bins grow by. */
  readonly gamma: number;
  /** Shift added to every index, carried so foreign sketches decode exactly. */
  readonly indexOffset: number;
  /** The relative error any value read back from a bin is within. */
  readonly relativeAccuracy: number;
  /** The smallest value with a bin; anything smaller counts as zero. */
  readonly minIndexableValue: number;
  /** The largest value with a bin. */
  readonly maxIndexableValue: number;
  /** The bin index of a value in the indexable range. */
  index(value: number): number;
  /** The value a bin reads back as. */
  value(index: number): number;
  /** The smallest value that falls in a bin. */
  lowerBound(index: number): number;
}

const MIN_INT32 = -(2 ** 31);
const MAX_INT32 = 2 ** 31 - 1;
const MIN_NORMAL = 2 ** -1022;
// The argument past which the reference's exp overflows.
const EXP_OVERFLOW = 709.4361393031;

// The arithmetic every mapping shares. Subclasses supply the logarithm they
// approximate and its inverse; index() and lowerBound() reproduce the
// reference implementations operation for operation, since a reordered
// expression rounds differently and moves boundary values between bins.
abstract class LogLikeMapping implements IndexMapping {
  abstract readonly kind: MappingKind;

  constructor(
    readonly gamma: number,
    readonly indexOffset: number,
    protected readonly multiplier: number,
    readonly relativeAccuracy: number,
    readonly minIndexableValue: number,
    readonly maxIndexableValue: number,
  ) {}

  protected abstract log(value: number): number;
  protected abstract logInverse(index: number): number;

  index(value: number): number {
    const index = this.log(value) * this.multiplier + this.indexOffset;
    // Truncate, then step down when negative: the reference's floor, which
    // also steps down at an exact negative integer.
    return index >= 0 ? Math.trunc(index) : Math.trunc(index) - 1;
  }

  value(index: number): number {
    return this.lowerBound(index) * (1 + this.relativeAccuracy);
  }

  lowerBound(index: number): number {
    return this.logInverse((index - this.indexOffset) / this.multiplier);
  }
}

// sketches-go LogarithmicMapping.
class LogMapping extends LogLikeMapping {
  readonly kind = "log";

  constructor(gamma: number, indexOffset: number) {
    const multiplier = 1 / Math.log(gamma);
    super(
      gamma,
      indexOffset,
      multiplier,
      1 - 2 / (1 + gamma),
      Math.max(
        Math.exp((MIN_INT32 - indexOffset) / multiplier + 1),
        MIN_NORMAL * gamma,
      ),
      Math.min(
        Math.exp((MAX_INT32 - indexOffset) / multiplier - 1),
        (Math.exp(EXP_OVERFLOW) / (2 * gamma)) * (gamma + 1),
      ),
    );
  }

  protected log(value: number): number {
    return Math.log(value);
  }

  protected logInverse(index: number): number {
    return Math.exp(index);
  }
}

function exactLogGamma(relativeAccuracy: number): number {
  assertProbability(relativeAccuracy, "relativeAccuracy");
  return (1 + relativeAccuracy) / (1 - relativeAccuracy);
}

/**
 * A mapping whose bins grow by exactly `gamma`: the most compact for a given
 * accuracy, at the cost of a `Math.log` per value.
 *
 * @param relativeAccuracy - Relative error bound, in `(0, 1)`.
 * @throws {@link ParamError} when `relativeAccuracy` is outside `(0, 1)`.
 */
export function logMapping(relativeAccuracy: number): IndexMapping {
  return new LogMapping(exactLogGamma(relativeAccuracy), 0);
}

const MAPPINGS = {
  log: LogMapping,
} satisfies Record<
  MappingKind,
  new (gamma: number, indexOffset: number) => IndexMapping
>;

/** Rebuilds a mapping from the parameters a serialized sketch carries. */
export function mappingWithGamma(
  kind: MappingKind,
  gamma: number,
  indexOffset: number,
): IndexMapping {
  return new MAPPINGS[kind](gamma, indexOffset);
}
