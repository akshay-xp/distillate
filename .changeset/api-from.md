---
"distillate": minor
---

Add `from(keys, epsilon)` to Bloom and Blocked filters: build a filter directly from an iterable of keys, sized for their count at the target false-positive rate. Mirrors the existing `BinaryFuse.from`.
