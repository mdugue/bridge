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
 * the line between its wall's two ends. Lower a budget when a fix lowers its share; raising one
 * needs a reason in the commit. `bun scripts/ground-joins.ts` prints the
 * table and the worst places for the whole site.
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
};

test("the committed parts meet the ground within their budgets", async () => {
  const reports = await measureJoins(["33412_5656_2_sn"]);
  for (const part of JOIN_PARTS) {
    const r = reports[part];
    expect(r.edges + r.feet).toBeGreaterThan(0);
    // a failure names the part and its share
    const share = missShare(r);
    expect({ part, share: share <= BUDGET[part] ? "within" : share }).toEqual({
      part,
      share: "within",
    });
  }
}, 60_000);
