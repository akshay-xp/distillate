import { expect, test } from "vitest";

import * as bloom from "../../src/bloom/index.js";
import * as riblt from "../../src/riblt/index.js";

// Type-only exports erase, so these are the names a consumer can reach at
// runtime. The module-internal hand-off (nextSymbol, pushSymbol) must not be
// among them.
test("the barrel exports the encoder, the decoder and ParamError", () => {
  expect(Object.keys(riblt).sort()).toEqual([
    "ParamError",
    "RibltDecoder",
    "RibltEncoder",
  ]);
});

test("one catch matches a settings failure from any subpath", () => {
  expect(riblt.ParamError).toBe(bloom.ParamError);
});
