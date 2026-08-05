# distillate

## 0.4.0

### Minor Changes

- ef8fb6e: Serialization format version 2. **BREAKING: filters serialized by 0.2.x (format v1) can no longer be read**; `fromBytes` rejects them with `UnknownVersionError`. Re-serialize any persisted filters after upgrading.

  - Bloom now serializes `k` as a `uint16` (was a single byte, so `k > 255`, reachable via `create(n, 1e-100)`, silently truncated and corrupted the filter's params).
  - Bloom now persists its key count `n`, so `bitsPerKey`, `rate()`, and the param accessors are stable across a `toBytes`/`fromBytes` roundtrip.
  - `BloomFilter.fromBytes` and `BlockedBloomFilter.fromBytes` now validate the header structure-type byte and reject a frame from another structure (Fuse already did).
  - All three `fromBytes` now validate the declared body length before allocating the backing store, closing a path where a crafted frame forced a large allocation from untrusted input.

## 0.3.0

### Minor Changes

- 6a50d76: Add read-only introspection accessors to the mutable Bloom-family filters.

  - `BloomFilter` now exposes `m`, `k`, `seed`, and `length` (bits currently set) getters, plus `rate()`, a fill-based estimate of the current false-positive rate.
  - `BlockedBloomFilter` now exposes `length` (bits set across all lanes) and `rate()`. Its `rate()` uses the split-block query width of 8 lane-bits rather than a classic probe count.
  - All accessors are allocation-free and touch no hot path.

## 0.2.0

### Minor Changes

- 644aba7: Validate construction parameters across the Bloom family and export a shared `ParamError`.

  - `BloomFilter` and `BlockedBloomFilter` now throw `ParamError` (a `RangeError`) on invalid construction inputs, both `create(n, epsilon)` and the low-level constructors, instead of silently building a wrong filter. This closes a path where `create(n, 1)` sized a zero-bit filter and dropped inserted keys, contradicting the zero-false-negatives guarantee.
  - `ParamError` is now exported from `distillate/bloom` and `distillate/blocked`.
  - `BlockedBloomFilter.create` floors bits-per-key to a minimum of one 256-bit block (matching the Parquet split-block reference), so any `epsilon` in `(0, 1)` builds.
  - `BinaryFuse` already handled empty input correctly; a regression guard now locks that in.

## 0.1.2

### Patch Changes

- 52ecd88: Document the entire public API with TSDoc. Type declarations (`.d.ts`) now ship inline docs, so editors surface a description, `@param`/`@returns`, and usage examples on hover and autocomplete for every exported member. A browsable API reference generated from these comments is also published in the repo under `docs/api`.
- 39ef6f7: Derive `VERSION` from `package.json` so it can no longer drift out of sync. Its type widens from the `"x.y.z"` string literal to `string`.

## 0.1.1

### Patch Changes

- f723db3: Faster, allocation-free key hashing on the membership hot path. String `has`/`add` are ~1.7x faster (the per-op UTF-8 encode buffer is now reused instead of allocated), and the 128-bit hash result is written into reused scratch instead of a fresh object per call, so steady-state `has`/`add` allocate at the GC noise floor. Hash values are unchanged, so existing serialized filters remain byte-compatible and cross-language readable.

## 0.1.0

### Minor Changes

- Initial pre-release. Three approximate-membership structures, each on its own subpath with a versioned AMQF binary format (`toBytes` / `fromBytes`):

  - `distillate/bloom`: Classic Bloom filter.
  - `distillate/blocked`: Blocked Bloom filter (cache-line-local lookups).
  - `distillate/fuse`: Binary Fuse 8/16 (static, space-efficient, built once via `from`).
