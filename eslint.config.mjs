import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import tsdoc from "eslint-plugin-tsdoc";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist",
      "coverage",
      "node_modules",
      "**/*.config.*",
      "scripts",
      "bench/**/*.bench.ts",
    ],
  },
  {
    files: ["src/**/*.ts", "tests/**/*.ts", "bench/**/*.ts"],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.strictTypeChecked,
      ...tseslint.configs.stylisticTypeChecked,
    ],
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.eslint.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ["src/**/*.ts"],
    plugins: { tsdoc },
    rules: {
      "tsdoc/syntax": "error",
    },
  },
  {
    files: ["bench/**/*.ts"],
    rules: {
      "@typescript-eslint/triple-slash-reference": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
  prettier,
);
