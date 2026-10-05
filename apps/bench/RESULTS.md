# distillate-bench results

- Machine: distillate-bench | node v24.14.1 | arm64 | Apple M5 | 10 cores
- Package: distillate@0.14.1
- Date: 2026-10-05

All filters are configured at the same target FPR (1%) and measured by identical code.
See [METHODOLOGY.md](./METHODOLOGY.md) for how these benches are run.

Every section was measured in this run, against `bloom-filters@3.0.4` and
`bloomfilter@1.1.2`, with each library's timed figures taken in its own process.
The throughput and key-length sections run first, before the long sections can
heat the machine. The previous results published `bloomfilter` at 13.4 M adds/s;
this run measures 52.5 M, and the old in-process harness also reads about 50 M on
a rested machine, so that figure came from the conditions of the earlier run.

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

Past 10k the distillate column does not move: 12,316 bytes at 10k and the same
12,316 bytes at 10M, because dense registers do not grow with `n`. The incumbent's
JSON does grow, from 32,904 to 33,831 bytes between 1k and 1M, since larger
register values take more digits to spell out.

The build column is wall time to add every key. `bloom-filters` holds a flat 9k
adds/sec at every size, so its cost is purely linear: 11.1 seconds at 100k and 112
seconds at 1M, which is why its 10M row is projected from the 1M build rather than
run. distillate's rate instead climbs with `n`, from 1.34 M ops/s at 1k to about
15 M ops/s once dense, since the fixed cost per run is amortised and the
sparse-to-dense promotion is behind it. At 10M that is 645 milliseconds against a
projected 19 minutes.

| Sketch         | n    | registers | estimate | rel. error | size           | build                   |
| -------------- | ---- | --------- | -------- | ---------- | -------------- | ----------------------- |
| distillate/hll | 1k   | 16384     | 1000     | 0.00%      | 4028 B binary  | 1 ms (1.34 M ops/s)     |
| bloom-filters  | 1k   | 16384     | 504      | 49.63%     | 32904 B json   | 117 ms (9 k ops/s)      |
| distillate/hll | 10k  | 16384     | 9954     | 0.46%      | 12316 B binary | 2 ms (4.17 M ops/s)     |
| bloom-filters  | 10k  | 16384     | 5049     | 49.51%     | 32912 B json   | 1.13 s (9 k ops/s)      |
| distillate/hll | 100k | 16384     | 99181    | 0.82%      | 12316 B binary | 10 ms (10.31 M ops/s)   |
| bloom-filters  | 100k | 16384     | 100778   | 0.78%      | 32991 B json   | 11.10 s (9 k ops/s)     |
| distillate/hll | 1M   | 16384     | 997042   | 0.30%      | 12316 B binary | 73 ms (13.70 M ops/s)   |
| bloom-filters  | 1M   | 16384     | 994642   | 0.54%      | 33831 B json   | 111.51 s (9 k ops/s)    |
| distillate/hll | 10M  | 16384     | 10015492 | 0.15%      | 12316 B binary | 645 ms (15.51 M ops/s)  |
| bloom-filters  | 10M  | 16384     | not run  | -          | -              | ~19 min projected build |

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

| Filter              | keys | stages  | bits/key | measured FPR | add                     | has          |
| ------------------- | ---- | ------- | -------- | ------------ | ----------------------- | ------------ |
| distillate/scalable | 1k   | 1       | 11.03    | 0.50%        | 805 k ops/s             | 2.41 M ops/s |
| bloom-filters       | 1k   | 2       | 40.17    | 0.81%        | 62 k ops/s              | 176 k ops/s  |
| distillate/scalable | 10k  | 4       | 21.45    | 0.89%        | 3.13 M ops/s            | 5.59 M ops/s |
| bloom-filters       | 10k  | 4       | 26.36    | 1.43%        | 52 k ops/s              | 96 k ops/s   |
| distillate/scalable | 100k | 7       | 23.27    | 0.99%        | 4.82 M ops/s            | 8.75 M ops/s |
| bloom-filters       | 100k | 7       | 29.68    | 1.60%        | 3 k ops/s               | 51 k ops/s   |
| distillate/scalable | 1M   | 10      | 23.10    | 1.00%        | 3.64 M ops/s            | 8.59 M ops/s |
| bloom-filters       | 1M   | not run | -        | -            | ~49 min projected build | -            |
| distillate/scalable | 10M  | 14      | 46.43    | 1.01%        | 2.52 M ops/s            | 5.75 M ops/s |
| bloom-filters       | 10M  | not run | -        | -            | ~81.4 h projected build | -            |

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

