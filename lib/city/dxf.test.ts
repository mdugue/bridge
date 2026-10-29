import { describe, expect, test } from "bun:test";
import { readDxf } from "./dxf";

/** A DXF from its groups, code and value per line pair. */
const dxf = (...groups: (string | number)[][]) =>
  `${groups.flatMap(([c, v]) => [String(c), String(v)]).join("\n")}\n`;

const header = (units: number) => [
  [0, "SECTION"],
  [2, "HEADER"],
  [9, "$INSUNITS"],
  [70, units],
  [0, "ENDSEC"],
];

const blocks = [
  [0, "SECTION"],
  [2, "BLOCKS"],
  [0, "BLOCK"],
  [2, "BAUM_LAUB"],
  [0, "CIRCLE"],
  [8, "0"],
  [10, 0],
  [20, 0],
  [40, 2.5],
  [0, "ENDBLK"],
  [0, "ENDSEC"],
];

/** A hatch of one polyline path per ring, on `layer`. */
function hatch(layer: string, rings: [number, number][][]) {
  return [
    [0, "HATCH"],
    [8, layer],
    [10, 0],
    [20, 0],
    [30, 0],
    [2, "SOLID"],
    [70, 1],
    [71, 0],
    [91, rings.length],
    ...rings.flatMap((ring) => [
      [92, 2],
      [72, 0],
      [73, 1],
      [93, ring.length],
      ...ring.flatMap(([x, y]) => [
        [10, x],
        [20, y],
      ]),
      [97, 0],
    ]),
    [75, 0],
    [76, 1],
    [98, 0],
  ];
}

function lwpolyline(layer: string, ring: [number, number][], space = 0) {
  return [
    [0, "LWPOLYLINE"],
    [8, layer],
    ...(space ? [[67, space]] : []),
    [90, ring.length],
    [70, 1],
    ...ring.flatMap(([x, y]) => [
      [10, x],
      [20, y],
    ]),
  ];
}

const square = (x0: number, y0: number, a: number): [number, number][] => [
  [x0, y0],
  [x0 + a, y0],
  [x0 + a, y0 + a],
  [x0, y0 + a],
];

const plan = (units = 6) =>
  dxf(
    ...header(units),
    ...blocks,
    [0, "SECTION"],
    [2, "ENTITIES"],
    ...hatch("L-RASEN", [square(0, 0, 20), square(5, 5, 4)]),
    ...lwpolyline("Pflaster Platz", square(30, 0, 10)),
    ...lwpolyline("Kante", square(50, 0, 10)),
    ...lwpolyline("Planrahmen", square(-100, -100, 400)),
    ...lwpolyline("Rasen", square(0, 50, 10), 1),
    [0, "CIRCLE"],
    [8, "Baum Bestand"],
    [10, 40],
    [20, 40],
    [30, 0],
    [40, 3],
    [0, "INSERT"],
    [8, "Pflanzung"],
    [2, "BAUM_LAUB"],
    [10, 45],
    [20, 40],
    [30, 0],
    [41, 1.2],
    [0, "3DFACE"],
    [8, "DGM Planung"],
    [10, 0],
    [20, 0],
    [30, 110],
    [11, 10],
    [21, 0],
    [31, 110.5],
    [12, 10],
    [22, 10],
    [32, 111],
    [13, 0],
    [23, 10],
    [33, 110.5],
    [0, "ENDSEC"],
    [0, "EOF"]
  );

