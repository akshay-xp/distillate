import { assertProbability } from "../core/params.js";

/** Which approximation of the logarithm a mapping bins values by. */
export type MappingKind = "log" | "linear" | "quadratic" | "cubic";

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

// Reinterprets a float's bits, big-endian so word 0 is the sign, exponent and
// top of the significand.
const bits = new DataView(new ArrayBuffer(8));

// The unbiased binary exponent of a positive normal float.
function exponentOf(value: number): number {
  bits.setFloat64(0, value);
  return ((bits.getUint32(0) >>> 20) & 0x7ff) - 1023;
}

// The significand of a positive normal float, as a value in [1, 2).
function significandPlusOne(value: number): number {
  bits.setFloat64(0, value);
  bits.setUint32(0, (bits.getUint32(0) & 0x000fffff) | 0x3ff00000);
  return bits.getFloat64(0);
}

// 2^exponent times a significand in [1, 2), assembled from bits.
function buildFloat(exponent: number, significandPlusOne: number): number {
  bits.setFloat64(0, significandPlusOne);
  bits.setUint32(
    0,
    (bits.getUint32(0) & 0x000fffff) | (((exponent + 1023) & 0x7ff) << 20),
  );
  return bits.getFloat64(0);
}

// Go's math.Log2, which the Go mappings derive their multiplier from. It
// rounds differently from Math.log2, and the multiplier must match the
// reference's to the bit. Only ever called on gamma, a normal float above 1.
// Go special-cases a fraction of exactly 0.5; in JS the general expression
// already gives exactly exponent - 1 there.
function goLog2(value: number): number {
  const fraction = significandPlusOne(value) / 2;
  return Math.log(fraction) * Math.LOG2E + (exponentOf(value) + 1);
}

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

// The indexable range of sketches-go's interpolated mappings: wide enough
// that every index fits an int32, narrow enough that the bins' values stay
// finite. adjustedGamma is gamma raised to the mapping's correction.
function goIndexableRange(
  indexOffset: number,
  multiplier: number,
  adjustedGamma: number,
): [min: number, max: number] {
  return [
    Math.max(
      2 ** ((MIN_INT32 - indexOffset) / multiplier + 1),
      MIN_NORMAL * adjustedGamma,
    ),
    Math.min(
      2 ** ((MAX_INT32 - indexOffset) / multiplier - 1),
      (Math.exp(EXP_OVERFLOW) / (2 * adjustedGamma)) * (adjustedGamma + 1),
    ),
  ];
}

// sketches-go LinearlyInterpolatedMapping: log2 approximated by linear
// interpolation between powers of two, read straight off the float's bits.
class LinearMapping extends LogLikeMapping {
  readonly kind = "linear";

  constructor(gamma: number, indexOffset: number) {
    const multiplier = 1 / goLog2(gamma);
    super(
      gamma,
      indexOffset,
      multiplier,
      1 - 2 / (1 + Math.exp(goLog2(gamma))),
      ...goIndexableRange(indexOffset, multiplier, gamma ** Math.LOG2E),
    );
  }

  protected log(value: number): number {
    return exponentOf(value) + significandPlusOne(value) - 1;
  }

  protected logInverse(index: number): number {
    const exponent = Math.floor(index);
    return buildFloat(exponent, index - exponent + 1);
  }
}

// The cubic's coefficients. sketches-go declares them as untyped constants, so
// Go folds every constant subexpression exactly before rounding once; these
// are those folded values, each a single correctly rounded division.
const A = 6 / 35;
const B = -3 / 5;
const C = 10 / 7;
const D0 = -459 / 1225; // B*B - 3*A*C
const D1 = 5454 / 6125; // 2*B*B*B - 9*A*B*C
const A2_27 = 972 / 1225; // 27*A*A
const A_3 = 18 / 35; // 3*A

// sketches-go CubicallyInterpolatedMapping: log2 approximated by a cubic in
// the significand, close enough that bins are only about 1% more numerous
// than the exact logarithm's.
class CubicMapping extends LogLikeMapping {
  readonly kind = "cubic";

  constructor(gamma: number, indexOffset: number) {
    const multiplier = 1 / goLog2(gamma);
    super(
      gamma,
      indexOffset,
      multiplier,
      1 - 2 / (1 + Math.exp(0.7 * goLog2(gamma))),
      ...goIndexableRange(
        indexOffset,
        multiplier,
        gamma ** (7 / (10 * Math.LN2)),
      ),
    );
  }

