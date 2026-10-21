import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import {
  QUERIES,
  REPO,
  type Row,
  TRACKED,
  appendRows,
  downloadsRow,
  githubRow,
  npmRows,
} from "../src/ranks.js";

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

describe("githubRow", () => {
  const names = fixture("github") as string[];

  test("ranks the repo among the collected names", () => {
    const withRepo = [...names.slice(0, 4), REPO, ...names.slice(4)];

    expect(githubRow("2026-10-21", "sketch", withRepo)).toEqual({
      date: "2026-10-21",
      source: "github",
      query: "sketch",
      name: REPO,
      rank: "5",
      score: "",
      downloads: "",
    });
  });

  test("leaves the rank empty when the repo is not among them", () => {
    const without = names.filter((n) => n !== REPO);

    expect(githubRow("2026-10-21", "sketch", without).rank).toBe("");
  });
});

describe("downloadsRow", () => {
  test("records a package's weekly downloads", () => {
    const body = fixture("downloads") as { downloads: number };

    expect(downloadsRow("2026-10-21", "distillate", 200, body)).toEqual({
      date: "2026-10-21",
      source: "downloads",
      query: "",
      name: "distillate",
      rank: "",
      score: "",
      downloads: String(body.downloads),
    });
  });

  test("leaves downloads empty for a package npm does not know yet", () => {
    const row = downloadsRow(
      "2026-10-21",
      "@distillate/hyperloglog",
      404,
      fixture("downloads-missing"),
    );

    expect(row.downloads).toBe("");
  });
});

describe("appendRows", () => {
  const row = (query: string, rank: string): Row => ({
    date: "2026-10-21",
    source: "npm",
    query,
    name: "distillate",
    rank,
    score: "",
    downloads: "",
  });

  test("writes the header once, then appends rows only", () => {
    const path = join(mkdtempSync(join(tmpdir(), "ranks-")), "ranks.csv");

    appendRows(path, [row("hyperloglog", ""), row("sketch", "7")]);
    appendRows(path, [row("minhash", "3")]);

    expect(readFileSync(path, "utf8")).toBe(
      [
        "date,source,query,name,rank,score,downloads",
        "2026-10-21,npm,hyperloglog,distillate,,,",
        "2026-10-21,npm,sketch,distillate,7,,",
        "2026-10-21,npm,minhash,distillate,3,,",
        "",
      ].join("\n"),
    );
  });

  // Values are written unquoted, which holds only while none can hold either.
  test("no query or tracked name holds a comma or quote", () => {
    for (const value of [...QUERIES, ...TRACKED]) {
      expect(value).not.toMatch(/[,"]/);
    }
  });
});
