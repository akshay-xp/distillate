# distillate

[![CI](https://github.com/akshay-xp/distillate/actions/workflows/ci.yml/badge.svg)](https://github.com/akshay-xp/distillate/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/distillate)](https://www.npmjs.com/package/distillate)
[![license](https://img.shields.io/npm/l/distillate)](./LICENSE)

Probabilistic data structures for JavaScript and TypeScript: approximate answers with a bounded, tunable error, in a fraction of the space an exact answer needs. Membership filters (Bloom, Cuckoo, Binary Fuse), cardinality (HyperLogLog, Theta), frequency (Count-Min, Top-K), quantiles (KLL, DDSketch), similarity (MinHash) and set reconciliation (RIBLT), with zero dependencies and the right structure per workload.

> **Pre-release (0.x).** The published structures are correct, tested, and benchmarked, but the public API may still change before `1.0`. Pin a version if you depend on it.

## Structures

Each structure ships as its own subpath, so you only bundle what you import.

| Import                | Structure      | Answers             | Use for                                                   |
| --------------------- | -------------- | ------------------- | --------------------------------------------------------- |
| `distillate/bloom`    | Classic Bloom  | seen this key?      | Familiar default, migration from `bloom-filters`          |
| `distillate/scalable` | Scalable Bloom | seen this key?      | Key count unknown or growing; keeps its FPR bound         |
| `distillate/blocked`  | Blocked Bloom  | seen this key?      | Faster lookups and a lower FPR for a small space premium  |
| `distillate/fuse`     | Binary Fuse    | seen this key?      | Static set built once and queried a lot; least space      |
| `distillate/cuckoo`   | Cuckoo         | seen this key?      | Keys come and go; the one filter with delete              |
| `distillate/hll`      | HyperLogLog    | how many distinct?  | Counting distinct users, IPs, or keys in fixed space      |
| `distillate/countmin` | Count-Min      | how many times?     | Counting events per key in fixed space                    |
| `distillate/topk`     | Top-K          | which are heaviest? | Finding the most frequent keys in fixed space             |
| `distillate/ddsketch` | DDSketch       | what is the p99?    | Latency and size percentiles, mergeable, in fixed space   |
| `distillate/minhash`  | MinHash        | how similar?        | Near-duplicate documents and set overlap, with an index   |
| `distillate/riblt`    | RIBLT          | which keys differ?  | Syncing two sets that mostly agree, exactly               |
| `distillate/theta`    | Theta          | how many, in both?  | Distinct counts to intersect and subtract across segments |
| `distillate/kll`      | KLL            | what rank is x?     | Ranks, CDFs and SLO fractions with a rank error bound     |

Full install, usage, runtime support, and benchmarks are in the [package README](./packages/distillate/README.md).

## Repository

This is a pnpm workspace.

| Package                               | Path                  | Description                                                                                                           |
| ------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------- |
| [`distillate`](./packages/distillate) | `packages/distillate` | The published library.                                                                                                |
| `distillate-bench` (private)          | `apps/bench`          | Cross-library benchmark (vs `bloom-filters` / `bloomfilter.js`) on `workspace:*`, so it always measures local source. |

### Development

```sh
pnpm install      # sets up git hooks (Husky)
pnpm build        # tsdown, across packages
pnpm test         # Vitest, across packages
pnpm lint         # type-aware ESLint
pnpm format:check
```

Library-specific tasks target the package: `pnpm --filter distillate <coverage|check|api:check|docs:check|bench>`. Releases run through [Changesets](https://github.com/changesets/changesets) at the root (`pnpm changeset`). See [CONTRIBUTING.md](./CONTRIBUTING.md).

## Docs

Design notes, the structure decision matrix, hashing, and the binary format live under [`packages/distillate/docs`](./packages/distillate/docs):

- [overview](./packages/distillate/docs/overview.md): what and why
- [choosing a structure](https://distillate.akxp.net/guides/choosing-a-structure/): decision matrix and the full lineup
- [serialization](https://distillate.akxp.net/reference/serialization/): the binary format spec
- [architecture](./packages/distillate/docs/architecture.md), [hashing](./packages/distillate/docs/hashing.md): contributor notes, on GitHub
- [API reference](https://distillate.akxp.net/api/overview/): generated from TSDoc at site build time

## License

[MIT](./LICENSE) © Akshay
