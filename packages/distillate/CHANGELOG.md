# distillate

## 0.9.0

### Minor Changes

- 4ee6bcb: `BloomParams` accepts an optional `n`, the expected key count, so a filter built from explicit geometry can carry the capacity it was sized for.

  ```ts
  import { BloomFilter, bloomSizing } from "distillate/bloom";

  const { m, k } = bloomSizing(1_000_000, 0.01);

  new BloomFilter({ m, k, seed: 42, n: 1_000_000 }).bitsPerKey; // 9.585059
  new BloomFilter({ m, k, seed: 42 }).bitsPerKey; // 10.098869270757605
  ```

  `bloomSizing` returns geometry alone, so passing its result straight to the constructor used to drop the count it was solved for. `bitsPerKey` is `m / n`, and with no `n` to hand the filter derived one as `m * ln2 / k`, the capacity that geometry is optimal for. The two answers differ, and nothing said so. `create` and `fromBytes` have always carried the real `n`; now the public constructor can too, and the getter documents the derivation used when it is omitted.

  `BlockedBloomFilter` has taken `capacity` since it shipped, so this also settles an inconsistency between the two.

  **Fixed: `bitsPerKey` could report `Infinity`.** A geometry with far more probes than bits, such as `{ m: 1000, k: 65535 }`, derives a capacity of zero, and `m / 0` is `Infinity`, which serializes to JSON `null`. The derived value is now at least 1. No forged input was needed to reach this.

  **Fixed: a frame declaring a capacity of zero is now rejected** with `ParamError` rather than restoring a filter that reports an infinite cost. Frames carry `n` as a plain `u32` that no caller has validated, and it is now validated on the way in like every other declared parameter.

- 9d029ab: Bump the binary format to version 4: rename the frame magic from `AMQF` to `DSTL`, and add a 32-bit body-length field to the header.

  **Breaking.** Frames written by earlier versions are rejected with `BadMagicError`, and there is no dual-magic read path. Re-serialize any persisted filters with this version.

  `AMQF` stood for _Approximate Membership Query Filter_, which stops being accurate as `distillate` grows beyond membership filters into probabilistic structures generally. The magic is published in a cross-language format spec, so it was fixed while the package is still pre-1.0 rather than left to outlive the assumption behind it.

  The header is now 16 bytes and carries the body length at offset 8, so a reader can validate, skip, or stream a frame of a structure type it does not implement, using the header alone. Previously body length was inferred from each type's params, which made the format unreadable by anything generic. The length is checked before the CRC, so a frame cut short in transit now reports `TruncatedError` rather than a checksum failure.

- bb4a52c: Add `HyperLogLog`, a cardinality sketch, on the new `distillate/hll` subpath. It answers "how many distinct keys have I seen?" in space fixed by precision rather than by the answer: 12 KiB at `p = 14` holds a count of a thousand or a billion at roughly 0.8% relative error.

  This is the first structure in `distillate` that is not a membership filter, which is why the binary format's naming was fixed in the same release.

  ```ts
  import { HyperLogLog } from "distillate/hll";

  const sketch = HyperLogLog.create(0.01); // or from(keys, 0.01), or { p }
  sketch.add("alice");
  sketch.count();

  const total = shardA.union(shardB); // merges, folding to the coarser precision
  ```

  `add`, `count`, `union`, `equals`, `toBytes`/`fromBytes`, `toJSON`/`fromJSON`, and `hllSizing` round out the surface, matching the shape the filters already use. Sketches serialize as DSTL type `5`.

  **Small counts are exact, not approximate.** Below a few thousand distinct keys the sketch stores what it has seen at 25-bit precision and counts rather than estimates, so 100 keys report exactly 100. It promotes to dense registers on its own once that stops paying, with no discontinuity in what it reports and nothing to configure. A rollup of many small per-shard sketches keeps that exactness through `union`.

  **Merging sketches of different precision folds to the coarser one**, matching BigQuery HLL++ and Apache DataSketches. Throwing on a mismatch instead would let one misconfigured shard break the rollup that merging exists to serve.

  The estimator is Ertl's improved raw estimator (2017) rather than the empirical bias tables of the HLL++ paper, the same choice Redis 5.0+ and DataSketches made. It needs no per-precision lookup tables, so there is nothing to port, mistranscribe, or fall off the end of.

  Accuracy is gated in CI against the analytic `1.04 / sqrt(2^p)` bound across a precision and cardinality sweep, bounding both every individual point and the mean _signed_ error, so an estimator that drifted uniformly would fail even while each point stayed in range. Measured on the sweep: mean signed error 0.27%, worst point 1.54x its bound. `add` allocates nothing in steady state, asserted by a probe rather than assumed.

