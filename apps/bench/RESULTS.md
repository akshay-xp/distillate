# distillate-bench results

- Machine: distillate-bench | node v24.14.1 | arm64 | Apple M5 | 10 cores
- Package: distillate@0.1.1
- Date: 2026-07-31

All filters are configured at the same target FPR (1%) and measured by identical code.
See [METHODOLOGY.md](./METHODOLOGY.md) for how these benches are run.

## Space and accuracy

| Structure        | Capacity | bits/key | measured FPR | Notes                   |
| ---------------- | -------- | -------- | ------------ | ----------------------- |
| distillate/bloom | 100k     | 9.59     | 1.03%        |                         |
| bloom-filters    | 100k     | 9.59     | 0.99%        |                         |
| bloomfilter      | 100k     | 9.59     | 0.96%        |                         |
| blocked          | 100k     | 11.00    | 0.82%        | no incumbent equivalent |
| fuse8            | 100k     | 9.50     | 0.38%        | no incumbent equivalent |
| fuse16           | 100k     | 19.01    | 0.00%        | no incumbent equivalent |
| distillate/bloom | 1M       | 9.59     | 1.01%        |                         |
| bloom-filters    | 1M       | 9.59     | 1.02%        |                         |
| bloomfilter      | 1M       | 9.59     | 0.97%        |                         |
| blocked          | 1M       | 11.00    | 0.81%        | no incumbent equivalent |
| fuse8            | 1M       | 9.04     | 0.40%        | no incumbent equivalent |
| fuse16           | 1M       | 18.09    | 0.00%        | no incumbent equivalent |

## Throughput (n = 100k)

| Operation                   | Throughput    |
| --------------------------- | ------------- |
| distillate/bloom add        | 6.76 M ops/s  |
| distillate/bloom has (hit)  | 7.03 M ops/s  |
| distillate/bloom has (miss) | 6.73 M ops/s  |
| bloom-filters add           | 289 k ops/s   |
| bloom-filters has (hit)     | 285 k ops/s   |
| bloom-filters has (miss)    | 290 k ops/s   |
| bloomfilter add             | 13.19 M ops/s |
| bloomfilter has (hit)       | 14.18 M ops/s |
| bloomfilter has (miss)      | 12.29 M ops/s |
| blocked has (hit)           | 7.14 M ops/s  |
| blocked has (miss)          | 6.79 M ops/s  |
| fuse8 has (hit)             | 5.55 M ops/s  |
| fuse8 has (miss)            | 5.51 M ops/s  |
| fuse16 has (hit)            | 5.52 M ops/s  |
| fuse16 has (miss)           | 5.50 M ops/s  |
