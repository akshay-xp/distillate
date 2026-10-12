---
"distillate": patch
---

`from()` builders no longer allocate an iterator result per key for array input, and Bloom, Blocked and Scalable no longer copy an array before sizing. Non-array input still streams. Results and frames are unchanged.
