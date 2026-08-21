# distillate

[![CI](https://github.com/akshay-xp/distillate/actions/workflows/ci.yml/badge.svg)](https://github.com/akshay-xp/distillate/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/distillate)](https://www.npmjs.com/package/distillate)
[![license](https://img.shields.io/npm/l/distillate)](./LICENSE)

Probabilistic data structures for JavaScript: space-efficient, approximate answers with tunable error and zero false negatives. TypeScript-first, zero dependencies, and the right structure per workload. It opens with a family of membership filters and is built to grow into other sketches.

> **Pre-release (0.x).** The published structures are correct, tested, and benchmarked, but the public API may still change before `1.0`, and more structures (Cuckoo, Scalable Bloom) are on the way. Pin a version if you depend on it.

## Why

An approximate-membership query (AMQ) filter answers "is this in the set?" with a tunable false-positive rate and **zero false negatives**, in a fraction of the space of storing the set itself.

- **Runs anywhere**: Node, Bun, Deno, browsers, Cloudflare/Vercel edge.
- **Correct**: no false negatives, property-tested.
- **Small**: per-structure subpath imports, zero runtime dependencies.
- **Portable**: a versioned binary format (`toBytes` / `fromBytes`).

Why these promises, and what the incumbents get wrong: [overview.md](./docs/overview.md).

## Install

```sh
npm install distillate
# or: pnpm add distillate / bun add distillate / deno add npm:distillate
```

Requires Node 22+ (or any modern Bun/Deno/browser/edge runtime).

## Runtime support

`distillate` targets ES2022 with zero runtime dependencies and no `eval`, so it runs on every modern JavaScript runtime:

- **Node.js** 22, 24 (LTS and current)
- **Bun** and **Deno**
- Browsers and Cloudflare/Vercel edge

Every push runs a CI smoke matrix that imports the built package on Node 22/24, Bun, and Deno, so cross-runtime support is verified, not assumed.

## Structures

Each structure ships as its own subpath, so you only bundle what you import.

| Import               | Structure     | Mutable? | Use for                                                  |
| -------------------- | ------------- | -------- | -------------------------------------------------------- |
| `distillate/bloom`   | Classic Bloom | yes      | Familiar default, migration from `bloom-filters`         |
| `distillate/blocked` | Blocked Bloom | yes      | Faster lookups and a lower FPR for a small space premium |
| `distillate/fuse`    | Binary Fuse   | no       | Static set built once and queried a lot; least space     |

### Classic Bloom (`distillate/bloom`)

```ts
import { BloomFilter } from "distillate/bloom";

const filter = BloomFilter.create(100_000, 0.01); // capacity, target FPR
filter.add("alice");
filter.has("alice"); // true
filter.has("bob"); // false (or a ~1% false positive)

const bytes = filter.toBytes();
const restored = BloomFilter.fromBytes(bytes);
```

Also: `union(other)` (merge equal-parameter filters), `bitsPerKey`, and a low-level `new BloomFilter({ m, k, seed })`.

### Blocked Bloom (`distillate/blocked`)

```ts
import { BlockedBloomFilter } from "distillate/blocked";

const filter = BlockedBloomFilter.create(100_000, 0.01);
filter.add("alice");
filter.has("alice"); // true
```

Same surface as Classic Bloom (`add` / `has` / `union` / `toBytes` / `fromBytes` / `bitsPerKey`). Reach for it when lookup throughput matters; prefer Classic when space is tight. Cache-line rationale, speed ratios, and the space penalty: [Blocked Bloom guide](https://distillate.akxp.net/guides/blocked/).

### Binary Fuse (`distillate/fuse`)

A **static** filter: built once from the full key set, then immutable. The most space-efficient option in the lineup. Bits-per-key, FPR, and query throughput: [Binary Fuse guide](https://distillate.akxp.net/guides/fuse/).

```ts
import { BinaryFuse8, BinaryFuse16 } from "distillate/fuse";

const filter = BinaryFuse8.from(["alice", "bob", "carol"]);
filter.has("alice"); // true
filter.size; // 3
filter.bitsPerKey; // 64 at this size; see below

// Lower false-positive rate, twice the space:
const precise = BinaryFuse16.from(["alice", "bob", "carol"]);
```

`bitsPerKey` is the space actually allocated, not the asymptotic figure. Three keys pay 64 bits each because the fingerprint array has a fixed minimum; the ~9 you see quoted is what a filter approaches once `n` is large (about 9.5 at 100k). Size honestly with `fuseBitsPerKey(n, width)`, or the [sizing guide](https://distillate.akxp.net/guides/sizing/).

Also: `toBytes` / `fromBytes`. No `add` / `delete`; rebuild `from` the new set to change membership.

## Performance

Classic Bloom head-to-head at a **matched 1% false-positive rate** over the same 100k keys, measured by identical code (cross-library harness, node v24.14.1, Apple M5):

| Classic Bloom  | bits/key | measured FPR | `has` throughput |
| -------------- | -------- | ------------ | ---------------- |
| **distillate** | 9.59     | 1.01%        | ~21.8 M ops/s    |
| bloom-filters  | 9.59     | 0.99%        | ~0.29 M ops/s    |

Same space, same accuracy, **~75x the lookup throughput** of [`bloom-filters`](https://www.npmjs.com/package/bloom-filters) (the package distillate replaces), while hashing UTF-8 bytes with MurmurHash3 so filters stay portable and cross-language readable.

These are a point-in-time snapshot on one machine. The full report (blocked/fuse, 1M capacity, the `bloomfilter` micro-package) and exactly how it is measured live in the [`apps/bench`](https://github.com/akshay-xp/distillate/tree/main/apps/bench) workspace: [RESULTS.md](https://github.com/akshay-xp/distillate/blob/main/apps/bench/RESULTS.md), [METHODOLOGY.md](https://github.com/akshay-xp/distillate/blob/main/apps/bench/METHODOLOGY.md).

## Docs

Design notes, the structure decision matrix, hashing, and the binary format live in [`docs/`](./docs):

- [overview](./docs/overview.md): what and why
- [choosing a structure](https://distillate.akxp.net/guides/choosing-a-structure/): decision matrix and the full lineup
- [serialization](https://distillate.akxp.net/reference/serialization/): the binary format spec
- [versioning](https://distillate.akxp.net/reference/versioning/): SemVer policy and supported-runtime baseline
- [architecture](./docs/architecture.md), [hashing](./docs/hashing.md): contributor notes, on GitHub
- [API reference](https://distillate.akxp.net/api/overview/): generated from TSDoc at site build time (per entry point)

## License

[MIT](./LICENSE) © Akshay
