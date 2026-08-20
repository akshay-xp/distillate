// The islands read their inputs through FormData, which hands over strings, so
// accept those as well as numbers. Anything else, including null, undefined,
// objects, and blanks, is not a number.
export function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") return Number(value);
  return NaN;
}

/** What both islands say when a target rate is not a number they can use. */
export const RATE_MESSAGE =
  "Target rate must be a number greater than 0 and less than 1, for example 0.01 for 1%.";
