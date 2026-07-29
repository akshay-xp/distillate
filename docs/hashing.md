# Hashing

The correctness linchpin. Weak/insufficiently-independent hashing is why existing JS libs measure worse FPR than theory. Getting this right is a differentiator.

## Strategy

One 64-bit hash per key, then derive all probe positions by enhanced double hashing. No N independent hash functions.

Kirsch-Mitzenmacher with the RocksDB correction:

```
g_i = (h1 + i*h2 + i*i) mod m      for probe i = 0..k-1
```

The `+ i*i` term avoids the degenerate-independence flaw of plain `h1 + i*h2`. No asymptotic FPR loss vs independent hashes.
Kirsch and Mitzenmacher, "Less Hashing, Same Performance" (2006); RocksDB issue #4120.

## Default hasher

Pure-JS MurmurHash3_x64_128, single pass, sliced into two 64-bit lanes (h1, h2) or four 32-bit lanes. Zero deps, synchronous, universal. Chosen because AMQ keys are usually short (IDs, URLs, tokens) where pure-JS beats the WASM call-boundary + marshaling overhead.

- Carry 64-bit as two 32-bit lanes (hi/lo as Numbers). Never `BigInt` in hot paths (heap-allocated, ~10x slower).
- `hash128` is allocation-free: flat number locals (no lane objects), inline little-endian byte reads (no `DataView`), lane helpers write to reused module-scope scratch registers. Zero per-call heap allocation beyond the returned lanes, so steady-state hashing adds no GC pressure. The 64-bit-lane arithmetic (16-bit partial-product multiply) is the cost floor, not allocation.
- All lane math unsigned: `>>> 0`. This is the #1 source of JS hash-port bugs.
- Hash once, reuse across all probes. (Incumbent recomputes per op; see bloom-filters issue #60.)
- String keys are hashed via `hash128Key`, which `TextEncoder.encodeInto`s the key into a reused, grow-on-demand buffer and calls the length-aware `hash128(buf, seed, written)`, so steady-state string hashing allocates nothing (no per-op `Uint8Array`). The bytes hashed are the same UTF-8 as `encode()`, so serialized filters stay cross-language readable; portability is unchanged.
- Hot paths (bloom/blocked/fuse `has`/`add`) call `hash128KeyInto(key, seed, out)`, which writes lanes into a caller-owned struct instead of returning a fresh object, so membership ops allocate nothing per call. `hash128`/`hash128Key` keep returning fresh objects for external/test use.

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

The chosen hash variant is pinned in the serialized header flags. A filter is only cross-language-readable if both sides hash identically. Murmur3_x64_128 is fully specified and trivially reimplementable in Rust/Go.

## Related

- [serialization.md](serialization.md), [architecture.md](architecture.md)
