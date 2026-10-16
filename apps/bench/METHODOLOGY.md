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
(`shuffled`), not index order. `bloomfilter` takes its probe positions straight
from FNV-1a's state, with no finaliser, so keys that differ only in their last
characters probe nearby bits. Its false positive rate is unaffected, 0.96% to
1.06% on such keys against a 1% target; only cache locality changes. Walked in
index order it read up to 1.6 times faster than shuffled, where distillate's
murmur3 moved by about 10%. A workload that really inserts or queries
sequential IDs in sequence gets that locality too; a benchmark should not
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

## Configuration for DDSketch

DDSketch is compared with `@datadog/sketches-js`, Datadog's own JavaScript
port, at a `relativeAccuracy` of 0.01, with distillate measured twice: at its
defaults, the bitwise mapping of sketches-java's `DDSketch.fast()` and a store
collapsing the lowest bins past 4096, and on
the log mapping, sketches-js's default, so that pair holds the same bins and
compares like for like. The stream is lognormal around 100, the shape latencies
take, and never reaches either store's bound.

The headline is the largest relative error over 11 quantiles from 0 to 1, each
against the exact value at rank `floor(q * (n - 1))`, which both libraries
promise to keep within 1%. Sizes are each library's own serialization, and
Datadog's protobuf message from each for a like-for-like figure; sketches-js
writes protobuf only, through `protobufjs`, which the bench installs because
sketches-js leaves it to the caller.

Bundle sizes are measured by bundling each import with esbuild for the browser,
minified, then gzipped. Each library is run in its own process, as every other
section is, at 1k, 10k, 100k and 1M values. Each `add` rate is the median of 5
timed passes after 2 untimed ones, a fresh sketch each pass, as for key length:
a single pass in a fresh process measured how fast V8 optimises each library
rather than how fast it adds, and read the two 35% apart at 10k values where
warm they were 1% apart.

`quantile`, `union`, `toProtobuf` and `fromProtobuf` are timed the same way on
the sketch the timed adds built: `quantile` cycling the same 11 quantiles,
`union` with a second sketch of as many values from another seeded stream.
sketches-js merges in place, so its union merges both operands into a fresh
sketch, as distillate's returns one.

The default mapping's `add` depends on how V8 compiles the loop calling it, and
nothing else does. When V8 optimises the loop while it is running, as it does
the bench's single long pass, the default adds at about 117 M ops/s at 1M
values; when the loop is compiled whole before it runs (`--no-use-osr`), about 150. The log mapping and sketches-js move by under 3% between the two. The
table reports the first, which is what a loop that adds a stream in one call
gets.

## Configuration for MinHash

MinHash is compared with `bloom-filters`' MinHash and with `minhash` (npm), all
at k = 128 slots, which gives each the same theoretical Jaccard error of about
0.044 at J = 0.5. Sketches that are compared come from one family per library:
one factory for `bloom-filters`, whose hash functions are random per factory,
and the default seed for the other two.

`bloom-filters` hashes numbers, not strings, so it is fed its own
`Hashing.hashAsInt` of each item. That returns a 64-bit xxhash as a double, past
both its factory's `maxValue` and 2^53, so it is reduced to 32 bits, with
`maxValue` set to 2^32 - 1 to hold it.

Error is `|estimate - J|` over 20 seeded pairs at J = 0.5 per set size (1k, 10k
and 100k items in the union), the same pairs for every library. `add` is the
median of 5 timed passes after 2 untimed ones, a fresh sketch each pass, as for
DDSketch. Sizes are each library's own form, named in the section.

The LSH comparison covers the two libraries that ship an index. distillate's
`MinHashLSH` is tuned to a threshold of 0.5; `minhash`'s `LshIndex` takes no
threshold and runs at its default band size of 4. Each indexes 10k documents of
100 items, then queries each one's near-duplicate (89 shared items of 100, J
about 0.8) and an unrelated document. Queries that throw are caught and counted
rather than ending the run. Each library runs in its own process.

## Configuration for RIBLT

RIBLT is compared with `ribbit-riblt` 1.1.1, another JS implementation of the
same rateless scheme, and with the `InvertibleBloomFilter` of `bloom-filters`
3.0.4, the latest release on npm, the fixed-size IBLT a caller migrates from.
All three answer the same question exactly: which keys does the sender hold that
the receiver does not, and the reverse.

Each case gives both sides `keys` keys, of which `d / 2` are each side's own, at
1 million and 10,000 keys per side and d of 10, 1,000 and 100,000. d of 100,000
cannot occur at 10,000 keys, so that pair is not run. The keys are the same
strings for every library, as `Buffer`s for `bloom-filters`, which requires them.

`ribbit-riblt` and `bloom-filters` stop at 10,000 keys, and their 1 million rows
are marked not run. At 1 million keys `bloom-filters` took 13 to 14 s a side and
ran out of memory at d of 100,000; `ribbit-riblt` took about 4 s a side at d of
1,000 and had not finished d of 100,000 after 35 minutes.

`bloom-filters`' table must be sized before the difference is known, and too
small a table fails to decode. It is given the true d through its own sizing,
`InvertibleBloomFilter.create(d, 0.01)`, an advantage no real caller has; a
caller guessing low would fail and resend, and one guessing high would ship a
larger table. Its bytes are the sender's `saveAsJSON`, the form it ships. A
failed decode is reported as such rather than dropped.

distillate is not sized: the sender streams frames of 64 coded symbols, the
guide's suggestion, until the receiver decodes. Its bytes count every frame byte
sent, headers and the unused tail of the last frame included, so a small d pays
for most of a frame it did not need. The minimal symbol counts, without that
tail, are gated in the package's tests and quoted in the RIBLT guide.

`ribbit-riblt` is not sized either, and streams the same 64-cell batches through
its own `serializeCellBatch`, whose bytes are counted the same way. Its receiver
does not hold a decoder over its set: it streams cells from its own keys and
diffs them against the sender's, and `receive` counts that stream. It returns
both sides' keys themselves, where distillate returns the sender's as 64-bit
hashes the sender resolves, one more message when the receiver needs the keys.
That message is not counted.

Time is reported per side, building included: an encoder's stream is consumed
by the one peer it serves, so every sync builds both sides from their keys. For
`bloom-filters`, the sender builds its table, and the receiver builds its own and
then subtracts and decodes. Each time is the median of 3 timed passes after 1
untimed one, each library in its own process.
