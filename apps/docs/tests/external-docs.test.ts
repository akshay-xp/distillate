import { expect, test } from "vitest";

import { parseTitle } from "../src/loaders/external-docs.js";

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
