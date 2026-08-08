import { expect, test } from "vitest";

import { VERSION } from "../src/index.js";

test("package entry exposes VERSION as a string", () => {
  expect(typeof VERSION).toBe("string");
});
