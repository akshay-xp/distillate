# distillate-bench results

- Machine: distillate-bench | node v24.14.1 | arm64 | Apple M5 | 10 cores
- Package: distillate@0.7.0
- Date: 2026-08-20

All filters are configured at the same target FPR (1%) and measured by identical code.
See [METHODOLOGY.md](./METHODOLOGY.md) for how these benches are run.

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
