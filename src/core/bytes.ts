export type BytesLike = string | Uint8Array | ArrayBuffer;

export function normalize(input: BytesLike): Uint8Array {
  if (typeof input === "string") return new TextEncoder().encode(input);
  if (input instanceof Uint8Array) return input;
  return new Uint8Array(input);
}
