import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { expect, test } from "vitest";

const SPEC = fileURLToPath(
  new URL("../src/content/docs/reference/serialization.md", import.meta.url),
);

function doc(): string {
  return readFileSync(SPEC, "utf8");
}

/** The structure-type row of the layout table, and the line continuing it. */
function typeRows(): { types: string; reserved: string } {
  const lines = doc().split("\n");
  const at = lines.findIndex((l) => l.includes("Structure type (u8)"));
  if (at === -1) throw new Error("serialization.md has no structure-type row");
  return { types: lines[at] ?? "", reserved: lines[at + 1] ?? "" };
}

test("the layout table names type 5 as HyperLogLog", () => {
  const { types, reserved } = typeRows();
  const named = new Map(
    [...types.matchAll(/(\d+)=([A-Za-z0-9]+)/g)].map(([, n, name]) => [
      Number(n),
      name,
    ]),
  );

  expect(named.get(5)).toBe("HyperLogLog");
  expect(reserved).not.toContain("HyperLogLog");
});