### Patch Changes

- 064816f: `HyperLogLog.fromBytes` rejects a sparse frame whose entry carries a rho the precision cannot produce, with `SerializationError`.

  A sparse entry is `index << 6 | rho`. The index half was validated as of the last release, via a 31-bit width check, and the rho half was not, leaving the sparse read path asymmetric with the dense one directly above it, which has always held its registers to `65 - p`.

  The gap was reachable only from a forged frame, and it did not throw. A frame carrying oversized rhos loaded clean, counted correctly, and round-tripped equal to itself, because nothing on the sparse path reads rho. The damage arrived later, when enough keys promoted the sketch and `foldSparse` wrote those rhos into registers: at `p = 14` with 3,000 keys forged to rho 63, the count went on to overstate by 16% (119,223 against a true 102,580) with no error raised. Worse, the frame such a sketch then wrote was one `fromBytes` refused, so a caller could hold a live sketch that could not be persisted.

  Rejecting on load closes both. Only the upper bound is checked: a rho of 0 is a legitimate dense register value, so rejecting it on one encoding and not the other would reintroduce the same asymmetry.

  No effect on frames written by any release.

## 0.8.2

### Patch Changes

- 0b4bd33: Point `homepage` at the documentation site, https://distillate.akxp.net, instead of the GitHub README anchor. This is the link npm renders on the package page, and the site is now the fuller reference: guides, the API reference generated from TSDoc, benchmarks, and runnable examples.

## 0.8.1

### Patch Changes

- cd7a5b9: Correct the README's three-key Binary Fuse sample, which claimed `~9` bits per key where the real value is 64. The `~9` figure is the asymptote a filter approaches at large `n`; at three keys the fingerprint array is at its fixed minimum. The sample now quotes the allocated cost and explains the difference.

## 0.8.0

### Minor Changes

- 17c77f5: Export the six serialization errors `fromBytes` and `fromJSON` throw, so a
  consumer can tell decode failures apart with `instanceof`: `SerializationError`
  and its subclasses `TruncatedError`, `BadMagicError`, `UnknownVersionError`,
  `UnknownHashVariantError`, and `ChecksumError`. All six are available from
  `distillate/bloom`, `distillate/blocked`, and `distillate/fuse`.

  Every published subpath also got substantially smaller. TSDoc was being
  preserved in the shipped JS, not just in the type declarations, so each
  consumer's runtime bundle carried the full doc comments. It is now stripped
  from the JS and kept in the `.d.ts`, leaving editor hovers and the generated
  API reference unchanged:

  | Subpath              | Raw            | Gzipped      |
  | -------------------- | -------------- | ------------ |
  | `distillate/bloom`   | 23018 -> 18387 | 7255 -> 5432 |
  | `distillate/blocked` | 24630 -> 19184 | 7855 -> 5700 |
  | `distillate/fuse`    | 25704 -> 21157 | 7897 -> 6152 |

  Public documentation now lives at https://distillate.akxp.net, with guides per
  structure, sizing, cross-runtime usage, migration from `bloom-filters`, and
  reference pages for the binary format, versioning, and every error class.

## 0.7.0

### Minor Changes

- 6d3a129: Sizing helpers are now public, so callers can size a filter without allocating one:

  - `distillate/bloom` exports `bloomSizing(n, epsilon)` and the `BloomSizing` type. It returns `{ m, k }`, which is a valid `BloomParams`, so `new BloomFilter(bloomSizing(100_000, 0.01))` works directly. This is the helper previously named `optimal` internally.
  - `distillate/blocked` exports `blockedBitsPerKey(epsilon)` and `blockedFprAt(bitsPerKey)`, the split-block solver and its underlying FPR model. `blockedBitsPerKey` throws `ParamError` for an `epsilon` below the blocked floor.
  - `distillate/fuse` exports `fuseBitsPerKey(n, width)`, which reports the bits per key a binary fuse filter over `n` distinct keys costs at an 8- or 16-bit fingerprint, without building it.

## 0.6.0

### Minor Changes

