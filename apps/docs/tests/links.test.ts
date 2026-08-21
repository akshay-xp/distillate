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
