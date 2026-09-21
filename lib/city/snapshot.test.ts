import { expect, test } from "bun:test";
import { LOOK_DEFAULTS } from "./look-controls";
import {
  decodeLook,
  encodeSnapshot,
  parseSnapshot,
  type Snapshot,
  snapshotInstant,
} from "./snapshot";

const valid: Snapshot = {
  v: 1,
  camera: {
    mode: "fly",
    pos: { x: 25, y: 140, z: -60 },
    epsg: { x: 412_025, y: 5_657_060 },
    headingDeg: 42,
    pitchDeg: -20,
    fov: 55,
  },
  date: "2026-06-21T12:00:00.000Z",
  look: {
    fogPct: 30,
    heightFogPct: 40,
    transparencyPct: 20,
    dof: true,
    focusMode: "manual",
    focusDistanceM: 80,
    multiTuft: false,
  },
};

const withLook = (look: Record<string, unknown>) =>
  JSON.stringify({ ...valid, look });

const withCamera = (camera: Record<string, unknown>) =>
  JSON.stringify({ ...valid, camera: { ...valid.camera, ...camera } });

const reason = (text: string): string => {
  const r = parseSnapshot(text);
  return r.ok ? "" : r.reason;
};

test("a valid snapshot round-trips", () => {
  const r = parseSnapshot(JSON.stringify(valid));
  expect(r.ok).toBe(true);
  if (r.ok) {
    expect(r.snapshot).toEqual(valid);
  }
});

test("malformed JSON", () => {
  expect(reason("{not json")).toBe("Invalid snapshot JSON");
});

test("non-object root and missing camera", () => {
  expect(reason("42")).toMatch(/snapshot must be an object/);
  expect(reason(JSON.stringify({ v: 1, date: valid.date }))).toMatch(
    /camera must be an object/
  );
});

test("non-numeric version", () => {
  expect(reason(JSON.stringify({ ...valid, v: "1" }))).toMatch(/^v must be/);
});

test("camera fields must be finite numbers", () => {
  expect(reason(withCamera({ headingDeg: "42" }))).toBe(
    "camera.headingDeg must be a finite number"
  );
  // A pasted "1e999" parses to Infinity — must be rejected, not applied.
  const infinite = JSON.stringify({ ...valid }).replace('"y":140', '"y":1e999');
  expect(reason(infinite)).toBe("camera.pos.y must be a finite number");
  expect(reason(withCamera({ pos: { x: 0 } }))).toBe(
    "camera.pos.y must be a finite number"
  );
});

test("camera mode and fov are range-checked", () => {
  expect(reason(withCamera({ mode: "hover" }))).toMatch(/camera.mode/);
  expect(reason(withCamera({ fov: 0 }))).toMatch(/camera.fov/);
  expect(reason(withCamera({ fov: 180 }))).toMatch(/camera.fov/);
});

test("date must parse", () => {
  expect(reason(JSON.stringify({ ...valid, date: "yesterday" }))).toMatch(
    /^date must be/
  );
  expect(reason(JSON.stringify({ ...valid, date: 5 }))).toMatch(
    /^date must be/
  );
});

test("look percentages must be numbers", () => {
  expect(reason(withLook({ fogPct: "50" }))).toBe(
    "look.fogPct must be a finite number"
  );
});

test("look flags are type- and enum-checked", () => {
  expect(reason(withLook({ focusMode: "fixed" }))).toMatch(/look.focusMode/);
  expect(reason(withLook({ dof: "yes" }))).toMatch(/look.dof/);
  expect(reason(withLook({ multiTuft: 1 }))).toMatch(/look.multiTuft/);
  expect(reason(withLook({ focusDistanceM: 0.5 }))).toMatch(
    /look.focusDistanceM/
  );
});

test("a snapshot without look is accepted", () => {
  const bare = { v: valid.v, camera: valid.camera, date: valid.date };
  const r = parseSnapshot(JSON.stringify(bare));
  expect(r.ok).toBe(true);
  if (r.ok) {
    expect(r.snapshot.look).toBeUndefined();
  }
});

test("unknown look keys are preserved", () => {
  const r = parseSnapshot(withLook({ sparklePct: 12, fogPct: 1 }));
  expect(r.ok).toBe(true);
  if (r.ok) {
    expect(r.snapshot.look?.sparklePct).toBe(12);
  }
});

test("a legacy snapshot with only the six original keys is accepted", () => {
  const r = parseSnapshot(
    withLook({
      transparencyPct: 20,
      fogPct: 30,
      gradingPct: 40,
      contactPct: 50,
      grainPct: 60,
      dof: false,
    })
  );
  expect(r.ok).toBe(true);
});

test("unknown versions are accepted", () => {
  expect(parseSnapshot(JSON.stringify({ ...valid, v: 7 })).ok).toBe(true);
});

test("what Copy encodes, Apply decodes back — through the same parser", () => {
  const values = {
    ...LOOK_DEFAULTS,
    fogAmount: 0.35,
    transparency: 0.9,
    dof: false,
    focusMode: "manual" as const,
    focusDistanceM: 80,
    multiTuft: false,
  };
  const snap = encodeSnapshot(values, valid.camera, new Date(valid.date));
  expect(snap.v).toBe(1);
  expect(snap.date).toBe(valid.date);
  expect(snap.look?.fogPct).toBe(35);
  expect(snap.look?.transparencyPct).toBe(90);
  const parsed = parseSnapshot(JSON.stringify(snap));
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) {
    return;
  }
  const patch = decodeLook(parsed.snapshot.look);
  for (const [key, value] of Object.entries(values)) {
    const decoded = patch[key as keyof typeof patch];
    if (typeof value === "number") {
      expect(decoded).toBeCloseTo(value, 6);
    } else {
      expect(decoded).toBe(value);
    }
  }
});

test("snapshotInstant floors a hand-edited instant to the minute the slider shows", () => {
  const instant = snapshotInstant({ date: "2026-06-21T18:59:59.500Z" });
  expect(instant.getSeconds()).toBe(0);
  expect(instant.getMilliseconds()).toBe(0);
  expect(instant.getTime()).toBe(
    new Date("2026-06-21T18:59:00.000Z").getTime()
  );
});

test("decodeLook leaves absent keys out, so an older snapshot keeps the current values", () => {
  expect(decodeLook({ fogPct: 30, dof: false })).toEqual({
    fogAmount: 0.3,
    dof: false,
  });
  expect(decodeLook(undefined)).toEqual({});
});
