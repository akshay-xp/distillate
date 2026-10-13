import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { HyperLogLog } from "distillate/hll";
import { describe, expect, test } from "vitest";

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

/** The spec from `start` up to the next heading of `stop`'s depth. */
function sectionFrom(start: string, stop: string, missing: string): string {
  const spec = doc();
  const at = spec.indexOf(start);
  if (at === -1) throw new Error(missing);
  const end = spec.indexOf(stop, at);
  return end === -1 ? spec.slice(at) : spec.slice(at, end);
}

/** Everything the spec says about the HyperLogLog frame. */
function hllSection(): string {
  return sectionFrom(
    "HyperLogLog (type 5), little-endian:",
    "\n### ",
    "serialization.md has no HyperLogLog params block",
  );
}

/**
 * The params table under `heading`, keyed by the field name each row names.
 * Each type's table is the first code block after its heading.
 */
function paramsTable(
  heading: string,
): Map<string, { offset: number; at: string; text: string }> {
  const section = sectionFrom(
    heading,
    "\n### ",
    `serialization.md has no params block for ${heading}`,
  );
  const open = section.indexOf("```");
  const close = section.indexOf("```", open + 3);

  const rows = new Map<string, { offset: number; at: string; text: string }>();
  for (const line of section
    .slice(open + 3, close)
    .trim()
    .split("\n")
    .slice(1)) {
    const [offset, , ...rest] = line.trim().split(/\s{2,}/);
    const text = rest.join(" ");
    rows.set(text.split(/[:\s(]/)[0] ?? "", {
      offset: Number(offset),
      at: offset,
      text,
    });
  }
  return rows;
}

/** The HyperLogLog params table. */
function hllParams(): Map<
  string,
  { offset: number; at: string; text: string }
> {
  return paramsTable("HyperLogLog (type 5), little-endian:");
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

const NUMERALS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
];

/** The structures the hash-variant section lists, and the count it claims. */
function hashVariant(): { families: string[]; count: string } {
  const section = sectionFrom(
    "### Hash variant (flags nibble)",
    "\n## ",
    "serialization.md has no hash variant section",
  );

  const listed = /murmur3_x86_128 \(([^)]+)\)/.exec(section);
  const count = /All (\w+) structures write variant/.exec(section);
  if (!listed || !count) {
    throw new Error("serialization.md does not say who writes variant 0");
  }
  return {
    families: listed[1].split(",").map((f) => f.trim()),
    count: count[1],
  };
}

interface Fixture {
  name: string;
  p?: number;
  seed?: number;
  keys: string[];
  frame: string;
}

