import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { expect, test } from "vitest";

import { site } from "../site.mjs";

const PACKAGE = fileURLToPath(
  new URL("../../../packages/distillate/package.json", import.meta.url),
);

function manifest(): Record<string, unknown> {
  return JSON.parse(readFileSync(PACKAGE, "utf8")) as Record<string, unknown>;
}

// The origin is one constant for code, but npm renders `homepage` from a
// literal string that no import can reach. This is the tripwire: change the
// constant and the failure names the file that still has to be edited by hand.
test("the published homepage is the site the docs deploy to", () => {
  expect(manifest().homepage).toBe(site);
});

// Cloudflare serves a managed robots.txt with no rules and no sitemap unless
// the origin has one, so crawlers other than the two consoles it is submitted
// to would never learn where the sitemap is.
test("robots.txt names the sitemap and blocks nothing", () => {
  const robots = readFileSync(
    fileURLToPath(new URL("../public/robots.txt", import.meta.url)),
    "utf8",
  );
  expect(robots.split("\n")).toContain(`Sitemap: ${site}/sitemap-index.xml`);
  expect(robots).not.toMatch(/^Disallow/m);
});
