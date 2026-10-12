---
"distillate": patch
---

Binary Fuse `has` no longer allocates in steady state on Node 24, and building no longer allocates a growable queue per attempt. Frames are unchanged.