function golden(name: string): {
  frame: Uint8Array;
  p: number;
  seed: number;
  keys: string[];
} {
  const all = JSON.parse(readFileSync(GOLDEN, "utf8")) as Fixture[];
  const entry = all.find((g) => g.name === name);
  if (!entry) throw new Error(`golden.json has no ${name} fixture`);
  return {
    frame: Buffer.from(entry.frame, "base64"),
    p: entry.p ?? 0,
    seed: entry.seed ?? 0,
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

test("the hash variant section counts every structure that writes variant 0", () => {
  const { families, count } = hashVariant();

  expect(families).toContain("HyperLogLog");
  expect(count).toBe(NUMERALS[families.length]);
});

test("the layout table marks every reserved header field must be 0", () => {
  const layout = doc().split("\n");
  for (const field of ["Flags (u8)", "Reserved (u8", "Reserved (u32"]) {
    const row = layout.find((l) => l.includes(field));
    expect(row, field).toContain("must be 0");
  }
});

test("the reserved bits section tells a reader to reject every reserved field", () => {
  const section = sectionFrom(
    "### Reserved bits",
    "\n### ",
    "serialization.md has no Reserved bits section",
  );

  expect(section).toContain("ReservedBitsError");
  expect(section).toContain("reject");
  for (const field of ["bits 4-7", "byte 7", "offset 12"]) {
    expect(section).toContain(field);
  }
});

test("the hash variant covers the index mapping of every structure", () => {
  // A variant that pins only the hash lets a probe-scheme change keep variant
  // 0 and silently misread every stored frame.
  const section = sectionFrom(
    "### Hash variant (flags nibble)",
    "\n## ",
    "serialization.md has no hash variant section",
  );

  expect(section).toContain("index mapping");
  expect(section).toContain("MURMUR128_MITZ_32");
  expect(section).toContain("MURMUR128_MITZ_64");
  const bullets = section.split("\n").filter((l) => l.startsWith("- **"));
  for (const family of hashVariant().families) {
    expect(
      bullets.some((l) => l.startsWith(`- **${family}:**`)),
      family,
    ).toBe(true);
  }
});

test("the reference shows walking a stream of frames with readFrameAt", () => {
  const walk = sectionFrom(
    "### Reading a stream of frames",
    "\n### ",
    "serialization.md has no stream-reading section",
  );
  expect(walk).toContain("readFrameAt");
  expect(walk).toMatch(/```ts[\s\S]*from "distillate\/frame"[\s\S]*```/);
});

test("the layout table names type 6 as ScalableBloom", () => {
  const { types, reserved } = typeRows();
  const named = new Map(
    [...types.matchAll(/(\d+)=([A-Za-z0-9]+)/g)].map(([, n, name]) => [
      Number(n),
      name,
    ]),
  );

  expect(named.get(6)).toBe("ScalableBloom");
  expect(reserved).not.toMatch(/\b6\+/);
});

test("the hash variant section lists Scalable among the variant 0 writers", () => {
  expect(hashVariant().families).toContain("Scalable");
});

test("the scalable section documents every field and the growth rules", () => {
  const section = sectionFrom(
    "Scalable Bloom (type 6)",
    "\n### ",
    "serialization.md has no Scalable Bloom section",
  );

  for (const field of [
    "n",
    "seed",
    "epsilon",
    "growth",
    "tightening",
    "stageCount",
    "m",
    "k",
    "capacity",
    "count",
  ]) {
    expect(section, field).toMatch(new RegExp(`\\b${field}\\b`));
  }
  expect(section).toContain("multiple of 8");
  expect(section).toContain("not already");
});

test("the layout table names type 7 as Cuckoo", () => {
  const { types, reserved } = typeRows();
  const named = new Map(
    [...types.matchAll(/(\d+)=([A-Za-z0-9]+)/g)].map(([, n, name]) => [
      Number(n),
      name,
    ]),
  );

  expect(named.get(7)).toBe("Cuckoo");
  expect(reserved).not.toMatch(/\b7\+/);
  expect(reserved).not.toContain("Cuckoo");
});

test("the hash variant section lists Cuckoo among the variant 0 writers", () => {
  expect(hashVariant().families).toContain("Cuckoo");
});

test("the cuckoo section documents every field and the add and delete rules", () => {
  const section = sectionFrom(
    "Cuckoo (type 7)",
    "\n### ",
    "serialization.md has no Cuckoo section",
  );

  for (const field of ["n", "seed", "epsilon", "f", "buckets", "count"]) {
    expect(section, field).toMatch(new RegExp(`\\b${field}\\b`));
  }
  expect(section).toContain("multiple of 8");
  expect(section).toContain("j * f");
  expect(section).toContain("0x5bd1e995");
  expect(section).toContain("500");
  expect(section).toContain("xorshift");
  expect(section).toMatch(/delete/i);
});

test("the layout table names type 8 as CountMin", () => {
  const { types, reserved } = typeRows();
  const named = new Map(
    [...types.matchAll(/(\d+)=([A-Za-z0-9]+)/g)].map(([, n, name]) => [
      Number(n),
      name,
    ]),
  );

  expect(named.get(8)).toBe("CountMin");
  expect(reserved).not.toMatch(/\b8\+/);
  expect(reserved).not.toContain("CountMin");
});

test("the hash variant section lists Count-Min among the variant 0 writers", () => {
  expect(hashVariant().families).toContain("Count-Min");
});

test("the count-min section documents every field and the row-sum rule", () => {
  const section = sectionFrom(
    "Count-Min (type 8)",
    "\n### ",
    "serialization.md has no Count-Min section",
  );

  for (const field of ["width", "depth", "seed"]) {
    expect(section, field).toMatch(new RegExp(`\\b${field}\\b`));
  }
  expect(section).toContain("row major");
  // The total is derivable, which is why it is not stored, and checking it is
  // what makes a forged frame detectable.
  expect(section).toMatch(/no total|total is not stored/i);
  expect(section).toContain("every row sums");
  expect(section).toMatch(/reject/i);
  // Same rule Cuckoo learned: geometry comes from the frame.
  expect(section).toContain("must not re-derive");
});

test("the layout table names type 9 as TopK", () => {
  const { types, reserved } = typeRows();
  const named = new Map(
    [...types.matchAll(/(\d+)=([A-Za-z0-9]+)/g)].map(([, n, name]) => [
      Number(n),
      name,
    ]),
  );

  expect(named.get(9)).toBe("TopK");
  expect(reserved).not.toContain("TopK");
});

// Payload rows give their offset as `A + Be`, e being the entries field, since
// where the lengths and keys start depends on how many entries there are.
function topKAt(
  rows: Map<string, { at: string }>,
  field: string,
  entries: number,
): number {
  const at = rows.get(field)?.at ?? "";
  const m = /^(\d+)(?: \+ (\d+)e)?$/.exec(at);
  if (!m) throw new Error(`Top-K ${field} row has offset "${at}"`);
  return Number(m[1]) + (m[2] ? Number(m[2]) : 0) * entries;
}

// Decoded from the page's offsets alone, so a wrong row fails here rather than
// in the Go reader written from it.
test("the documented Top-K layout decodes the golden frame", () => {
  const rows = paramsTable("Top-K (type 9), little-endian");
  const fixture = golden("topk");
  const body = frameBody(fixture.frame);
  const u32 = (field: string): number =>
    body.getUint32(rows.get(field)?.offset ?? NaN, true);

  const capacity = u32("capacity");
  const entries = u32("entries");
  expect(Number.isInteger(Math.log2(capacity))).toBe(true);
  expect(entries).toBeGreaterThan(0);
  expect(entries).toBeLessThanOrEqual(Math.floor(0.75 * capacity));
  // The seed once sat at 24; slot placement never reached the frame, so the
  // whole tail of the params block is padding a reader requires to be zero.
  const padding = rows.get("padding")?.offset ?? NaN;
  expect(padding).toBe(24);
  expect([
    ...new Uint8Array(body.buffer, body.byteOffset + padding, 8),
  ]).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  expect(body.getFloat64(rows.get("total")?.offset ?? NaN, true)).toBe(
    fixture.keys.length,
  );

  const lengthsAt = topKAt(rows, "lengths", entries);
  let keyBytes = 0;
  for (let i = 0; i < entries; i++) {
    expect(
      body.getUint32(topKAt(rows, "counts", entries) + 4 * i, true),
    ).toBeGreaterThan(0);
    keyBytes += body.getUint32(lengthsAt + 4 * i, true);
  }
  expect(topKAt(rows, "keys", entries) + keyBytes).toBe(body.byteLength);
});

test("the layout table names type 10 as DDSketch", () => {
  const { types, reserved } = typeRows();
  const named = new Map(
    [...types.matchAll(/(\d+)=([A-Za-z0-9]+)/g)].map(([, n, name]) => [
      Number(n),
      name,
    ]),
  );

  expect(named.get(10)).toBe("DDSketch");
  expect(reserved).not.toContain("DDSketch");
});

test("the layout table names type 11 as MinHash and reserves from 12", () => {
  const { types, reserved } = typeRows();
  const named = new Map(
    [...types.matchAll(/(\d+)=([A-Za-z0-9]+)/g)].map(([, n, name]) => [
      Number(n),
      name,
    ]),
  );

  expect(named.get(11)).toBe("MinHash");
  expect(reserved).toContain("12+");
  expect(reserved).not.toContain("MinHash");
});

test("the hash variant section lists MinHash among the variant 0 writers", () => {
  expect(hashVariant().families).toContain("MinHash");
});

const minHashSection = (): string =>
  sectionFrom(
    "MinHash (type 11), little-endian",
    "\n### ",
    "serialization.md has no MinHash section",
  );

test("the MinHash section states the slot rule, the clamp and what is stored", () => {
  const section = minHashSection();
  for (const phrase of [
    "reduce(w0, k)",
    "min(w1, 0xfffffffe)",
    "densif",
    "slot-wise min",
    "A reader rejects",
  ]) {
    expect(section, phrase).toContain(phrase);
  }
});

// Decoded from the page's offsets alone, so a wrong row fails here rather
// than in the Go reader.
describe.each<[string, number, number]>([
  ["minhash", 7, 128],
  ["minhash-small", 0, 64],
])(
  "the documented MinHash layout decodes the golden %s frame",
  (name, seed, k) => {
    test("seed, k, padding and every slot", () => {
      const rows = paramsTable("MinHash (type 11), little-endian");
      const body = frameBody(golden(name).frame);
      const at = (field: string): number => rows.get(field)?.offset ?? NaN;

      expect(rows.get("k")?.text).toContain("u16");
      expect(body.getUint32(at("seed"), true)).toBe(seed);
      const slots = body.getUint16(at("k"), true);
      expect(slots).toBe(k);
      expect(body.getUint8(at("reserved"))).toBe(0);
      expect(body.getUint8(at("reserved") + 1)).toBe(0);
      expect(body.byteLength).toBe(at("slots") + 4 * slots);

      let empty = 0;
      for (let i = 0; i < slots; i++) {
        if (body.getUint32(at("slots") + 4 * i, true) === 0xffffffff) empty++;
      }
      if (name === "minhash-small") expect(empty).toBeGreaterThan(0);
    });
  },
);

test("the hash variant section lists DDSketch among the variant 0 writers", () => {
  expect(hashVariant().families).toContain("DDSketch");
});

// The block table is the section's second code block. Its rows give offsets
// within a block, the indices' as `16 + wn`: after n counts of width w.
function blockTable(): Map<string, string> {
  const section = sectionFrom(
    "DDSketch (type 10), little-endian",
    "\n### ",
    "serialization.md has no DDSketch section",
  );
  const blocks = section.split("```");
  const table = blocks[3] ?? "";
  const rows = new Map<string, string>();
  for (const line of table.trim().split("\n").slice(1)) {
    const [offset, , ...rest] = line.trim().split(/\s{2,}/);
    rows.set(rest.join(" ").split(/[:\s(]/)[0] ?? "", offset);
  }
  return rows;
}

// Decoded from the page's offsets alone, as for Top-K, so a wrong row fails
// here rather than in the Go reader written from it.
describe.each(["ddsketch", "ddsketch-collapsed"])(
  "the documented DDSketch layout decodes the golden %s frame",
  (name) => {
    test("params, both blocks and every count", () => {
      const rows = paramsTable("DDSketch (type 10), little-endian");
      const block = blockTable();
      const all = JSON.parse(readFileSync(GOLDEN, "utf8")) as (Fixture & {
        values?: number[];
        epsilon?: number;
      })[];
      const fixture = all.find((g) => g.name === name);
      if (!fixture) throw new Error(`golden.json has no ${name} fixture`);
      const body = frameBody(Buffer.from(fixture.frame, "base64"));
      const at = (field: string): number => rows.get(field)?.offset ?? NaN;
      const f64 = (field: string): number => body.getFloat64(at(field), true);
      const off = (field: string): number => Number(block.get(field));

      // The default mapping: bitwise, which travels as linear with gamma
      // 2^(1/64) at 1% and no offset.
      expect(body.getUint8(at("mapping"))).toBe(1);
      expect(f64("gamma")).toBe(2 ** (1 / 64));
      expect(f64("relativeAccuracy")).toBe(fixture.epsilon);
      const values = fixture.values ?? [];
      expect(f64("min")).toBe(Math.min(...values));
      expect(f64("max")).toBe(Math.max(...values));

      let total = f64("zeroCount");
      let blockAt = 64;
      const forms: boolean[] = [];
      for (let sign = 0; sign < 2; sign++) {
        const layout = body.getUint8(blockAt + off("layout"));
        const contiguous = (layout & 1) === 1;
        const width = layout & 2 ? 8 : 4;
        const n = body.getUint32(blockAt + off("n"), true);
        const start = body.getInt32(blockAt + off("start"), true);
        const countsAt = blockAt + off("counts");
        expect(block.get("indices")).toBe("16 + wn");
        const indicesAt = countsAt + width * n;
        let previous = -Infinity;
        for (let i = 0; i < n; i++) {
          const count =
            width === 8
              ? body.getFloat64(countsAt + 8 * i, true)
              : body.getUint32(countsAt + 4 * i, true);
          const index = contiguous
            ? start + i
            : body.getInt32(indicesAt + 4 * i, true);
          expect(index).toBeGreaterThan(previous);
          previous = index;
          total += count;
        }
        forms.push(contiguous);
        const data = contiguous ? width * n : (width + 4) * n;
        blockAt += 16 + Math.ceil(data / 8) * 8;
      }
      expect(blockAt).toBe(body.byteLength);
      expect(total).toBe(values.length);
      // The two fixtures cover both forms between them.
      expect(forms[0]).toBe(name === "ddsketch-collapsed");
    });
  },
);
