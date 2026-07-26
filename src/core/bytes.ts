export type BytesLike = string | Uint8Array | ArrayBuffer;

export function normalize(input: BytesLike): Uint8Array {
  if (input instanceof Uint8Array) return input;
  return new TextEncoder().encode(input as string);
}
