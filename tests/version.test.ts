import { expect, test } from "vitest";

import pkg from "../package.json" with { type: "json" };
import { VERSION } from "../src/index.js";

test("VERSION matches the package.json version", () => {
  expect(VERSION).toBe(pkg.version);
});
