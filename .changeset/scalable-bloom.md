---
"distillate": minor
---

Add `distillate/scalable` with `ScalableBloomFilter`, a Bloom filter for when the key count is not known up front. It grows by opening larger, tighter stages as keys arrive, and keeps its false-positive rate under the target however many open. Growth and tightening are configurable, duplicates never use up capacity, and it supports `union`, `equals`, and the same binary and JSON serialization as the other structures (frame type 6).
