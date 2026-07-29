---
"distillate": patch
---

Faster, allocation-free key hashing on the membership hot path. String `has`/`add` are ~1.7x faster (the per-op UTF-8 encode buffer is now reused instead of allocated), and the 128-bit hash result is written into reused scratch instead of a fresh object per call, so steady-state `has`/`add` allocate at the GC noise floor. Hash values are unchanged, so existing serialized filters remain byte-compatible and cross-language readable.
