import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "vitest";

import { findBrokenLinks, findBrokenSiteLinks } from "../scripts/links.mjs";

function page(...hrefs: string[]): string {
  const links = hrefs.map((h) => `<a href="${h}">x</a>`).join("");
  return `<html><body>${links}</body></html>`;
}

test("a link to a route the build never emitted is reported", () => {
  const pages = new Map([
    ["/a/", page("/b/", "/nope/")],
    ["/b/", page()],
  ]);

  expect(findBrokenLinks(pages)).toEqual([{ from: "/a/", href: "/nope/" }]);
});

test("a page linking only to routes that exist reports nothing", () => {
  const pages = new Map([
    ["/a/", page("/b/", "/a/")],
    ["/b/", page("/a/")],
  ]);

  expect(findBrokenLinks(pages)).toEqual([]);
});

test("the forms that address one page are all the same route", () => {
  const pages = new Map([
    ["/a/", page("/b", "/b/", "/b#x", "/b/#x", "/b?q=1", "/b/?q=1")],
    ["/b/", page()],
  ]);

  expect(findBrokenLinks(pages)).toEqual([]);
});

test("a broken link is reported as written, not as normalised", () => {
  const pages = new Map([["/a/", page("/nope#x")]]);

  expect(findBrokenLinks(pages)).toEqual([{ from: "/a/", href: "/nope#x" }]);
});

test("assets, external URLs and relative links are not routes", () => {
  const pages = new Map([
    [
      "/a/",
      page(
        "/_astro/x.js",
        "/favicon.svg",
        "/llms.txt",
        "https://example.com/nope/",
        "mailto:x@y.z",
        "../b/",
        "#top",
        // The control: a real dead page link, so the filters above cannot
        // pass by swallowing everything.
        "/nope/",
      ),
    ],
  ]);

  expect(findBrokenLinks(pages)).toEqual([{ from: "/a/", href: "/nope/" }]);
});

// `/llms.txt` is a file and `/reference/v0.7/` is a page, and after a trailing
// slash is appended the two look alike. The trailing slash as written is what
// tells them apart, so the asset test has to run before normalisation.
test("a dot in a page's own path does not make it an asset", () => {
  const pages = new Map([["/a/", page("/reference/v0.7/")]]);

  expect(findBrokenLinks(pages)).toEqual([
    { from: "/a/", href: "/reference/v0.7/" },
  ]);
});

const CHECKER = fileURLToPath(
  new URL("../scripts/check-links.mjs", import.meta.url),
);

/** Writes `{ route: html }` into a temp directory laid out like `dist`. */
function buildDir(tree: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "links-"));
  for (const [route, html] of Object.entries(tree)) {
    const parent = join(dir, route);
    mkdirSync(parent, { recursive: true });
    writeFileSync(join(parent, "index.html"), html);
  }
  return dir;
}

function check(dir: string) {
  const run = spawnSync(process.execPath, [CHECKER, dir], {
    encoding: "utf8",
  });
  return { status: run.status, output: run.stdout + run.stderr };
}

test("the checker exits non-zero and names a broken link", () => {
  const dir = buildDir({ ".": page("/gone/") });

  const { status, output } = check(dir);

  expect(status).toBe(1);
  expect(output).toContain("/ -> /gone/");
  expect(output).toContain("1 routes, 1 broken");
});

test("the checker exits zero once every link resolves", () => {
  const dir = buildDir({ ".": page("/gone/"), gone: page() });

  const { status, output } = check(dir);

  expect(status).toBe(0);
  expect(output).toContain("2 routes, 0 broken");
  expect(output).not.toContain("->");
});

const SITE = "https://distillate.akxp.net";

test("an absolute link into the site is checked against the same routes", () => {
  const routes = new Set(["/", "/guides/sizing/"]);
  const markdown = [
    `[live](${SITE}/guides/sizing/)`,
    `[dead](${SITE}/api/readme/)`,
    "[elsewhere](https://example.com/whatever/)",
    "[relative](./other.md)",
  ].join("\n");

  expect(findBrokenSiteLinks(markdown, SITE, routes)).toEqual([
    `${SITE}/api/readme/`,
  ]);
});
