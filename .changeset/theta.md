---
"distillate": minor
---

Add the Theta sketch at `distillate/theta`: distinct counts that combine by union, intersection and difference, so "how many keys are in both segments" or "in one but not the other" is answered from sketches stored apart. HyperLogLog can only union, and an overlap estimated from its unions by inclusion-exclusion carries the error of the whole union; at a 1% overlap of two 1M-key sets, Theta's intersection error measured a quarter of HyperLogLog's.

`ThetaSketch.create(relativeError)`, `ThetaSketch.from(keys, relativeError)` or `new ThetaSketch({ k, seed })` builds one; `add(key)` records a key, `count()` estimates, and `lowerBound(sd)` and `upperBound(sd)` bracket it at 1, 2 or 3 standard deviations. `union`, `intersect` and `difference` each return a new sketch that takes more keys and further operations. `equals`, `toBytes` / `fromBytes` (frame type 13) and `toJSON` / `fromJSON` work as on the other sketches, and `thetaSizing(relativeError)` gives the `k` a target needs.

Three behaviours worth knowing:

- It counts exactly up to `k` distinct keys, 4096 by default, and estimates within about `1 / sqrt(k)` past that. The same keys give the same sketch and the same bytes whatever order they arrive in.
- A set operation keeps the smaller `k` of its two inputs, so any order or grouping of unions gives the same sketch; combining a coarse sketch with a fine one gives the coarse one's accuracy. Both inputs must share a `seed`, or it throws `ParamError`.
- While it takes keys, a sketch holds about 28 bytes per unit of `k`: 112 KiB at the default. Its frame is at most `8k + 44` bytes.
