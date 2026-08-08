export type BytesLike = string | Uint8Array | ArrayBuffer;

const encoder = new TextEncoder();

export function normalize(input: BytesLike): Uint8Array {
  if (typeof input === "string") return encoder.encode(input);
  if (input instanceof Uint8Array) return input;
  return new Uint8Array(input);
}
