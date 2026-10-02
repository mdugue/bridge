import { expect, test } from "bun:test";
import {
  encodeRuns,
  type Level,
  type LevelSample,
  lineLevels,
  runLevelAt,
} from "./levels";

/** A line sampled every 4 m: the ground and the decks per sample from
 *  functions of the distance. */
function line(
  length: number,
  ground: (d: number) => number,
  decks: (d: number) => number[] = () => []
): LevelSample[] {
  const out: LevelSample[] = [];
  for (let d = 0; d <= length; d += 4) {
    out.push({ d, ground: ground(d), decks: decks(d) });
  }
  return out;
}

const RAIL = { grade: 0.04 };
const modeAt = (levels: (Level | null)[], samples: LevelSample[], d: number) =>
  levels[samples.findIndex((s) => s.d === d)];

test("a line keeps to the level it can drive", () => {
  const cases: {
    name: string;
    samples: LevelSample[];
    at: number;
    expected: Level;
  }[] = [
    {
      // a flyover: the lower line passes under the upper line's deck
      name: "under a deck it passes beneath, it stays on the ground",
      samples: line(
        200,
        () => 116,
        (d) => (d >= 80 && d <= 120 ? [123] : [])
      ),
      at: 100,
      expected: { mode: "ground", y: 116 },
    },
    {
      // the embankment at 123 either side, the deck carrying it over a
      // street the DGM shows at 116
      name: "over a deck its embankment leads onto, it rides the deck",
      samples: line(
        200,
        (d) => (d >= 80 && d <= 120 ? 116 : 123),
        (d) => (d >= 80 && d <= 120 ? [123] : [])
      ),
      at: 100,
      expected: { mode: "deck", y: 123 },
    },
    {
      // the DGM's gap under a viaduct runs on 60 m past the deck's outline
      name: "over the gap beyond a deck's outline, it spans",
      samples: line(
        300,
        (d) => (d >= 80 && d <= 200 ? 111.5 : 117.5),
        (d) => (d >= 80 && d <= 140 ? [117.5] : [])
      ),
      at: 172,
      expected: { mode: "span", y: 117.5 },
    },
    {
      // the fill the DGM puts under a deck: a hump in the passage
      name: "through a fill under a deck, it cuts",
      samples: line(200, (d) => (d >= 92 && d <= 108 ? 117 : 111)),
      at: 100,
      expected: { mode: "cut", y: 111 },
    },
    {
      // a deck end high above lower ground that never comes back up: the
      // approach (lib/city/bridge.ts) meets it, not the levels
      name: "past a deck end onto lower ground for good, it stays on the ground",
      samples: line(
        300,
        (d) => (d < 100 ? 120 : 114),
        (d) => (d < 100 ? [120] : [])
      ),
      at: 200,
      expected: { mode: "ground", y: 114 },
    },
  ];
  for (const c of cases) {
    const got = modeAt(lineLevels(c.samples, RAIL), c.samples, c.at);
    expect({ name: c.name, mode: got?.mode, y: got?.y.toFixed(1) }).toEqual({
      name: c.name,
      mode: c.expected.mode,
      y: c.expected.y.toFixed(1),
    });
  }
});

test("a gap's sloped sides belong to the gap, not to the line", () => {
  // the DGM rounds the gap's edges into 2 m-per-step ramps
  const samples = line(240, (d) => {
    if (d < 100 || d > 140) {
      return 113;
    }
    return Math.max(107, 113 - Math.min(d - 100, 140 - d) / 2);
  });
  const levels = lineLevels(samples, { grade: 0.08 });
  for (const d of [104, 120, 136]) {
    expect(modeAt(levels, samples, d)).toEqual({ mode: "span", y: 113 });
  }
});

test("what the source says decides between two levels as good", () => {
  // a deck flush with the ground: a way OSM puts on the bridge rides it,
  // one it does not keeps to the ground
  const samples = line(
    100,
    () => 110,
    (d) => (d >= 40 && d <= 60 ? [110.4] : [])
  );
  expect(
    modeAt(lineLevels(samples, { grade: 0.08, prefer: "deck" }), samples, 52)
      ?.mode
  ).toBe("deck");
  expect(
    modeAt(lineLevels(samples, { grade: 0.08, prefer: "ground" }), samples, 52)
      ?.mode
  ).toBe("ground");
});

test("the runs a build bakes give the layer back every level off the ground", () => {
  const samples = line(
    300,
    (d) => (d >= 80 && d <= 200 ? 111.5 : 117.5),
    (d) => (d >= 80 && d <= 140 ? [117.5] : [])
  );
  const levels = lineLevels(samples, RAIL);
  const runs = encodeRuns(levels);
  const d = samples.map((s) => s.d);
  samples.forEach((_, i) => {
    const level = levels[i];
    const back = runLevelAt(runs, d, i);
    if (level?.mode === "ground") {
      expect(back).toBeNull();
    } else {
      expect(back?.mode).toBe(level?.mode ?? "ground");
      expect(back?.y ?? 0).toBeCloseTo(level?.y ?? 0, 1);
    }
  });
});
