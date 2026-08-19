import { expect, test } from "vitest";

import { parseTitle, rewriteLinks } from "../src/loaders/external-docs.js";

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
