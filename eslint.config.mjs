import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import tsdoc from "eslint-plugin-tsdoc";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist",
      "**/coverage",
      "**/node_modules",
      "**/*.config.*",
      "**/scripts",
      "**/*.bench.ts",
    ],
  },
  {
    files: [
      "packages/distillate/src/**/*.ts",
      "packages/distillate/tests/**/*.ts",
      "packages/distillate/bench/**/*.ts",
    ],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.strictTypeChecked,
      ...tseslint.configs.stylisticTypeChecked,
    ],
    languageOptions: {
      parserOptions: {
        project: "packages/distillate/tsconfig.eslint.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ["packages/distillate/src/**/*.ts"],
    plugins: { tsdoc },
    rules: {
      "tsdoc/syntax": "error",
    },
  },
  {
    files: ["packages/distillate/bench/**/*.ts"],
    rules: {
      "@typescript-eslint/triple-slash-reference": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
  prettier,
);
