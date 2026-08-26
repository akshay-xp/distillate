import { bench, do_not_optimize, run } from "mitata";

import { HyperLogLog } from "../src/hll/hll.js";

import { cardinalityRows, formatCardinalityRows } from "./cardinality.js";
import { cycle, envBanner, hitMissPools } from "./harness.js";

const PRECISIONS = [10, 12, 14];
const { hit } = hitMissPools(100_000);

console.log(envBanner());

// Space and accuracy first: both are machine-independent, unlike throughput.
console.log();
console.log(
  formatCardinalityRows(cardinalityRows(PRECISIONS, [1e3, 1e4, 1e5])),
);

// Bytes per sketch in each encoding, at the same cardinality, so the sparse
// win is a direct comparison rather than two numbers from different runs.
const sparseAt = (p: number): number => {
  const sketch = new HyperLogLog({ p });
  for (let i = 0; i < 100; i++) sketch.add(`size:${String(i)}`);
  return sketch.toBytes().length;
};

const denseAt = (p: number): number => {
  const sketch = new HyperLogLog({ p });
  for (const key of hit) sketch.add(key);
  return sketch.toBytes().length;
};

console.log();
console.log("bytes per sketch (100 keys sparse, 100k keys dense)");
for (const p of PRECISIONS) {
  console.log(
    `p=${String(p).padEnd(3)} sparse ${String(sparseAt(p)).padStart(6)}  dense ${String(denseAt(p)).padStart(6)}`,
  );
}
console.log();

// add() is benched on a promoted sketch: that is the steady state, and the
// sparse path allocates by design.
const dense = new HyperLogLog({ p: 14 });
for (const key of hit) dense.add(key);
const nextAdd = cycle(hit);
bench("hll add (dense)", () => {
  dense.add(nextAdd());
});

const sparse = new HyperLogLog({ p: 14 });
for (let i = 0; i < 100; i++) sparse.add(`count:${String(i)}`);

bench("hll count (dense)", () => {
  do_not_optimize(dense.count());
});
bench("hll count (sparse)", () => {
  do_not_optimize(sparse.count());
});

await run();
