import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  carLength,
  dayKindOf,
  headAlong,
  measurePattern,
  operatorOf,
  pointAlong,
  previousDayKind,
  routeOperator,
  runningTrams,
  secondsOfDay,
  TRAM_LIVERIES,
  type TramOperator,
  type TramTimetable,
} from "./tram-timetable";

/** One line, one pattern: three stops 0, 400 and 1000 m along a path
 *  that turns north at 600 m; a bridge from 600 m on. */
const TT: TramTimetable = {
  routes: ["11"],
  patterns: [
    {
      route: 0,
      coords: [
        [0, 0],
        [600, 0],
        [600, 400],
      ],
      at: [0, 400, 1000],
      bridge: [[1, 2]],
    },
  ],
  // leaves at 0, at the middle stop 120..140, arrives at 300, stands 20
  profiles: [{ pattern: 0, t: [0, 0, 120, 140, 300, 320] }],
  days: {
    weekday: {
      date: "2026-10-01",
      trips: [
        [0, 3600],
        [0, 86_300],
      ],
    },
    saturday: { date: "2026-10-10", trips: [[0, 7200]] },
  },
};

test("the kinds of day", () => {
  expect(dayKindOf(new Date(2026, 9, 1))).toBe("weekday");
  expect(dayKindOf(new Date(2026, 9, 3))).toBe("saturday");
  expect(dayKindOf(new Date(2026, 9, 4))).toBe("sunday");
  expect(previousDayKind(new Date(2026, 9, 5))).toBe("sunday");
  expect(secondsOfDay(new Date(2026, 9, 1, 1, 2, 3))).toBe(3723);
});

test("a car stands at its stops and eases between them", () => {
  const { at } = TT.patterns[0];
  const { t } = TT.profiles[0];
  expect(headAlong(at, t, -1)).toBeNull();
  expect(headAlong(at, t, 0)).toBe(0);
  expect(headAlong(at, t, 60)).toBeCloseTo(200, 6); // halfway, eased
  expect(headAlong(at, t, 10)).toBeLessThan(400 * (10 / 120)); // starting slow
  expect(headAlong(at, t, 130)).toBe(400); // standing
  expect(headAlong(at, t, 310)).toBe(1000);
  expect(headAlong(at, t, 321)).toBeNull();
});

test("a point along the path, its heading and whether it is on the bridge", () => {
  const p = measurePattern(TT.patterns[0]);
  const a = pointAlong(p, 300);
  expect([a.x, a.y]).toEqual([300, 0]);
  expect(a.dir).toEqual([1, 0]);
  expect(a.onBridge).toBe(false);
  const b = pointAlong(p, 800);
  expect([b.x, b.y]).toEqual([600, 200]);
  expect(b.dir).toEqual([0, 1]);
  expect(b.onBridge).toBe(true);
  expect(pointAlong(p, 5000).y).toBe(400);
});

test("the trams on their way, the night's from the day before included", () => {
  // 00:01:40: the 23:58:20 trip of the day before is still out, 200 s in
  const night = runningTrams(TT, "weekday", "weekday", 100);
  expect(night).toHaveLength(1);
  expect(night[0].route).toBe("11");
  expect(night[0].head).toBeGreaterThan(400);
  // and gone by 00:06
  expect(runningTrams(TT, "weekday", "weekday", 360)).toEqual([]);
  const morning = runningTrams(TT, "weekday", "weekday", 3600 + 130);
  expect(morning).toEqual([
    { head: 400, pattern: 0, route: "11", routeIndex: 0, seed: 3600 },
  ]);
  expect(runningTrams(TT, "sunday", "saturday", 3600)).toEqual([]);
});

// The committed timetables read as this module expects them.
const DATA = join(import.meta.dir, "..", "..", "data");
const SITES = existsSync(DATA)
  ? readdirSync(DATA).filter((site) =>
      existsSync(join(DATA, site, "transit", "trams.json"))
    )
  : [];
