---
"distillate": minor
---

Serialization format version 2. **BREAKING: filters serialized by 0.2.x (format v1) can no longer be read**; `fromBytes` rejects them with `UnknownVersionError`. Re-serialize any persisted filters after upgrading.

- Bloom now serializes `k` as a `uint16` (was a single byte, so `k > 255`, reachable via `create(n, 1e-100)`, silently truncated and corrupted the filter's params).
- Bloom now persists its key count `n`, so `bitsPerKey`, `rate()`, and the param accessors are stable across a `toBytes`/`fromBytes` roundtrip.
- `BloomFilter.fromBytes` and `BlockedBloomFilter.fromBytes` now validate the header structure-type byte and reject a frame from another structure (Fuse already did).
- All three `fromBytes` now validate the declared body length before allocating the backing store, closing a path where a crafted frame forced a large allocation from untrusted input.