The incumbent's add rate falls from 62k to about 3k ops/s by 100k. Every `add`
calls `_currentload()`, which counts every set bit in the newest stage, so each
insert costs time proportional to that stage's size, and its 1M and 10M rows are
projected from its 100k build rather than run. distillate's add rate peaks
around 100k and eases to 2.52 M ops/s at 10M: each new key is checked against
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
| distillate/cuckoo | 1k   | 11.84    | 0.68%        | 0 (0.00%)        | 0 (0.00%)         | 0       | 940 k ops/s  | 2.82 M ops/s | 3.78 M ops/s |
| bloom-filters     | 1k   | 8.38     | 2.90%        | 370 (37.00%)     | 160 (32.00%)      | 0       | 129 k ops/s  | 210 k ops/s  | 265 k ops/s  |
| distillate/cuckoo | 10k  | 10.93    | 0.76%        | 0 (0.00%)        | 0 (0.00%)         | 0       | 4.95 M ops/s | 7.49 M ops/s | 6.13 M ops/s |
| bloom-filters     | 10k  | 8.38     | 2.96%        | 3109 (31.09%)    | 1421 (28.42%)     | 0       | 249 k ops/s  | 295 k ops/s  | 271 k ops/s  |
| distillate/cuckoo | 100k | 10.65    | 0.72%        | 0 (0.00%)        | 0 (0.00%)         | 0       | 5.15 M ops/s | 8.87 M ops/s | 8.00 M ops/s |
| bloom-filters     | 100k | 8.38     | 2.95%        | 32659 (32.66%)   | 14779 (29.56%)    | 0       | 239 k ops/s  | 271 k ops/s  | 291 k ops/s  |
| distillate/cuckoo | 1M   | 10.57    | 0.72%        | 0 (0.00%)        | 0 (0.00%)         | 0       | 5.84 M ops/s | 9.19 M ops/s | 8.83 M ops/s |
| bloom-filters     | 1M   | 8.38     | 2.97%        | 333618 (33.36%)  | 150780 (30.16%)   | 0       | 225 k ops/s  | 241 k ops/s  | 251 k ops/s  |
| distillate/cuckoo | 10M  | 10.54    | 0.79%        | 0 (0.00%)        | 0 (0.00%)         | 0       | 5.79 M ops/s | 9.25 M ops/s | 8.87 M ops/s |
| bloom-filters     | 10M  | 8.38     | 2.86%        | 3346399 (33.46%) | 1511025 (30.22%)  | 0       | 188 k ops/s  | 232 k ops/s  | 231 k ops/s  |

The incumbent loses about a third of the keys it accepted, from 31% to 37%
across every size, with every `add` reporting success: an eviction moves a
fingerprint to a bucket its key's lookup never checks. Deleting half the keys
does not repair it: 28% to 32% of the kept half still reads absent. distillate
loses none, before or after the deletes. The incumbent's 8-bit fingerprint puts
its false-positive rate near 2.9% against the 1% it was asked for, where
distillate's 10 bits land at 0.7% to 0.8%, for 2.2 to 2.6 more bits per key from
10k up. From 10k up distillate adds 20 to 31 times faster and answers `has` and
`delete` 23 to 40 times faster; the 1k row is a single short pass and closer.

## Count-Min

Both sketches are built at the same geometry, 2,719 columns by 7 rows, which is what `epsilon` 0.001 and `delta` 0.001 call for.

