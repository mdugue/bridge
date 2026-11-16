/**
 * What the specs hand the scene (city-walk.spec.ts, the census in
 * ledger.spec.ts): a planner's export built in the spec, never a committed
 * file, and the answer for Dresden's live bicycle counts, so no spec waits
 * on the city's server.
 */
import { Document, WebIO } from "@gltf-transform/core";

/**
 * A design as a planner's export: a 40 × 30 m block, 20 m high (x east,
 * y up, z south), under a node at `at` — the Land's coordinates, NHN.
 */
export async function designBlockGlb(at: [number, number, number]) {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const [x0, x1, y0, y1, z0, z1] = [-20, 20, 0, 20, -15, 15];
  const c = [
    [x0, y0, z0],
    [x1, y0, z0],
    [x1, y0, z1],
    [x0, y0, z1],
    [x0, y1, z0],
    [x1, y1, z0],
    [x1, y1, z1],
    [x0, y1, z1],
  ];
  const faces = [
    [4, 7, 6, 5],
    [0, 1, 2, 3],
    [3, 2, 6, 7],
    [1, 0, 4, 5],
    [2, 1, 5, 6],
    [0, 3, 7, 4],
  ];
  const positions = faces.flatMap(([a, b, d, e]) =>
    [a, b, d, a, d, e].flatMap((i) => c[i])
  );
  const accessor = doc
    .createAccessor()
    .setType("VEC3")
    .setArray(new Float32Array(positions))
    .setBuffer(buffer);
  const mesh = doc
    .createMesh("block")
    .addPrimitive(doc.createPrimitive().setAttribute("POSITION", accessor));
  doc
    .createScene()
    .addChild(doc.createNode("block").setTranslation(at).setMesh(mesh));
  return await new WebIO().writeBinary(doc);
}

/** The host of Dresden's bicycle counts (the WFS), as a route pattern. */
export const BIKE_COUNTS_ROUTE = "**/kommisdd.dresden.de/**";

/** The bicycle counts' answer: two counters on the spawn tile. */
export const BIKE_COUNTS_BODY = JSON.stringify({
  type: "FeatureCollection",
  features: [
    ["F01092", "Albertbrücke", 412_610, 5_657_020, 309, 482],
    ["F01093", "Glacisstraße", 412_900, 5_657_300, 0, 123],
  ].map(([id, name, x, y, w1, w2]) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: [x, y] },
    properties: {
      fremd_id: id,
      bezeichnung: name,
      lage: "",
      r1: "Richtung Nord",
      w1,
      r2: "Richtung Süd",
      w2,
      messzeit: "01.10.2026 07:00:00",
      winkel: 0,
      inaktiv: "0",
    },
  })),
});
