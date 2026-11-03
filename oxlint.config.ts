import { defineConfig } from "oxlint";
import core from "ultracite/oxlint/core";
import next from "ultracite/oxlint/next";
import react from "ultracite/oxlint/react";

export default defineConfig({
  extends: [core, react, next],
  options: { typeAware: true },
  rules: {
    // Our limits and exceptions, stricter or more precise than the preset's.
    complexity: ["error", { max: 20 }],
    eqeqeq: ["error", "always", { null: "ignore" }],
    "no-eq-null": "off",
    "typescript/prefer-optional-chain": "error",

    // Their autofix breaks working code here: a dropped return, a typed array
    // turned into a plain one, shifted promise timing, new possibly-undefined.
    "typescript/no-confusing-void-expression": "off",
    "typescript/promise-function-async": "off",
    "unicorn/prefer-at": "off",
    "unicorn/prefer-spread": "off",

    // They fight how this code is written: helpers below their callers, the
    // key order that reads best, comments beside the line they explain.
    "func-style": "off",
    "no-inline-comments": "off",
    "no-use-before-define": "off",
    "sort-keys": "off",

    // The work needs what they forbid: packed words and hash seeds, one
    // compile at a time, no array copies on a phone (ADR 0047), promises
    // around timers and workers, assertions on three's and TSL's types.
    "no-await-in-loop": "off",
    "no-bitwise": "off",
    "promise/avoid-new": "off",
    "typescript/no-unsafe-type-assertion": "off",
    "typescript/strict-boolean-expressions": "off",
    "unicorn/no-array-reverse": "off",
    "unicorn/no-array-sort": "off",
  },
  ignorePatterns: [
    ...(core.ignorePatterns ?? []),
    "next-env.d.ts",
    "components/ui/**",
    "hooks/use-mobile.ts",
    ".agents/**",
    ".claude/skills/**",
    "public/**",
    "data/**",
    "aesthetic-sandbox.html",
  ],
  overrides: [
    {
      files: ["lib/city/terrain-geometry.ts"],
      rules: { "oxc/erasing-op": "off" },
    },
    {
      files: ["**/*.{test,spec}.{ts,tsx}", "e2e/**"],
      rules: {
        complexity: "off",
        "typescript/no-explicit-any": "off",
      },
    },
  ],
});