Reaching that geometry in `bloom-filters` means passing `0.001` to an argument its documentation calls "the probability of accuracy".
Its `create(errorRate, accuracy = 0.999)` sizes rows as `Math.ceil(Math.log(1 / accuracy))`, a formula that wants `delta`, the failure probability; the comment directly above that line in its source even reads `rows = Math.ceil(Math.log(1 / delta))`.
Measured: `create(0.001)` and `create(0.001, 0.999)` both give 2,719 columns by **one** row, where taking the minimum across rows buys nothing at all.
A reader following its documentation gets that single-row sketch. The rows below give it the seven the target calls for, so the comparison is at equal size rather than against a sketch a seventh the height.

Accuracy is measured on a Zipf-skewed stream over 10,000 distinct keys, the shape a frequency sketch exists for: a uniform stream spreads counts evenly and hides the collisions between one heavy key and the light tail sharing its column.
`mean over` and `max over` are how far above the true count an estimate sits, and `over bound` is the share of keys past `epsilon * events`, which the geometry allows at up to `delta`.
`under` counts answers below the true count, which neither sketch may ever give; it is measured rather than assumed.

The two sizes are not the same encoding: distillate writes a binary frame and `bloom-filters` writes JSON.

| Sketch              | events | grid     | size    | mean over | max over | over bound | under | add           | count         |
| ------------------- | ------ | -------- | ------- | --------- | -------- | ---------- | ----- | ------------- | ------------- |
| distillate/countmin | 1k     | 2719 x 7 | 76168 B | 0.0       | 0        | 0.00%      | 0     | 904 k ops/s   | 1.75 M ops/s  |
| bloom-filters       | 1k     | 2719 x 7 | 38264 B | 0.0       | 0        | 0.00%      | 0     | 130 k ops/s   | 132 k ops/s   |
| distillate/countmin | 10k    | 2719 x 7 | 76168 B | 0.0       | 3        | 0.00%      | 0     | 3.60 M ops/s  | 3.19 M ops/s  |
| bloom-filters       | 10k    | 2719 x 7 | 39257 B | 0.0       | 2        | 0.00%      | 0     | 229 k ops/s   | 224 k ops/s   |
| distillate/countmin | 100k   | 2719 x 7 | 76168 B | 2.6       | 31       | 0.00%      | 0     | 12.51 M ops/s | 3.21 M ops/s  |
| bloom-filters       | 100k   | 2719 x 7 | 49982 B | 2.5       | 28       | 0.00%      | 0     | 232 k ops/s   | 244 k ops/s   |
| distillate/countmin | 1M     | 2719 x 7 | 76168 B | 29.6      | 276      | 0.00%      | 0     | 13.34 M ops/s | 5.07 M ops/s  |
| bloom-filters       | 1M     | 2719 x 7 | 68025 B | 29.7      | 211      | 0.00%      | 0     | 259 k ops/s   | 261 k ops/s   |
| distillate/countmin | 10M    | 2719 x 7 | 76168 B | 301.3     | 2517     | 0.00%      | 0     | 14.77 M ops/s | 10.40 M ops/s |
| bloom-filters       | 10M    | 2719 x 7 | 86630 B | 303.2     | 2226     | 0.00%      | 0     | 235 k ops/s   | 257 k ops/s   |

## Top-K

Both sketches target an error of 0.001 of the events recorded, and both are asked for the top k = 100.
The two are built differently, and that difference is the comparison: `bloom-filters` takes `k` at construction and keeps a Count-Min sketch plus a sorted list of that many candidates, where distillate keeps a Misra-Gries map sized by the error alone and takes `k` per query.
So the incumbent is given the same `k` that distillate is queried with, rather than a smaller one that would make it look worse.

`bloom-filters`' `TopK(k, errorRate, accuracy)` hands `accuracy` straight to its Count-Min sketch, and inherits the inversion in the Count-Min section above: rows are sized as `Math.ceil(Math.log(1 / accuracy))`, a formula that wants the failure probability.
Measured: `new TopK(10, 0.001)` gives 2,719 columns by **one** row. The rows below pass `0.001` as `accuracy` to give it the seven rows the target calls for.

