# Hashing

The correctness linchpin. Weak/insufficiently-independent hashing is why existing JS libs measure worse FPR than theory. Getting this right is a differentiator.

## Strategy

Derive all probe positions from a small hash by enhanced double hashing, not from N independent hash functions. One hash (murmur3_x86_128) serves every structure: Bloom and Blocked take two of its four 32-bit output words as `a`/`b`; Fuse takes its first 64-bit lane.

Kirsch-Mitzenmacher with the RocksDB correction:

```
g_i = (h1 + i*h2 + i*i) mod m      for probe i = 0..k-1
```

The `+ i*i` term avoids the degenerate-independence flaw of plain `h1 + i*h2`. No asymptotic FPR loss vs independent hashes.
Kirsch and Mitzenmacher, "Less Hashing, Same Performance" (2006); RocksDB issue #4120.

## Default hasher

One hash for every structure, pinned in the serialized header flags nibble as variant `0` (see [serialization.md](serialization.md)):

- **murmur3_x86_128** (flags variant `0`). Pure `Math.imul`, one pass over the key, four 32-bit output words. No emulated 64-bit multiply, so it is fast on V8 for every structure. Bloom and Blocked read two words as the double-hash `a`/`b`; Fuse reads the first 64-bit lane (`h1lo`/`h1hi`) for its fingerprints, retry `mixSeed`, and Lemire `mulhi64` reduction.

A single pass of murmur3_x86_128 beats the previous two passes of murmur3_x86_32 for Bloom/Blocked (both words in one traversal) and replaces the emulated MurmurHash3_x64_128 for Fuse (pure `Math.imul`, no partial-product multiply), so the whole library shares one hash. Measured on M5: Fuse query about 2x faster, Bloom/Blocked lookups about 1.3x faster than the two-pass baseline.

Pure-JS, zero-dep, synchronous, universal. Chosen because AMQ keys are usually short (IDs, URLs, tokens) where pure-JS beats the WASM call-boundary + marshaling overhead. The 64-bit lane helpers (`mul64`/`fmix64`) live once in `core/hasher.ts` and are now used only by Fuse's reduction, not the hash body.

- Carry 64-bit as two 32-bit lanes (hi/lo as Numbers). Never `BigInt` in hot paths (heap-allocated, ~10x slower).
- `hash128` is allocation-free: flat number locals (no lane objects), inline little-endian byte reads (no `DataView`), results written to a reused module-scope struct. Zero per-call heap allocation beyond the returned lanes, so steady-state hashing adds no GC pressure. Pure 32-bit `Math.imul` arithmetic, so no emulated 64-bit multiply in the hash body.
- All lane math unsigned: `>>> 0`. This is the #1 source of JS hash-port bugs.
- Hash once, reuse across all probes. (Incumbent recomputes per op; see bloom-filters issue #60.)
- String keys are hashed via `hash128Key`, which `TextEncoder.encodeInto`s the key into a reused, grow-on-demand buffer and calls the length-aware `hash128(buf, seed, written)`, so steady-state string hashing allocates nothing (no per-op `Uint8Array`). The bytes hashed are the same UTF-8 as `encode()`, so serialized filters stay cross-language readable; portability is unchanged.
- Hot paths allocate nothing per call. Bloom/Blocked call `probeInto`/`hash32x2Into`, which encode the key once into the reused buffer and run one murmur3_x86_128 pass, reading two of its output words. Fuse calls `hash128KeyInto(key, seed, out)`, which writes lanes into a caller-owned struct. `hash128`/`hash128Key` keep returning fresh objects for external/test use.

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

The hash variant is pinned in the serialized header flags nibble (`0` = murmur3_x86_128), so a reader knows which hash produced the bits. A filter is only cross-language-readable if both sides hash identically; murmur3_x86_128 is fully specified and trivially reimplementable in Rust/Go. A reader rejects a frame whose version or variant it does not implement (`UnknownVersionError`/`UnknownHashVariantError`) rather than misread it. The caveat runs one way: a newer reader rejects an older frame, but an older reader predates the check and would silently misread a newer frame, so a consumer must be at least as new as the producer.

## Related

- [serialization.md](serialization.md), [architecture.md](architecture.md)
