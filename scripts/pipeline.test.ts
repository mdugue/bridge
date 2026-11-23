import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { SITES } from "../sites";
import { siteSpec } from "./pipeline";

const PYTHON = path.join(import.meta.dir, "../pipeline/bake");

test("the spec carries exactly the keys pipeline/bake/spec.py reads", () => {
  // a key spec.py reads with .get() and a default would go silently
  // missing; one it no longer reads would ride along unused
  const python = readFileSync(path.join(PYTHON, "spec.py"), "utf-8");
  const read = new Set(
    [
      ...python.matchAll(/doc(?:\["(?<index>\w+)"\]|\.get\("(?<call>\w+)")/gu),
    ].map((m) => m.groups?.index ?? m.groups?.call ?? "")
  );
  for (const site of Object.values(SITES)) {
    expect(new Set(Object.keys(siteSpec(site)))).toEqual(read);
  }
});

test("every provider's products are fields pipeline/bake/common.py takes", () => {
  const python = readFileSync(path.join(PYTHON, "common.py"), "utf-8");
  const block = (
    /class Products:\n(?<body>[\s\S]*?)\n\n\n/u.exec(python)?.groups?.body ?? ""
  ).replaceAll(/"""[\s\S]*?"""/gu, "");
  // `name: type`, `name: type = default` (spaced or not), a comment after
  const fields = [
    ...block.matchAll(
      /^ {4}(?<name>\w+): [^=#\n]+?(?<tail>\s*=|\s*(?:#.*)?$)/gmu
    ),
  ];
  const required = fields
    .filter((m) => !(m.groups?.tail ?? "").includes("="))
    .map((m) => m.groups?.name ?? "");
  const all = new Set(fields.map((m) => m.groups?.name ?? ""));
  expect(required.length).toBeGreaterThan(0);
  for (const site of Object.values(SITES)) {
    const keys = Object.keys(siteSpec(site).products);
    expect(keys.filter((k) => !all.has(k))).toEqual([]);
    expect(required.filter((k) => !keys.includes(k))).toEqual([]);
  }
});