The headline is precision and recall of the returned set against the true top k, on a Zipf-skewed stream over 10,000 distinct keys.
Keys tied at the k-th true count are interchangeable: every key above it must come back, and any tie may fill the places left, so an arbitrary but correct tie-break scores 1.
`under` counts returned keys whose estimate is below the true count, which distillate's sketch rules out; it is measured rather than assumed.

`holds` is what each sketch was read back to hold. The sizes are not the same encoding: distillate writes a binary frame, holding every key its map has kept, and `bloom-filters` writes JSON.

| Sketch          | events | holds              | size    | precision | recall | under | add          |
| --------------- | ------ | ------------------ | ------- | --------- | ------ | ----- | ------------ |
| distillate/topk | 1k     | 4096 slots         | 7770 B  | 1.000     | 1.000  | 0     | 765 k ops/s  |
| bloom-filters   | 1k     | 2719 x 7 + top 100 | 41707 B | 1.000     | 1.000  | 0     | 67 k ops/s   |
| distillate/topk | 10k    | 4096 slots         | 43974 B | 1.000     | 1.000  | 0     | 3.21 M ops/s |
| bloom-filters   | 10k    | 2719 x 7 + top 100 | 42773 B | 1.000     | 1.000  | 0     | 105 k ops/s  |
| distillate/topk | 100k   | 4096 slots         | 41390 B | 1.000     | 1.000  | 0     | 3.56 M ops/s |
| bloom-filters   | 100k   | 2719 x 7 + top 100 | 53589 B | 0.990     | 0.990  | 0     | 117 k ops/s  |
| distillate/topk | 1M     | 4096 slots         | 40333 B | 1.000     | 1.000  | 0     | 3.98 M ops/s |
| bloom-filters   | 1M     | 2719 x 7 + top 100 | 71733 B | 0.980     | 0.980  | 0     | 123 k ops/s  |

## Throughput (n = 100k)

Absolute throughput is machine-relative: it depends on the CPU, the runtime, and the load on the box at measurement time.
Compare the ratios between rows, not these figures against a run on another machine.

| Operation                   | Throughput    |
| --------------------------- | ------------- |
| distillate/bloom add        | 21.98 M ops/s |
| distillate/bloom has (hit)  | 22.24 M ops/s |
| distillate/bloom has (miss) | 19.49 M ops/s |
| bloom-filters add           | 285 k ops/s   |
| bloom-filters has (hit)     | 290 k ops/s   |
| bloom-filters has (miss)    | 291 k ops/s   |
| bloomfilter add             | 52.51 M ops/s |
| bloomfilter has (hit)       | 49.93 M ops/s |
| bloomfilter has (miss)      | 36.51 M ops/s |
| blocked has (hit)           | 24.37 M ops/s |
| blocked has (miss)          | 20.58 M ops/s |
| fuse8 has (hit)             | 11.08 M ops/s |
| fuse8 has (miss)            | 11.08 M ops/s |
| fuse16 has (hit)            | 10.86 M ops/s |
| fuse16 has (miss)           | 11.29 M ops/s |
| distillate/hll add          | 28.44 M ops/s |
| distillate/hll count        | 52 k ops/s    |
| bloom-filters hll add       | 9 k ops/s     |
| bloom-filters hll count     | 3 k ops/s     |

On keys of up to seven characters `bloomfilter` is the fastest Classic Bloom
filter here: it adds 2.4 times as fast as distillate and answers `has` 2.2 times
as fast on hits and 1.9 times on misses. Its FNV costs little per call on a
short key, where distillate pays a UTF-8 encode and murmur3's fixed
finalisation. `bloom-filters`, the incumbent for every other structure here, is
slower than distillate's equivalent in every row.

## Key length

The Classic Bloom filters at 100k keys, timed again at each key length in characters, for ASCII keys and for keys that carry non-ASCII characters.
The libraries do different work per character: `bloomfilter` runs FNV-1a over each UTF-16 code unit, and distillate encodes the key to UTF-8 and runs murmur3 over the bytes, so which is faster depends on the length.

