import { afterEach, expect, test } from "bun:test";

// A module of its own (the query): the DSN is read once, at load, and
// crash-reports.test.ts loads the shared one with a DSN set — under Bun
// the test files share one module registry. Loaded with no DSN whatever
// the environment holds (Bun reads .env files), which is then put back.
const savedDsn = process.env.CRASH_REPORTS_DSN;
delete process.env.CRASH_REPORTS_DSN;
const { reportsDeclined, reportsState, setReportsDeclined } =
  await (async () => {
    try {
      return (await import(
        `${import.meta.dir}/report-choice.ts?no-dsn`
      )) as typeof import("./report-choice");
    } finally {
      if (savedDsn !== undefined) {
        process.env.CRASH_REPORTS_DSN = savedDsn;
      }
    }
  })();

const globals = globalThis as { localStorage?: unknown };
const original = globals.localStorage;

function fakeStorage(): Map<string, string> {
  const map = new Map<string, string>();
  globals.localStorage = {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  };
  return map;
}

/** A browser that keeps nothing: every write throws. */
function refusingStorage(): void {
  globals.localStorage = {
    getItem: () => null,
    setItem: () => {
      throw new Error("QuotaExceededError");
    },
    removeItem: () => {
      throw new Error("QuotaExceededError");
    },
  };
}

afterEach(() => {
  globals.localStorage = original;
});

test("nobody has said no yet", () => {
  fakeStorage();
  expect(reportsDeclined()).toBe(false);
});

test("a no is kept in storage, and a yes removes it", () => {
  const map = fakeStorage();
  expect(setReportsDeclined(true)).toBe(true);
  expect(map.get("crash-reports.declined")).toBe("1");
  expect(reportsDeclined()).toBe(true);
  expect(setReportsDeclined(false)).toBe(true);
  expect(map.has("crash-reports.declined")).toBe(false);
  expect(reportsDeclined()).toBe(false);
});

test("a no holds in memory where the browser keeps nothing", () => {
  refusingStorage();
  expect(setReportsDeclined(true)).toBe(false);
  expect(reportsDeclined()).toBe(true);
  // The yes again resets the tab's no (module state).
  expect(setReportsDeclined(false)).toBe(false);
  expect(reportsDeclined()).toBe(false);
});

test("without a DSN in the build no report goes out, whatever was said", () => {
  // This file's module was loaded without one.
  const map = fakeStorage();
  expect(reportsState()).toBe("no-dsn");
  map.set("crash-reports.declined", "1");
  expect(reportsState()).toBe("no-dsn");
});