  protected log(value: number): number {
    const s = significandPlusOne(value) - 1;
    return ((A * s + B) * s + C) * s + exponentOf(value);
  }

  protected logInverse(index: number): number {
    const exponent = Math.floor(index);
    const d1 = D1 - A2_27 * (index - exponent);
    const p = Math.cbrt((d1 - Math.sqrt(d1 * d1 - 4 * D0 * D0 * D0)) / 2);
    return buildFloat(exponent, -(B + p + D0 / p) / A_3 + 1);
  }
}

// How many more bins than the exact logarithm the quadratic needs; also the
// exponent relating its gamma to the exact one.
const QUADRATIC_CORRECTION = 3 / (4 * Math.LN2);

// sketches-java QuadraticallyInterpolatedMapping, which sketches-go lacks.
// Its multiplier and range follow Java's LogLikeIndexMapping, not Go's.
class QuadraticMapping extends LogLikeMapping {
  readonly kind = "quadratic";

  constructor(gamma: number, indexOffset: number) {
    const multiplier = Math.LN2 / Math.log1p(gamma - 1);
    const exact = gamma ** QUADRATIC_CORRECTION;
    const relativeAccuracy = (exact - 1) / (exact + 1);
    super(
      gamma,
      indexOffset,
      multiplier,
      relativeAccuracy,
      Math.max(
        2 ** ((MIN_INT32 - indexOffset) / multiplier + 1),
        (MIN_NORMAL * (1 + relativeAccuracy)) / (1 - relativeAccuracy),
      ),
      Math.min(
        2 ** ((MAX_INT32 - indexOffset) / multiplier - 1),
        Number.MAX_VALUE / (1 + relativeAccuracy),
      ),
    );
  }

  protected log(value: number): number {
    const s = significandPlusOne(value);
    return exponentOf(value) - (s - 5) * (s - 1) * (1 / 3);
  }

  protected logInverse(index: number): number {
    const exponent = Math.floor(index);
    return buildFloat(exponent, 3 - Math.sqrt(4 - 3 * (index - exponent)));
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

/**
 * A mapping that interpolates log2 linearly from the float's bits instead of
 * calling `Math.log`: faster per value, at about 44% more bins than
 * {@link logMapping} for the same accuracy.
 *
 * @param relativeAccuracy - Relative error bound, in `(0, 1)`.
 * @throws {@link ParamError} when `relativeAccuracy` is outside `(0, 1)`.
 */
export function linearMapping(relativeAccuracy: number): IndexMapping {
  const gamma = exactLogGamma(relativeAccuracy) ** Math.LN2;
  // sketches-go keeps this offset for backward compatibility; matching it
  // keeps bins aligned with sketches built there.
  return new LinearMapping(gamma, 1 / goLog2(gamma));
}

/**
 * A mapping that approximates log2 with a quadratic in the float's
 * significand: between {@link linearMapping} and {@link cubicMapping} in
 * bins per accuracy. Matches sketches-java, the reference that has it.
 *
 * @param relativeAccuracy - Relative error bound, in `(0, 1)`.
 * @throws {@link ParamError} when `relativeAccuracy` is outside `(0, 1)`.
 */
export function quadraticMapping(relativeAccuracy: number): IndexMapping {
  return new QuadraticMapping(
    exactLogGamma(relativeAccuracy) ** (1 / QUADRATIC_CORRECTION),
    0,
  );
}

/**
 * A mapping that approximates log2 with a cubic in the float's significand:
 * nearly as compact as {@link logMapping} without calling `Math.log`.
 *
 * @param relativeAccuracy - Relative error bound, in `(0, 1)`.
 * @throws {@link ParamError} when `relativeAccuracy` is outside `(0, 1)`.
 */
export function cubicMapping(relativeAccuracy: number): IndexMapping {
  return new CubicMapping(
    exactLogGamma(relativeAccuracy) ** ((10 * Math.LN2) / 7),
    0,
  );
}

const MAPPINGS = {
  log: LogMapping,
  linear: LinearMapping,
  quadratic: QuadraticMapping,
  cubic: CubicMapping,
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
