# siftr

Modern approximate-membership toolkit for JavaScript. The next-generation successor to Bloom filter packages: TypeScript-first, zero dependencies, and the right structure per workload, not just a Bloom filter.

> **Pre-release (0.x).** The published structures are correct, tested, and benchmarked, but the public API may still change before `1.0`, and more structures (Cuckoo, Scalable Bloom) are on the way. Pin a version if you depend on it.

## Why

An approximate-membership query (AMQ) filter answers "is this in the set?" with a tunable false-positive rate and **zero false negatives**, in a fraction of the space of storing the set itself.

- **Runs anywhere**: Node, Bun, Deno, browsers, and Cloudflare/Vercel edge. No `eval`, no required WASM compile.
- **Correct**: no false negatives (property-tested); false-positive rates validated against theory.
- **Small**: per-structure subpath imports, `sideEffects: false`, zero runtime dependencies.
- **Portable**: a versioned little-endian binary format (`toBytes` / `fromBytes`) for persistence and cross-language reads.

## Install

```sh
npm install siftr
# or: pnpm add siftr / bun add siftr / deno add npm:siftr
```

Requires Node 20+ (or any modern Bun/Deno/browser/edge runtime).

## Structures

Each structure ships as its own subpath, so you only bundle what you import.

| Import          | Structure     | Mutable? | Use for                                              |
| --------------- | ------------- | -------- | ---------------------------------------------------- |
| `siftr/bloom`   | Classic Bloom | yes      | Familiar default, migration from `bloom-filters`     |
| `siftr/blocked` | Blocked Bloom | yes      | Streaming inserts, speed-first, cache-friendly       |
| `siftr/fuse`    | Binary Fuse   | no       | Static set built once and queried a lot; least space |

### Classic Bloom (`siftr/bloom`)

```ts
import { BloomFilter } from "siftr/bloom";

const filter = BloomFilter.create(100_000, 0.01); // capacity, target FPR
filter.add("alice");
filter.has("alice"); // true
filter.has("bob"); // false (or a ~1% false positive)

const bytes = filter.toBytes();
const restored = BloomFilter.fromBytes(bytes);
```

Also: `union(other)` (merge equal-parameter filters), `bitsPerKey`, and a low-level `new BloomFilter({ m, k, seed })`.

### Blocked Bloom (`siftr/blocked`)

```ts
import { BlockedBloomFilter } from "siftr/blocked";

const filter = BlockedBloomFilter.create(100_000, 0.01);
filter.add("alice");
filter.has("alice"); // true
```

Same surface as Classic Bloom (`add` / `has` / `union` / `toBytes` / `fromBytes` / `bitsPerKey`). Confines every lookup to one cache line, trading ~20-30% more space for cache-friendly throughput.

### Binary Fuse (`siftr/fuse`)

A **static** filter: built once from the full key set, then immutable. The most space-efficient option (~9 bits/key at ~0.39% FPR for 8-bit; ~19 bits/key at ~1/65536 for 16-bit).

```ts
import { BinaryFuse8, BinaryFuse16 } from "siftr/fuse";

const filter = BinaryFuse8.from(["alice", "bob", "carol"]);
filter.has("alice"); // true
filter.size; // 3
filter.bitsPerKey; // ~9

// Lower false-positive rate, twice the space:
const precise = BinaryFuse16.from(["alice", "bob", "carol"]);
```

Also: `toBytes` / `fromBytes`. No `add` / `delete`; rebuild `from` the new set to change membership.

## Docs

Design notes, the structure decision matrix, hashing, and the binary format live in [`docs/`](./docs):

- [overview](./docs/overview.md): what and why
- [structures](./docs/structures.md): decision matrix and the full lineup
- [architecture](./docs/architecture.md), [hashing](./docs/hashing.md), [serialization](./docs/serialization.md)

## License

[MIT](./LICENSE) © Akshay
