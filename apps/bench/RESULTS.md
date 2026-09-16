# distillate-bench results

- Machine: distillate-bench | node v24.14.1 | arm64 | Apple M5 | 10 cores
- Package: distillate@0.9.0
- Date: 2026-09-16

All filters are configured at the same target FPR (1%) and measured by identical code.
See [METHODOLOGY.md](./METHODOLOGY.md) for how these benches are run.

The filter numbers are carried forward from the distillate@0.7.0 run dated
2026-08-20. Nothing in those structures has changed since, so rerunning them only
moves the figures by run-to-run variance. The cardinality section was measured on
0.9.0, which is the release that first ships the sketch.

## Space and accuracy

| Structure        | Capacity | bits/key | measured FPR | Notes                   |
| ---------------- | -------- | -------- | ------------ | ----------------------- |
| distillate/bloom | 100k     | 9.59     | 1.01%        |                         |
| bloom-filters    | 100k     | 9.59     | 0.99%        |                         |
| bloomfilter      | 100k     | 9.59     | 0.96%        |                         |
| blocked          | 100k     | 11.00    | 0.86%        | no incumbent equivalent |
| fuse8            | 100k     | 9.50     | 0.39%        | no incumbent equivalent |
| fuse16           | 100k     | 19.01    | 0.00%        | no incumbent equivalent |
| distillate/bloom | 1M       | 9.59     | 1.02%        |                         |
| bloom-filters    | 1M       | 9.59     | 1.02%        |                         |
| bloomfilter      | 1M       | 9.59     | 0.97%        |                         |
| blocked          | 1M       | 11.00    | 0.83%        | no incumbent equivalent |
| fuse8            | 1M       | 9.04     | 0.38%        | no incumbent equivalent |
| fuse16           | 1M       | 18.09    | 0.00%        | no incumbent equivalent |

## Cardinality

Both sketches are built at a matched register count (`m = 2 ** p`), so they carry the same theoretical error of `1.04 / sqrt(m)`.
Equal memory was rejected as the basis: it would hand the incumbent roughly a eleventh of the registers, making its accuracy look bad for a reason that is really about representation rather than estimation.

The two sizes are not the same encoding. distillate writes a binary payload and `bloom-filters` writes JSON, so each row names its format.

distillate is exact at small cardinalities because it is still holding sparse entries there, not because its estimator is better.
Once it promotes to dense registers it carries the same theoretical error as any HyperLogLog at that precision.

Past 10k the distillate column does not move: 12,314 bytes at 10k and the same
12,314 bytes at 10M, because dense registers do not grow with `n`. The incumbent's
JSON does grow, from 32,904 to 40,247 bytes over the same range, since larger
register values take more digits to spell out.

| Sketch         | n    | registers | estimate | rel. error | size           |
| -------------- | ---- | --------- | -------- | ---------- | -------------- |
| distillate/hll | 1k   | 16384     | 1000     | 0.00%      | 4026 B binary  |
| bloom-filters  | 1k   | 16384     | 504      | 49.63%     | 32904 B json   |
| distillate/hll | 10k  | 16384     | 9954     | 0.46%      | 12314 B binary |
| bloom-filters  | 10k  | 16384     | 5049     | 49.51%     | 32912 B json   |
| distillate/hll | 100k | 16384     | 99181    | 0.82%      | 12314 B binary |
| bloom-filters  | 100k | 16384     | 100778   | 0.78%      | 32991 B json   |
| distillate/hll | 1M   | 16384     | 997042   | 0.30%      | 12314 B binary |
| bloom-filters  | 1M   | 16384     | 994642   | 0.54%      | 33831 B json   |
| distillate/hll | 10M  | 16384     | 10015492 | 0.15%      | 12314 B binary |
| bloom-filters  | 10M  | 16384     | 9959055  | 0.41%      | 40247 B json   |

## Throughput (n = 100k)

Absolute throughput is machine-relative: it depends on the CPU, the runtime, and the load on the box at measurement time.
Compare the ratios between rows, not these figures against a run on another machine.

| Operation                   | Throughput    |
| --------------------------- | ------------- |
| distillate/bloom add        | 22.06 M ops/s |
| distillate/bloom has (hit)  | 22.00 M ops/s |
| distillate/bloom has (miss) | 18.88 M ops/s |
| bloom-filters add           | 289 k ops/s   |
| bloom-filters has (hit)     | 291 k ops/s   |
| bloom-filters has (miss)    | 288 k ops/s   |
| bloomfilter add             | 13.40 M ops/s |
| bloomfilter has (hit)       | 14.12 M ops/s |
| bloomfilter has (miss)      | 12.50 M ops/s |
| blocked has (hit)           | 24.31 M ops/s |
| blocked has (miss)          | 20.39 M ops/s |
| fuse8 has (hit)             | 11.04 M ops/s |
| fuse8 has (miss)            | 11.04 M ops/s |
| fuse16 has (hit)            | 10.95 M ops/s |
| fuse16 has (miss)           | 10.95 M ops/s |
| distillate/hll add          | 25.58 M ops/s |
| distillate/hll count        | 45 k ops/s    |
| bloom-filters hll add       | 8 k ops/s     |
| bloom-filters hll count     | 3 k ops/s     |
