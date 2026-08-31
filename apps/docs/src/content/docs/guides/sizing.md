---
title: Sizing and tuning FPR
description: Choose a false positive rate and a space budget deliberately, using the analytic sizing helper each structure ships.
---

Every filter trades space against its false positive rate. Each structure
ships the analytic helper behind its own `create`, so you can price a target
before you allocate anything, or work backwards from a byte budget you already
have.

The floor for any filter is `log2(1/epsilon)` bits per key: 6.64 at a 1% FPR,
9.97 at 0.1%, 19.93 at 1e-6. Nothing beats that. How far above it a structure
lands is the whole comparison.

:::tip[Price it without reading further]
The [sizing calculator](/guides/sizing/calculator/) runs every helper on this
page against your own capacity and target, and prices all four structures at
once. It is analytic, so a 100 million key input answers instantly.
:::

## Pick a target first

`epsilon` is not a quality dial to turn up. It is the fraction of negative
lookups that will cost you whatever the filter is protecting. Price it:

- If a false positive costs a disk seek, 1% is usually generous. One wasted
  seek in a hundred misses is invisible.
- If it costs a network round trip or a paid API call, work out the rate at
  which that spend stops being noise, and size for it.
- If it costs correctness, a filter is the wrong tool. There is no `epsilon`
  small enough to make a "yes" trustworthy.

Then check the price in bits, because the curve is steep. Every factor of ten
off `epsilon` costs another 4.8 bits per key on classic Bloom, forever.

## Classic Bloom: `bloomSizing(n, epsilon)`

Returns the `{ m, k }` geometry for `n` keys at target `epsilon`: `m` bits in
the array, `k` probes per key.

```ts
import { bloomSizing } from "distillate/bloom";

bloomSizing(1_000_000, 0.01); // { m: 9585059, k: 7 }
bloomSizing(1_000_000, 1e-6); // { m: 28755176, k: 20 }
```

`BloomFilter.create(n, epsilon)` is this call plus the constructor. Use
`bloomSizing` directly when you want to see the cost first, or to construct
with an explicit `seed`:

```ts
import { BloomFilter, bloomSizing } from "distillate/bloom";

const { m, k } = bloomSizing(1_000_000, 0.01);
const bits = m / 1_000_000; // 9.59 bits per key
const filter = new BloomFilter({ m, k, seed: 42 });
```

Classic Bloom is fixed at 1.44 times the floor at every target, so its cost is
a straight line in `log10(1/epsilon)`:

| target `epsilon` | bits/key | `k` |
| ---------------- | -------- | --- |
| 1e-1             | 4.79     | 3   |
| 1e-2             | 9.59     | 7   |
| 1e-3             | 14.38    | 10  |
| 1e-4             | 19.17    | 13  |
| 1e-5             | 23.96    | 17  |
| 1e-6             | 28.76    | 20  |
| 1e-7             | 33.55    | 23  |

## Blocked Bloom: `blockedBitsPerKey(epsilon)` and `blockedFprAt(bitsPerKey)`

The two directions of the same model. `blockedBitsPerKey` solves for the
minimum integer bits per key that reaches a target; `blockedFprAt` reports the
rate a given budget actually delivers.

```ts
import { blockedBitsPerKey, blockedFprAt } from "distillate/blocked";

blockedBitsPerKey(0.01); // 11
blockedFprAt(11); // 0.008168, the rate 11 bits/key really gives

blockedBitsPerKey(1e-4); // 27
blockedFprAt(27); // 0.00008788
```

Use `blockedFprAt` when the budget is the constraint. If you can afford 16
bits per key and no more, ask what that buys rather than guessing an
`epsilon`:

```ts
import { blockedFprAt } from "distillate/blocked";

blockedFprAt(16); // 0.0013156, so about 0.13%
```

The blocked curve is **not** linear, because keys cluster into 256-bit blocks
by a Poisson distribution and an unluckily full block is far worse than an
average one. `blockedFprAt` models that average directly rather than assuming
an even spread, which is why its answers sit above a naive Bloom formula.

### The `ParamError` floor near 1e-8

