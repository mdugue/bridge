import { expect, test } from "bun:test";
import {
  inDaySpan,
  isWalkBundle,
  seasonOf,
  stopCamera,
  stopDate,
  stopNotes,
  stopView,
  type Walk,
  walkBundle,
  type WalkStop,
  walkProblems,
} from "./walks";

const stop: WalkStop = {
  id: "kuppel",
  title: "Die Kuppel",
  from: [1000, 2000, 1.6],
  ground: 110,
  at: [1000, 2100, 211.6],
  hour: 16.5,
  text: "Eine Kuppel aus Stein.",
  facts: [{ claim: "Sie ist aus Stein.", source: "https://example.org/k" }],
  days: [
    { from: "12-20", to: "01-06", text: "Zwischen den Jahren." },
    { from: "10-30", to: "10-30", text: "Weihetag." },
  ],
  seasons: { winter: "Im Winter.", autumn: "Im Herbst." },
};

test("a stop's view looks from its eye at its point", () => {
  const view = stopView(stop);
  expect(view.epsg).toEqual({ x: 1000, y: 2000 });
  expect(view.headingDeg).toBe(0);
  // 100 m up over 100 m: 45°
  expect(view.pitchDeg).toBe(45);
  expect(view.fov).toBe(60);
  expect(view.mode).toBe("walk");
  expect(stopView({ ...stop, from: [1100, 2100, 80] }).mode).toBe("fly");
  expect(stopView({ ...stop, from: [1100, 2100, 1.6] }).headingDeg).toBe(270);
});

test("a stop's camera is in the scene frame, with Modell where it asks", () => {
  const offset = { cx: 900, cy: 1900 };
  const plain = stopCamera(stop, offset);
  expect(plain.pos).toEqual({ x: 100, y: 111.6, z: -100 });
  expect(plain.model).toBeUndefined();
  const model = stopCamera(
    { ...stop, model: { preset: "military", scale: 1500, turnDeg: 45 } },
    offset
  );
  expect(model.model?.pivot).toEqual({ x: 100, y: 211.6, z: -200 });
  expect(model.model?.tiltDeg).toBe(90);
  expect(model.mode).toBe("fly");
});

test("a stop is shown today at its hour", () => {
  const at = stopDate(stop, new Date(2026, 9, 29, 9, 12));
  expect([at.getFullYear(), at.getMonth(), at.getDate()]).toEqual([
    2026, 9, 29,
  ]);
  expect([at.getHours(), at.getMinutes()]).toEqual([16, 30]);
});

test("today's notes: the days first, then the season", () => {
  expect(seasonOf(new Date(2026, 1, 1))).toBe("winter");
  expect(seasonOf(new Date(2026, 4, 31))).toBe("spring");
  expect(seasonOf(new Date(2026, 9, 29))).toBe("autumn");
  expect(inDaySpan("01-02", "12-20", "01-06")).toBe(true);
  expect(inDaySpan("11-02", "12-20", "01-06")).toBe(false);
  expect(stopNotes(stop, new Date(2026, 9, 30))).toEqual([
    "Weihetag.",
    "Im Herbst.",
  ]);
  expect(stopNotes(stop, new Date(2027, 0, 3))).toEqual([
    "Zwischen den Jahren.",
    "Im Winter.",
  ]);
  expect(stopNotes(stop, new Date(2026, 6, 1))).toEqual([]);
});

const walk: Walk = {
  id: "probe",
  title: "Probe",
  teaser: "Zwei Stationen.",
  by: "Claude",
  written: "2026-10-29",
  minutes: 5,
  stops: [stop, { ...stop, id: "zwei" }],
};

test("a walk's problems are named", () => {
  expect(walkProblems(walk)).toEqual([]);
  const broken: Walk = {
    ...walk,
    id: "Probe Walk",
    stops: [
      {
        ...stop,
        hour: 25,
        text: "x".repeat(901),
        facts: [{ claim: "Geraten.", source: "irgendwo" }],
        days: [{ from: "13-01", to: "01-01", text: "" }],
      },
    ],
  };
  const problems = walkProblems(broken);
  expect(problems).toHaveLength(6);
  expect(problems.join("\n")).toContain("no checkable source");
  expect(() => walkBundle("probe", [broken])).toThrow("probe walks");
});

test("a bundle is recognised by its shape", () => {
  expect(isWalkBundle(walkBundle("probe", [walk]))).toBe(true);
  expect(isWalkBundle({ site: "probe" })).toBe(false);
  expect(isWalkBundle(null)).toBe(false);
});
