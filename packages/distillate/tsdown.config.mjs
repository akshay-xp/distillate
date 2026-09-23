import { defineConfig } from "tsdown";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/bloom/index.ts",
    "src/blocked/index.ts",
    "src/fuse/index.ts",
    "src/hll/index.ts",
    "src/frame/index.ts",
    "src/scalable/index.ts",
    "src/cuckoo/index.ts",
    "src/countmin/index.ts",
  ],
  format: ["esm", "cjs"],
  fixedExtension: false,
  dts: true,
  // TSDoc belongs in the .d.ts, where editors and typedoc read it, not in the
  // shipped JS. Rolldown preserves it by default, which cost every subpath
  // roughly 20% of its bundle for comments no runtime ever executes.
  outputOptions: { comments: false },
  clean: true,
});
