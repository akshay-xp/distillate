export type BytesLike = string | Uint8Array | ArrayBuffer;

export function normalize(input: BytesLike): Uint8Array {
  return new TextEncoder().encode(input as string);
}