/** Who runs each site's trams, once its timetable names the agencies. */
const OPERATOR: Record<string, TramOperator> = {
  dresden: "dvb",
  leipzig: "lvb",
  muenchen: "mvg",
};

test.each(SITES)("%s: the committed timetable is whole", (site) => {
  const tt = JSON.parse(
    readFileSync(join(DATA, site, "transit", "trams.json"), "utf8")
  ) as TramTimetable;
  if (tt.agencies) {
    expect(tt.routeAgency).toHaveLength(tt.routes.length);
    for (const [i] of tt.routes.entries()) {
      expect(routeOperator(tt, i)).toBe(OPERATOR[site] ?? "neutral");
    }
  }
  expect(tt.routes.length).toBeGreaterThan(0);
  for (const p of tt.patterns) {
    expect(p.coords.length).toBeGreaterThanOrEqual(2);
    expect(p.at.length).toBeGreaterThanOrEqual(2);
    const m = measurePattern(p);
    const total = m.dist.at(-1) ?? 0;
    for (let i = 1; i < p.at.length; i++) {
      expect(p.at[i]).toBeGreaterThanOrEqual(p.at[i - 1]);
    }
    expect(p.at.at(-1) ?? 0).toBeLessThanOrEqual(total + 0.5);
  }
  for (const prof of tt.profiles) {
    const stops = tt.patterns[prof.pattern].at.length;
    expect(prof.t).toHaveLength(2 * stops);
    for (let i = 1; i < prof.t.length; i++) {
      expect(prof.t[i]).toBeGreaterThanOrEqual(prof.t[i - 1]);
    }
  }
  for (const kind of ["weekday", "saturday", "sunday"] as const) {
    const trips = tt.days[kind]?.trips ?? [];
    expect(trips.length).toBeGreaterThan(0);
    for (let i = 1; i < trips.length; i++) {
      expect(trips[i][1]).toBeGreaterThanOrEqual(trips[i - 1][1]);
    }
  }
  // A weekday afternoon: the city's trams are out (Munich's site: 28).
  expect(
    runningTrams(tt, "weekday", "weekday", 14 * 3600).length
  ).toBeGreaterThan(20);
});

test("the GTFS agencies stand for their operators' liveries", () => {
  // as gtfs.de's feed names them (agency.txt, 2026-10-20)
  expect(operatorOf("Verkehrsverbund Oberelbe")).toBe("dvb");
  expect(operatorOf("LVB")).toBe("lvb");
  expect(operatorOf("Stadtwerke München")).toBe("mvg");
  expect(operatorOf("Berliner Verkehrsbetriebe")).toBe("bvg");
  expect(operatorOf("Hallesche Verkehrs-AG")).toBe("neutral");
  expect(operatorOf(undefined)).toBe("neutral");
  const tt: TramTimetable = {
    ...TT,
    agencies: ["Verkehrsverbund Oberelbe"],
    routeAgency: [0],
  };
  expect(routeOperator(tt, 0)).toBe("dvb");
  // a timetable from before the agencies: the neutral car
  expect(routeOperator(TT, 0)).toBe("neutral");
});

test("a trip's car length follows its fleet's mix, the same all day", () => {
  const dvb = TRAM_LIVERIES.dvb;
  const counts = new Map<number, number>();
  for (let seed = 0; seed < 4000; seed++) {
    const l = carLength(dvb, seed * 977 + 3600);
    counts.set(l, (counts.get(l) ?? 0) + 1);
  }
  expect([...counts.keys()].sort((a, b) => a - b)).toEqual([30, 41, 45]);
  // 89 of 188 cars are 30 m long: about 47 % of the trips
  expect((counts.get(30) ?? 0) / 4000).toBeGreaterThan(0.4);
  expect((counts.get(30) ?? 0) / 4000).toBeLessThan(0.55);
  expect(carLength(dvb, 12_345)).toBe(carLength(dvb, 12_345));
  expect(carLength(TRAM_LIVERIES.mvg, 7)).toBe(36);
});
