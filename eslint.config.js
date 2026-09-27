import js from "@eslint/js";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";
import globals from "globals";

export default [
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/coverage/**",
      "website/dist/**",
      "website/src/generated/**",
      "website/.ssr-build/**",
      ".lighthouseci/**",
      "apps/*/dist/**",
      "apps/*/test-results/**",
      "apps/*/playwright-report/**",
    ],
  },
  js.configs.recommended,
  {
    files: ["**/*.{js,mjs}"],
    languageOptions: {
      sourceType: "module",
      ecmaVersion: 2023,
      globals: { ...globals.node },
    },
  },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 2023,
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
      globals: { ...globals.node, ...globals.browser },
    },
    plugins: { "@typescript-eslint": tseslint },
    rules: {
      "no-undef": "off",
      "no-unused-vars": "off",
      "no-redeclare": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "error",
      "no-control-regex": "off",
      eqeqeq: ["error", "always"],
      "no-console": ["error", { allow: ["warn", "error"] }],
    },
  },
  {
    // Tests, scripts and runnable examples print their results.
    files: [
      "**/tests/**",
      "**/*_test.ts",
      "**/scripts/**",
      "e2e/**",
      "examples/**",
    ],
    rules: { "no-console": "off" },
  },
];
