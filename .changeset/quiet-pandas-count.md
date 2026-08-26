---
"distillate": minor
---

Add `HyperLogLog`, a cardinality sketch, on the new `distillate/hll` subpath. It answers "how many distinct keys have I seen?" in space fixed by precision rather than by the answer: 12 KiB at `p = 14` holds a count of a thousand or a billion at roughly 0.8% relative error.

This is the first structure in `distillate` that is not a membership filter, which is why the binary format's naming was fixed in the same release.

```ts
import { HyperLogLog } from "distillate/hll";

const sketch = HyperLogLog.create(0.01); // or from(keys, 0.01), or { p }
sketch.add("alice");
sketch.count();

const total = shardA.union(shardB); // merges, folding to the coarser precision
```

`add`, `count`, `union`, `equals`, `toBytes`/`fromBytes`, `toJSON`/`fromJSON`, and `hllSizing` round out the surface, matching the shape the filters already use. Sketches serialize as DSTL type `5`.

**Small counts are exact, not approximate.** Below a few thousand distinct keys the sketch stores what it has seen at 25-bit precision and counts rather than estimates, so 100 keys report exactly 100. It promotes to dense registers on its own once that stops paying, with no discontinuity in what it reports and nothing to configure. A rollup of many small per-shard sketches keeps that exactness through `union`.

**Merging sketches of different precision folds to the coarser one**, matching BigQuery HLL++ and Apache DataSketches. Throwing on a mismatch instead would let one misconfigured shard break the rollup that merging exists to serve.

The estimator is Ertl's improved raw estimator (2017) rather than the empirical bias tables of the HLL++ paper, the same choice Redis 5.0+ and DataSketches made. It needs no per-precision lookup tables, so there is nothing to port, mistranscribe, or fall off the end of.

Accuracy is gated in CI against the analytic `1.04 / sqrt(2^p)` bound across a precision and cardinality sweep, bounding both every individual point and the mean _signed_ error, so an estimator that drifted uniformly would fail even while each point stayed in range. Measured on the sweep: mean signed error 0.27%, worst point 1.54x its bound. `add` allocates nothing in steady state, asserted by a probe rather than assumed.
