import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// lib/city is the three-free, DOM-free half of the viewer (AGENTS.md); this
// keeps it that way so every module here stays unit-testable under bun.
const DIR = import.meta.dir;
const sources = readdirSync(DIR).filter(
  (f) => f.endsWith(".ts") && !f.endsWith(".test.ts")
);

test.each(sources)("%s imports no three.js and touches no DOM", (file) => {
  const text = readFileSync(join(DIR, file), "utf8");
  expect(text).not.toMatch(/from ["']three(\/|["'])/);
  expect(text).not.toMatch(/\b(document|window|navigator)\./);
});
