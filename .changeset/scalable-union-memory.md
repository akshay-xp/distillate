---
"distillate": patch
---

`ScalableBloomFilter.union` no longer allocates a first stage it immediately discards, halving its peak memory for single-stage filters.
