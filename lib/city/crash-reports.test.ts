import { describe, expect, test } from "bun:test";
import {
  crashReport,
  createProblemGate,
  envelope,
  envelopeUrl,
  isAftermath,
  type Payload,
  PROBLEMS_PER_PAGE,
  problemReport,
  reportBuild,
  sessionEnvelope,
  sessionUpdate,
  summaryDue,
  summaryMark,
  summaryReport,
  TUNNEL_PATH,
  tunnelRewrites,
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

const SETUP = {
  startedAt: "2026-10-03T10:00:00.000Z",
  url: "/dresden?view=abc&trail=1",
  userAgent: "Mozilla/5.0 (iPhone)",
  screen: "393×852@3",
  deviceMemoryGB: 4,
};

/** The tags a report carries (a payload's members are unknown). */
const tagsOf = (payload: Payload) =>
  payload.tags as Record<string, string | undefined>;

/** A page that booted, streamed, was loaded and ran at 8, 25 and 50 fps. */
function page(): Trail {
  const trail = createTrail(SETUP);
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

test("no report leaves Sentry an address to infer for the visitor", () => {
  const trail = page();
  const error = { t: 7, kind: "error", detail: "boom" };
  for (const report of [
    crashReport(trail, ID, ctx),
    problemReport(trail, error, ID, ctx),
    summaryReport(trail, ID, ctx),
  ]) {
    // Relay's legacy rule infers an address for a `javascript` event
    // without one (and for `ip_address: null`); "never" turns it off.
    expect(report).toMatchObject({
      platform: "javascript",
      sdk: { settings: { infer_ip: "never" } },
    });
    expect(report.user).toBeUndefined();
  }
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
});

test("a problem's level says whether the page survived it", () => {
  const trail = page();
  const level = (kind: string, detail?: string) =>
    problemReport(trail, { t: 7, kind, detail }, ID, ctx).level;
  expect(level("load-error", "https://x/a.glb 404")).toBe("error");
  expect(level("device-lost")).toBe("fatal");
  expect(level("boot failed", "Die Grafik ist ausgefallen")).toBe("fatal");
  // A boot that gave up on the network is the connection's failure.
  expect(level("boot failed", "network: Load failed")).toBe("error");
  // An allocation the page shed memory for and survived.
  expect(level("alloc-failed", "RangeError: out of bounds")).toBe("warning");
});

describe("which problems are the aftermath of the page's end", () => {
  const noted = (...kinds: string[]) => {
    const trail = page();
    kinds.forEach((kind, i) => pushEvent(trail, { t: 10 + i, kind }));
    return trail;
  };
  const error = { t: 20, kind: "rejection", detail: "buffer.destroy" };
  const lost = { t: 20, kind: "load-error", detail: "https://x/a.glb" };

  test("a problem on a page in use is reported", () => {
    expect(isAftermath(noted(), error, false)).toBe(false);
    expect(isAftermath(noted(), lost, false)).toBe(false);
    // the frame that failed, noted before the render stopped
    expect(isAftermath(noted("memory"), error, false)).toBe(false);
  });

  test("not once the page is past saving", () => {
    for (const end of ["render stopped", "reloading", "gpu reclaimed"]) {
      expect(isAftermath(noted("frame failed", end), error, false)).toBe(true);
    }
  });

  test("not once the page has left", () => {
    const left = noted("hidden", "pagehide");
    left.state = "clean";
    expect(isAftermath(left, error, false)).toBe(true);
    // back from the back-forward cache, it is in use again
    left.state = "running";
    expect(isAftermath(left, error, false)).toBe(false);
  });

  test("not a load that failed while the page was out of view", () => {
    expect(isAftermath(noted(), lost, true)).toBe(true);
    expect(isAftermath(noted(), { t: 20, kind: "boot failed" }, true)).toBe(
      true
    );
    // an error is the page's own, in view or not
    expect(isAftermath(noted(), error, true)).toBe(false);
  });
});

test("a recovery page that died is a crash of its own, with its restart gap", () => {
  const trail = page();
  trail.safety = 2;
  const died = Date.parse(trail.startedAt) / 1000 + 8;
  const plain = crashReport(trail, ID, ctx, { nextStart: died + 0.84 });
  expect(plain.tags).toMatchObject({ restart_gap_s: "0.8", safety: "2" });
  const recovery = crashReport(trail, ID, ctx, {
    recovered: true,
    nextStart: died + 33,
  });
  expect(recovery).toMatchObject({
    level: "fatal",
    message: { formatted: "Recovery page died (running, WebGPU)" },
    fingerprint: ["recovery page died", "WebGPU", "running"],
    tags: { restart_gap_s: "33" },
  });
  // Without the next page's start, no gap.
  expect(tagsOf(crashReport(trail, ID, ctx)).restart_gap_s).toBeUndefined();
});

test("a report says how soon after a long stretch in the background it came", () => {
  const trail = page();
  pushEvent(trail, { t: 10, kind: "hidden" });
  pushEvent(trail, { t: 130, kind: "visible" }); // two minutes away
  pushEvent(trail, { t: 140, kind: "hidden" });
  pushEvent(trail, { t: 143, kind: "visible" }); // a glance away: no resume
  const at = (t: number) =>
    tagsOf(problemReport(trail, { t, kind: "frame failed" }, ID, ctx))
      .resumed_s;
  expect(at(130.8)).toBe("0.8");
  expect(at(185)).toBe("55");
  expect(at(190)).toBeUndefined();
  // A page loaded in the background resumes when it first comes into view.
  const behind = createTrail({ ...SETUP, hidden: true });
  pushEvent(behind, { t: 12, kind: "visible" });
  const error = { t: 13, kind: "error" };
  expect(tagsOf(problemReport(behind, error, ID, ctx)).resumed_s).toBe("1");
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

test("what the viewer notes as it copes is never a report of its own", () => {
  const admit = createProblemGate();
  for (const kind of [
    "gpu reclaimed",
    "memory emergency",
    "net-retry",
    "net-wait",
    "safety",
    "render stopped",
  ]) {
    expect(admit({ t: 1, kind, detail: "x" })).toBe(false);
  }
  expect(admit({ t: 2, kind: "alloc-failed", detail: "x" })).toBe(true);
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

const DSN = "https://k3y@o1.ingest.de.sentry.io/42";
const SHA = "3b74f39d6894e26a36f2b11c18f242c961dc3b69";

test("the release is named once, from the build's commit", () => {
  expect(
    reportBuild({
      NEXT_PUBLIC_SENTRY_DSN: DSN,
      VERCEL_GIT_COMMIT_SHA: SHA,
      VERCEL_ENV: "preview",
      NODE_ENV: "production",
    })
  ).toEqual({ dsn: DSN, release: `bridge@${SHA}`, environment: "preview" });
  // SENTRY_RELEASE and SENTRY_ENVIRONMENT win, as given.
  expect(
    reportBuild({
      VERCEL_GIT_COMMIT_SHA: SHA,
      SENTRY_RELEASE: "bridge@1.2.0",
      SENTRY_ENVIRONMENT: "staging",
      VERCEL_ENV: "preview",
    })
  ).toMatchObject({ release: "bridge@1.2.0", environment: "staging" });
  // A local build: no commit, so no release; no DSN (or a broken one).
  expect(
    reportBuild({
      NEXT_PUBLIC_SENTRY_DSN: " nonsense ",
      NODE_ENV: "development",
    })
  ).toEqual({ dsn: null, release: undefined, environment: "development" });
});

test("the site's own path forwards to the DSN's envelope endpoint", () => {
  expect(tunnelRewrites(DSN)).toEqual([
    { source: TUNNEL_PATH, destination: envelopeUrl(DSN) ?? "" },
  ]);
  expect(tunnelRewrites(null)).toEqual([]);
});

test("a page that comes back into view is summarised again, for the stretch since", () => {
  const trail = page();
  trail.report = {
    sid: ID,
    release: "bridge@abc",
    environment: "production",
    problems: 0,
    ended: false,
  };
  expect(summaryDue(trail)).toBe(true);
  expect(summaryReport(trail, ID, ctx).tags).toMatchObject({ stretch: "1" });
  // It goes out of view: the summary covers the page so far …
  trail.report.sent = summaryMark(trail);
  expect(summaryDue(trail)).toBe(false);
  // … it comes back and renders two more beats in view.
  pushBeat(trail, beat(10, 12));
  pushBeat(trail, beat(12, 40));
  expect(summaryDue(trail)).toBe(true);
  const start = Date.parse(trail.startedAt) / 1000;
  const second = summaryReport(trail, ID, ctx);
  expect(second).toMatchObject({
    start_timestamp: start + 8,
    timestamp: start + 12,
    tags: { stretch: "2" },
  });
  // Only the new beats; the boot's milestones were in the first stretch.
  expect(second.measurements).toEqual({
    beats_in_view: { value: 2, unit: "none" },
    fps_mean: { value: 26, unit: "none" },
    fps_below_10: { value: 0, unit: "ratio" },
    fps_below_20: { value: 0.5, unit: "ratio" },
    fps_below_30: { value: 0.5, unit: "ratio" },
    held_max: { value: 512, unit: "megabyte" },
  });
});

test("a record is reported under the release its page ran, not this one's", () => {
  const trail = page();
  trail.report = {
    sid: ID,
    release: "bridge@old",
    environment: "production",
    problems: 0,
    ended: false,
  };
  expect(crashReport(trail, ID, ctx).release).toBe("bridge@old");
  expect(summaryReport(trail, ID, ctx).release).toBe("bridge@old");
});

test("a session starts ok and ends crashed or exited, with its errors and length", () => {
  const trail = page();
  // A record from before the reports has no session to end.
  expect(sessionUpdate(trail, "crashed", ctx)).toBeNull();
  trail.report = {
    sid: ID,
    release: "bridge@abc",
    environment: "preview",
    problems: 2,
    ended: false,
  };
  const attrs = {
    release: "bridge@abc",
    environment: "preview",
    user_agent: "Mozilla/5.0 (iPhone)",
  };
  expect(sessionUpdate(trail, "ok", ctx)).toEqual({
    sid: ID,
    init: true,
    started: "2026-10-03T10:00:00.000Z",
    timestamp: "2026-10-03T10:00:00.000Z",
    status: "ok",
    errors: 2,
    duration: undefined,
    attrs,
  });
  expect(sessionUpdate(trail, "crashed", ctx)).toMatchObject({
    init: false,
    timestamp: "2026-10-03T10:00:08.000Z",
    status: "crashed",
    duration: 8,
  });
  // No release, no session: release health counts per release.
  trail.report.release = undefined;
  expect(sessionUpdate(trail, "ok", { ...ctx, release: undefined })).toBeNull();
});

test("a session update is its own kind of envelope item", () => {
  const sent = new Date("2026-10-03T10:01:00.000Z");
  const trail = page();
  trail.report = {
    sid: ID,
    release: "bridge@abc",
    environment: "production",
    problems: 0,
    ended: false,
  };
  const session = sessionUpdate(trail, "exited", ctx);
  if (!session) {
    throw new Error("expected a session");
  }
  const [header, item, payload] = sessionEnvelope(DSN, session, sent)
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line) as unknown);
  expect(header).toEqual({ dsn: DSN, sent_at: sent.toISOString() });
  expect(item).toEqual({ type: "session" });
  expect(payload).toEqual(JSON.parse(JSON.stringify(session)));
});
