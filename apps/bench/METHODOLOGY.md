# Methodology

How `RESULTS.md` is produced. Run it yourself with `pnpm bench` (`src/report.ts`).

## Fairness

All classic-Bloom libraries are configured for the **same target FPR (1%)** over the
**same key set**, and every filter is measured by the **same vendored code**
(`src/harness.ts`), so differences reflect the implementation, not the setup.

## Configuration at matched FPR

- `distillate/bloom`: `BloomFilter.create(n, 0.01)`.
- `bloom-filters`: `BloomFilter.create(n, 0.01)`.
- `bloomfilter` (jasondavies): takes bits `m` and hashes `k` directly, so it is
  given `(m, k)` computed from `(n, 0.01)` by the standard optimal-sizing formulas
  (`m = ceil(-n·ln ε / ln²2)`, `k = round((m/n)·ln 2)`). See `optimalMK` in
  `src/adapters.ts`.

`bits/key` is read from each filter's actual allocated bit count divided by `n`,
not from the requested target, so all three land at the same ~9.59 bits/key.

## Configuration at matched precision

HyperLogLog is compared at a **matched register count**. `bloom-filters` takes the
register count `m` directly and distillate takes a precision `p`, so `m = 2 ** p`
puts both on the same number of registers and therefore the same theoretical error
of `1.04 / sqrt(m)`. Accuracy is then comparable and space is the differentiator.

Equal _memory_ was rejected as the basis. It would hand the incumbent roughly a
eleventh of the registers, so its accuracy would look bad for a reason that is
really about representation rather than estimation. That is the misleading table,
so the comparison does not use it.

Sizes are not the same encoding: distillate writes a binary payload, `bloom-filters`
writes JSON via `saveAsJSON`. Each row names its format rather than presenting the
two as interchangeable.

Accuracy is reported across a **sweep** of cardinalities, not at one point, because
the incumbent has no working small-range correction: it is roughly 50% off whenever
`n` is below about `2.5 * m`, and accurate once `n` is well past `m`. A single
point would hide which of the two regimes it is in.

distillate is exact at the low end of that sweep because it is still storing sparse
entries there, not because its estimator is better. Once it promotes to dense
registers it carries the same theoretical error as any HyperLogLog at that precision.

`p = 14` is not an arbitrary pick. It gives `m = 16384` six-bit registers, the same
configuration Redis uses for its own HyperLogLog, so the precision under test is one
people actually run rather than one chosen to flatter a table.

The sweep runs to 10M distinct keys so the asymptotic regime is visible and not just
the small-range one. Memory is the point being shown: the dense sketch does not grow
with `n`, so the size column stays flat while the cardinality moves four orders of
magnitude.

Each row records the wall time to add its keys, so build cost is reported alongside
accuracy and space rather than needing a separate run. The sweep's cost is almost
entirely the incumbent, which holds a flat 9k adds/sec at every size: 10.6 seconds
at 100k, 109 seconds at 1M and 1,165 seconds at 10M, against 626 milliseconds for
distillate at 10M. The full sweep takes about 21 minutes, essentially all of it
waiting on `bloom-filters`.

The sketch throughput benches build at 20,000 keys rather than the 100k the filter
benches use. The incumbent adds at roughly 8k ops/s, so a 100k-key sketch costs it
about 12.5 seconds to build.

## Configuration for Scalable Bloom

Scalable Bloom is compared at the **incumbent's default configuration**. Both
filters get the same arguments: an initial size of 1,000 keys, a 1% target,
growth 2, and a tightening `ratio` of 0.5. `bloom-filters` fixes growth at 2 and
defaults `ratio` to 0.5, so distillate is set to match (`growth: 2, tightening:
0.5`) rather than run at its own defaults.

The match is on arguments, not on stage capacities, because the two do not grow
the same way. `bloom-filters` passes `ratio` to each stage twice, as the
tightening factor and as the stage's load factor, and opens a new stage when a
stage's fill passes that load factor. distillate opens one after a count of keys.
Its first stage also targets the full rate, so its stage targets sum to
`errorRate / (1 - ratio)`; distillate's sum to the target. Each filter is
measured from 1k to 10M keys, one to ten thousand times the initial size.
`bloom-filters` stops at 100k: every `add` recounts the newest stage's set bits
(`_currentload`), so its build is quadratic in the key count. Its 1M and 10M rows
are marked not run, with the build time projected quadratically from its own 100k
run.

## Configuration for Cuckoo

