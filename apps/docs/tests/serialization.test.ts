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

/** Everything the spec says about the HyperLogLog frame. */
function hllSection(): string {
  const spec = doc();
  const at = spec.indexOf("HyperLogLog (type 5), little-endian:");
  if (at === -1) {
    throw new Error("serialization.md has no HyperLogLog params block");
  }
  const end = spec.indexOf("\n### ", at);
  return end === -1 ? spec.slice(at) : spec.slice(at, end);
}

/** The HyperLogLog params table, keyed by the field name each row names. */
function hllParams(): Map<string, { offset: number; text: string }> {
  const section = hllSection();
  const open = section.indexOf("```");
  const close = section.indexOf("```", open + 3);

  const rows = new Map<string, { offset: number; text: string }>();
  for (const line of section
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

/** The two values the params table names for the encoding byte. */
function encodingValues(): Partial<Record<"dense" | "sparse", number>> {
  const text = hllParams().get("encoding")?.text ?? "";
  const values: Partial<Record<"dense" | "sparse", number>> = {};
  for (const [, value, name] of text.matchAll(/(\d+) = (dense|sparse)/g)) {
    values[name as "dense" | "sparse"] = Number(value);
  }
  return values;
}

/** The register width, in bits, the dense payload paragraph states. */
function denseRegisterWidth(): number {
  const width = /(\d+) bits each/.exec(hllSection());
  if (!width) {
    throw new Error("serialization.md does not state the dense register width");
  }
  return Number(width[1]);
}

/** The entry size and bit split the sparse payload paragraph states. */
function sparseEntryLayout(): {
  bytes: number;
  indexBits: number;
  rhoBits: number;
} {
  const section = hllSection();
  const bytes = /(\d+) bytes each/.exec(section);
  const indexBits = /top (\d+) bits/.exec(section);
  const rhoBits = /low (\d+) bits/.exec(section);
  if (!bytes || !indexBits || !rhoBits) {
    throw new Error(
      "serialization.md does not state the sparse entry encoding",
    );
  }
  return {
    bytes: Number(bytes[1]),
    indexBits: Number(indexBits[1]),
    rhoBits: Number(rhoBits[1]),
  };
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

test("the documented encoding values tell the two golden frames apart", () => {
  const { dense, sparse } = encodingValues();
  expect(dense).toBeDefined();
  expect(sparse).toBeDefined();

  const at = paramOffset("encoding");
  expect(frameBody(golden("hll-dense").frame).getUint8(at)).toBe(dense);
  expect(frameBody(golden("hll-sparse").frame).getUint8(at)).toBe(sparse);
});

test("the documented register width sizes the dense payload", () => {
  const fixture = golden("hll-dense");
  const payload = frameBody(fixture.frame).byteLength - paramOffset("payload");

  expect((payload * 8) / 2 ** fixture.p).toBe(denseRegisterWidth());
});

test("the documented sparse entry encoding decodes the golden entries", () => {
  const { bytes, indexBits, rhoBits } = sparseEntryLayout();
  expect(indexBits + rhoBits).toBe(31);

  const fixture = golden("hll-sparse");
  const body = frameBody(fixture.frame);
  const at = paramOffset("payload");
  const entries = (body.byteLength - at) / bytes;

  expect((body.byteLength - at) % bytes).toBe(0);
  expect(entries).toBe(new Set(fixture.keys).size);
  expect(entries).toBe(HyperLogLog.fromBytes(fixture.frame).count());

  let previous = -1;
  for (let i = 0; i < entries; i++) {
    const entry = body.getUint32(at + i * bytes, true);
    const index = entry >>> rhoBits;
    const rho = entry & ((1 << rhoBits) - 1);

    expect(index).toBeLessThan(2 ** indexBits);
    expect(index).toBeGreaterThan(previous);
    expect(rho).toBeGreaterThanOrEqual(1);
    expect(rho).toBeLessThan(2 ** rhoBits);
    previous = index;
  }
});
