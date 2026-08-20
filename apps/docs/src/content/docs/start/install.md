---
title: Install
description: Add distillate with npm, pnpm, bun, or deno, then build and query your first filter.
---

distillate is published to npm as [`distillate`](https://www.npmjs.com/package/distillate),
with zero runtime dependencies.

## Install

```sh
npm install distillate
```

```sh
pnpm add distillate
```

```sh
bun add distillate
```

```sh
deno add npm:distillate
```

### Requirements

**Node 22 or newer**, or any modern Bun, Deno, browser, or edge runtime. The
package targets ES2022, ships ESM and CJS builds with types for both, and uses
no `eval` and no required WASM compile step, so it also runs unmodified on
Cloudflare and Vercel edge. See [cross-runtime usage](/guides/cross-runtime/).

## Quick start

Pick the subpath for the structure you want. Nothing else is bundled.

```ts
import { BloomFilter } from "distillate/bloom";

// Size for 100k keys at a 1% false positive rate.
const filter = BloomFilter.create(100_000, 0.01);

filter.add("alice");
filter.add("bob");

filter.has("alice"); // true
filter.has("carol"); // false, or a ~1% false positive

filter.length; // bits currently set
filter.bitsPerKey; // ~9.59, the design m / n
```

A "no" is always correct. A "yes" is correct about 99% of the time at this
setting. See [sizing and tuning](/guides/sizing/) to choose `epsilon`
deliberately.

### Build a static filter from a known set

If every key is known up front and the set never changes, Binary Fuse is
smaller and faster than either Bloom variant:

```ts
import { BinaryFuse8 } from "distillate/fuse";

const filter = BinaryFuse8.from(["alice", "bob", "carol"]);

filter.has("alice"); // true
filter.size; // 3
filter.bitsPerKey; // 64 at this size, ~9 once n is large
```

### Persist and restore

Every structure serializes to the same versioned binary frame:

```ts
import { BloomFilter } from "distillate/bloom";

const filter = BloomFilter.create(1000, 0.01);
filter.add("alice");

const bytes: Uint8Array = filter.toBytes();
const restored = BloomFilter.fromBytes(bytes);

restored.has("alice"); // true
```

The format is specified in [serialization](/reference/serialization/), so
other languages can read the same bytes.

## Next

- [What is an AMQ filter?](/start/what-is-an-amq-filter/) for the concept.
- [Choosing a structure](/guides/choosing-a-structure/) to pick the right one.
- [API reference](/api/) generated from the source.
