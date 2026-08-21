import { expect, test } from "vitest";

import { findBrokenLinks } from "../scripts/links.mjs";

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
