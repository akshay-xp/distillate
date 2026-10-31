import { appendFileSync } from "node:fs";
import { test } from "vitest";

import { measureAllocation } from "../../bench/harness.js";
import { KllSketch } from "../../src/kll/kll.js";

test("probe", async () => {
  const sketch = new KllSketch({ seed: 1 });
  const values = new Float64Array(65_536);
  for (let i = 0; i < values.length; i++) values[i] = Math.random();
  let at = 0;
  const addNext = (): void => {
    at = (at + 1) & 65_535;
    sketch.add(values[at] ?? 0);
  };
  const start = performance.now();
  for (let i = 0; i < 2_000_000; i++) addNext();
  const g = globalThis as unknown as { __gc?: string[] };
  const a = await measureAllocation(addNext, 600_000);
  const first = g.__gc ?? [];
  g.__gc = [];
  const b = await measureAllocation(() => {
    at = (at + 1) & 65_535;
    sketch.add(values[at] ?? 0);
  }, 600_000);
  appendFileSync(
    process.env.PROBE_LOG ?? "probe.log",
    `first=${String(a.collections)} second=${String(b.collections)} bytes=${String(a.bytesPerCall)}/${String(b.bytesPerCall)} ms=${(performance.now() - start).toFixed(0)} ${first.join(",")} | ${(g.__gc ?? []).join(",")}\n`,
  );
});
