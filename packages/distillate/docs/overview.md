# distillate

Modern probabilistic data structures for JavaScript. Successor to aging Bloom filter packages.

## What

Probabilistic structures trade a bounded, tunable error for a fraction of the space an exact answer would need. `distillate` ships the right structure per workload (not just a Bloom filter), TS-first, dependency-free, universal.

Two questions so far, each with its own family:

- **Have I seen this key?** Approximate-membership filters: a tunable false-positive rate and zero false negatives. Bloom, Blocked Bloom, Binary Fuse.
- **How many distinct keys have I seen?** Cardinality sketches: a count in space fixed by precision rather than by the answer. HyperLogLog, in 12 KiB at about 0.8% relative error whether the true count is a thousand or a billion.

Frequency, quantiles, and similarity are the same shape of question and are not shipped yet. See [architecture.md](architecture.md) for why a sketch cannot satisfy the filter interface.

## Why (market gap, 2026)

- `bloom-filters` (~493k/wk) is the de-facto standard but: CJS-only, not tree-shakeable, breaks on edge runtimes (dynamic `eval` via `reflect-metadata`/`seedrandom`), heavy deps (lodash, long, seedrandom), and has a false-negative bug in its Cuckoo filter.
- Rest of the field is stale or Bloom-only micro-packages.
- No maintained JS/TS Binary Fuse or Ribbon filter exists anywhere.

## Promises

1. Runs anywhere: Node, Bun, Deno, browser, Cloudflare/Vercel edge. No `eval`, no required WASM compile.
2. Correct: no false negatives (property-tested), FPR statistically validated against theory, and sketch error gated in CI against its analytic bound.
3. Small: per-structure subpath imports, `sideEffects: false`, zero runtime deps.

## Goals

- Best-in-class DX: one narrow interface per family, first-class sizing helpers, honest static-vs-mutable API split.
- Portable versioned binary format (readable from Rust/Go), carrying sketches as well as filters: format v4 renamed the frame magic from `AMQF` to `DSTL` for exactly that reason.
- Rigorous cross-runtime benchmarks.

## Non-goals

- Cryptographic hashing or security guarantees.
- Distributed / on-disk filters (v1 is in-memory; serialization is the persistence primitive).

## v1.0 scope (lean)

Blocked Bloom, Classic Bloom, Binary Fuse 8/16, HyperLogLog, correct Cuckoo (with delete), plus sizing helpers, serialization, docs, benchmarks. Ribbon/BuRR, WASM acceleration, expandable filters (InfiniFilter/Aleph), and the other sketch families are post-1.0.

## Module docs

- [architecture.md](architecture.md): interfaces, families, storage, file layout.
- [choosing a structure](https://distillate.akxp.net/guides/choosing-a-structure/): decision matrix, v1 lineup, citations, deferred tiers.
- [hashing.md](hashing.md): hash strategy and correctness.
- [serialization](https://distillate.akxp.net/reference/serialization/): binary format spec.
- [engineering.md](engineering.md): packaging, testing, benchmarking, CI, release.
