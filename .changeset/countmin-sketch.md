---
"distillate": minor
---

Add the Count-Min sketch at `distillate/countmin`: a frequency sketch that estimates how many times each key appeared, in space fixed by the error you ask for rather than by how many keys arrive.

`CountMinSketch.create(epsilon, delta)` sizes the grid so an estimate is at most `epsilon` of the total recorded above the truth, with probability at least `1 - delta`. It has the same `create`, `from`, `equals`, `union` and binary and JSON serialization (frame type 8) as the other structures, plus `add(key, count)`, `count(key)`, `total` and `error()`.

The estimate is never below the true count, and the API refuses everything that would break that. A negative count throws `ParamError`. An `add` or `union` that would carry a counter past `2**32 - 1` throws `CountMinOverflowError` and leaves the sketch untouched, rather than wrapping to a number that would read as an underestimate. An `add` or `union` that would carry `total` past `Number.MAX_SAFE_INTEGER` throws the same error: counters cap individually, but on a very wide sketch their sum can pass `2**53` while each one is still legal, and past that point the total loses precision and the sketch would no longer round-trip.

Two behaviours worth knowing:

- `from(keys, epsilon, delta)` counts repeated keys, the opposite of `CuckooFilter.from`, which ignores them. For a frequency sketch the repeats are the measurement.
- `union` adds counts, so unlike the filters it is not idempotent: `a.union(a)` doubles every count. Combining two sketches gives bytes identical to one sketch fed both streams.
