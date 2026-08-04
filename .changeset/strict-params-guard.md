---
"distillate": minor
---

Validate construction parameters across the Bloom family and export a shared `ParamError`.

- `BloomFilter` and `BlockedBloomFilter` now throw `ParamError` (a `RangeError`) on invalid construction inputs, both `create(n, epsilon)` and the low-level constructors, instead of silently building a wrong filter. This closes a path where `create(n, 1)` sized a zero-bit filter and dropped inserted keys, contradicting the zero-false-negatives guarantee.
- `ParamError` is now exported from `distillate/bloom` and `distillate/blocked`.
- `BlockedBloomFilter.create` floors bits-per-key to a minimum of one 256-bit block (matching the Parquet split-block reference), so any `epsilon` in `(0, 1)` builds.
- `BinaryFuse` already handled empty input correctly; a regression guard now locks that in.