Cuckoo is compared with both filters built by `create(n, 0.01)`, which gives
both a bucket size of 4 and a limit of 500 kicks per add: the incumbent's
defaults, and distillate's fixed values. The one setting that does not match is
the fingerprint. `bloom-filters` takes `ceil(f / 8)` hex characters of a 32-bit
hash, where `f` is the width the target calls for (10 bits at 1%), so it stores
2 hex characters, 8 bits, as a JS string. distillate stores 10 bits packed.
Bits per key is each filter's nominal slot bits over the key count; for the
incumbent that is hex characters times 4 bits, not the heap its strings occupy.

Each row runs a delete-half workload: add `n` keys, count those `has` then
denies (lost after build), measure FPR over 100,000 keys neither filter saw,
delete the first half, and count kept keys that `has` denies (lost after
delete, a share of the kept half). Adds that report the filter full are counted
as refused. Both are measured from 1k to 10M keys; the incumbent scales
linearly, so no row is projected.

## Configuration for Count-Min

Count-Min is compared with both sketches at the same geometry, 2,719 columns by
7 rows, which is what `epsilon` 0.001 and `delta` 0.001 call for.

Reaching that geometry in `bloom-filters` means passing `0.001` to an argument
its documentation calls "the probability of accuracy". Its
`create(errorRate, accuracy = 0.999)` sizes rows as
`Math.ceil(Math.log(1 / accuracy))`, a formula that wants `delta`, the failure
probability; the comment directly above that line in its source reads
`rows = Math.ceil(Math.log(1 / delta))`. Measured, `create(0.001)` and
`create(0.001, 0.999)` both give 2,719 columns by one row, where taking the
minimum across rows buys nothing. Giving it seven rows is what makes the
comparison equal-sized rather than flattering; a reader following its
documentation gets the one-row sketch.

Accuracy is measured on a Zipf-skewed stream over 10,000 distinct keys, rank
`i` appearing with probability proportional to `1 / (i + 1)`. A uniform stream
spreads counts evenly and hides the collisions between one heavy key and the
light tail sharing its column, which is where a frequency estimate is tested.
Overestimate columns are how far above the true count an estimate sits, over
every distinct key in the stream. Answers below the true count are counted
rather than assumed absent: that is the one answer neither sketch may give.

Sizes are not the same encoding. distillate reports its binary frame length and
`bloom-filters` the length of its JSON, as in the cardinality section.

## Configuration for Top-K

Top-K is compared with both sketches asked for the top k = 100 and both targeting
an error of 0.001 of the events recorded. The two take `k` differently:
`bloom-filters`' `TopK(k, errorRate, accuracy)` fixes it at construction and
keeps only that many candidates, while distillate sizes its map by the error and
takes `k` per query. So the incumbent is built with k = 100, the same `k`
distillate is queried with; a smaller one would strawman it.

Its `accuracy` goes straight to its Count-Min sketch, so it inherits the
inversion recorded above: `accuracy` sizes the rows as the failure probability.
Measured, `new TopK(10, 0.001)` gets 2,719 columns by one row. It is built as
`new TopK(100, 0.001, 0.001)`, which gives the seven rows the target calls for;
a reader following its documentation gets the one-row sketch.

The headline metric is precision and recall of the returned set against the true
top k, not the error of the counts: a top-k structure is judged on whether the
right keys came back. Accuracy is measured on the Zipf-skewed stream the
Count-Min section uses, over 10,000 distinct keys. Keys tied at the k-th true
count are interchangeable: every key above that count must be returned, and any
tie may fill the places left, so a correct but arbitrary tie-break scores 1. A
returned key whose estimate is below its true count is counted rather than
assumed absent.

Events are capped at 1M, as for the incumbent's HyperLogLog after it took about
21 minutes for 10M. Sizes are not the same encoding: distillate reports its
binary frame length, which holds every key its map has kept, and `bloom-filters`
the length of its JSON.

## Keys

`hitMissPools(n)` builds two disjoint sets: inserted "hit" keys `0:0 … 0:(n-1)`
and never-inserted "miss" keys `1:0 … 1:(n-1)`. The prefixes guarantee the miss
set shares no member with the hit set.

Both pools, and the key-length keys, are served in a fixed shuffled order
(`shuffled`), not index order. A hash with weak avalanche sends keys that differ
only in their last characters to nearby bits: walked in index order, `bloomfilter`'s
FNV-1a stays in a few cache lines and read up to 1.6 times faster than shuffled,
where distillate's murmur3 moved by about 10%. A workload that really inserts or
queries sequential IDs in sequence gets that locality too; a benchmark should not
assume it.

