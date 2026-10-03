import { expect, test } from "bun:test";
import {
  crashReport,
  createProblemGate,
  envelope,
  envelopeUrl,
  PROBLEMS_PER_PAGE,
  problemReport,
  summaryReport,
} from "./crash-reports";
import { createTrail, pushBeat, pushEvent, type Trail } from "./crash-trail";

const ID = "0123456789abcdef0123456789abcdef";
const ctx = {
  origin: "https://city.example",
  release: "abc123",
  environment: "production",
};

const beat = (t: number, fps: number) => ({
  t,
  frames: t * 30,
  fps,
  gpuMB: 300,
  heldMB: 500 + t,
  calls: 90,
  triangles: 1_000_000,
  cities: 3,
  dressings: 2,
  style: "pastel",
  mode: "walk",
  heightM: 1.7,
});

/** A page that booted, streamed, was loaded and ran at 8, 25 and 50 fps. */
function page(): Trail {
  const trail = createTrail({
    startedAt: "2026-10-03T10:00:00.000Z",
    url: "/dresden?view=abc&trail=1",
    userAgent: "Mozilla/5.0 (iPhone)",
    screen: "393×852@3",
    deviceMemoryGB: 4,
  });
  trail.backend = "WebGPU";
  pushEvent(trail, { t: 0, kind: "start" });
  pushEvent(trail, { t: 3, kind: "first frame" });
  pushBeat(trail, beat(4, 8));
  pushEvent(trail, { t: 5, kind: "loaded" });
  pushBeat(trail, beat(6, 25));
  pushBeat(trail, beat(8, 50));
  return trail;
}

test("a DSN names its envelope endpoint, the key in the query", () => {
  expect(envelopeUrl("https://k3y@o1.ingest.de.sentry.io/42")).toBe(
    "https://o1.ingest.de.sentry.io/api/42/envelope/?sentry_key=k3y&sentry_version=7"
  );
  // A self-hosted tracker under a path and a port.
  expect(envelopeUrl("http://k@localhost:9000/errors/7")).toBe(
    "http://localhost:9000/errors/api/7/envelope/?sentry_key=k&sentry_version=7"
  );
  for (const notADsn of [
    "",
    "nonsense",
    "https://host/42",
    "https://k@host/",
  ]) {
    expect(envelopeUrl(notADsn)).toBeNull();
  }
});

test("an envelope is its header, the item's header and the payload, a line each", () => {
  const dsn = "https://k@host/1";
  const sent = new Date("2026-10-03T10:01:00.000Z");
  const event = envelope(dsn, { event_id: ID, level: "error" }, sent);
  expect(event.endsWith("\n")).toBe(true);
  const [header, item, payload] = event
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line) as unknown);
  expect(header).toEqual({ event_id: ID, dsn, sent_at: sent.toISOString() });
  expect(item).toEqual({ type: "event" });
  expect(payload).toEqual({ event_id: ID, level: "error" });
  const transaction = envelope(
    dsn,
    { event_id: ID, type: "transaction" },
    sent
  );
  expect(JSON.parse(transaction.split("\n")[1] ?? "")).toEqual({
    type: "transaction",
  });
});

test("a crash names where the page died and carries no query", () => {
  const trail = page();
  const report = crashReport(trail, ID, ctx);
  expect(report).toMatchObject({
    event_id: ID,
    level: "fatal",
    release: "abc123",
    message: { formatted: "Page died in use (running, WebGPU)" },
    fingerprint: ["page died", "WebGPU", "running"],
    request: {
      url: "https://city.example/dresden",
      headers: { "User-Agent": "Mozilla/5.0 (iPhone)" },
    },
    tags: { site: "dresden", backend: "WebGPU", device_memory_gb: "4" },
  });
  expect(JSON.stringify(report)).not.toContain("view=abc");
  // Its time is the trail's last moment; events and beats lead up to it.
  expect(report.timestamp).toBe(Date.parse(trail.startedAt) / 1000 + 8);
  const crumbs = (report.breadcrumbs as { values: { category: string }[] })
    .values;
  expect(crumbs.map((c) => c.category)).toEqual([
    "trail",
    "trail",
    "beat",
    "trail",
    "beat",
    "beat",
  ]);
});