The keys are flat strings, flattened through a JSON round trip, the way keys from a parser, the network or a database arrive.
V8 keeps a concatenation of 13 or more characters as a rope, where reading each character costs more, so keys built with `+` or a template literal would skew the longer rows.

| Filter           | key length | keys      | add           | has           |
| ---------------- | ---------- | --------- | ------------- | ------------- |
| distillate/bloom | 8          | ascii     | 17.65 M ops/s | 17.98 M ops/s |
| bloom-filters    | 8          | ascii     | 300 k ops/s   | 296 k ops/s   |
| bloomfilter      | 8          | ascii     | 18.55 M ops/s | 18.38 M ops/s |
| distillate/bloom | 16         | ascii     | 17.28 M ops/s | 19.05 M ops/s |
| bloom-filters    | 16         | ascii     | 280 k ops/s   | 278 k ops/s   |
| bloomfilter      | 16         | ascii     | 12.50 M ops/s | 13.23 M ops/s |
| distillate/bloom | 32         | ascii     | 9.53 M ops/s  | 14.87 M ops/s |
| bloom-filters    | 32         | ascii     | 190 k ops/s   | 190 k ops/s   |
| bloomfilter      | 32         | ascii     | 9.07 M ops/s  | 9.36 M ops/s  |
| distillate/bloom | 128        | ascii     | 7.88 M ops/s  | 8.29 M ops/s  |
| bloom-filters    | 128        | ascii     | 100 k ops/s   | 100 k ops/s   |
| bloomfilter      | 128        | ascii     | 4.53 M ops/s  | 4.54 M ops/s  |
| distillate/bloom | 512        | ascii     | 2.96 M ops/s  | 2.78 M ops/s  |
| bloom-filters    | 512        | ascii     | 34 k ops/s    | 35 k ops/s    |
| bloomfilter      | 512        | ascii     | 1.23 M ops/s  | 1.19 M ops/s  |
| distillate/bloom | 8          | non-ascii | 17.24 M ops/s | 17.04 M ops/s |
| bloom-filters    | 8          | non-ascii | 286 k ops/s   | 285 k ops/s   |
| bloomfilter      | 8          | non-ascii | 11.70 M ops/s | 14.10 M ops/s |
| distillate/bloom | 16         | non-ascii | 13.94 M ops/s | 14.31 M ops/s |
| bloom-filters    | 16         | non-ascii | 184 k ops/s   | 184 k ops/s   |
| bloomfilter      | 16         | non-ascii | 10.70 M ops/s | 10.74 M ops/s |
| distillate/bloom | 32         | non-ascii | 8.80 M ops/s  | 8.94 M ops/s  |
| bloom-filters    | 32         | non-ascii | 137 k ops/s   | 136 k ops/s   |
| bloomfilter      | 32         | non-ascii | 8.48 M ops/s  | 8.44 M ops/s  |
| distillate/bloom | 128        | non-ascii | 3.33 M ops/s  | 3.37 M ops/s  |
| bloom-filters    | 128        | non-ascii | 54 k ops/s    | 55 k ops/s    |
| bloomfilter      | 128        | non-ascii | 3.79 M ops/s  | 3.80 M ops/s  |
| distillate/bloom | 512        | non-ascii | 947 k ops/s   | 949 k ops/s   |
| bloom-filters    | 512        | non-ascii | 16 k ops/s    | 16 k ops/s    |
| bloomfilter      | 512        | non-ascii | 1.19 M ops/s  | 1.19 M ops/s  |

The two tables time differently: Throughput is mitata's per-call figure over a
cycled pool, Key length one timed pass over 100k distinct keys, so compare rows
within a table. With ASCII keys the two are level at 8 characters, with
`bloomfilter` about 5% ahead; from 16 distillate leads, by 2.4 times at 512. With
non-ASCII keys distillate leads at 8 and 16 characters, the two are level at 32,
and `bloomfilter` is ahead at 128 and 512, where distillate encodes two or three
UTF-8 bytes per character and `bloomfilter` reads one code unit.
