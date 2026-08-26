---
title: Binary Fuse
description: The most space-efficient filter in the lineup, built once from the whole key set and immutable afterwards, with a rate fixed by fingerprint width.
---

`distillate/fuse` ships Binary Fuse 8 and 16, the best static AMQ filter
published and the thing nothing else in JavaScript offers.

- **Static.** Built once from the complete key set.
- **Immutable.** There is no `add` and no `delete`. The filter **cannot accept
  later inserts**; to change membership you rebuild `from` the new set.
- **Takes no `epsilon`.** The false positive rate is fixed by the fingerprint
  width, so `from` has no target parameter to give it.
- **About 1.08 to 1.13 times the floor**, roughly 9% overhead, the least in
  the lineup. Three cache-local probes per query.

Graf and Lemire, JEA 2022 (arXiv 2201.01174). Reference implementation:
FastFilter/xorfilter.

## Build one

```ts
import { BinaryFuse8 } from "distillate/fuse";

const filter = BinaryFuse8.from(["alice", "bob", "carol"]);

filter.has("alice"); // true
filter.has("dave"); // false, or a ~0.39% false positive
filter.size; // 3
filter.bitsPerKey; // 64 at this size; see below
```

`from` is the only constructor. It takes the whole key set and no target rate.

`bitsPerKey` is the real allocated cost, not the asymptotic figure. A
three-key filter pays 64 bits per key because the fingerprint array has a
fixed minimum; the ~9 figure is what you get once `n` is large. Use
`fuseBitsPerKey(n, width)` below to size honestly.

## Pick a width, not a rate

The two widths are the whole tuning surface:

| Class          | Fingerprint | FPR      | bits/key at n=1M |
| -------------- | ----------- | -------- | ---------------- |
| `BinaryFuse8`  | 8-bit       | ~0.39%   | ~9.04            |
| `BinaryFuse16` | 16-bit      | ~1/65536 | ~18.09           |

```ts
import { BinaryFuse16 } from "distillate/fuse";

// Lower false-positive rate, twice the space.
const precise = BinaryFuse16.from(["alice", "bob", "carol"]);
precise.has("alice"); // true
```

Observed at n=100k: about 9.50 bits/key at 0.39% for the 8-bit filter, and
about 19.01 bits/key at roughly 1.3e-5 against the 1/65536 target for the
16-bit. To predict the size before you build, `fuseBitsPerKey(n, width)`:

```ts
import { fuseBitsPerKey } from "distillate/fuse";

fuseBitsPerKey(1_000_000, 8); // ~9.04
fuseBitsPerKey(1_000_000, 16); // ~18.09
```

If neither rate is what you need, a fuse filter is the wrong structure. Use
[Classic](/guides/bloom/) or [Blocked Bloom](/guides/blocked/), which take a
target `epsilon`. See [sizing and tuning](/guides/sizing/).

## How the build works

Each key is hashed once with `hash128` and deduplicated by hash, so a repeated
key costs nothing. The build then peels a 3-hypergraph in split construction
and assigns fingerprints so each key's XOR of its three lanes equals its
fingerprint. A query recomputes those three lanes and compares.

Peeling can stall. The build retries with a bumped seed, and throws
[`BinaryFuseBuildError`](/reference/errors/) only if it exhausts the retry
budget, which is astronomically unlikely. It never returns a corrupt filter.

Building is the expensive operation: about 39 ms for 100k keys with 8-bit
fingerprints. Queries are about 94 ns on a hit and 91 ns on a miss (Apple M5,
node v24.14.1). That asymmetry is the whole point of the structure. Build once,
query a great many times.

## Inspect it

```ts
import { BinaryFuse8 } from "distillate/fuse";

const filter = BinaryFuse8.from(["alice", "bob", "carol"]);

filter.size; // distinct keys
filter.seed; // the seed the build succeeded on
filter.bitsPerKey; // actual bits per key
```

There is no `length`, no `rate()`, and no `union`. The filter is fully
determined at build time, so a fill estimate would say nothing the width does
not already say, and two fuse filters cannot be merged.

## Persist it

```ts
import { BinaryFuse8 } from "distillate/fuse";

const filter = BinaryFuse8.from(["alice", "bob", "carol"]);

const bytes = filter.toBytes();
const restored = BinaryFuse8.fromBytes(bytes);

restored.equals(filter); // true
```

Frames are DSTL type 3 for Fuse 8 and type 4 for Fuse 16, and `fromBytes`
rejects a mismatched type. Fingerprints are a `Uint8Array` for the 8-bit
filter and a `Uint16Array` for the 16-bit one, so see
[serialization](/reference/serialization/) for the byte-order note on the
latter.

Serializing is often the right move: build the filter once in a job, ship the
bytes, and let every reader restore it instead of rebuilding.

## When to pick it

Pick Binary Fuse whenever the key set is known up front and does not change.
It is the smallest and the fastest to query, and shipping it as bytes is
cheap.

Pick something else when:

- Keys arrive over time. Fuse cannot accept later inserts. Use
  [Blocked Bloom](/guides/blocked/) for streaming inserts.
- You need a rate between 0.39% and 1/65536, or below it. Fuse has exactly two
  rates. Use [Classic Bloom](/guides/bloom/), which takes any `epsilon`.
- You need `union`. Fuse filters cannot be merged; rebuild from the combined
  key set.
