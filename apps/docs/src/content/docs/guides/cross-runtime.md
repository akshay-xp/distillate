---
title: Cross-runtime usage
description: distillate runs unmodified on Node, Bun, Deno, browsers, and Cloudflare or Vercel edge, and its binary frames move between them.
---

distillate targets **ES2022**, ships zero runtime dependencies, and uses no
`eval` and no required WASM compile step. That is the whole reason it runs
everywhere: there is nothing in the package for a restricted runtime to
refuse.

## Supported runtimes

- **Node.js** 22 and 24, the active LTS and current lines.
- **Bun** and **Deno**.
- Browsers, and Cloudflare or Vercel edge.

Every push runs a CI smoke matrix that imports the built package on Node 22,
Node 24, Bun, and Deno. Cross-runtime support is verified, not assumed.

## Importing

The package ships both ESM and CommonJS builds with types for each, so the
same import works whatever your bundler or runtime resolves to:

```ts
import { BloomFilter } from "distillate/bloom";

const filter = BloomFilter.create(1000, 0.01);
filter.add("alice");
```

Each structure is its own subpath, so a bundle only carries what it imports.
With `sideEffects: false` set, a build that imports `distillate/fuse` never
pulls in the Bloom code at all.

Deno resolves the same specifier through npm, by prefixing it:

```
import { BloomFilter } from "npm:distillate/bloom";
```

## Why it works on edge

Edge runtimes forbid dynamic code generation. A package that reaches for
`eval` or `new Function`, directly or through a transitive dependency, fails
there at import time, before any of your code runs.

distillate has no such call, and no dependency that could add one. It also
does not use decorators or `reflect-metadata`, so nothing needs a metadata
reflection polyfill installed at module scope. Importing it is inert.

## Moving filters between runtimes

`toBytes` produces the same frame everywhere, and `fromBytes` reads a frame
any supported runtime produced. Build a filter in a Node job and query it in
an edge worker:

```ts
import { BinaryFuse8 } from "distillate/fuse";

// Build side, wherever the key set lives.
const built = BinaryFuse8.from(["alice", "bob", "carol"]);
const frame: Uint8Array = built.toBytes();

// Read side, anywhere.
const filter = BinaryFuse8.fromBytes(frame);
filter.has("alice"); // true
```

This is usually the right shape for edge: build once where the data is, ship
the bytes, restore on each isolate. Fuse filters in particular are built once
and never mutated, so there is nothing to synchronise.

Where a transport cannot carry bytes, `toJSON` wraps the same frame in a
base64 envelope:

```ts
import { BloomFilter } from "distillate/bloom";

const filter = BloomFilter.create(1000, 0.01);
filter.add("alice");

const envelope = filter.toJSON(); // { $: "distillate", v: 4, data: "..." }
const restored = BloomFilter.fromJSON(envelope);
restored.has("alice"); // true
```

The envelope is for transport and debugging. Prefer raw bytes when you can:
base64 costs a third more.

### Endianness

Header and params fields are written little-endian explicitly, so they parse
identically on any host. The payload is the raw backing typed array copied
verbatim, so multi-byte lanes land in host byte order.

Every supported JavaScript runtime is little-endian, so frames are
interoperable in practice. A big-endian host would need a read-time byte swap,
which is not implemented. Full detail in
[serialization](/reference/serialization/).

### Reader and producer versions

The format version and hash variant checks protect a **newer reader from an
older frame**: it refuses rather than misreads. They cannot protect an older
reader from a newer frame, because the older build predates the check.

So keep readers at least as new as producers. If you build filters in a Node
job and read them at the edge, upgrade the edge first.

## Node.js support policy

The supported Node range tracks the active and current LTS lines. Dropping an
end-of-life Node major is **not** a breaking change and can happen in a minor
release. It will be called out in the changelog. See
[versioning](/reference/versioning/).
