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