The key-length sweep builds its own keys (`keyLengthKeys`): a unique base-64
index padded to the exact length with `.` for ASCII keys, or prefixed with `é`
and padded with `漢` for keys that carry non-ASCII characters. Base 64 fits 100k
keys in three digits, so even 4-character non-ASCII keys are unique and hold one.
They are flattened through a JSON round trip
so every key is one of the flat strings a parser, the network or a database
returns. V8 keeps a concatenation of 13 or more characters as a rope, where
`charCodeAt` costs more per character, which would skew the longer rows against
a library that reads characters one at a time.

## Measured FPR

After inserting the hit set, `measureFpr` queries a disjoint miss set of
1,000,000 keys and reports the fraction that return true. A well-built 1%-target
filter lands near 1%; blocked/fuse sit lower by design.

## Throughput

Measured with [mitata](https://github.com/evanwashere/mitata) at n = 100,000.
To keep the numbers honest against dead-code elimination:

- results are fed through mitata's `do_not_optimize`;
- lookups cycle through a key pool (`cycle`) instead of repeating one key;
- hit and miss paths are benched separately;
- `add` inserts distinct keys each iteration.

Reported as ops/sec (`1e9 / avg_ns`).

## Isolation

Every timed figure, in every section, comes from a library run in its
own process (`src/isolate.ts`), one process after another so none compete for the
CPU. Timing libraries in one process can bias the result: V8 shapes a shared
call site, such as the lookup loop, around the libraries that reach it first. In
one check `bloomfilter`'s `has` read 23 M lookups/s sharing a process with
distillate and 50 M on its own. Space and FPR time nothing, so they are measured
in one process.

A laptop throttles under minutes of sustained load: in one full run every
structure's throughput, distillate's included, read about half its rested rate.
So the short per-call benches run first, before the long sections. If the
Throughput table reads far below the previous run, rerun on a rested machine.

## Structures

- **Classic Bloom** is a head-to-head: `distillate/bloom` vs `bloom-filters` vs
  `bloomfilter`.
- **HyperLogLog** is a head-to-head: `distillate/hll` vs the `bloom-filters` sketch,
  at a matched register count (see above).
- **Scalable Bloom** is a head-to-head: `distillate/scalable` vs the
  `bloom-filters` scalable filter, at the incumbent's default configuration.
- **Cuckoo** is a head-to-head: `distillate/cuckoo` vs the `bloom-filters`
  cuckoo filter, with a delete-half workload that counts lost keys.
- **blocked**, **fuse8**, **fuse16** are distillate-only and shown standalone; no
  audited incumbent offers an equivalent, so there is nothing fair to compare them
  to. fuse8 targets 2⁻⁸, fuse16 targets 2⁻¹⁶.
- **Key length** reruns the Classic Bloom head-to-head at 100k keys for each key
  length, ASCII and non-ASCII, timing `add` and `has` over the whole key set.

## Portability caveat

`bloomfilter` hashes strings over UTF-16 code units: a 64-bit FNV-1a variant
that takes a whole unit per step, read with `charCodeAt`. Nothing is lost: each
full 16-bit unit goes into the hash. No library outside JavaScript implements
it. Java, C# and Dart strings are UTF-16 too, so a port of the short hash would
read its filters there, but a language with UTF-8 strings has to transcode each
key to UTF-16 first. distillate hashes the UTF-8 bytes with murmur3_x86_128, so
its frames re-read wherever the bytes of a key are the same, which a Go reader
in this repo checks. The throughput difference depends on key length: FNV is
cheaper per call on short keys, murmur3 per character on long ones. The
key-length section shows both.

## Scope

Node only, single machine (disclosed in the banner). No Bun/Deno, no CI runs, no
charts. Capacities: 100k and 1M for space/accuracy, 100k for throughput. Cardinality is
swept at 1k/10k/100k/1M/10M against `p = 14`, with `bloom-filters` capped at 1M
and its 10M build projected from its 1M run; the sketch throughput is built at
20k. Scalable Bloom is swept at 1k/10k/100k/1M/10M keys from an initial size of 1k,
with `bloom-filters` capped at 100k. Cuckoo is swept at 1k/10k/100k/1M/10M keys
for both filters. Count-Min is swept at 1k/10k/100k/1M/10M events for both
sketches. Top-K is swept at 1k/10k/100k/1M events, capped at 1M as the
incumbent's HyperLogLog was. Key length is swept at 4/8/12/13/16/32/128/512
characters for the three Classic Bloom filters, each row the median of five
timed passes after two untimed ones.