describe("readDxf", () => {
  test("hatches are areas with their holes, classed by layer", () => {
    const { features } = readDxf(plan());
    const lawn = features.find((f) => f.kind === "area" && f.cls === "lawn");
    expect(lawn?.kind === "area" && lawn.rings.length).toBe(2);
  });

  test("a closed polyline is an area only on a layer that names a class", () => {
    const r = readDxf(plan());
    const paving = r.features.filter(
      (f) => f.kind === "area" && f.cls === "paving"
    );
    expect(paving).toHaveLength(1);
    expect(r.features.some((f) => f.kind === "area" && f.cls === null)).toBe(
      false
    );
    expect(r.unclassified).toContain("Kante");
  });

  test("frames and paper space are not the plan", () => {
    const r = readDxf(plan());
    const areas = r.features.filter((f) => f.kind === "area");
    // the lawn hatch and the paving: not the frame, not the paper-space lawn
    expect(areas).toHaveLength(2);
  });

  test("trees from a circle and from a block's circle, scaled", () => {
    const trees = readDxf(plan()).features.filter((f) => f.kind === "tree");
    expect(trees).toHaveLength(2);
    const crowns = trees.map((t) => (t.kind === "tree" ? t.crown : 0));
    expect(crowns[0]).toBeCloseTo(6, 9);
    expect(crowns[1]).toBeCloseTo(6, 9);
  });

  test("3D faces are a planned ground, quads in two triangles", () => {
    const mesh = readDxf(plan()).features.find((f) => f.kind === "mesh");
    expect(mesh?.kind === "mesh" && mesh.cls).toBe("terrain");
    expect(mesh?.kind === "mesh" && mesh.triangles).toHaveLength(2);
  });

  test("drawing units become metres", () => {
    const r = readDxf(plan(4));
    expect(r.unit).toBe(0.001);
    const paving = r.features.find(
      (f) => f.kind === "area" && f.cls === "paving"
    );
    expect(paving?.kind === "area" && paving.rings[0][1][0]).toBeCloseTo(
      0.04,
      9
    );
  });

  test("a bulge rounds a polyline's edge", () => {
    const text = dxf(
      [0, "SECTION"],
      [2, "ENTITIES"],
      [0, "LWPOLYLINE"],
      [8, "Wasser"],
      [90, 2],
      [70, 1],
      [10, 0],
      [20, 0],
      [42, 1],
      [10, 10],
      [20, 0],
      [42, 1],
      [0, "ENDSEC"],
      [0, "EOF"]
    );
    const water = readDxf(text).features[0];
    // two half circles: a round pond of 10 m, many points on its rim
    expect(water.kind === "area" && water.rings[0].length).toBeGreaterThan(10);
    if (water.kind === "area") {
      for (const [x, y] of water.rings[0]) {
        expect(Math.hypot(x - 5, y)).toBeCloseTo(5, 6);
      }
    }
  });

  /** A hatch on "Beet" of one edge path: a line, then an arc edge. */
  const halfDisc = (arc: (string | number)[][], extrusion = 1) =>
    dxf(
      [0, "SECTION"],
      [2, "ENTITIES"],
      [0, "HATCH"],
      [8, "Beet"],
      [230, extrusion],
      [91, 1],
      [92, 1],
      [93, 2],
      [72, 1],
      [10, 5],
      [20, 0],
      [11, -5],
      [21, 0],
      [72, 2],
      ...arc,
      [97, 0],
      [0, "ENDSEC"],
      [0, "EOF"]
    );

  test("arc edges, anticlockwise and clockwise (stored mirrored), on their side", () => {
    const ccw = [
      [10, 0],
      [20, 0],
      [40, 5],
      [50, 0],
      [51, 180],
      [73, 1],
    ];
    // the same upper half run clockwise: true angles 180 → 0, stored 180, 360
    const cw = [
      [10, 0],
      [20, 0],
      [40, 5],
      [50, 180],
      [51, 360],
      [73, 0],
    ];
    for (const arc of [ccw, cw]) {
      const [bed] = readDxf(halfDisc(arc)).features;
      expect(bed?.kind).toBe("area");
      if (bed?.kind === "area") {
        expect(Math.min(...bed.rings[0].map((p) => p[1]))).toBeGreaterThan(
          -1e-9
        );
        expect(Math.max(...bed.rings[0].map((p) => p[1]))).toBeCloseTo(5, 6);
      }
    }
  });

  test("a mirrored entity (extrusion 0, 0, −1) lands mirrored back", () => {
    const text = dxf(
      [0, "SECTION"],
      [2, "ENTITIES"],
      ...lwpolyline("Rasen", square(-412_310, 5_657_400, 10)),
      [210, 0],
      [220, 0],
      [230, -1],
      [0, "ENDSEC"],
      [0, "EOF"]
    );
    const [lawn] = readDxf(text).features;
    expect(lawn?.kind === "area" && lawn.rings[0][0][0]).toBeGreaterThan(
      412_000
    );
  });
});
