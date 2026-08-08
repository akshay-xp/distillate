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
- **blocked**, **fuse8**, **fuse16** are distillate-only and shown standalone; no
  audited incumbent offers an equivalent, so there is nothing fair to compare them
  to. fuse8 targets 2⁻⁸, fuse16 targets 2⁻¹⁶.

## Portability caveat

`bloomfilter` hashes strings via `charCodeAt`: fast, but ASCII-lossy (it ignores
the high bytes of non-ASCII characters) and not reproducible in another language.
distillate hashes the UTF-8 bytes with MurmurHash3_x64_128, so its filters
serialize and re-read across languages. The throughput gap is that tradeoff.

## Scope

Node only, single machine (disclosed in the banner). No Bun/Deno, no CI runs, no
charts. Capacities: 100k and 1M for space/accuracy, 100k for throughput.
