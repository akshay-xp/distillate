---
"distillate": patch
---

`ScalableBloomFilter.fromBytes` no longer throws a raw `RangeError` on a frame declaring hundreds of thousands of stages; such a frame loads like any other.
