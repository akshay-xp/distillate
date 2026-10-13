import { test } from "vitest";

import { checkJaccardCell } from "../helpers/jaccard-gate.js";

// Large sets, past the oracle's reach: it hashes every item k times.
test.each([0.1, 0.5, 0.9])("n 100000, J %f", (j) => {
  checkJaccardCell(100_000, j);
});
