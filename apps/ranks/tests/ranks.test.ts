import { readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";

import { QUERIES, TRACKED, npmRows } from "../src/ranks.js";

function fixture(name: string): unknown {
  return JSON.parse(
    readFileSync(new URL(`fixtures/${name}.json`, import.meta.url), "utf8"),
  );
}

interface NpmBody {
  objects: {
    package: { name: string };
    score: { final: number };
    downloads: { weekly: number };
  }[];
}

describe("npmRows", () => {
  test("ranks a tracked package found in the results", () => {
    const body = fixture("npm-found") as NpmBody;
    const at = body.objects.findIndex((o) => o.package.name === "distillate");
    const hit = body.objects[at];

    const rows = npmRows("2026-10-21", "probabilistic data structures", body);

    expect(rows).toEqual([
      {
        date: "2026-10-21",
        source: "npm",
        query: "probabilistic data structures",
        name: "distillate",
        rank: String(at + 1),
        score: hit?.score.final.toFixed(3),
        downloads: String(hit?.downloads.weekly),
      },
      {
        date: "2026-10-21",
        source: "npm",
        query: "probabilistic data structures",
        name: "@distillate/hyperloglog",
        rank: "",
        score: "",
        downloads: "",
      },
    ]);
  });

  test("leaves the rank empty for a package not in the results", () => {
    const rows = npmRows("2026-10-21", "hyperloglog", fixture("npm-absent"));

    expect(rows.map((r) => [r.name, r.rank])).toEqual([
      ["distillate", ""],
      ["@distillate/hyperloglog", ""],
    ]);
  });
});

test("tracks 16 distinct queries and both packages", () => {
  expect(new Set(QUERIES).size).toBe(16);
  expect(QUERIES).toContain("hyperloglog");
  expect(QUERIES).toContain("probabilistic data structures");
  expect(TRACKED).toEqual(["distillate", "@distillate/hyperloglog"]);
});