The solver stops at 128 bits per key. Its modeled rate there is around 1e-8,
so that is the floor: ask for less and you get a typed rejection rather than a
silently under-provisioned filter.

```ts
import { blockedBitsPerKey } from "distillate/blocked";
import { ParamError } from "distillate/bloom";

try {
  blockedBitsPerKey(1e-9);
} catch (error) {
  error instanceof ParamError; // true
  // "epsilon 1e-9 is below the blocked-filter floor; use a classic or fuse filter"
}
```

`BlockedBloomFilter.create` throws the same error for the same reason. See
[errors](/reference/errors/).

### Below 1e-5, do not use blocked

The clustering penalty compounds. Compare the two structures at an identical
bits-per-key budget:

| bits/key | classic FPR | blocked FPR | blocked is worse by |
| -------- | ----------- | ----------- | ------------------- |
| 10       | 8.19e-3     | 1.26e-2     | 1.5x                |
| 16       | 4.59e-4     | 1.32e-3     | 2.9x                |
| 20       | 6.71e-5     | 4.20e-4     | 6.3x                |
| 24       | 9.84e-6     | 1.63e-4     | 16.5x               |
| 32       | 2.10e-7     | 3.61e-5     | 172x                |
| 48       | 9.65e-11    | 4.45e-6     | 46000x              |

Both columns are the analytic models: the standard Bloom formula for classic,
`blockedFprAt` for blocked.

Around 1e-5 the gap becomes decisive: at 24 bits per key classic reaches about
1e-5 while blocked is still at 1.6e-4. Restated as space, hitting 1e-5 costs
classic 24 bits per key and blocked 41.

So **below roughly 1e-5, blocked costs more bits per key than classic and
still delivers a worse rate.** There is no budget at which it wins there. Use
[Classic Bloom](/guides/bloom/) or a fuse filter instead. Above 1e-5 the
premium is the modest 20 to 30% that buys the one-cache-line lookup.

## Binary Fuse: `fuseBitsPerKey(n, width)`

Fuse takes **no target rate**, and there is no sizing call to make before you
build. Its FPR is fixed by the fingerprint width:

| Class          | Fingerprint | FPR      |
| -------------- | ----------- | -------- |
| `BinaryFuse8`  | 8-bit       | ~0.39%   |
| `BinaryFuse16` | 16-bit      | ~1/65536 |

Those two rates are the entire tuning surface. `fuseBitsPerKey` therefore
answers the only open question, which is how much space the build will take:

```ts
import { fuseBitsPerKey } from "distillate/fuse";

fuseBitsPerKey(1_000_000, 8); // 9.044
fuseBitsPerKey(1_000_000, 16); // 18.088
```

That is roughly 9% over the floor, the least of anything in the lineup, and
about 0.39% for 9 bits per key is a bargain no Bloom variant matches: classic
needs 11.5 bits for the same rate and blocked needs 13.

Two caveats:

- **Small sets pay fixed overhead.** The fingerprint array has a minimum
  length, so a three-key filter costs 64 bits per key. The figures above hold
  once `n` is large.
- **Neither rate may be what you want.** If you need 1e-3, Fuse 8 is too loose
  and Fuse 16 wastes half its space. Take a Bloom variant, which accepts any
  `epsilon`.

## Choosing between them

Work from the target:

- **Above 1e-5, streaming inserts:** [Blocked Bloom](/guides/blocked/). Pay
  the 20 to 30% premium for the cache-line lookup.
- **Above 1e-5, space-tight:** [Classic Bloom](/guides/bloom/).
- **Below 1e-5:** [Classic Bloom](/guides/bloom/), or Fuse 16 if the set is
  static. Never blocked.
- **Static set, either rate suits:** [Binary Fuse](/guides/fuse/). Smallest
  and fastest, at 0.39% or 1/65536.

And size for the keys you will actually insert. Every helper here targets `n`
distinct keys; overshoot `n` and the real rate climbs above the target. Both
Bloom variants expose `rate()`, which estimates the FPR from the current fill
rather than the design target, so you can watch for that in production.
