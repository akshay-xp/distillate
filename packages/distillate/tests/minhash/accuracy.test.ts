import { test } from "vitest";

import { checkJaccardCell } from "../helpers/jaccard-gate.js";

// Sets small and mid-sized, checked against the classic oracle as well. The
// 100k cells live in accuracy-large.test.ts so the two run on separate workers.
test.each([20, 1000].flatMap((n) => [0.1, 0.5, 0.9].map((j) => [n, j])))(
  "n %i, J %f",
  checkJaccardCell,
);
