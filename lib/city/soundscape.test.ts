import { describe, expect, test } from "bun:test";
import {
  advanceSteps,
  airCutoff,
  audible,
  BELL_REACH_M,
  BELL_TOWERS_MAX,
  bellStrokes,
  birdCall,
  birdsGain,
  classShares,
  cricketsGain,
  distanceGain,
  fountainGain,
  hourCrossed,
  humGain,
  leavesGain,
  localMs,
  mix,
  nearestOnLines,
  nearestWater,
  panFor,
  soundTileOf,
  SPEED_OF_SOUND,
  type SoundEnv,
  STRIKE_INTERVAL_S,
  STRIDE_M,
  stepSurface,
  strideFor,
  strokesFor,
  tramBellChance,
  waterGain,
  windGain,
  windSway,
} from "./soundscape";

/** A spring afternoon in a park on foot, the river 400 m away. */
const PARK: SoundEnv = {
  day: 120,
  fountainDistance: Number.POSITIVE_INFINITY,
  heightAboveGround: 1.7,
  minutes: 15 * 60,
  mode: "walk",
  near: { green: 0.7, road: 0.05, rail: 0, builtup: 0.1 },
  nightFactor: 0,
  skyView: 0.8,
  trees: 20,
  waterDistance: 400,
};

const at = (patch: Partial<SoundEnv>): SoundEnv => ({ ...PARK, ...patch });

