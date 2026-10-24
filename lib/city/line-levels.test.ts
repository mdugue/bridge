import { expect, test } from "bun:test";
import { bridgeDecks } from "./decks";
import type { BridgeFeature } from "./features";
import { runLevelAt } from "./levels";
import { type LinePiece, pieceSamples, solvePieces } from "./line-levels";

const offset = { cx: 0, cy: 0 };
/** An embankment at 117.5 along y = 0 with a 120 m gap (the street the
 *  DGM shows under a viaduct) from x = 180 to 300. */
const heightAt = (x: number) => (x >= 180 && x <= 300 ? 111.5 : 117.5);

/** The levels of `pieces[k]` at its samples, decoded as the layer reads
 *  them. */
function levelsOf(pieces: LinePiece[], k: number, decks: BridgeFeature[]) {
  const runs = solvePieces(pieces, {
    decks: bridgeDecks(decks, offset),
    heightAt,
    offset,
  })[k].runs;
  const pts = pieceSamples(pieces[k]);
  const d = pts.map((p) => p[0] - pts[0][0]);
  return pts.map((p, i) => ({ x: p[0], level: runLevelAt(runs, d, i) }));
}

test("a piece cut at a seam inside a gap sees the gap whole", () => {
  // the bake cut the line at the tile edge x = 240, in the middle of the
  // gap: alone, the west piece ends low and cannot tell a gap from a ramp
  const west: LinePiece = {
    coords: [
      [0, 0],
      [240, 0],
    ],
    line: "rail",
  };
  const east: LinePiece = {
    coords: [
      [240, 0],
      [500, 0],
    ],
    line: "rail",
  };
  const alone = levelsOf([west], 0, []);
  expect(alone.find((s) => s.x === 220)?.level).toBeNull();
  const joined = levelsOf([west, east], 0, []);
  expect(joined.find((s) => s.x === 220)?.level).toEqual({
    mode: "span",
    y: 117.5,
  });
});

test("a track along a deck's edge rides it where it strays past the outline", () => {
  // a tram way OSM puts on the bridge, a metre beside the DLM's outline
  const deck: BridgeFeature = {
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [180, 1],
          [300, 1],
          [300, 10],
          [180, 10],
          [180, 1],
        ],
      ],
    },
    properties: { deck: [117.5, 117.5, 117.5, 117.5], kind: "road" },
  };
  const tram: LinePiece = {
    coords: [
      [0, 0],
      [500, 0],
    ],
    line: "tram",
    prefer: "deck",
  };
  const at = levelsOf([tram], 0, [deck]).find((s) => s.x === 240);
  expect(at?.level?.mode).toBe("deck");
});

test("a line the DGM carries over another on its bridge crosses on a span", () => {
  // a tram on an embankment that crosses a rail at x = 250: the DGM keeps
  // the embankment over the rail, as Hamburg's keeps its bridges
  const crossing = (x: number, y: number) => {
    if (Math.abs(x - 250) > 4) {
      return 110;
    }
    return Math.max(110, 116 - Math.max(Math.abs(y) - 60, 0) * 0.04);
  };
  const rail: LinePiece = {
    coords: [
      [0, 0],
      [500, 0],
    ],
    line: "rail",
  };
  const tram: LinePiece = {
    coords: [
      [250, -300],
      [250, 300],
    ],
    line: "tram",
  };
  const solved = solvePieces([rail, tram], {
    decks: [],
    heightAt: crossing,
    offset,
  });
  const pts = pieceSamples(tram);
  const d = pts.map((p) => p[1] - pts[0][1]);
  const at = pts.findIndex((p) => p[1] === 0);
  expect(runLevelAt(solved[1].runs, d, at)?.mode).toBe("span");
  // away from the rail it is on the ground
  expect(runLevelAt(solved[1].runs, d, at + 20)).toBeNull();
  // the rail below passes under it (a cut through the kept embankment),
  // never over it
  expect(solved[0].runs.some((r) => r[2] === "s")).toBe(false);
});
