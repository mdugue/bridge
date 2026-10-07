import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CITY_WFS } from "@/lib/city/bike-counts";
import { HAMBURG_STA } from "@/lib/city/bike-feeds";
import { SESSION_KEYS, STORAGE_KEYS } from "./storage-keys";

/** The privacy page (ADR 0045): it names what the browser keeps and asks. */
const PAGE = readFileSync(
  join(import.meta.dir, "../(legal)/datenschutz/page.mdx"),
  "utf8"
);

test("the privacy page names every key the viewer keeps in the browser", () => {
  const keys = [...Object.values(STORAGE_KEYS), ...Object.values(SESSION_KEYS)];
  expect(keys.filter((key) => !PAGE.includes(`\`${key}\``))).toEqual([]);
});

test("the privacy page names every host the viewer reads live", () => {
  const hosts = [CITY_WFS, HAMBURG_STA].map((url) => new URL(url).host);
  expect(hosts.filter((host) => !PAGE.includes(host))).toEqual([]);
});

/** The site's own sources (not tests): what runs in a visitor's browser. */
const ROOT = join(import.meta.dir, "../..");
const SOURCES = ["app", "components", "hooks", "lib"].flatMap((dir) =>
  [...new Bun.Glob(`${dir}/**/*.{ts,tsx}`).scanSync({ cwd: ROOT })]
    .filter((path) => !/\.test\.tsx?$/.test(path))
    .map((path) => ({ path, text: readFileSync(join(ROOT, path), "utf8") }))
);

const paths = (files: { path: string }[]) => files.map(({ path }) => path);

test("the site sets no cookies (the privacy page says so)", () => {
  expect(SOURCES.length).toBeGreaterThan(100);
  expect(
    paths(SOURCES.filter(({ text }) => text.includes("document.cookie")))
  ).toEqual([]);
});

test("every storage key comes from the table, none is written inline", () => {
  // a key given as a literal to a storage call, or as a literal index
  const literalKey =
    /(?:\.\s*(?:getItem|setItem|removeItem)\s*\(|\b(?:localStorage|sessionStorage)\s*\[)\s*["'`]/;
  expect(paths(SOURCES.filter(({ text }) => literalKey.test(text)))).toEqual(
    []
  );
  // whoever touches the browser's storage takes its keys from the table
  const touching = SOURCES.filter(
    ({ path, text }) =>
      !path.endsWith("storage-keys.ts") &&
      /\b(?:localStorage|sessionStorage)\b/.test(text)
  );
  expect(touching.length).toBeGreaterThan(0);
  expect(
    paths(touching.filter(({ text }) => !text.includes('storage-keys"')))
  ).toEqual([]);
});
