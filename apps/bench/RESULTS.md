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
The Scalable Bloom section was measured on 2026-09-21, on the same machine, from
the unreleased build that adds `distillate/scalable` on top of 0.10.0.
The Cuckoo section was measured on 2026-09-22, on the same machine, from the
unreleased build that adds `distillate/cuckoo` on top of 0.11.0.

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

The build column is wall time to add every key. `bloom-filters` holds a flat 9k
adds/sec at every size, so its cost is purely linear: 10.6 seconds at 100k, 109
seconds at 1M, 1,165 seconds at 10M. distillate's rate instead climbs with `n`, from
1.12 M ops/s at 1k to about 16 M ops/s once dense, since the fixed cost per run is
amortised and the sparse-to-dense promotion is behind it. At 10M that is 626
milliseconds against 19 minutes.

| Sketch         | n    | registers | estimate | rel. error | size           | build                  |
| -------------- | ---- | --------- | -------- | ---------- | -------------- | ---------------------- |
| distillate/hll | 1k   | 16384     | 1000     | 0.00%      | 4026 B binary  | 1 ms (1.12 M ops/s)    |
| bloom-filters  | 1k   | 16384     | 504      | 49.63%     | 32904 B json   | 109 ms (9 k ops/s)     |
| distillate/hll | 10k  | 16384     | 9954     | 0.46%      | 12314 B binary | 2 ms (4.35 M ops/s)    |
| bloom-filters  | 10k  | 16384     | 5049     | 49.51%     | 32912 B json   | 1.06 s (9 k ops/s)     |
| distillate/hll | 100k | 16384     | 99181    | 0.82%      | 12314 B binary | 9 ms (10.91 M ops/s)   |
| bloom-filters  | 100k | 16384     | 100778   | 0.78%      | 32991 B json   | 10.60 s (9 k ops/s)    |
| distillate/hll | 1M   | 16384     | 997042   | 0.30%      | 12314 B binary | 62 ms (16.18 M ops/s)  |
| bloom-filters  | 1M   | 16384     | 994642   | 0.54%      | 33831 B json   | 109.32 s (9 k ops/s)   |
| distillate/hll | 10M  | 16384     | 10015492 | 0.15%      | 12314 B binary | 626 ms (15.96 M ops/s) |
| bloom-filters  | 10M  | 16384     | 9959055  | 0.41%      | 40247 B json   | 1164.62 s (9 k ops/s)  |

## Scalable Bloom

Both filters are built from the same arguments: an initial size of 1,000 keys, a 1% target, growth 2, and `ratio` 0.5.
That is the incumbent's own default configuration, since `bloom-filters` fixes growth at 2 and defaults `ratio` to 0.5, so distillate is set to match it (`growth: 2, tightening: 0.5`).

The two do not grow on the same trigger. `bloom-filters` passes `ratio` to each stage twice: as the tightening factor and as the stage's load factor, and it opens a new stage when a stage's fill passes that load factor rather than after a count of keys.
So an equal initial size is the same argument, not identical stage capacities, and the stage counts can differ.

Its first stage targets the full rate and later ones `errorRate * ratio ** i`, so its targets sum to `errorRate / (1 - ratio)`, twice the requested rate at `ratio` 0.5.
distillate starts at `epsilon * (1 - tightening)`, so its whole chain targets `epsilon`.
Bits per key is allocated bits over keys added; FPR is measured over 100,000 keys neither filter saw.

distillate is measured from 1k to 10M keys, the same reach as every other structure. The incumbent stops at 100k: every `add` recounts the newest stage's set bits (`_currentload`), so its build time grows with the square of the key count.
Past 100k its rows project the build time from its own 100k run rather than running for hours at 1M and days at 10M.

| Filter              | keys | stages  | bits/key | measured FPR | add                     | has           |
| ------------------- | ---- | ------- | -------- | ------------ | ----------------------- | ------------- |
| distillate/scalable | 1k   | 1       | 11.03    | 0.50%        | 854 k ops/s             | 2.66 M ops/s  |
| bloom-filters       | 1k   | 2       | 40.17    | 0.81%        | 72 k ops/s              | 223 k ops/s   |
| distillate/scalable | 10k  | 4       | 21.45    | 0.89%        | 3.36 M ops/s            | 6.35 M ops/s  |
| bloom-filters       | 10k  | 4       | 26.36    | 1.43%        | 55 k ops/s              | 108 k ops/s   |
| distillate/scalable | 100k | 7       | 23.27    | 0.99%        | 5.76 M ops/s            | 10.16 M ops/s |
| bloom-filters       | 100k | 7       | 29.68    | 1.60%        | 4 k ops/s               | 51 k ops/s    |
| distillate/scalable | 1M   | 10      | 23.10    | 1.00%        | 4.01 M ops/s            | 8.99 M ops/s  |
| bloom-filters       | 1M   | not run | -        | -            | ~47 min projected build | -             |
| distillate/scalable | 10M  | 14      | 46.43    | 1.01%        | 2.56 M ops/s            | 5.62 M ops/s  |
| bloom-filters       | 10M  | not run | -        | -            | ~78.0 h projected build | -             |

From one to a thousand times its initial size distillate measures 0.50% to
1.00%, and 1.01% at 10M. That last figure is within sampling noise of the 1%
target: over 100,000 probes one standard deviation is about 0.03%.
`bloom-filters` measures 1.60% at 100k, past its requested rate and inside the 2%
its own stage targets add up to.

