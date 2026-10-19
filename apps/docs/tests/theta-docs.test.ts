import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { expect, test } from "vitest";

const read = (path: string): string =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

test("the README shows the sketch", () => {
  const readme = read("../../../packages/distillate/README.md");
  expect(readme).toContain("### Theta (`distillate/theta`)");
});
