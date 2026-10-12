---
"distillate": patch
---

Top-K `add` and `count` no longer allocate in steady state, including the purges a stream of new keys triggers at capacity. Frames are unchanged.
