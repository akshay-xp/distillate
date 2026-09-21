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

## Keys

`hitMissPools(n)` builds two disjoint sets: inserted "hit" keys `0:0 … 0:(n-1)`
and never-inserted "miss" keys `1:0 … 1:(n-1)`. The prefixes guarantee the miss
set shares no member with the hit set.

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

## Structures

- **Classic Bloom** is a head-to-head: `distillate/bloom` vs `bloom-filters` vs
  `bloomfilter`.
- **HyperLogLog** is a head-to-head: `distillate/hll` vs the `bloom-filters` sketch,
  at a matched register count (see above).
- **blocked**, **fuse8**, **fuse16** are distillate-only and shown standalone; no
  audited incumbent offers an equivalent, so there is nothing fair to compare them
  to. fuse8 targets 2⁻⁸, fuse16 targets 2⁻¹⁶.

## Portability caveat

`bloomfilter` hashes strings via `charCodeAt`: fast, but ASCII-lossy (it ignores
the high bytes of non-ASCII characters) and not reproducible in another language.
distillate hashes the UTF-8 bytes with murmur3_x86_128, so its filters
serialize and re-read across languages. The throughput gap is that tradeoff.

## Scope

Node only, single machine (disclosed in the banner). No Bun/Deno, no CI runs, no
charts. Capacities: 100k and 1M for space/accuracy, 100k for throughput. Cardinality is
swept at 1k/10k/100k/1M/10M against `p = 14`, with the sketch throughput built at
20k. Scalable Bloom is swept at 1k/10k/100k/1M/10M keys from an initial size of 1k,
with `bloom-filters` capped at 100k.