test("no report names a place: not the tile, not a coordinate", () => {
  const trail = page();
  const lost = {
    t: 7,
    kind: "load-error",
    detail:
      "https://city.example/data/dresden/canopy_33412_5656_2_sn.3f9a1c.json 404",
  };
  const thrown = {
    t: 7.5,
    kind: "error",
    detail: "no ground at 412345.67, 5656789.12 (51.05041, 13.73726)",
  };
  pushEvent(trail, lost);
  pushEvent(trail, thrown);
  const sent = JSON.stringify([
    crashReport(trail, ID, ctx),
    problemReport(trail, lost, ID, ctx),
    problemReport(trail, thrown, ID, ctx),
  ]);
  for (const place of [
    "33412",
    "5656",
    "412345",
    "5656789",
    "51.05041",
    "13.73726",
  ]) {
    expect(sent).not.toContain(place);
  }
  // What failed stays readable.
  expect(sent).toContain("canopy_#####_####_#_sn");
  expect(sent).toContain("no ground at ######.##");
});

test("a problem is grouped by its kind and its detail without URLs or numbers", () => {
  const trail = page();
  const a = problemReport(
    trail,
    { t: 7, kind: "load-error", detail: "https://x/data/a_33412.glb 404" },
    ID,
    ctx
  );
  const b = problemReport(
    trail,
    { t: 7, kind: "load-error", detail: "https://x/data/b_33414.glb 404" },
    ID,
    ctx
  );
  expect(a.fingerprint).toEqual(["load-error", "<url> #"]);
  expect(b.fingerprint).toEqual(a.fingerprint);
  expect(a.level).toBe("error");
  expect(
    problemReport(trail, { t: 7, kind: "device-lost" }, ID, ctx).level
  ).toBe("fatal");
});

test("a page reports each problem once, and only so many", () => {
  const admit = createProblemGate();
  expect(admit({ t: 1, kind: "style", detail: "paper" })).toBe(false);
  expect(admit({ t: 1, kind: "gpu-error", detail: "validation 1" })).toBe(true);
  expect(admit({ t: 2, kind: "gpu-error", detail: "validation 2" })).toBe(
    false
  );
  for (let i = 1; i < PROBLEMS_PER_PAGE; i++) {
    expect(
      admit({ t: 3, kind: "error", detail: `boom ${"x".repeat(i)}` })
    ).toBe(true);
  }
  expect(admit({ t: 4, kind: "device-lost" })).toBe(false);
});

test("the summary is a transaction over the page with its numbers", () => {
  const trail = page();
  const report = summaryReport(trail, ID, ctx);
  const start = Date.parse(trail.startedAt) / 1000;
  expect(report).toMatchObject({
    type: "transaction",
    transaction: "/dresden",
    start_timestamp: start,
    timestamp: start + 8,
    contexts: {
      trace: { trace_id: ID, span_id: ID.slice(16), op: "page" },
    },
  });
  // Three beats in view at 8, 25 and 50 fps: the shares below 10/20/30.
  expect(report.measurements).toEqual({
    first_frame: { value: 3, unit: "second" },
    loaded: { value: 5, unit: "second" },
    beats_in_view: { value: 3, unit: "none" },
    fps_mean: { value: 83 / 3, unit: "none" },
    fps_below_10: { value: 1 / 3, unit: "ratio" },
    fps_below_20: { value: 1 / 3, unit: "ratio" },
    fps_below_30: { value: 2 / 3, unit: "ratio" },
    held_max: { value: 508, unit: "megabyte" },
  });
});
