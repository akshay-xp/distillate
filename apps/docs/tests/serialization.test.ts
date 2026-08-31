import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { HyperLogLog } from "distillate/hll";
import { expect, test } from "vitest";

const SPEC = fileURLToPath(
  new URL("../src/content/docs/reference/serialization.md", import.meta.url),
);

const GOLDEN = fileURLToPath(
  new URL(
    "../../../packages/distillate/tests/fixtures/golden.json",
    import.meta.url,
  ),
);

const HEADER = 16;

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

/** The HyperLogLog params table, keyed by the field name each row names. */
function hllParams(): Map<string, { offset: number; text: string }> {
  const spec = doc();
  const at = spec.indexOf("HyperLogLog (type 5), little-endian:");
  if (at === -1) {
    throw new Error("serialization.md has no HyperLogLog params block");
  }

  const open = spec.indexOf("```", at);
  const close = spec.indexOf("```", open + 3);
  const rows = new Map<string, { offset: number; text: string }>();
  for (const line of spec
    .slice(open + 3, close)
    .trim()
    .split("\n")
    .slice(1)) {
    const [offset, , ...rest] = line.trim().split(/\s{2,}/);
    const text = rest.join(" ");
    rows.set(text.split(/[:\s(]/)[0] ?? "", { offset: Number(offset), text });
  }
  return rows;
}

/** The offset the params table gives for `field`, relative to the body. */
function paramOffset(field: string): number {
  const row = hllParams().get(field);
  if (!row) throw new Error(`HyperLogLog params block has no ${field} row`);
  return row.offset;
}

interface Fixture {
  name: string;
  p?: number;
  keys: string[];
  frame: string;
}

function golden(name: string): {
  frame: Uint8Array;
  p: number;
  keys: string[];
} {
  const all = JSON.parse(readFileSync(GOLDEN, "utf8")) as Fixture[];
  const entry = all.find((g) => g.name === name);
  if (!entry) throw new Error(`golden.json has no ${name} fixture`);
  return {
    frame: Buffer.from(entry.frame, "base64"),
    p: entry.p ?? 0,
    keys: entry.keys,
  };
}

/** A view of the frame's body alone, the offsets in the params table. */
function frameBody(frame: Uint8Array): DataView {
  const dv = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  return new DataView(
    frame.buffer,
    frame.byteOffset + HEADER,
    dv.getUint32(8, true),
  );
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

test("the documented params offsets decode both golden frames", () => {
  const encodings = ["hll-dense", "hll-sparse"].map((name) => {
    const fixture = golden(name);
    const body = frameBody(fixture.frame);

    expect(body.getUint8(paramOffset("p"))).toBe(fixture.p);
    expect(body.getUint32(paramOffset("seed"), true)).toBe(0);
    expect(() => HyperLogLog.fromBytes(fixture.frame)).not.toThrow();

    return body.getUint8(paramOffset("encoding"));
  });

  expect(encodings[0]).not.toBe(encodings[1]);
});
