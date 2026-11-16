/** The compared plates' report and folder comparison (scripts/plates.ts). */
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import nodePath from "node:path";
import sharp from "sharp";
import { compare, reportOf, TIER1_VIEWS } from "./plates";
import type { ViewResult } from "./plates";

const TOLERANCE = { level: 24, share: 0.01 };
const dir = mkdtempSync(nodePath.join(tmpdir(), "plates-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** A 20 × 10 grey plate with `marked` pixels of its first row white. */
async function writePlate(folder: string, view: string, marked: number) {
  mkdirSync(folder, { recursive: true });
  const data = new Uint8Array(20 * 10 * 3).fill(90);
  data.fill(255, 0, marked * 3);
  await sharp(data, { raw: { width: 20, height: 10, channels: 3 } })
    .png()
    .toFile(nodePath.join(folder, `qa-${view}.png`));
}

describe("compare", () => {
  test("names the view that differs and writes its three images", async () => {
    const base = nodePath.join(dir, "base");
    const head = nodePath.join(dir, "head");
    const report = nodePath.join(dir, "report");
    await writePlate(base, "same", 0);
    await writePlate(head, "same", 0);
    await writePlate(base, "edge", 0);
    // 2 of 200 pixels: at the share, not over it
    await writePlate(head, "edge", 2);
    await writePlate(base, "moved", 0);
    await writePlate(head, "moved", 3);
    const results = await compare(base, head, TOLERANCE, report);
    expect(results.map((r) => [r.view, r.differs, r.differing])).toEqual([
      ["edge", false, 2],
      ["moved", true, 3],
      ["same", false, 0],
    ]);
    expect(results[1]).toMatchObject({ max: 165, share: 0.015 });
    for (const kind of ["base", "head", "diff"]) {
      expect(existsSync(nodePath.join(report, `moved.${kind}.png`))).toBe(true);
    }
    expect(existsSync(nodePath.join(report, "edge.diff.png"))).toBe(false);
  });

  test("a view rendered on one side only is an error", async () => {
    const base = nodePath.join(dir, "base2");
    const head = nodePath.join(dir, "head2");
    await writePlate(base, "a", 0);
    await writePlate(base, "b", 0);
    await writePlate(head, "a", 0);
    await expect(compare(base, head, TOLERANCE, null)).rejects.toThrow(
      "same views (b)"
    );
  });
});

describe("reportOf", () => {
  const results: ViewResult[] = [
    { view: "same", differs: false, differing: 0, share: 0, max: 3 },
    {
      view: "moved",
      differs: true,
      differing: 812,
      share: 0.2 / 100 + 3e-5,
      max: 97,
    },
  ];
  const opts = {
    base: "aaaaaaaa",
    head: "bbbbbbbb",
    tier: "tier1" as const,
    adapter: "google swiftshader",
    tolerance: TOLERANCE,
  };

  test("a PR that claims no change fails on a differing view", () => {
    const report = reportOf(results, { ...opts, claimsChange: false });
    expect(report).toContain("## Plates, tier1: 1 of 2 views differ");
    expect(report).toContain("**failed**");
    expect(report).toContain("| `moved` | **differs** | 812 | 0.203 % | 97 |");
    expect(report).toContain("| `same` | same | 0 | 0.000 % | 3 |");
    expect(report).toContain("plates-report");
  });

  test("a PR with a Snapshots section is reported, not failed", () => {
    const report = reportOf(results, { ...opts, claimsChange: true });
    expect(report).toContain("reported, not failed");
    expect(report).not.toContain("**failed**");
  });

  test("no differing view: the picture is the same", () => {
    const report = reportOf(results.slice(0, 1), {
      ...opts,
      claimsChange: false,
    });
    expect(report).toContain("0 of 1 views differ");
    expect(report).toContain("the picture is the same");
    expect(report).not.toContain("plates-report");
  });
});

test("every tier 1 view is a committed QA view", () => {
  for (const view of TIER1_VIEWS) {
    expect(existsSync(nodePath.join("qa", "views", `${view}.json`))).toBe(true);
  }
});
