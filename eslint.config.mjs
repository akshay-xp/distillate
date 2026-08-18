import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import astro from "eslint-plugin-astro";
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
  {
    files: ["apps/docs/**/*.ts"],
    // The astro processor names extracted <script> blocks "<file>.astro/1_1.ts",
    // which no tsconfig can supply a program for.
    ignores: ["apps/docs/**/*.astro/**"],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.strictTypeChecked,
      ...tseslint.configs.stylisticTypeChecked,
    ],
    languageOptions: {
      parserOptions: {
        project: "apps/docs/tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  // Astro templates get the non-type-aware rules: their frontmatter and
  // expressions are parsed by astro-eslint-parser, which the type-aware
  // configs cannot supply program information for.
  {
    files: ["apps/docs/**/*.astro", "apps/docs/**/*.astro/*.{js,ts}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
  },
  ...astro.configs.recommended,
  prettier,
);