Bits per key counts every allocated stage in full, including the newest, which
opens at twice the capacity of the one before and starts empty. So the figure
holds near 23 from 100k to 1M and jumps to 46 at 10M: the fourteenth stage
opened at about 8.19M keys and at 10M is a fifth full (1.71M of 8.19M) while
holding just over half of all the allocated bits. It falls back as that stage
fills.

The incumbent's add rate falls from 72k to under 4k ops/s by 100k. Every `add`
calls `_currentload()`, which counts every set bit in the newest stage, so each
insert costs time proportional to that stage's size, and its 1M and 10M rows are
projected from its 100k build rather than run. distillate's add rate peaks
around 100k and eases to 2.56 M ops/s at 10M: each new key is checked against
every stage before it is added, fourteen by then, and at 58 MB the stages no
longer fit the CPU caches. A stage that lacks the key is usually ruled out
within two probes, which is where the check stops.

The 1k and 10k rows time a single pass of a few thousand operations, well under
a millisecond at 1k, so their throughput includes warm-up and moves from run to
run. Read the 100k and larger rows for rates.

## Cuckoo

Both filters are built by `create(n, 0.01)`, which gives both buckets of 4 and a limit of 500 kicks per add.
The fingerprint does not match: `bloom-filters` stores `ceil(f / 8)` hex characters of a 32-bit hash, 2 characters and so 8 bits at 1%, where distillate stores the 10 bits the target calls for.
Bits per key is nominal slot bits over keys; the incumbent keeps each fingerprint as a JS string, so its heap is far larger than its row shows.

Each row runs a delete-half workload: add `n` keys, count the ones `has` then denies, measure FPR over 100,000 keys neither filter saw, delete the first half, and count kept keys that `has` denies.
A key that was added and not deleted but reads absent is a false negative, the one answer a filter must never give. Refused counts adds that reported the filter full.

| Filter            | keys | bits/key | measured FPR | lost after build | lost after delete | refused | add          | has          | delete       |
| ----------------- | ---- | -------- | ------------ | ---------------- | ----------------- | ------- | ------------ | ------------ | ------------ |
| distillate/cuckoo | 1k   | 11.84    | 0.68%        | 0 (0.00%)        | 0 (0.00%)         | 0       | 958 k ops/s  | 3.00 M ops/s | 3.78 M ops/s |
| bloom-filters     | 1k   | 8.38     | 2.90%        | 370 (37.00%)     | 160 (32.00%)      | 0       | 137 k ops/s  | 265 k ops/s  | 285 k ops/s  |
| distillate/cuckoo | 10k  | 10.93    | 0.76%        | 0 (0.00%)        | 0 (0.00%)         | 0       | 4.93 M ops/s | 6.89 M ops/s | 6.63 M ops/s |
| bloom-filters     | 10k  | 8.38     | 2.96%        | 3109 (31.09%)    | 1421 (28.42%)     | 0       | 247 k ops/s  | 301 k ops/s  | 303 k ops/s  |
| distillate/cuckoo | 100k | 10.65    | 0.72%        | 0 (0.00%)        | 0 (0.00%)         | 0       | 5.49 M ops/s | 8.02 M ops/s | 7.76 M ops/s |
| bloom-filters     | 100k | 8.38     | 2.95%        | 32659 (32.66%)   | 14779 (29.56%)    | 0       | 239 k ops/s  | 296 k ops/s  | 294 k ops/s  |
| distillate/cuckoo | 1M   | 10.57    | 0.72%        | 0 (0.00%)        | 0 (0.00%)         | 0       | 5.58 M ops/s | 8.44 M ops/s | 8.28 M ops/s |
| bloom-filters     | 1M   | 8.38     | 2.97%        | 333618 (33.36%)  | 150780 (30.16%)   | 0       | 224 k ops/s  | 274 k ops/s  | 272 k ops/s  |
| distillate/cuckoo | 10M  | 10.54    | 0.79%        | 0 (0.00%)        | 0 (0.00%)         | 0       | 5.51 M ops/s | 8.67 M ops/s | 8.57 M ops/s |
| bloom-filters     | 10M  | 8.38     | 2.86%        | 3346399 (33.46%) | 1511025 (30.22%)  | 0       | 209 k ops/s  | 262 k ops/s  | 257 k ops/s  |

The incumbent loses about a third of the keys it accepted, from 31% to 37%
across every size, with every `add` reporting success: an eviction moves a
fingerprint to a bucket its key's lookup never checks. Deleting half the keys
does not repair it: 28% to 32% of the kept half still reads absent. distillate
loses none, before or after the deletes. The incumbent's 8-bit fingerprint puts
its false-positive rate near 2.9% against the 1% it was asked for, where
distillate's 10 bits land at 0.7% to 0.8%, for 2.2 to 2.6 more bits per key from
10k up. From 10k up distillate adds 20 to 26 times faster and answers `has` and
`delete` 22 to 33 times faster; the 1k row is a single short pass and closer.

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
| distillate/hll add          | 17.63 M ops/s |
| distillate/hll count        | 38 k ops/s    |
| bloom-filters hll add       | 8 k ops/s     |
| bloom-filters hll count     | 3 k ops/s     |
