/** The compared plates' folder comparison, claims, verdict and report
 *  (scripts/plates.ts). */
import { afterAll, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import nodePath from "node:path";
import sharp from "sharp";
import { compare, TIER1_VIEWS } from "./plates";

const TOLERANCE = { level: 24, mean: 1000, share: 0.01 };
const root = mkdtempSync(nodePath.join(tmpdir(), "plates-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
let folders = 0;
/** A fresh rendered folder with its `run.json`. */
function side(held = true): string {
  folders += 1;
  const dir = nodePath.join(root, `side-${folders}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    nodePath.join(dir, "run.json"),
    JSON.stringify({
      adapter: "test adapter",
      held,
      ms: {},
      query: "",
      small: true,
    })
  );
  return dir;
}

/**
 * A 20 × 10 plate of `view`: grey, a mark that tells the views apart
 * (two with the same pixels are a harness fault), and `changed` pixels
 * of its first row white.
 */
async function writePlate(
  folder: string,
  view: string,
  changed = 0,
  mark = 1 + (Bun.hash(view) % 90n === 0n ? 90 : Number(Bun.hash(view) % 90n))
) {
  const data = new Uint8Array(20 * 10 * 3).fill(90);
  data.fill(10, 300, 300 + mark * 3);
  data.fill(255, 0, changed * 3);
  await sharp(data, { raw: { width: 20, height: 10, channels: 3 } })
    .png()
    .toFile(nodePath.join(folder, `qa-${view}.png`));
}

/** Base and head with the views `same`, `edge` (2 pixels) and `moved` (3). */
async function pair(): Promise<{ base: string; head: string }> {
  const [base, head] = [side(), side()];
  await writePlate(base, "same");
  await writePlate(head, "same");
  await writePlate(base, "edge");
  // 2 of 200 pixels: at the share, not over it
  await writePlate(head, "edge", 2);
  await writePlate(base, "moved");
  await writePlate(head, "moved", 3);
  return { base, head };
}

describe("compare", () => {
  test("names the view that differs and writes its three images", async () => {
    const { base, head } = await pair();
    const report = nodePath.join(root, "report");
    const results = await compare(base, head, TOLERANCE, report);
    expect(results.map((r) => [r.view, r.differs, r.differing])).toEqual([
      ["edge", false, 2],
      ["moved", true, 3],
      ["same", false, 0],
    ]);
    expect(results[1]).toMatchObject({ max: 165, share: 0.015 });
    expect(results[1].mean).toBeCloseTo((3 * 165) / 200, 9);
    for (const kind of ["base", "head", "diff"]) {
      expect(existsSync(nodePath.join(report, `moved.${kind}.png`))).toBe(true);
    }
    expect(existsSync(nodePath.join(report, "edge.diff.png"))).toBe(false);
  });

  test("a view rendered on one side only is an error, either side", async () => {
    const { base, head } = await pair();
    await writePlate(base, "only-base", 0, 9);
    await expect(compare(base, head, TOLERANCE, null)).rejects.toThrow(
      "same views (only-base)"
    );
    await expect(compare(head, base, TOLERANCE, null)).rejects.toThrow(
      "same views (only-base)"
    );
  });

  test("a blank plate is an error", async () => {
    const [base, head] = [side(), side()];
    await writePlate(base, "a");
    await writePlate(head, "a", 0, 0);
    await expect(compare(base, head, TOLERANCE, null)).rejects.toThrow(
      "the plate of a is blank"
    );
  });

  test("two views with the same pixels are an error", async () => {
    const [base, head] = [side(), side()];
    for (const dir of [base, head]) {
      await writePlate(dir, "first", 0, 4);
      await writePlate(dir, "second", 0, 4);
    }
    await expect(compare(base, head, TOLERANCE, null)).rejects.toThrow(
      "first and second are the same picture"
    );
  });
});

test("every tier 1 view is a committed QA view", () => {
  expect(TIER1_VIEWS.length).toBe(8);
  for (const view of TIER1_VIEWS) {
    expect(existsSync(nodePath.join("qa", "views", `${view}.json`))).toBe(true);
  }
});
