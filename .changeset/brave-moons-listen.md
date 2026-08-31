---
"distillate": minor
---

`BloomParams` accepts an optional `n`, the expected key count, so a filter built from explicit geometry can carry the capacity it was sized for.

```ts
import { BloomFilter, bloomSizing } from "distillate/bloom";

const { m, k } = bloomSizing(1_000_000, 0.01);

new BloomFilter({ m, k, seed: 42, n: 1_000_000 }).bitsPerKey; // 9.585059
new BloomFilter({ m, k, seed: 42 }).bitsPerKey; // 10.098869270757605
```

`bloomSizing` returns geometry alone, so passing its result straight to the constructor used to drop the count it was solved for. `bitsPerKey` is `m / n`, and with no `n` to hand the filter derived one as `m * ln2 / k`, the capacity that geometry is optimal for. The two answers differ, and nothing said so. `create` and `fromBytes` have always carried the real `n`; now the public constructor can too, and the getter documents the derivation used when it is omitted.

`BlockedBloomFilter` has taken `capacity` since it shipped, so this also settles an inconsistency between the two.

**Fixed: `bitsPerKey` could report `Infinity`.** A geometry with far more probes than bits, such as `{ m: 1000, k: 65535 }`, derives a capacity of zero, and `m / 0` is `Infinity`, which serializes to JSON `null`. The derived value is now at least 1. No forged input was needed to reach this.

**Fixed: a frame declaring a capacity of zero is now rejected** with `ParamError` rather than restoring a filter that reports an infinite cost. Frames carry `n` as a plain `u32` that no caller has validated, and it is now validated on the way in like every other declared parameter.
