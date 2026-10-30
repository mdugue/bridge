import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SITES } from "../sites";
import { siteSpec } from "./pipeline";

const PYTHON = join(import.meta.dir, "../pipeline/bake");

test("the spec carries exactly the keys pipeline/bake/spec.py reads", () => {
  // a key spec.py reads with .get() and a default would go silently
  // missing; one it no longer reads would ride along unused
  const python = readFileSync(join(PYTHON, "spec.py"), "utf8");
  const read = new Set(
    [...python.matchAll(/doc(?:\["(\w+)"\]|\.get\("(\w+)")/gu)].map(
      (m) => m[1] ?? m[2]
    )
  );
  for (const site of Object.values(SITES)) {
    expect(new Set(Object.keys(siteSpec(site)))).toEqual(read);
  }
});

test("every provider's products are fields pipeline/bake/common.py takes", () => {
  const python = readFileSync(join(PYTHON, "common.py"), "utf8");
  const block = (
    python.match(/class Products:\n([\s\S]*?)\n\n\n/u)?.[1] ?? ""
  ).replace(/"""[\s\S]*?"""/gu, "");
  // `name: type`, `name: type = default` (spaced or not), a comment after
  const fields = [
    ...block.matchAll(/^ {4}(\w+): [^=#\n]+?(\s*=|\s*(?:#.*)?$)/gmu),
  ];
  const required = fields.filter((m) => !m[2].includes("=")).map((m) => m[1]);
  const all = new Set(fields.map((m) => m[1]));
  expect(required.length).toBeGreaterThan(0);
  for (const site of Object.values(SITES)) {
    const keys = Object.keys(siteSpec(site).products);
    expect(keys.filter((k) => !all.has(k))).toEqual([]);
    expect(required.filter((k) => !keys.includes(k))).toEqual([]);
  }
});
