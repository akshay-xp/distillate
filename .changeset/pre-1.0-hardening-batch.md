---
"distillate": patch
---

Pre-1.0 hardening:

- Deserialization now rejects malformed frames with `SerializationError`: `BinaryFuse8`/`BinaryFuse16.fromBytes` reject a segment length that is not a power of two, exceeds `1<<18`, or whose segment-count length is not a multiple of it; `BlockedBloomFilter.fromBytes` rejects `numBlocks=0` and `n=0` (previously a `ParamError` leaked, or an `Infinity` bits-per-key filter was accepted).
- `fromBase64` now throws on characters outside the base64 alphabet and on invalid lengths instead of silently producing wrong-length bytes; a corrupted JSON envelope surfaces as `SerializationError` rather than a downstream `ChecksumError`.
- `BloomFilter.from([])` and `BlockedBloomFilter.from([])` build a valid empty filter (membership always false) instead of throwing, matching the binary fuse filters.
