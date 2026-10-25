import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { expect, test } from "vitest";
import { parse } from "yaml";

import { SEARCH_NAME, structureSubpaths } from "./structures.js";

interface Frontmatter {
  title: string;
  head?: { tag: string; content?: string }[];
}

function frontmatter(name: string): Frontmatter {
  const md = readFileSync(
    fileURLToPath(
      new URL(`../src/content/docs/guides/${name}.md`, import.meta.url),
    ),
    "utf8",
  );
  return parse(md.split("---\n")[1]) as Frontmatter;
}

const words = (s: string): string => s.toLowerCase().replaceAll("-", " ");

// Starlight renders a head title entry as the page's <title> verbatim, in
// place of "<title> | distillate", and leaves the frontmatter title as the H1.
// The search name is the npm keyword and the tracked query, so the three stay
// one phrase.
test("every structure guide's <title> carries its search name and JavaScript", () => {
  for (const subpath of structureSubpaths) {
    const { title, head = [] } = frontmatter(subpath.slice(2));
    const titles = head.filter((entry) => entry.tag === "title");
    expect(titles, subpath).toHaveLength(1);
    const content = words(titles[0]?.content ?? "");
    expect(content, subpath).toContain(words(SEARCH_NAME[subpath] ?? subpath));
    expect(content, subpath).toContain("javascript");
    expect(title, `${subpath} H1`).not.toContain("JavaScript");
  }
});
