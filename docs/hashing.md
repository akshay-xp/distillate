# Hashing

The correctness linchpin. Weak/insufficiently-independent hashing is why existing JS libs measure worse FPR than theory. Getting this right is a differentiator.

## Strategy

Derive all probe positions from a small hash by enhanced double hashing, not from N independent hash functions. Bloom and Blocked take two 32-bit words (`a`, `b`) as `h1`/`h2`; Fuse takes one 64-bit hash.

Kirsch-Mitzenmacher with the RocksDB correction:

```
g_i = (h1 + i*h2 + i*i) mod m      for probe i = 0..k-1
```

The `+ i*i` term avoids the degenerate-independence flaw of plain `h1 + i*h2`. No asymptotic FPR loss vs independent hashes.
Kirsch and Mitzenmacher, "Less Hashing, Same Performance" (2006); RocksDB issue #4120.

## Default hasher

Two hashes, chosen per structure and pinned in the serialized header flags nibble (see [serialization.md](serialization.md)):

- **Bloom and Blocked: murmur3_x86_32** (flags variant `1`). Pure `Math.imul`, run twice over the key (seeds `seed` and `seed ^ 0x9e3779b1`) to produce the two 32-bit words. The probe path only ever needed 64 bits, and JS has no native 64-bit multiply, so the 32-bit hash is the same accuracy at a fraction of the cost (roughly 5x faster on short keys, 11x on long).
- **Fuse: MurmurHash3_x64_128** (flags variant `0`). Its fingerprints, retry `mixSeed`, and Lemire `mulhi64` reduction need the full 64-bit value.

Both are pure-JS, zero-dep, synchronous, universal. Chosen because AMQ keys are usually short (IDs, URLs, tokens) where pure-JS beats the WASM call-boundary + marshaling overhead. The 64-bit core (`mul64`/`fmix64`) lives once in `core/hasher.ts`, shared by the x64 hash and Fuse.

- Carry 64-bit as two 32-bit lanes (hi/lo as Numbers). Never `BigInt` in hot paths (heap-allocated, ~10x slower).
- `hash128` is allocation-free: flat number locals (no lane objects), inline little-endian byte reads (no `DataView`), lane helpers write to reused module-scope scratch registers. Zero per-call heap allocation beyond the returned lanes, so steady-state hashing adds no GC pressure. The 64-bit-lane arithmetic (16-bit partial-product multiply) is the cost floor, not allocation.
- All lane math unsigned: `>>> 0`. This is the #1 source of JS hash-port bugs.
- Hash once, reuse across all probes. (Incumbent recomputes per op; see bloom-filters issue #60.)
- String keys are hashed via `hash128Key`, which `TextEncoder.encodeInto`s the key into a reused, grow-on-demand buffer and calls the length-aware `hash128(buf, seed, written)`, so steady-state string hashing allocates nothing (no per-op `Uint8Array`). The bytes hashed are the same UTF-8 as `encode()`, so serialized filters stay cross-language readable; portability is unchanged.
- Hot paths allocate nothing per call. Bloom/Blocked call `probeInto`/`hash32x2Into`, which encode the key once into the reused buffer and run murmur3_x86_32 twice. Fuse calls `hash128KeyInto(key, seed, out)`, which writes lanes into a caller-owned struct. `hash128`/`hash128Key` keep returning fresh objects for external/test use.

## Pluggable

```ts
interface Hasher {
  hash64(
    key: Uint8Array,
    seed: number,
  ): { h1: number; h2: number; hi1: number; hi2: number };
}
```

Users may inject their own. Ship `xxhash-wasm` as an optional fast path for throughput-bound Node/Bun over large keys. Never the default: `WebAssembly.compile` is blocked on some edge runtimes, the exact portability distillate sells.

## Reduction to range

Lemire multiply-shift `((h * m) >>> shift)` instead of modulo. For m > 2^32 this needs 64-bit-lane math (another reason to keep the lane representation).

## Portability

The hash variant is pinned in the serialized header flags nibble (`0` = murmur3_x64_128, `1` = murmur3_x86_32), so a reader knows which hash produced the bits. A filter is only cross-language-readable if both sides hash identically; both variants are fully specified murmur3 and trivially reimplementable in Rust/Go. A Bloom or Blocked reader rejects a frame whose variant it does not implement (`UnknownHashVariantError`) rather than misread it. The caveat runs one way: a newer reader rejects an older frame, but an older reader predates the variant check and would silently misread a newer-variant frame, so a consumer must be at least as new as the producer.

## Related

- [serialization.md](serialization.md), [architecture.md](architecture.md)
