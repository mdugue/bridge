import { afterEach, beforeEach, expect, test } from "bun:test";
import { createTrail, type Trail } from "@/lib/city/crash-trail";
import { TUNNEL_PATH } from "@/lib/city/crash-reports";

/**
 * The sender's gate (ADR 0045): with a DSN in the build a problem goes
 * out as an envelope beacon to the site's own path — and after the
 * visitor's no, nothing does. The browser is modelled by the few globals
 * the reports touch; the modules are imported only once the DSN is set,
 * since they read it at load.
 */

const g = globalThis as Record<string, unknown>;
const NAMES = [
  "localStorage",
  "navigator",
  "fetch",
  "window",
  "location",
  "document",
] as const;
const saved = Object.fromEntries(NAMES.map((name) => [name, g[name]]));
const savedInfo = console.info;

interface Beacon {
  url: string;
  body: string;
}
let beacons: Beacon[] = [];
let fetched = 0;

beforeEach(() => {
  beacons = [];
  fetched = 0;
  const map = new Map<string, string>();
  g.localStorage = {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  };
  g.navigator = {
    sendBeacon: (url: string, body: string) => {
      beacons.push({ url, body });
      return true;
    },
    userAgent: "test",
    onLine: true,
  };
  g.fetch = () => {
    fetched += 1;
    return Promise.resolve(new Response(null, { status: 200 }));
  };
  g.window = {};
  g.location = { origin: "https://example.test" };
  g.document = { visibilityState: "visible" };
  console.info = () => {};
  process.env.CRASH_REPORTS_DSN = "https://abc123@o1.ingest.de.sentry.io/42";
});

afterEach(() => {
  Object.assign(g, saved);
  console.info = savedInfo;
  delete process.env.CRASH_REPORTS_DSN;
});

function trail(): Trail {
  return createTrail({
    startedAt: new Date().toISOString(),
    url: "/dresden",
    userAgent: "test",
    screen: "1280×720@1",
  });
}

/** Starts the reports and has the page start, then throw. */
async function startAndFail(): Promise<void> {
  const { startCrashReports } = await import("./crash-reports");
  const listener = startCrashReports();
  expect(listener).not.toBeNull();
  const page = trail();
  listener?.({ t: 0, kind: "start" }, page);
  listener?.({ t: 1, kind: "error", detail: "TypeError: boom" }, page);
}

/** The items the beacons carry: each envelope's item header and payload. */
function items(): { type: string; payload: Record<string, unknown> }[] {
  return beacons.map(({ body }) => {
    const [, item, payload] = body
      .trimEnd()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    return {
      type: String(item?.type),
      payload: payload ?? {},
    };
  });
}

test("with reports on, a problem goes out as an envelope to the site's path", async () => {
  const { setReportsDeclined } = await import("./report-choice");
  setReportsDeclined(false);
  await startAndFail();
  expect(beacons.length).toBeGreaterThan(0);
  expect(beacons.every(({ url }) => url === TUNNEL_PATH)).toBe(true);
  const header = JSON.parse(beacons[0]?.body.split("\n")[0] ?? "") as {
    dsn?: string;
  };
  expect(header.dsn).toBe("https://abc123@o1.ingest.de.sentry.io/42");
  const events = items().filter(({ type }) => type === "event");
  expect(events).toHaveLength(1);
  expect(events[0]?.payload.level).toBe("error");
  expect(fetched).toBe(0);
});

test("after the visitor's no, nothing goes out", async () => {
  const { setReportsDeclined } = await import("./report-choice");
  const { startCrashReports } = await import("./crash-reports");
  setReportsDeclined(false);
  // A page that started before the no (said on /datenschutz in another
  // tab): its listener is live, and the sender's gate must hold.
  const listener = startCrashReports();
  expect(listener).not.toBeNull();
  const page = trail();
  listener?.({ t: 0, kind: "start" }, page);
  beacons = [];
  setReportsDeclined(true);
  listener?.({ t: 1, kind: "error", detail: "TypeError: boom" }, page);
  listener?.({ t: 2, kind: "pagehide" }, page);
  expect(beacons).toEqual([]);
  expect(fetched).toBe(0);
  setReportsDeclined(false);
});
