---
"distillate": patch
---

Fix `BlockedBloomFilter.union` returning false negatives. The result filter was rebuilt from the fractional `bitsPerKey` getter, which for some capacities rounded up to one extra block; keys then hashed to a different block and read as absent. `union` (and `fromBytes`) now reconstruct from the exact integer block count.
