/** Thrown when a structure is constructed with invalid parameters. */
export class ParamError extends RangeError {
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
