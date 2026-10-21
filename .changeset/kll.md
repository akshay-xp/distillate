---
"distillate": minor
---

Add the KLL sketch at `distillate/kll`: ranks, quantiles and whole CDFs of a stream of numbers, each within a guaranteed error in rank, whatever the values. It answers "what share of requests met a 200 ms SLO?", which DDSketch cannot guarantee, in memory set by `k` alone. DDSketch stays the choice for extreme tails, where an error relative to the value is the tighter one.

`new KllSketch({ k, seed })` or `KllSketch.create(rankError)` builds one; `add(value, count)` records a value, `quantile(q)` and `quantiles(qs)` read values back, and `rank(x)`, `cdf(splits)` and `pmf(splits)` read shares of the stream. `union` returns a new sketch that takes more values and further unions, and `normalizedRankError(pmf)` gives the bound at 99% confidence: about 1.33% for one rank and 1.65% for a whole CDF at the default `k` of 200. `equals`, `toBytes` / `fromBytes` (frame type 14) and `toJSON` / `fromJSON` work as on the other sketches, and `kllSizing(rankError)` gives the `k` a target needs.

Three behaviours worth knowing:

- It is exact below `k` values, and holds its bound past that on any distribution and through any tree of unions; CI gates it on five stream shapes and three merge shapes.
- A union keeps the smaller `k` of its two inputs. Without a `seed`, each sketch draws its own at its first compaction rather than in the constructor, since Cloudflare Workers refuse random values at module scope; with one, the same stream gives the same bytes, and a decoded sketch continues as the original would.
- Over `L` levels it holds at most `3k + 8L` items as doubles. At the default `k`, ten million values fit in a 5,228-byte frame.

Measured against the `tdigest` lib, the most-downloaded t-digest on npm, on 1M latency-shaped values: KLL added values about five times as fast and merged in 0.04 ms against 1.4 ms, a gap that belongs to that lib's tree-based design rather than to t-digest. The `tdigest` lib was the more accurate in rank, even at KLL's size, but gives no bound. No other JS library ships a KLL sketch.
