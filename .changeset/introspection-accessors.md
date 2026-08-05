---
"distillate": minor
---

Add read-only introspection accessors to the mutable Bloom-family filters.

- `BloomFilter` now exposes `m`, `k`, `seed`, and `length` (bits currently set) getters, plus `rate()`, a fill-based estimate of the current false-positive rate.
- `BlockedBloomFilter` now exposes `length` (bits set across all lanes) and `rate()`. Its `rate()` uses the split-block query width of 8 lane-bits rather than a classic probe count.
- All accessors are allocation-free and touch no hot path.
