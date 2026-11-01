# @distillate/hyperloglog

HyperLogLog for JavaScript and TypeScript. Count distinct keys in fixed space: 12 KiB holds a thousand distinct keys or a billion, at about 0.8% relative error.

```sh
npm install @distillate/hyperloglog
```

## Usage

```ts
import { HyperLogLog } from "@distillate/hyperloglog";

const sketch = HyperLogLog.create(0.01); // target relative error
sketch.add("alice");
sketch.add("bob");
sketch.add("alice"); // already counted

sketch.count(); // 2

// Merge per-shard sketches without double-counting the overlap:
const other = HyperLogLog.from(["bob", "carol"], 0.01);
sketch.union(other).count(); // 3
```

Below a few thousand distinct keys the sketch counts rather than estimates, so small answers are exact. It switches to fixed-size registers on its own, with nothing to configure.

Sketches serialize with `toBytes` / `fromBytes` and `toJSON` / `fromJSON`, so you can count on many machines and merge in one place.

## Accuracy and size

```ts
import { hllSizing, HyperLogLog } from "@distillate/hyperloglog";

hllSizing(0.01).p; // 14
hllSizing(0.05).p; // 9
HyperLogLog.create(0.01).p; // 14
```

Ask for a relative error and `hllSizing` returns the precision `p` that meets it: a sketch holds `2 ** p` registers. `standardError` reads the bound back off a sketch you already have.

Timings depend on the machine, so they live in the [benchmark results](https://github.com/akshay-xp/distillate/blob/main/apps/bench/RESULTS.md#cardinality).

## Learn more

- [HyperLogLog guide](https://distillate.akxp.net/guides/hll/): the full API, sizing and trade-offs.
- [distillate](https://distillate.akxp.net): the other probabilistic data structures, including Bloom filters and sketches for frequency and quantiles.

## Dependencies

This package depends only on `distillate`, which has no dependencies. It re-exports `distillate/hll`, so its classes are the same objects: if you already use `distillate`, both work together and nothing is duplicated.
