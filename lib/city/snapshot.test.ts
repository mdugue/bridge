import { expect, test } from "bun:test";
import { DATA_LAYERS } from "./data-layers";
import { LOOK_DEFAULTS, RETIRED_SNAPSHOT_KEYS } from "./look-controls";
import {
  decodeLook,
  encodeSnapshot,
  parseSnapshot,
  SNAPSHOT_PARAM_MAX,
  snapshotFromSearch,
  snapshotFromParam,
  snapshotHref,
  snapshotInstant,
  snapshotToParam,
} from "./snapshot";
import type { Snapshot, SnapshotParse } from "./snapshot";

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
    multiTuft: false,
    style: "comic",
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
  expect(reason("42")).toMatch(/snapshot must be an object/u);
  expect(reason(JSON.stringify({ v: 1, date: valid.date }))).toMatch(
    /camera must be an object/u
  );
});

test("non-numeric version", () => {
  expect(reason(JSON.stringify({ ...valid, v: "1" }))).toMatch(/^v must be/u);
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
  expect(reason(withCamera({ mode: "hover" }))).toMatch(/camera.mode/u);
  expect(reason(withCamera({ fov: 0 }))).toMatch(/camera.fov/u);
  expect(reason(withCamera({ fov: 180 }))).toMatch(/camera.fov/u);
});

test("date must parse", () => {
  expect(reason(JSON.stringify({ ...valid, date: "yesterday" }))).toMatch(
    /^date must be/u
  );
  expect(reason(JSON.stringify({ ...valid, date: 5 }))).toMatch(
    /^date must be/u
  );
});

test("look percentages must be numbers", () => {
  expect(reason(withLook({ fogPct: "50" }))).toBe(
    "look.fogPct must be a finite number"
  );
});

test("look flags are type- and enum-checked", () => {
  expect(reason(withLook({ multiTuft: 1 }))).toMatch(/look.multiTuft/u);
  expect(reason(withLook({ bikeLayer: "on" }))).toMatch(/look.bikeLayer/u);
  expect(reason(withLook({ style: "ghost" }))).toMatch(/look.style/u);
  expect(reason(withLook({ style: 2 }))).toMatch(/look.style/u);
});

// The controls the maintainer removed (2026-10-10): on the performance PR
// the see-through buildings, the leaf flutter and its gust brightness, the
// river mist's strength, the depth of field's switch and its focus; then
// every slider but Nebel (plan 073). Snapshots copied before then — in PR
// descriptions, in shots/ — carry their keys.
const REMOVED_LOOK = {
  transparencyPct: 40,
  leafFlutterPct: 70,
  leafBrightPct: 30,
  waterMistPct: 0,
  dof: false,
  focusMode: "manual",
  focusDistanceM: 80,
  heightFogPct: 40,
  gradingPct: 50,
  tintPct: 25,
  windowsPct: 0,
  facadeReadingPct: 0,
  duskGlowPct: 100,
  shimmerPct: 45,
  contactPct: 90,
  reflectionPct: 0,
  grainPct: 20,
  inkPct: 100,
};

test("an old snapshot with removed controls still loads, and they are ignored", () => {
  const r = parseSnapshot(
    withLook({ ...REMOVED_LOOK, fogPct: 30, multiTuft: false })
  );
  expect(r.ok).toBe(true);
  if (!r.ok) {
    return;
  }
  // Apply sets what is still a control, and nothing else.
  expect(decodeLook(r.snapshot.look)).toEqual({
    fogAmount: 0.3,
    multiTuft: false,
  });
});

test("a removed control's key is no longer checked", () => {
  // Rejected while they were controls; now unknown keys like any other.
  for (const look of [
    { focusMode: "fixed" },
    { dof: "yes" },
    { focusDistanceM: 0.5 },
    { transparencyPct: "20" },
    { tintPct: "20" },
    { inkPct: null },
  ]) {
    expect(parseSnapshot(withLook(look)).ok).toBe(true);
  }
});

test("every retired key is read and ignored, and the camera applies as before", () => {
  const retired = Object.fromEntries(
    RETIRED_SNAPSHOT_KEYS.map((key) => [key, 40])
  );
  const r = parseSnapshot(withLook({ ...retired, fogPct: 30 }));
  expect(r.ok).toBe(true);
  if (!r.ok) {
    return;
  }
  expect(r.snapshot.camera).toEqual(valid.camera);
  expect(decodeLook(r.snapshot.look)).toEqual({ fogAmount: 0.3 });
});

