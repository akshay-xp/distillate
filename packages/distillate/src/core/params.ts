/** Thrown when a structure is constructed with invalid parameters. */
export class ParamError extends RangeError {
  /** Discriminates this error from other `Error`s. */
  override readonly name = "ParamError";
}

/** Asserts `value` is an integer greater than or equal to 1. */
export function assertPositiveInt(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new ParamError(
      `${label} must be a positive integer, got ${String(value)}`,
    );
  }
}

/** Asserts `value` is a finite number greater than 0 (a positive real). */
export function assertPositiveFinite(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new ParamError(
      `${label} must be a positive number, got ${String(value)}`,
    );
  }
}

/** Asserts `value` is an integer in the uint32 range `[0, 2^32 - 1]`. */
export function assertUint32(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new ParamError(`${label} must be a uint32, got ${String(value)}`);
  }
}

/** Asserts `value` is a finite number in the open interval `(0, 1)`. */
export function assertProbability(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0 || value >= 1) {
    throw new ParamError(
      `${label} must be in the open interval (0, 1), got ${String(value)}`,
    );
  }
}