describe("mix", () => {
  test("every level is a gain in 0..1", () => {
    for (const env of [
      PARK,
      at({ nightFactor: 1, day: 200 }),
      at({ heightAboveGround: 400, mode: "fly" }),
      at({ waterDistance: 0, fountainDistance: 0 }),
    ]) {
      for (const v of Object.values(mix(env))) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  test("the river rises as it comes near and is silent out of reach", () => {
    const levels = [0, 50, 100, 200, 259, 400].map((d) =>
      waterGain(at({ waterDistance: d }))
    );
    for (let i = 1; i < levels.length; i++) {
      expect(levels[i]).toBeLessThanOrEqual(levels[i - 1]);
    }
    expect(levels[0]).toBeGreaterThan(0.95);
    expect(levels.at(-1)).toBe(0);
    expect(waterGain(at({ waterDistance: Number.POSITIVE_INFINITY }))).toBe(0);
  });

  test("height takes the ear away from the river", () => {
    const ground = waterGain(at({ waterDistance: 80 }));
    const air = waterGain(at({ waterDistance: 80, heightAboveGround: 150 }));
    expect(air).toBeLessThan(ground);
  });

  test("birds are silent at night and sparse in winter", () => {
    expect(birdsGain(at({ nightFactor: 1 }))).toBe(0);
    expect(birdsGain(at({ day: 15 }))).toBeLessThan(birdsGain(PARK) / 2);
    expect(birdsGain(PARK)).toBeGreaterThan(0.3);
  });

  test("the dawn chorus in spring is louder than the spring afternoon", () => {
    const edge = {
      trees: 2,
      near: { green: 0.2, road: 0.2, rail: 0, builtup: 0.6 },
    };
    const dawn = birdsGain(
      at({ ...edge, minutes: 5.5 * 60, nightFactor: 0.2 })
    );
    expect(dawn).toBeGreaterThan(birdsGain(at({ ...edge, nightFactor: 0.2 })));
  });

  test("crickets only on warm summer nights near meadows", () => {
    const summerNight = at({ day: 200, nightFactor: 1 });
    expect(cricketsGain(summerNight)).toBeGreaterThan(0.5);
    expect(cricketsGain(at({ day: 200 }))).toBe(0);
    expect(cricketsGain(at({ day: 20, nightFactor: 1 }))).toBe(0);
    expect(
      cricketsGain({
        ...summerNight,
        near: { green: 0, road: 0.6, rail: 0, builtup: 0.4 },
      })
    ).toBe(0);
  });

  test("leaves rustle near trees in summer, hardly in winter, not from the air", () => {
    expect(leavesGain(PARK)).toBeGreaterThan(0.3);
    expect(leavesGain(at({ day: 20 }))).toBeLessThan(leavesGain(PARK) / 3);
    expect(leavesGain(at({ trees: 0 }))).toBe(0);
    expect(leavesGain(at({ heightAboveGround: 60 }))).toBe(0);
  });

  test("the wind grows with the open sky and with height", () => {
    const courtyard = windGain(at({ skyView: 0.2 }));
    const open = windGain(at({ skyView: 1 }));
    const high = windGain(at({ skyView: 1, heightAboveGround: 200 }));
    expect(courtyard).toBeLessThan(open);
    expect(open).toBeLessThan(high);
    // Without the sky view, a built-up place is less open.
    expect(
      windGain(
        at({ skyView: null, near: { green: 0, road: 0, rail: 0, builtup: 1 } })
      )
    ).toBeLessThan(windGain(at({ skyView: null })));
  });

  test("the city hums near roads, less at night", () => {
    const street = at({ near: { green: 0, road: 0.5, rail: 0, builtup: 0.5 } });
    expect(humGain(street)).toBeGreaterThan(humGain(PARK));
    expect(humGain({ ...street, nightFactor: 1 })).toBeLessThan(
      humGain(street)
    );
  });

  test("fountains run by day in the warm months only", () => {
    expect(fountainGain(at({ fountainDistance: 5 }))).toBeGreaterThan(0.5);
    expect(fountainGain(at({ fountainDistance: 5, day: 340 }))).toBe(0);
    expect(fountainGain(at({ fountainDistance: 5, minutes: 23 * 60 }))).toBe(0);
    expect(fountainGain(at({ fountainDistance: 100 }))).toBe(0);
  });
});

describe("footsteps", () => {
  test("a step every 0.75 m at walking pace", () => {
    expect(strideFor(1.4)).toBe(STRIDE_M);
    let carry = 0;
    let steps = 0;
    // 3.15 m at 1.5 m/s in 21 ticks
    for (let i = 0; i < 21; i++) {
      const r = advanceSteps(carry, 0.15, 0.1);
      carry = r.carry;
      steps += r.steps;
    }
    expect(steps).toBe(4);
  });

  test("the stride lengthens with speed so the cadence stays human", () => {
    for (const speed of [1.4, 5, 9, 27]) {
      const perSecond = speed / strideFor(speed);
      expect(perSecond).toBeGreaterThan(1.5);
      expect(perSecond).toBeLessThanOrEqual(2.8);
    }
  });

  test("standing still and jumping are silent", () => {
    expect(advanceSteps(0.5, 0, 0.1)).toEqual({ carry: 0.5, steps: 0 });
    expect(advanceSteps(0.5, 500, 0.1)).toEqual({ carry: 0, steps: 0 });
    expect(advanceSteps(0.5, 20, 3)).toEqual({ carry: 0, steps: 0 });
    // a slow frame is still a walk
    expect(advanceSteps(0, 9, 1).steps).toBe(2);
  });

  test("the paving raster decides, the class falls back", () => {
    const sett = 4;
    const asphalt = 1;
    const paving = 3;
    // carriageway sett, pavement slabs
    const byte = sett + paving * 8;
    expect(stepSurface(7, byte)).toBe("sett");
    expect(stepSurface(4, byte)).toBe("paving");
    // only the road is known: the pavement hears it too
    expect(stepSurface(4, asphalt)).toBe("asphalt");
    // nothing known: the class
    expect(stepSurface(1, 0)).toBe("grass");
    expect(stepSurface(6, 0)).toBe("gravel");
    expect(stepSurface(7, 0)).toBe("asphalt");
    // the parking bits never change the surface
    expect(stepSurface(7, 64 * 3 + sett)).toBe("sett");
  });
});

describe("bells", () => {
  const H = 3_600_000;
  test("a forward crossing of a full hour strikes it", () => {
    expect(hourCrossed(17.8 * H, 18.1 * H)).toBe(18);
    expect(hourCrossed(17.1 * H, 17.9 * H)).toBeNull();
    // exactly on the hour counts once
    expect(hourCrossed(17.5 * H, 18 * H)).toBe(18);
    expect(hourCrossed(18 * H, 18.5 * H)).toBeNull();
  });

  test("a long scrub strikes only the last hour; back or a new day strikes nothing", () => {
    expect(hourCrossed(9.5 * H, 14.2 * H)).toBe(14);
    expect(hourCrossed(18.1 * H, 17.8 * H)).toBeNull();
    expect(hourCrossed(10 * H, 34.5 * H)).toBeNull();
    expect(hourCrossed(23.5 * H, 24.2 * H)).toBe(0);
  });

  test("the local wall clock, whatever the zone", () => {
    const d = new Date(2026, 5, 1, 18, 0);
    expect(new Date(localMs(d)).getUTCHours()).toBe(18);
  });

  test("the hour's strokes: 1 to 12", () => {
    expect([0, 1, 6, 12, 13, 18, 23].map(strokesFor)).toEqual([
      12, 1, 6, 12, 1, 6, 11,
    ]);
  });

  test("each tower is delayed by its distance at 343 m/s", () => {
    const listener = { x: 0, y: 0 };
    // the Frauenkirche 80 m east, the Kreuzkirche 420 m south
    const strokes = bellStrokes(
      18,
      [
        { x: 0, y: -420, size: "large" },
        { x: 80, y: 0, size: "large" },
      ],
      listener
    );
    expect(strokes).toHaveLength(12);
    const first = strokes.filter((s) => s.tower === 1);
    const second = strokes.filter((s) => s.tower === 0);
    expect(first[0].at).toBeCloseTo(80 / SPEED_OF_SOUND, 6);
    expect(second[0].at).toBeCloseTo(420 / SPEED_OF_SOUND, 6);
    expect(first[1].at - first[0].at).toBeCloseTo(STRIKE_INTERVAL_S.large, 6);
    // the nearer bell is louder, brighter, and to the right (east)
    expect(first[0].gain).toBeGreaterThan(second[0].gain);
    expect(first[0].cutoff).toBeGreaterThan(second[0].cutoff);
    expect(panFor(first[0].bearing, 0)).toBeGreaterThan(0.7);
    expect(Math.abs(panFor(second[0].bearing, 0))).toBeLessThan(1e-9);
  });

  test("only the nearest towers within reach answer", () => {
    const towers = Array.from({ length: 8 }, (_, i) => ({
      x: 100 * (i + 1),
      y: 0,
      size: "small" as const,
    }));
    towers.push({ x: BELL_REACH_M + 10, y: 0, size: "small" });
    const heard = new Set(
      bellStrokes(1, towers, { x: 0, y: 0 }).map((s) => s.tower)
    );
    expect([...heard].sort((a, b) => a - b)).toEqual(
      [0, 1, 2, 3].slice(0, BELL_TOWERS_MAX)
    );
  });

  test("distance quiets and dulls a sound", () => {
    expect(distanceGain(30)).toBe(1);
    expect(distanceGain(600)).toBeCloseTo(0.1, 6);
    expect(airCutoff(1400)).toBeLessThan(airCutoff(100));
    expect(airCutoff(1e6)).toBe(700);
  });
});

describe("rare events", () => {
  test("a tram rings rarely, near a track, while trams run", () => {
    expect(tramBellChance(10, 12 * 60, 0.1)).toBeGreaterThan(0);
    expect(tramBellChance(10, 12 * 60, 0.1)).toBeLessThan(0.001);
    expect(tramBellChance(200, 12 * 60, 0.1)).toBe(0);
    expect(tramBellChance(10, 3 * 60, 0.1)).toBe(0);
    expect(tramBellChance(Number.POSITIVE_INFINITY, 12 * 60, 0.1)).toBe(0);
  });

  test("blackbirds at dusk, sparrows in streets, tits in parks", () => {
    const street = at({ near: { green: 0, road: 0.4, rail: 0, builtup: 0.6 } });
    expect(birdCall(street, 0.9)).toBe("sparrow");
    expect(birdCall(PARK, 0.9)).toBe("tit");
    expect(birdCall(at({ nightFactor: 0.45 }), 0.5)).toBe("blackbird");
    expect(birdCall(PARK, 0.5)).not.toBe("blackbird");
  });
});

describe("silence", () => {
  const on = { enabled: true, hidden: false, loading: false };
  test("only an explicit toggle opens the master", () => {
    expect(audible(on)).toBe(true);
    expect(audible({ ...on, enabled: false })).toBe(false);
  });
  test("a hidden tab and the loading screen close it", () => {
    expect(audible({ ...on, hidden: true })).toBe(false);
    expect(audible({ ...on, loading: true })).toBe(false);
  });
});

describe("sampling", () => {
  // Water north of y = 100, road in the band 0 <= y < 12, meadow elsewhere.
  const classAt = (_x: number, y: number) =>
    y >= 100 ? 8 : y >= 0 && y < 12 ? 7 : 1;

  test("class shares within 30 m", () => {
    const s = classShares(classAt, 0, -40);
    expect(s.green).toBe(1);
    const street = classShares(classAt, 0, 6);
    expect(street.road).toBeGreaterThan(0.2);
    expect(street.road + street.green).toBeCloseTo(1, 6);
    expect(classShares(() => null, 0, 0)).toEqual({
      green: 0,
      road: 0,
      rail: 0,
      builtup: 0,
    });
  });

  test("the nearest water lies north, as far as it is", () => {
    const w = nearestWater(classAt, 0, 20);
    expect(w.distance).toBe(80);
    expect(w.bearing).toBe(0);
    expect(nearestWater(classAt, 0, 150).distance).toBe(0);
    expect(nearestWater(classAt, 0, -500).distance).toBe(
      Number.POSITIVE_INFINITY
    );
  });

  test("the nearest point on a track", () => {
    const track = [
      [0, 0],
      [100, 0],
    ] as const;
    const near = nearestOnLines([track], 30, 12);
    expect(near).toEqual({ distance: 12, x: 30, y: 0 });
    expect(nearestOnLines([], 0, 0).distance).toBe(Number.POSITIVE_INFINITY);
  });

  test("the rustle follows the crowns' sway", () => {
    expect(windSway(0, 0, 0)).toBe(0);
    for (const t of [1, 7, 40]) {
      expect(Math.abs(windSway(t, 12, -30))).toBeLessThanOrEqual(1.5);
    }
  });

  test("a tile's sound files resolve against the tileset", () => {
    const tile = soundTileOf(
      {
        bounds: [0, 0, 2000, 2000],
        footprints: "f.json",
        id: "t",
        minimap: "landcover_t.r512.abc.png",
        sound: { soundmarks: "soundmarks_t.abc.geojson" },
      },
      "https://example.org/data/tileset.json"
    );
    expect(tile.landcover).toBe(
      "https://example.org/data/landcover_t.r512.abc.png"
    );
    expect(tile.files).toEqual({
      soundmarks: "https://example.org/data/soundmarks_t.abc.geojson",
    });
  });
});