test("Copy writes the controls there are, and no retired key", () => {
  const snap = encodeSnapshot(
    LOOK_DEFAULTS,
    valid.camera,
    new Date(valid.date)
  );
  expect(Object.keys(snap.look ?? {}).sort()).toEqual(
    [
      "fogPct",
      "multiTuft",
      "style",
      ...DATA_LAYERS.map((d) => d.snapshotKey),
    ].sort()
  );
  for (const key of RETIRED_SNAPSHOT_KEYS) {
    expect(snap.look).not.toHaveProperty(key);
  }
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

test("unknown versions are accepted", () => {
  expect(parseSnapshot(JSON.stringify({ ...valid, v: 7 })).ok).toBe(true);
});

test("what Copy encodes, Apply decodes back — through the same parser", () => {
  const values = {
    ...LOOK_DEFAULTS,
    fogAmount: 0.35,
    multiTuft: false,
    style: "sincity" as const,
    trafficLayer: true,
    tramLayer: true,
  };
  const snap = encodeSnapshot(values, valid.camera, new Date(valid.date));
  expect(snap.look?.trafficLayer).toBe(true);
  expect(snap.look?.bikeLayer).toBe(false);
  expect(snap.v).toBe(1);
  expect(snap.date).toBe(valid.date);
  expect(snap.look?.fogPct).toBe(35);
  expect(snap.look?.style).toBe("sincity");
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
  expect(decodeLook({ fogPct: 30, multiTuft: false })).toEqual({
    fogAmount: 0.3,
    multiTuft: false,
  });
  expect(decodeLook(undefined)).toEqual({});
});

test("a Modell view round-trips with the camera, and is checked", () => {
  const model = {
    pivot: { x: 120, y: 112, z: -340 },
    preset: "iso",
    scale: 2500,
    tiltDeg: 35.26,
    turnDeg: 45,
  };
  const r = parseSnapshot(withCamera({ model }));
  expect(r.ok).toBe(true);
  if (r.ok) {
    expect(r.snapshot.camera.model).toEqual(model as never);
  }
  expect(
    reason(withCamera({ model: { ...model, preset: "fisheye" } }))
  ).toMatch(/camera\.model\.preset/u);
  expect(reason(withCamera({ model: { ...model, scale: 0 } }))).toMatch(
    /camera\.model\.scale/u
  );
  expect(reason(withCamera({ model: { ...model, tiltDeg: 120 } }))).toMatch(
    /camera\.model\.tiltDeg/u
  );
  expect(
    reason(withCamera({ model: { ...model, pivot: { x: 1, y: "2", z: 3 } } }))
  ).toMatch(/camera\.model\.pivot\.y/u);
});

test("a snapshot without a Modell view is the perspective one, as before", () => {
  const r = parseSnapshot(JSON.stringify(valid));
  expect(r.ok && r.snapshot.camera.model).toBe(undefined);
});

const linkReason = (r: SnapshotParse): string => (r.ok ? "" : r.reason);

test("a view link carries the snapshot whole, and reads back through the parser", () => {
  const snap = encodeSnapshot(
    { ...LOOK_DEFAULTS, style: "noir", trafficLayer: true },
    {
      ...valid.camera,
      model: {
        pivot: { x: 1, y: 2, z: 3 },
        preset: "plan",
        scale: 5000,
        tiltDeg: 90,
        turnDeg: 0,
      },
    },
    new Date(valid.date)
  );
  const param = snapshotToParam(snap);
  expect(param).toMatch(/^[\w-]+$/u);
  expect(snapshotFromParam(param)).toEqual({ ok: true, snapshot: snap });
  const href = snapshotHref("/dresden", snap);
  expect(href.startsWith("/dresden?snap=")).toBe(true);
  expect(snapshotFromSearch(new URL(href, "https://x.test").search)).toEqual({
    ok: true,
    snapshot: snap,
  });
});

test("a view link keeps the query its path has, and sets snap after it", () => {
  const href = snapshotHref("/dresden?safety=3", valid);
  const url = new URL(href, "https://x.test");
  expect(url.pathname).toBe("/dresden");
  expect(url.searchParams.get("safety")).toBe("3");
  expect(snapshotFromSearch(url.search)?.ok).toBe(true);
});

test("a view link that is not one is refused with a reason, never thrown", () => {
  expect(linkReason(snapshotFromParam("not base64!"))).toBe(
    "View link is not base64url"
  );
  // base64url of "{": JSON the parser refuses
  expect(linkReason(snapshotFromParam("ew"))).toBe("Invalid snapshot JSON");
  // a snapshot with a broken camera: the parser's own reason
  const broken = snapshotToParam({
    ...valid,
    camera: { ...valid.camera, fov: 0 },
  });
  expect(linkReason(snapshotFromParam(broken))).toMatch(/camera\.fov/u);
  // a byte that is no UTF-8 (0xff)
  expect(linkReason(snapshotFromParam("_w"))).toBe(
    "View link is not base64url"
  );
});

test("an oversized view link is refused unread", () => {
  const long = "A".repeat(SNAPSHOT_PARAM_MAX + 1);
  expect(linkReason(snapshotFromParam(long))).toBe("View link too long");
});

test("only a query's snap opens a view, beside other parameters", () => {
  const param = snapshotToParam(valid);
  expect(snapshotFromSearch("?scene=lite")).toBe(null);
  expect(snapshotFromSearch("")).toBe(null);
  expect(snapshotFromSearch(`?scene=lite&snap=${param}`)?.ok).toBe(true);
});
