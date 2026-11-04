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
    "typescript/no-require-imports": "error",
    "typescript/prefer-optional-chain": "error",
    // `() => setKey(null)` hides nothing; a returned void expression can.
    "typescript/no-confusing-void-expression": [
      "error",
      { ignoreArrowShorthand: true },
    ],
    // An async function that only returns a promise is what
    // promise-function-async asks for: the typed require-await allows it, the
    // base rule does not.
    "require-await": "off",
    "typescript/require-await": "error",
    // Objects only: `const [x] = typedArray` walks an iterator, in hot loops.
    "prefer-destructuring": ["error", { array: false, object: true }],

    // Reads every postMessage as window's: here they are channels' and workers'.
    "unicorn/require-post-message-target-origin": "off",

    // A TypeError is a network failure to fetch-retry.ts: a data fault is not.
    "unicorn/prefer-type-error": "off",
    // A worker's URL stays explicit for the bundler: new URL("./x.ts", …).
    "unicorn/relative-url-style": "off",

    // Takes `typedArray.slice()` for an array: its fix makes a plain one.
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
      // "use cache" functions and Next's config hooks must be async.
      files: ["app/wissen/**/page.tsx", "next.config.ts"],
      rules: { "typescript/require-await": "off" },
    },
    {
      // These read a number off text with more behind it ("123px", "12 m", a
      // field padded with NUL), which Number() would make NaN.
      files: [
        "app/_components/inquiry-card.tsx",
        "lib/city/dxf.ts",
        "lib/city/plan-records.ts",
        "lib/city/shapefile.ts",
      ],
      rules: { "unicorn/prefer-number-coercion": "off" },
    },
    {
      // Overriding a method of ShadowNode's, which its types leave out, takes
      // a method signature in the cast: a property's would not allow it.
      files: ["app/_components/sun-rig.ts"],
      rules: { "typescript/method-signature-style": "off" },
    },
    {
      // watchGone's listener is one per walk on purpose: three adds one
      // function once per geometry, and the first walk's stop would take it.
      files: ["app/_components/post-stack.ts"],
      rules: { "unicorn/consistent-function-scoping": "off" },
    },
    {
      files: ["lib/city/terrain-geometry.ts"],
      rules: { "oxc/erasing-op": "off" },
    },
    {
      files: ["**/*.{test,spec}.{ts,tsx}", "e2e/**"],
      rules: {
        complexity: "off",
        "typescript/no-explicit-any": "off",
        // A fake that resolves at once breaks one of three rules whichever way
        // it is written: promise-function-async without `async`,
        // no-useless-promise-resolve-reject with Promise.resolve, this without.
        "typescript/require-await": "off",
      },
    },
  ],
});
