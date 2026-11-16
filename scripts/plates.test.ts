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
import {
  claimedViews,
  comparability,
  compare,
  conclude,
  exitOf,
  reportOf,
  TIER1_VIEWS,
  unclaimed,
} from "./plates";
import type { ViewResult } from "./plates";

const TOLERANCE = { level: 24, mean: 1000, share: 0.01 };
const TIER = { name: "tier1" as const, tolerance: TOLERANCE };
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

  test("a view differs by the mean alone", async () => {
    const { base, head } = await pair();
    const results = await compare(
      base,
      head,
      { level: 24, mean: 1, share: 1 },
      null
    );
    // edge: 2 × 165 / 200 = 1.65 on average
    expect(results.map((r) => r.differs)).toEqual([true, true, false]);
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

  test("a folder without a plate is an error, not zero differing views", async () => {
    const { base } = await pair();
    await expect(compare(base, side(), TOLERANCE, null)).rejects.toThrow(
      "no plate was rendered"
    );
    await expect(compare(side(), side(), TOLERANCE, null)).rejects.toThrow(
      "no plate was rendered"
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

describe("claimedViews", () => {
  const views = ["rooftops", "shore-eye", "street-crossings", "across-400"];

  test("no Snapshots section: the PR claims no change", () => {
    expect(claimedViews("A refactor.\n\n## Notes\nrooftops", views)).toBeNull();
    // the heading in running text or at another level is not the section
    expect(claimedViews("see `## Snapshots` below", views)).toBeNull();
    expect(claimedViews("### Snapshots\nrooftops", views)).toBeNull();
  });

  test("the heading alone names no view", () => {
    expect(claimedViews("## Snapshots\n\nOpen the preview.", views)).toEqual(
      []
    );
  });

  test("the views named under it, up to the next heading", () => {
    const body = [
      "Intro naming across-400.",
      "## Snapshots\r",
      "- `rooftops`: the eaves moved",
      "- shore-eye, the bank",
      "### Details",
      "street-crossings-comic, which is another view",
      "## Not done",
      "across-400",
    ].join("\n");
    expect(claimedViews(body, views)).toEqual(["rooftops", "shore-eye"]);
  });

  test("a name is a word of its own", () => {
    expect(
      claimedViews("## Snapshots\nstreet-crossings (the kerbs)", views)
    ).toEqual(["street-crossings"]);
    expect(claimedViews("## Snapshots\nxrooftops rooftops2", views)).toEqual(
      []
    );
  });
});

const RESULTS: ViewResult[] = [
  { view: "same", differs: false, differing: 0, share: 0, max: 3, mean: 0.01 },
  {
    view: "moved",
    differs: true,
    differing: 812,
    share: 0.2 / 100 + 3e-5,
    max: 97,
    mean: 0.25,
  },
  {
    view: "meant",
    differs: true,
    differing: 40,
    share: 1e-4,
    max: 50,
    mean: 0,
  },
];

describe("exitOf", () => {
  test("a differing view no claim names fails", () => {
    expect(exitOf(RESULTS, null)).toBe(1);
    expect(exitOf(RESULTS, [])).toBe(1);
    expect(exitOf(RESULTS, ["meant"])).toBe(1);
    expect(unclaimed(RESULTS, ["meant"])).toEqual(["moved"]);
  });

  test("every differing view named passes; so does none differing", () => {
    expect(exitOf(RESULTS, ["moved", "meant", "same"])).toBe(0);
    expect(exitOf(RESULTS.slice(0, 1), null)).toBe(0);
    expect(unclaimed(RESULTS.slice(0, 1), null)).toEqual([]);
  });
});

describe("comparability", () => {
  test("both held: compared", () => {
    expect(
      comparability({ headHeld: true, baseHeld: true, baseKnowsPlates: true })
    ).toEqual({ compare: true });
  });

  test("an unheld head fails, whatever the base", () => {
    for (const baseHeld of [true, false]) {
      for (const baseKnowsPlates of [true, false]) {
        expect(
          comparability({ headHeld: false, baseHeld, baseKnowsPlates })
        ).toMatchObject({ compare: false, exit: 2 });
      }
    }
  });

  test("an unheld base that has the plates fails", () => {
    expect(
      comparability({ headHeld: true, baseHeld: false, baseKnowsPlates: true })
    ).toMatchObject({ compare: false, exit: 2 });
  });

  test("only a base from before the plates is let through, uncompared", () => {
    expect(
      comparability({ headHeld: true, baseHeld: false, baseKnowsPlates: false })
    ).toMatchObject({ compare: false, exit: 0 });
  });
});

/** `conclude`'s input over a fresh pair, each side held or not. */
const args = async (claims: string[] | null, held = [true, true]) => {
  const { base, head } = await pair();
  if (!held[0] || !held[1]) {
    for (const [dir, h] of [
      [base, held[0]],
      [head, held[1]],
    ] as const) {
      writeFileSync(
        nodePath.join(dir, "run.json"),
        JSON.stringify({ adapter: "test adapter", held: h })
      );
    }
  }
  return {
    base,
    head,
    baseName: "aaaaaaaa",
    headName: "bbbbbbbb",
    baseKnowsPlates: true,
    tier: TIER,
    claims: () => claims,
    report: null,
  };
};

describe("conclude", () => {
  test("a differing view nobody named: exit 1, and the report says which", async () => {
    const { exit, markdown } = await conclude(await args(null));
    expect(exit).toBe(1);
    expect(markdown).toContain("1 of 3 views differ");
    expect(markdown).toContain("**failed** on `moved`");
  });

  test("the differing view named: exit 0", async () => {
    const { exit, markdown } = await conclude(await args(["moved"]));
    expect(exit).toBe(0);
    expect(markdown).toContain("reported, not failed");
  });

  test("the claims are asked of the views rendered", async () => {
    let asked: readonly string[] = [];
    await conclude({
      ...(await args(null)),
      claims: (views) => {
        asked = views;
        return null;
      },
    });
    expect([...asked].toSorted()).toEqual(["edge", "moved", "same"]);
  });

  test("an unheld head: exit 2, nothing compared", async () => {
    const { exit, markdown } = await conclude(await args(null, [true, false]));
    expect(exit).toBe(2);
    expect(markdown).toContain("not compared — **failed**");
    expect(markdown).toContain("the head was not held still");
  });

  test("an unheld base with the plates: exit 2", async () => {
    const { exit, markdown } = await conclude(await args(null, [false, true]));
    expect(exit).toBe(2);
    expect(markdown).toContain("the `still` probe was lost");
  });

  test("an unheld base from before the plates: exit 0, and not called the same", async () => {
    const { exit, markdown } = await conclude({
      ...(await args(null, [false, true])),
      baseKnowsPlates: false,
    });
    expect(exit).toBe(0);
    expect(markdown).toContain("## Plates, tier1: not compared\n");
    expect(markdown).not.toContain("failed");
    expect(markdown).not.toContain("the picture is the same");
  });
});

describe("reportOf", () => {
  const opts = {
    base: "aaaaaaaa",
    head: "bbbbbbbb",
    tier: "tier1" as const,
    adapter: "google swiftshader",
    tolerance: { level: 3, mean: 0.1, share: 1e-5 },
  };

  test("a PR without the section fails on each differing view", () => {
    const report = reportOf(RESULTS, { ...opts, claimed: null });
    expect(report).toContain("## Plates, tier1: 2 of 3 views differ");
    expect(report).toContain("**failed** on `moved`, `meant`");
    expect(report).toContain(
      "| `moved` | **differs, not named** | 812 | 0.203 % | 97 | 0.250 |"
    );
    expect(report).toContain("| `same` | same | 0 | 0.000 % | 3 | 0.010 |");
    expect(report).toContain("above 3 of 255");
    expect(report).toContain("above 0.001 % of its pixels");
    expect(report).toContain("above 0.1 of 255 on average");
    expect(report).toContain("plates-report");
  });

  test("with the section, a view it does not name still fails", () => {
    const report = reportOf(RESULTS, { ...opts, claimed: ["meant"] });
    expect(report).toContain("**failed**: `moved` differs and is not named");
    expect(report).toContain("| `meant` | differs, named |");
    expect(report).toContain("| `moved` | **differs, not named** |");
  });

  test("every differing view named: reported, not failed", () => {
    const report = reportOf(RESULTS, { ...opts, claimed: ["meant", "moved"] });
    expect(report).toContain("reported, not failed");
    expect(report).not.toContain("**failed**");
    expect(report).not.toContain("not named");
  });

  test("no differing view: the picture is the same", () => {
    const report = reportOf(RESULTS.slice(0, 1), { ...opts, claimed: null });
    expect(report).toContain("0 of 1 views differ");
    expect(report).toContain("the picture is the same");
    expect(report).not.toContain("plates-report");
  });
});

test("every tier 1 view is a committed QA view", () => {
  expect(TIER1_VIEWS.length).toBe(8);
  for (const view of TIER1_VIEWS) {
    expect(existsSync(nodePath.join("qa", "views", `${view}.json`))).toBe(true);
  }
});
