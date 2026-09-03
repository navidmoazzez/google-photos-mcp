// Flat config. Type-aware rules are deliberately off: they need a full program
// per run, which triples CI time on a repo this size for findings the compiler
// already makes under `strict` + `noUncheckedIndexedAccess`.
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", "coverage/**", "desktop-extension/build/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // An unused argument is usually a signature being honoured, not a bug.
      // Underscore-prefixed ones are intentional.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // The MCP SDK derives callback types from a schema generic, so the one
      // cast in tools/kit.ts cannot be expressed without `any`. It is confined
      // to that seam and every tool is checked against its own schema.
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
);
