# distillate

Modern approximate-membership toolkit for JavaScript. Successor to aging Bloom filter packages.

## What

A filter answers set membership with a tunable false-positive rate and zero false negatives, in a fraction of the space of storing the set. `distillate` ships the right structure per workload (not just a Bloom filter), TS-first, dependency-free, universal.

## Why (market gap, 2026)

- `bloom-filters` (~493k/wk) is the de-facto standard but: CJS-only, not tree-shakeable, breaks on edge runtimes (dynamic `eval` via `reflect-metadata`/`seedrandom`), heavy deps (lodash, long, seedrandom), and has a false-negative bug in its Cuckoo filter.
- Rest of the field is stale or Bloom-only micro-packages.
- No maintained JS/TS Binary Fuse or Ribbon filter exists anywhere.

## Promises

1. Runs anywhere: Node, Bun, Deno, browser, Cloudflare/Vercel edge. No `eval`, no required WASM compile.
2. Correct: no false negatives (property-tested), FPR statistically validated against theory.
3. Small: per-structure subpath imports, `sideEffects: false`, zero runtime deps.

## Goals

- Best-in-class DX: one narrow interface across all structures, first-class sizing helpers, honest static-vs-mutable API split.
- Portable versioned binary format (readable from Rust/Go).
- Rigorous cross-runtime benchmarks.

## Non-goals

- Cryptographic hashing or security guarantees.
- Distributed / on-disk filters (v1 is in-memory; serialization is the persistence primitive).

## v1.0 scope (lean)

Blocked Bloom, Classic Bloom, Binary Fuse 8/16, correct Cuckoo (with delete), plus sizing helpers, serialization, docs, benchmarks. Ribbon/BuRR, WASM acceleration, and expandable filters (InfiniFilter/Aleph) are post-1.0.

## Module docs

- [architecture.md](architecture.md): interfaces, families, storage, file layout.
- [choosing a structure](https://distillate.akxp.net/guides/choosing-a-structure/): decision matrix, v1 lineup, citations, deferred tiers.
- [hashing.md](hashing.md): hash strategy and correctness.
- [serialization](https://distillate.akxp.net/reference/serialization/): binary format spec.
- [engineering.md](engineering.md): packaging, testing, benchmarking, CI, release.
