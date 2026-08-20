import { expect, test } from "vitest";

import {
  parseTitle,
  rewriteLinks,
  siteRoutesFor,
} from "../src/loaders/external-docs.js";

const GITHUB_BASE =
  "https://github.com/akshay-xp/distillate/blob/main/packages/distillate/docs/";

const opts = {
  file: "hashing.md",
  siteRoutes: { "METHODOLOGY.md": "/bench/methodology/" },
  githubDocs: new Set<string>(),
  githubBase: GITHUB_BASE,
};

test("parseTitle lifts the h1 and removes it from the body", () => {
  expect(
    parseTitle("# Hashing\n\nThe correctness linchpin.\n", "hashing.md"),
  ).toEqual({ title: "Hashing", body: "The correctness linchpin.\n" });
});

test("parseTitle leaves a later h1 in place", () => {
  const { body } = parseTitle(
    "# Hashing\n\nIntro.\n\n# Appendix\n\nMore.\n",
    "hashing.md",
  );
  expect(body).toBe("Intro.\n\n# Appendix\n\nMore.\n");
});

test("parseTitle names the file when it has no h1", () => {
  expect(() => parseTitle("no heading here\n", "RESULTS.md")).toThrow(
    /RESULTS\.md/,
  );
});

test("rewriteLinks points mapped md links at their site route", () => {
  expect(
    rewriteLinks("See [METHODOLOGY.md](./METHODOLOGY.md) for how", opts),
  ).toBe("See [METHODOLOGY.md](/bench/methodology/) for how");
});

test("rewriteLinks resolves the bare md form too", () => {
  expect(rewriteLinks("[m](METHODOLOGY.md)", opts)).toBe(
    "[m](/bench/methodology/)",
  );
});

test("rewriteLinks sends docs that are not rendered to github", () => {
  const githubOnly = {
    ...opts,
    githubDocs: new Set(["architecture.md", "serialization.md"]),
  };
  expect(rewriteLinks("[architecture.md](architecture.md)", githubOnly)).toBe(
    `[architecture.md](${GITHUB_BASE}architecture.md)`,
  );
  expect(rewriteLinks("[s](serialization.md)", githubOnly)).toBe(
    `[s](${GITHUB_BASE}serialization.md)`,
  );
});

test("rewriteLinks leaves fenced code alone", () => {
  const fence = "```md\n[a](./METHODOLOGY.md)\n[b](./unknown.md)\n```\n";
  expect(rewriteLinks(`${fence}\n[m](./METHODOLOGY.md)\n`, opts)).toBe(
    `${fence}\n[m](/bench/methodology/)\n`,
  );
});

test("rewriteLinks rejects a relative md link with no mapping", () => {
  expect(() => rewriteLinks("[x](unknown.md)", opts)).toThrow(
    /hashing\.md.*unknown\.md/,
  );
});

test("siteRoutesFor derives a route per in-place source", () => {
  expect(
    siteRoutesFor([
      { file: "apps/bench/RESULTS.md", id: "bench/results" },
      { file: "packages/distillate/docs/hashing.md", id: "internals/hashing" },
    ]),
  ).toEqual({
    "RESULTS.md": "/bench/results/",
    "hashing.md": "/internals/hashing/",
  });
});

test("siteRoutesFor adds authored pages that are not in-place sources", () => {
  expect(
    siteRoutesFor(
      [
        {
          file: "packages/distillate/docs/hashing.md",
          id: "internals/hashing",
        },
      ],
      { "serialization.md": "/reference/serialization/" },
    ),
  ).toEqual({
    "hashing.md": "/internals/hashing/",
    "serialization.md": "/reference/serialization/",
  });
});

test("an authored route resolves a link an in-place page makes", () => {
  const siteRoutes = siteRoutesFor(
    [{ file: "packages/distillate/docs/hashing.md", id: "internals/hashing" }],
    { "serialization.md": "/reference/serialization/" },
  );
  expect(
    rewriteLinks("see [serialization.md](serialization.md)", {
      file: "hashing.md",
      siteRoutes,
      githubDocs: new Set<string>(),
      githubBase: GITHUB_BASE,
    }),
  ).toBe("see [serialization.md](/reference/serialization/)");
});
