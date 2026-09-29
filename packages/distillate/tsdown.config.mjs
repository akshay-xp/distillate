import { defineConfig } from "tsdown";

import { publishedEntries } from "./scripts/entries.mjs";

export default defineConfig({
  entry: publishedEntries().map((e) => e.src),
  format: ["esm", "cjs"],
  fixedExtension: false,
  dts: true,
  // TSDoc belongs in the .d.ts, where editors and typedoc read it, not in the
  // shipped JS. Rolldown preserves it by default, which cost every subpath
  // roughly 20% of its bundle for comments no runtime ever executes.
  outputOptions: { comments: false },
  clean: true,
});
