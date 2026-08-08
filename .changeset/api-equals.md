---
"distillate": minor
---

Add `equals` to Bloom, Blocked, and both Fuse filters. `a.equals(b)` is true when the two filters serialize to identical bytes (same parameters and contents); a fuse8 and a fuse16 are never equal.
