import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createKeyMaker } from "./cache-keys";

/** A tiny repo: bake.ts imports helper.ts (which imports a package),
 *  other.ts stands apart. */
function repo() {
  const root = mkdtempSync(join(tmpdir(), "cache-keys-"));
  mkdirSync(join(root, "scripts"));
  writeFileSync(
    join(root, "scripts/bake.ts"),
    'import { h } from "./helper";\nexport const b = h;\n'
  );
  writeFileSync(
    join(root, "scripts/helper.ts"),
    'import { x } from "pkg";\nexport const h = x;\n'
  );
  writeFileSync(join(root, "scripts/other.ts"), "export const o = 1;\n");
  writeFileSync(join(root, "input.json"), "{}");
  writeFileSync(join(root, "common.ts"), "// orchestration\n");
  return root;
}

const lock = (version: string) => ({
  pkg: [`pkg@${version}`, "", {}, "sha"],
  viewerOnly: ["viewerOnly@1", "", {}, "sha"],
});

const keyOf = (root: string, version = "1") =>
  createKeyMaker({
    root,
    common: [join(root, "common.ts")],
    lockfile: lock(version),
  }).key([join(root, "input.json")], ["scripts/bake.ts"], "extra");

test("a key changes with an input, a module the bake reaches, a common source or its package", () => {
  const root = repo();
  const base = keyOf(root);
  expect(keyOf(root)).toBe(base);
  writeFileSync(
    join(root, "scripts/helper.ts"),
    'import { x } from "pkg";\nexport const h = x + 1;\n'
  );
  const helper = keyOf(root);
  expect(helper).not.toBe(base);
  writeFileSync(join(root, "input.json"), '{"a":1}');
  const input = keyOf(root);
  expect(input).not.toBe(helper);
  writeFileSync(join(root, "common.ts"), "// orchestration, edited\n");
  const common = keyOf(root);
  expect(common).not.toBe(input);
  expect(keyOf(root, "2")).not.toBe(common);
});

test("a module outside the bake's graph and a package only the viewer imports change nothing", () => {
  const root = repo();
  const base = keyOf(root);
  writeFileSync(join(root, "scripts/other.ts"), "export const o = 2;\n");
  expect(keyOf(root)).toBe(base);
  const bumped = createKeyMaker({
    root,
    common: [join(root, "common.ts")],
    lockfile: { ...lock("1"), viewerOnly: ["viewerOnly@9", "", {}, "sha"] },
  }).key([join(root, "input.json")], ["scripts/bake.ts"], "extra");
  expect(bumped).toBe(base);
});

test("an absent input is part of the key, as absent", () => {
  const root = repo();
  const maker = createKeyMaker({ root, common: [], lockfile: lock("1") });
  const absent = maker.key([join(root, "missing.json")], []);
  writeFileSync(join(root, "missing.json"), "{}");
  const present = createKeyMaker({ root, common: [], lockfile: lock("1") }).key(
    [join(root, "missing.json")],
    []
  );
  expect(present).not.toBe(absent);
});
