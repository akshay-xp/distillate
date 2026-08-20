// The islands read their inputs through FormData, which hands over strings, so
// accept those as well as numbers. Anything else, including null, undefined,
// objects, and blanks, is not a number.
export function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") return Number(value);
  return NaN;
}
