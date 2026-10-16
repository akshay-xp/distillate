import { expect, test } from "vitest";

import {
  incumbentReconcileAdapter,
  RIBLT_CASES,
  RIBLT_FRAME,
  reconcileAdapters,
  ribbitReconcileAdapter,
  ribltRows,
} from "../src/riblt.js";

const keys = (prefix: string, n: number): string[] =>
  Array.from({ length: n }, (_, i) => `${prefix}:${String(i)}`);

test("each reconciler recovers both sides of a small difference", () => {
  expect(reconcileAdapters.map((a) => a.name)).toEqual([
    "distillate/riblt",
    "ribbit-riblt",
    "bloom-filters",
  ]);

  const shared = keys("s", 995);
  const a = [...shared, ...keys("a", 5)];
  const b = [...shared, ...keys("b", 5)];
  for (const adapter of reconcileAdapters) {
    const result = adapter.run(a, b, 10);

    expect(result.decoded, adapter.name).toBe(true);
    expect(result.onlyA, adapter.name).toBe(5);
    expect(result.onlyB, adapter.name).toBe(5);
    expect(result.bytes, adapter.name).toBeGreaterThan(0);
    for (const ms of [result.sendMs, result.receiveMs]) {
      expect(Number.isFinite(ms) && ms > 0, adapter.name).toBe(true);
    }
  }

  const [ours, ribbit, incumbent] = reconcileAdapters.map((r) =>
    r.run(a, b, 10),
  );
  for (const streamed of [ours, ribbit]) {
    expect(streamed?.symbols).toBeGreaterThan(0);
    expect((streamed?.symbols ?? 1) % RIBLT_FRAME).toBe(0);
  }
  expect(incumbent?.symbols).toBeNull();
});

test("riblt rows time each reconciler over a case", () => {
  expect(RIBLT_CASES).toEqual([
    [10_000, 10],
    [10_000, 1000],
    [1_000_000, 10],
    [1_000_000, 1000],
    [1_000_000, 100_000],
  ]);

  const rows = ribltRows([[1000, 10]]);

  expect(rows.map((r) => r.name)).toEqual([
    "distillate/riblt",
    "ribbit-riblt",
    "bloom-filters",
  ]);
  for (const r of rows) {
    expect(r.keys, r.name).toBe(1000);
    expect(r.d, r.name).toBe(10);
    expect(r.decoded, r.name).toBe(true);
    expect(r.bytes, r.name).toBeGreaterThan(0);
    expect(Number.isFinite(r.sendMs) && r.sendMs > 0, r.name).toBe(true);
    expect(Number.isFinite(r.receiveMs) && r.receiveMs > 0, r.name).toBe(true);
  }
});

test("the slow reconcilers are not run past 10k keys", () => {
  const rows = ribltRows(
    [[20_000, 10]],
    [ribbitReconcileAdapter, incumbentReconcileAdapter],
  );

  expect(rows.map((r) => [r.name, r.notRun])).toEqual([
    ["ribbit-riblt", true],
    ["bloom-filters", true],
  ]);
});
