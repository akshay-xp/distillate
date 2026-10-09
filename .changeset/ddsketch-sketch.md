---
"distillate": minor
---

Add DDSketch at `distillate/ddsketch`: a quantile sketch whose every answer, p99.9 included, is within a relative error of the true value, in memory bounded by default.

`DDSketch.create(relativeAccuracy, { mapping, store })` takes a mapping factory (`bitwiseMapping` by default, the integer-only mapping of sketches-java's `DDSketch.fast()`, or `logMapping`, `linearMapping`, `quadraticMapping`, `cubicMapping`) and a store factory (`collapsingLowestStore(4096)` by default, or `collapsingHighestStore`, `denseStore`, `sparseStore`), so a bundle carries only what it names. It has `add(value, count)`, `quantile(q)`, `quantiles(qs)`, `count`, `sum`, `min`, `max`, and the same `from`, `equals`, `union` and binary and JSON serialization (frame type 10) as the other structures. `union` is exact: the bins two merged sketches hold are those one sketch fed both streams would hold.

`distillate/ddsketch/protobuf` adds `toProtobuf` and `fromProtobuf` for the message Datadog's agent and libraries exchange, with no dependencies. For a dense store the bytes match sketches-go's exactly.

Three behaviours worth knowing:

- It records numbers, not keys, and hashes nothing.
- The default store keeps 4096 bins per sign, about 19 orders of magnitude at 1%. Past that it gives up accuracy on the values nearest zero, keeping both tails; raise `maxBins` when tightening the accuracy.
- Datadog's message carries no sum, min or max, so a sketch read with `fromProtobuf` derives them from its bins, within the accuracy rather than exactly.
