import { defineConfig } from "tsdown";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/bloom/index.ts",
    "src/blocked/index.ts",
    "src/fuse/index.ts",
  ],
  format: ["esm", "cjs"],
  fixedExtension: false,
  dts: true,
  clean: true,
});
