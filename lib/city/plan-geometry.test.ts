import { describe, expect, test } from "bun:test";
import { nestRings, type PlanFeature, planMesh } from "./plan-geometry";
import { PLAN_LOOKS, planClass } from "./plan-classes";

const square = (x0: number, y0: number, a: number) =>
  [
    [x0, y0],
    [x0 + a, y0],
    [x0 + a, y0 + a],
    [x0, y0 + a],
  ] as [number, number][];

/** Each triangle's normal's y (unnormalised) in the design frame. */
function normalsY(p: Float32Array): number[] {
  const out: number[] = [];
  for (let i = 0; i < p.length; i += 9) {
    const ux = p[i + 3] - p[i];
    const uz = p[i + 5] - p[i + 2];
    const vx = p[i + 6] - p[i];
    const vz = p[i + 8] - p[i + 2];
    out.push(uz * vx - ux * vz);
  }
  return out;
}

const flatGround = () => 100;

describe("planMesh", () => {
  test("an area lies on the ground, lifted by its class, facing up", () => {
    const mesh = planMesh(
      [{ kind: "area", cls: "lawn", rings: [square(0, 0, 10)] }],
      [0, 0],
      flatGround
    );
    const lawn = mesh.groups.find((g) => g.cls === "lawn");
    expect(lawn).toBeDefined();
    const p = lawn?.positions ?? new Float32Array();
    for (let i = 1; i < p.length; i += 3) {
      expect(p[i]).toBeCloseTo(100 + PLAN_LOOKS.lawn.lift, 4);
    }
    for (const ny of normalsY(p)) {
      expect(ny).toBeGreaterThan(0);
    }
    expect(mesh.undraped).toBe(0);
  });

  test("a large area is cut to a few metres, so it can follow the ground", () => {
    const mesh = planMesh(
      [{ kind: "area", cls: "paving", rings: [square(0, 0, 40)] }],
      [0, 0],
      (x) => 100 + x / 10
    );
    const p = mesh.groups[0].positions;
    expect(p.length / 9).toBeGreaterThan(100);
    // every vertex on its ground, lifted by its class
    for (let i = 0; i < p.length; i += 3) {
      expect(p[i + 1]).toBeCloseTo(100 + p[i] / 10 + PLAN_LOOKS.paving.lift, 4);
    }
  });

  test("the plan's own heights win over the ground (a planned level)", () => {
    const ring = square(0, 0, 4).map(([x, y]) => [x, y, 105] as const);
    const mesh = planMesh(
      [{ kind: "area", cls: "paving", rings: [ring] }],
      [0, 0],
      flatGround
    );
    expect(mesh.groups[0].positions[1]).toBeCloseTo(
      105 + PLAN_LOOKS.paving.lift,
      4
    );
  });

  test("without the ground, the lowest that was found", () => {
    const mesh = planMesh(
      [{ kind: "area", cls: "lawn", rings: [square(0, 0, 4)] }],
      [0, 0],
      (x, y) => (x === 0 && y === 0 ? 90 : null)
    );
    expect(mesh.undraped).toBeGreaterThan(0);
    expect(mesh.groups[0].positions[1]).toBeCloseTo(
      90 + PLAN_LOOKS.lawn.lift,
      4
    );
  });

  test("what is drawn into an area lies above it, whatever its class", () => {
    const mesh = planMesh(
      [
        { kind: "area", cls: "paving", rings: [square(2, 2, 4)] },
        { kind: "area", cls: "lawn", rings: [square(0, 0, 10)] },
      ],
      [0, 0],
      flatGround
    );
    const y = (cls: string) =>
      mesh.groups.find((g) => g.cls === cls)?.positions[1] ?? 0;
    expect(y("paving")).toBeGreaterThan(y("lawn"));
  });

  test("a hole stays open", () => {
    const mesh = planMesh(
      [
        {
          kind: "area",
          cls: "lawn",
          rings: [square(0, 0, 10), square(2, 2, 6)],
        },
      ],
      [0, 0],
      flatGround
    );
    const p = mesh.groups[0].positions;
    let area = 0;
    for (let i = 0; i < p.length; i += 9) {
      const ux = p[i + 3] - p[i];
      const uz = p[i + 5] - p[i + 2];
      const vx = p[i + 6] - p[i];
      const vz = p[i + 8] - p[i + 2];
      area += Math.abs(ux * vz - uz * vx) / 2;
    }
    expect(area).toBeCloseTo(100 - 36, 4);
  });

  test("coordinates about the origin: x east, z south", () => {
    const mesh = planMesh(
      [{ kind: "area", cls: "lawn", rings: [square(412_300, 5_657_420, 2)] }],
      [412_300, 5_657_420],
      flatGround
    );
    const p = mesh.groups[0].positions;
    const xs = [p[0], p[3], p[6]];
    const zs = [p[2], p[5], p[8]];
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...zs)).toBeLessThanOrEqual(0);
  });

  test("a tree stands at its spot, its crown and trunk", () => {
    const features: PlanFeature[] = [
      { kind: "tree", at: [10, 10], crown: 8, height: 12 },
    ];
    const mesh = planMesh(features, [0, 0], flatGround);
    const crown = mesh.groups.find((g) => g.cls === "tree")?.positions;
    const trunk = mesh.groups.find((g) => g.cls === "trunk")?.positions;
    expect(crown && trunk).toBeTruthy();
    let top = 0;
    let wide = 0;
    for (let i = 0; i < (crown?.length ?? 0); i += 3) {
      top = Math.max(top, crown?.[i + 1] ?? 0);
      wide = Math.max(wide, Math.abs((crown?.[i] ?? 0) - 10));
    }
    expect(top).toBeCloseTo(112, 6);
    expect(wide).toBeCloseTo(4, 6);
  });

  test("a planned building is a block on its lowest ground, walls facing out", () => {
    const mesh = planMesh(
      [{ kind: "area", cls: "building", rings: [square(0, 0, 10)], height: 9 }],
      [0, 0],
      (x) => 100 + x / 10
    );
    const p = mesh.groups.find((g) => g.cls === "building")?.positions;
    expect(p).toBeDefined();
    let low = Number.POSITIVE_INFINITY;
    let high = 0;
    for (let i = 1; i < (p?.length ?? 0); i += 3) {
      low = Math.min(low, p?.[i] ?? 0);
      high = Math.max(high, p?.[i] ?? 0);
    }
    expect(low).toBeCloseTo(100, 6);
    expect(high).toBeCloseTo(109, 6);
    // the wall along y = 0 (z = 0) faces south: +z
    const q = p ?? new Float32Array();
    for (let i = 0; i < q.length; i += 9) {
      const zs = [q[i + 2], q[i + 5], q[i + 8]];
      if (zs.every((z) => Math.abs(z) < 1e-6)) {
        const ux = q[i + 3] - q[i];
        const uy = q[i + 4] - q[i + 1];
        const vx = q[i + 6] - q[i];
        const vy = q[i + 7] - q[i + 1];
        expect(ux * vy - uy * vx).toBeGreaterThan(0);
      }
    }
  });

  test("a mesh keeps its own heights and faces up", () => {
    const mesh = planMesh(
      [
        {
          kind: "mesh",
          cls: "terrain",
          triangles: [
            [
              [0, 0, 110],
              [0, 10, 111],
              [10, 0, 110.5],
            ],
          ],
        },
      ],
      [0, 0],
      flatGround
    );
    const p = mesh.groups[0].positions;
    const byValue = (a: number, b: number) => a - b;
    expect([p[1], p[4], p[7]].sort(byValue)).toEqual(
      [110, 110.5, 111].map((v) => Math.fround(v))
    );
    expect(normalsY(p)[0]).toBeGreaterThan(0);
  });
});

describe("nestRings", () => {
  test("a ring inside another is its hole; one inside the hole an island", () => {
    const areas = nestRings([
      square(2, 2, 6),
      square(0, 0, 10),
      square(4, 4, 2),
    ]);
    expect(areas).toHaveLength(2);
    expect(areas[0]).toHaveLength(2);
    expect(areas[1]).toHaveLength(1);
  });
});

describe("planClass", () => {
  test("German and English names, the narrower first", () => {
    expect(planClass("L-RASEN")).toBe("lawn");
    expect(planClass("Wassergebundene Wegedecke")).toBe("gravel");
    expect(planClass("Spielplatz Sand")).toBe("sand");
    expect(planClass("Baum Bestand")).toBe("tree");
    expect(planClass("Parkplatz")).toBe("road");
    expect(planClass("Staudenbeet")).toBe("planting");
    expect(planClass("Betonpflaster")).toBe("paving");
    expect(planClass("Gebäude Neubau")).toBe("building");
    expect(planClass("Kante")).toBeNull();
    expect(planClass("L-STREET-PAVING")).toBe("road");
    expect(planClass("TREES_NEW")).toBe("tree");
  });
});