- 6e77718: Add `equals` to Bloom, Blocked, and both Fuse filters. `a.equals(b)` is true when the two filters serialize to identical bytes (same parameters and contents); a fuse8 and a fuse16 are never equal.
- 16db712: Add `from(keys, epsilon)` to Bloom and Blocked filters: build a filter directly from an iterable of keys, sized for their count at the target false-positive rate. Mirrors the existing `BinaryFuse.from`.
- 51db353: Add `toJSON`/`fromJSON` to all filters (Bloom, Blocked, Fuse 8/16). `toJSON()` returns a JSON-friendly envelope (`{ $, v, data }`) wrapping the base64 of `toBytes()`, so filters can live in a JSON column or survive `JSON.stringify`; `fromJSON` validates the envelope and delegates to `fromBytes`.
- e3264f5: Raise the minimum supported Node.js to 22; Node 20 reached end-of-life on 2026-04-30. Dropping an end-of-life Node line is a minor, not a breaking change, per the runtime-support policy.
- 83aeccb: Correctness and API hardening:

  - `BlockedBloomFilter.create` now sizes bits-per-key by solving the split-block false-positive rate in closed form, so it hits the target rate across the full epsilon range (previously values like `0.1` were silently under-provisioned to ~18%). Targets below the solvable floor throw a `ParamError` rather than returning a degraded filter. The bits-per-key chosen for a given epsilon may differ from before.
  - Filter constructors now reject parameters that exceed their serialized field widths (`k > 65535`, `m`/`capacity > 2^32-1`) with a `ParamError`, instead of silently truncating on serialize.
  - New accessors for compatibility prechecks: `numBlocks` and `seed` on `BlockedBloomFilter`, and `seed` on `BinaryFuse8`/`BinaryFuse16`.
  - `toBytes` writes into a single allocated frame, dropping the duplicate body buffer.

- c9b0a21: Unify all structures on murmur3_x86_128 and bump the serialization format to version 3.

  One hash (murmur3_x86_128, pure `Math.imul`, single pass) now backs Bloom, Blocked, and Fuse, replacing the two-pass murmur3_x86_32 and the emulated MurmurHash3_x64_128. On Apple M5 this is ~2x faster Fuse queries and ~1.3x faster Bloom/Blocked lookups.

  Breaking: this is a format change. Filters serialized by earlier versions (format v2) are rejected on read with `UnknownVersionError`; re-serialize with this version. Fuse frames now carry a hash-variant guard they previously lacked.

### Patch Changes

- c4c0c4b: Fix `BlockedBloomFilter.union` returning false negatives. The result filter was rebuilt from the fractional `bitsPerKey` getter, which for some capacities rounded up to one extra block; keys then hashed to a different block and read as absent. `union` (and `fromBytes`) now reconstruct from the exact integer block count.
- 4649c1a: Fix `BloomFilter.union` reporting the wrong `bitsPerKey`/`rate` and breaking `equals`: the result now carries the operand's expected-key count instead of re-deriving it from `m/k` (membership was never affected). `BloomFilter.create` now rejects `n` above `2^32-1` with a `ParamError` instead of silently truncating it into the serialized frame.
- 01ecf28: Compute the serialization CRC-32 with a slice-by-8 table drive instead of the byte-at-a-time loop. Output is byte-identical (same IEEE 802.3 checksum), so no format change; `toBytes`/`fromBytes` are about 4x faster on large filters (measured ~50 ms to ~13 ms for the CRC over an 11 MB payload on Apple M5).
- fa2fb8c: Pre-1.0 hardening:

  - Deserialization now rejects malformed frames with `SerializationError`: `BinaryFuse8`/`BinaryFuse16.fromBytes` reject a segment length that is not a power of two, exceeds `1<<18`, or whose segment-count length is not a multiple of it; `BlockedBloomFilter.fromBytes` rejects `numBlocks=0` and `n=0` (previously a `ParamError` leaked, or an `Infinity` bits-per-key filter was accepted).
  - `fromBase64` now throws on characters outside the base64 alphabet and on invalid lengths instead of silently producing wrong-length bytes; a corrupted JSON envelope surfaces as `SerializationError` rather than a downstream `ChecksumError`.
  - `BloomFilter.from([])` and `BlockedBloomFilter.from([])` build a valid empty filter (membership always false) instead of throwing, matching the binary fuse filters.

## 0.5.0

### Minor Changes

- 42581ef: Swap the Bloom and Blocked probe hash to murmur3_x86_32, roughly 5x faster on short keys and 11x on long keys, with an unchanged false-positive rate. Fuse is unaffected.

  **BREAKING:** Bloom and Blocked filters serialized before this release (hash variant 0) can no longer be read; `fromBytes` rejects them with `UnknownHashVariantError`. The serialized layout and format version are unchanged; the hash variant is recorded in the header flags nibble. Re-serialize any persisted Bloom/Blocked filters after upgrading. Binary Fuse frames are unaffected and remain readable.

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
