---
"distillate": minor
---

Sizing helpers are now public, so callers can size a filter without allocating one:

- `distillate/bloom` exports `bloomSizing(n, epsilon)` and the `BloomSizing` type. It returns `{ m, k }`, which is a valid `BloomParams`, so `new BloomFilter(bloomSizing(100_000, 0.01))` works directly. This is the helper previously named `optimal` internally.
- `distillate/blocked` exports `blockedBitsPerKey(epsilon)` and `blockedFprAt(bitsPerKey)`, the split-block solver and its underlying FPR model. `blockedBitsPerKey` throws `ParamError` for an `epsilon` below the blocked floor.
- `distillate/fuse` exports `fuseBitsPerKey(n, width)`, which reports the bits per key a binary fuse filter over `n` distinct keys costs at an 8- or 16-bit fingerprint, without building it.
