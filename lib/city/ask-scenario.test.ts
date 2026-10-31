import { expect, test } from "bun:test";
import { knowledgeOf } from "./ask-knowledge";
import { floodAffected, shadowAnswer } from "./ask-scenario";
import { latLngToUtm } from "./crs";
import { riverOf, SCENARIO_NOTE } from "./scenario";
import type { StadtwissenIndex, WissenTile } from "./stadtwissen";

const EPSG = 25_833;
const dresden = riverOf("dresden")!.gauges.find((g) => g.name === "Dresden")!;
const G = latLngToUtm(EPSG, dresden.lat, dresden.lng)!;

const INDEX: StadtwissenIndex = {
  epsg: EPSG,
  site: "dresden",
  sources: {},
  tiles: [{ id: "t", file: "t.json" }],
  landmarks: [
    {
      id: "Q1",
      name: "Am Ufer",
      tile: "t",
      x: G.x + 40,
      y: G.y,
      z: 108,
      h: 20,
      links: 1,
      objects: [],
    },
  ],
};
const TILE: WissenTile = {
  tile: "t",
  monuments: [],
  buildings: [
    { id: "a", name: "Tief", x: G.x, y: G.y + 10, z: 105 },
    { id: "b", addr: "Ufer 2", x: G.x, y: G.y + 30, z: 111 },
    { id: "c", name: "Trocken", x: G.x, y: G.y + 50, z: 120 },
    { id: "d", x: G.x, y: G.y + 70, z: 112 },
    // a base no flood reaches: a fault of the data
    { id: "e", name: "Falsch", x: G.x, y: G.y + 90, z: 40 },
  ],
};
const K = knowledgeOf(INDEX, [TILE]);

test("a flood counts what stands below its water, deepest first, and says it is a model", () => {
  const r = floodAffected(K, "dresden", EPSG, { ereignis: "2002" });
  expect(r.pegel_cm).toBe(940);
  expect(r.gebaeude_unter_wasser).toBe(3);
  expect(r.nach_tiefe).toEqual({
    bis_0_5_m: 1,
    von_0_5_bis_2_m: 1,
    ueber_2_m: 1,
  });
  const named = r.tiefste_benannte as { name: string }[];
  expect(named.map((n) => n.name)).toEqual(["Tief", "Ufer 2"]);
  expect((r.wahrzeichen as { id: string }[])[0].id).toBe("Q1");
  expect(r.hinweis).toBe(SCENARIO_NOTE);
});

test("a radius keeps to its circle; a city without gauges says so", () => {
  const r = floodAffected(K, "dresden", EPSG, {
    pegel_cm: 940,
    x: G.x,
    y: G.y,
    radius: 50,
  });
  expect(r.gebaeude_gesamt).toBe(3);
  expect(
    floodAffected(K, "hamburg", 25_832, { pegel_cm: 900 }).fehler
  ).toBeTruthy();
  expect(floodAffected(K, "dresden", EPSG, {}).ereignisse).toBeTruthy();
});

test("a shadow study names the neighbour north of a tower in winter", () => {
  const r = shadowAnswer(K, EPSG, {
    x: G.x,
    y: G.y - 20,
    breite: 10,
    tiefe: 10,
    hoehe: 40,
    drehung: 0,
    datum: "2026-12-21",
  });
  const shaded = r.nachbarn_im_schatten as {
    name: string;
    stunden: string[];
  }[];
  expect(shaded.map((s) => s.name)).toContain("Tief");
  // the unnamed one is never named
  expect(JSON.stringify(r)).not.toContain('"d"');
  expect(r.hinweis).toBe(SCENARIO_NOTE);
});
