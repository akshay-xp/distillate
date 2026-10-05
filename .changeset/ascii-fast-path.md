---
"distillate": patch
---

Faster string keys. Keys of up to 12 ASCII characters are encoded without crossing into native code, which speeds `add` and `has` on short keys for every structure. Top-K's `add` and `count` no longer allocate a new array per call. `BloomFilter.has` stops at the first unset bit, so misses are faster. Hashes, serialized bytes and results are unchanged.
