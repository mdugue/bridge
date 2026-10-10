import { expect, test } from "bun:test";
import { fenceGeometry } from "../lib/city/fences";
import { checkJoins, type HeightAt } from "../lib/city/ground-join";
import { kerbGeometry } from "../lib/city/kerbs";
import { stairGeometry } from "../lib/city/stairs";
import { wallGeometry } from "../lib/city/walls";
import {
  JOIN_PARTS,
  type JoinPart,
  measureJoins,
  missShare,
} from "./ground-joins";

const offset = { cx: 0, cy: 0 };

/** A smoothed street: the road north of y = 0 at 100 m, the pavement
 *  rising 4 cm over the first half metre south of it (the DGM's kerb). */
const street: HeightAt = (_x, y) =>
  y >= 0 ? 100 : 100 + 0.04 * Math.min(1, -y / 0.5);

/** A retaining wall's ground: 100 m south, 104 m north, the DGM's ramp
 *  between y = −0.5 and 1.5. */
const bank: HeightAt = (_x, y) =>
  100 + 4 * Math.min(1, Math.max(0, (y + 0.5) / 2));

test("every builder's joins hold on the ground it stood on", () => {
  // Kerbs along x, the road on the left (north).
  const kerbs = kerbGeometry(
    [
      [
        [0, 0],
        [20, 0],
      ],
    ],
    street,
    offset
  );
  const k = checkJoins(kerbs?.joins ?? [], street);
  expect(k.edges).toBeGreaterThan(0);
  expect(k.misses).toEqual([]);

  const wall = wallGeometry(
    [
      {
        coords: [
          [-20, 0],
          [40, 0],
        ],
        h: 4,
        kind: "retaining_wall",
      },
    ],
    bank,
    offset,
    { snapToStep: true }
  );
  const w = checkJoins(wall?.joins ?? [], bank);
  expect(w.edges).toBeGreaterThan(0);
  expect(w.misses).toEqual([]);

  const fence = fenceGeometry(
    [
      {
        coords: [
          [0, 5],
          [20, 5],
        ],
        h: 1.2,
        type: "railing",
      },
    ],
    [],
    bank,
    offset
  );
  const f = checkJoins(fence?.joins ?? [], bank);
  expect(f.feet).toBeGreaterThan(0);
  expect(f.misses).toEqual([]);

  // A flight up the bank, the ground beside it a metre above its treads.
  const cut: HeightAt = (x, y) =>
    (bank(x, y) ?? 0) + (Math.abs(x - 10) > 2 ? 1 : 0);
  const stairs = stairGeometry(
    {
      coords: [
        [10, -1],
        [10, 2],
      ],
      n: 20,
      w: 4,
      z: [100, 104],
    },
    offset,
    { groundAt: cut }
  );
  const s = checkJoins(stairs?.joins ?? [], cut);
  expect(s.feet).toBeGreaterThan(0);
  expect(s.misses.filter((m) => m.join.kind === "foot")).toEqual([]);
});

/**
 * The share of joins that miss on the spawn tile (and the parts of its
 * neighbours it reads), per part (ADR 0035): the measured state, a little
 * above it. A change that floats a part or stands a step on the ground
 * (the kerb stood a second step on the pavement: 32 % of its joins;
 * before ADR 0035's audit the walls missed 3.5 %, the stairs 4.5 %, the
 * fences 1.6 %)
 * fails here. The doors' misses (0.8 % at first bake) are sills at the
 * top of a mapped flight of steps, whose ground the stairs lower; the
 * shopfronts' (0.36 % at first bake) a riser whose ground dips below
 * the line between its wall's two ends. The rails, trams and riverside
 * were built in the viewer until plan 074 part A baked them, and came with
 * their misses (measured at first bake, 2026-10-10): the rails' are the
 * polygon platforms' fascia (down to the ground at each outline vertex
 * only, straight between them: 38 % of their feet site-wide — dips, and
 * platforms on a viaduct, clamped to the ground at its ends) and the
 * ballast yards' fascia over a dip between two of its 6 m samples (3.6 %);
 * the trams' a lawn or ballast strip's downhill edge across a slope and
 * street rails over the ground's dips between their 2 m samples. Here:
 * rails 16.9 % (10.5 % over the site), trams 0.31 % (0.59 %), riverside
 * none (the pontoons float; piles, groyne flanks, gangways). Lower a
 * budget when a fix lowers its share; raising one needs a reason in the
 * commit. `bun scripts/ground-joins.ts` prints the table and the worst
 * places for the whole site.
 */
const BUDGET: Record<JoinPart, number> = {
  kerbs: 0.003,
  walls: 0.007,
  stairs: 0.001,
  fences: 0.003,
  sheds: 0.001,
  doors: 0.01,
  shopfronts: 0.005,
  plinths: 0.01,
  rails: 0.175,
  tram: 0.004,
  riverside: 0.001,
};

/** The tile a part is measured on where the spawn tile has none of it:
 *  the spawn tile's rails are line-mapped platforms (a ribbon at platform
 *  height: no joins), so the rails are measured on the tile west of it,
 *  the Neustadt's yards and platforms. The lines' levels are solved per
 *  piece here (`measureJoins` without the site's): over the site the
 *  trams' share is the same within 0.01 %. */
const MEASURED_ON: Partial<Record<JoinPart, string>> = {
  rails: "33410_5656_2_sn",
};

test("the committed parts meet the ground within their budgets", async () => {
  const spawnParts = JOIN_PARTS.filter((p) => !MEASURED_ON[p]);
  const reports = {
    ...(await measureJoins(
      ["33412_5656_2_sn"],
      undefined,
      undefined,
      spawnParts
    )),
  };
  for (const [part, tile] of Object.entries(MEASURED_ON)) {
    Object.assign(
      reports,
      await measureJoins([tile], undefined, undefined, [part as JoinPart])
    );
  }
  for (const part of JOIN_PARTS) {
    const r = reports[part];
    expect(r).toBeDefined();
    if (!r) {
      continue;
    }
    expect(r.edges + r.feet).toBeGreaterThan(0);
    // a failure names the part and its share
    const share = missShare(r);
    expect({ part, share: share <= BUDGET[part] ? "within" : share }).toEqual({
      part,
      share: "within",
    });
  }
}, 120_000);
