/**
 * The committed QA views (qa/views/, plan 048) are Snapshots the viewer
 * takes: each parses through the one validator, stands where its `epsg`
 * says in the site's frame, and has its working link in the index. A
 * Snapshot format change, a hand-edited view or a stale index fails here,
 * not in a GPU session.
 */
import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import nodePath from "node:path";
import { tileIdOf } from "../lib/city/site";
import { parseSnapshot, snapshotHref } from "../lib/city/snapshot";
import type { Snapshot } from "../lib/city/snapshot";
import { cityMeshSourceFiles } from "../lib/city/tile";
import type { CityJsonDocument } from "../lib/city/types";
import { siteById } from "../sites";
import { cityFrame } from "./bake-city-mesh";
import { QA_VIEWS, QA_VIEWS_DIR, QA_VIEWS_SITE } from "./qa-views";

const files = readdirSync(QA_VIEWS_DIR).filter((f) => f.endsWith(".json"));
const views = new Map<string, Snapshot>(
  files.map((file) => {
    const parsed = parseSnapshot(
      readFileSync(nodePath.join(QA_VIEWS_DIR, file), "utf-8")
    );
    if (!parsed.ok) {
      throw new Error(`qa/views/${file}: ${parsed.reason}`);
    }
    return [file.replace(/\.json$/u, ""), parsed.snapshot];
  })
);

test("every QA view is a valid snapshot, and the catalogue names each one", () => {
  expect(files.length).toBeGreaterThan(0);
  expect([...views.keys()].toSorted()).toEqual(
    QA_VIEWS.map((v) => v.name).toSorted()
  );
});

test("every QA view stands where its epsg says, in the site's frame", () => {
  const site = siteById(QA_VIEWS_SITE);
  if (!site) {
    throw new Error(`no site ${QA_VIEWS_SITE}`);
  }
  const spawn = tileIdOf(site, site.tiles[0]);
  const { offset } = cityFrame(
    spawn,
    JSON.parse(
      readFileSync(cityMeshSourceFiles(site, spawn).city, "utf-8")
    ) as CityJsonDocument
  );
  const misplaced = [...views]
    .filter(([, snap]) => {
      const { pos, epsg } = snap.camera;
      return (
        Math.abs(pos.x + offset.cx - epsg.x) > 1 ||
        Math.abs(offset.cy - pos.z - epsg.y) > 1
      );
    })
    .map(([name]) => name);
  expect(misplaced).toEqual([]);
});

test("the index carries each view's link, which opens that very snapshot", () => {
  const index = readFileSync(nodePath.join(QA_VIEWS_DIR, "README.md"), "utf-8");
  for (const view of QA_VIEWS) {
    const snap = views.get(view.name);
    expect(snap).toBeDefined();
    if (snap) {
      expect(index).toContain(
        snapshotHref(`/${QA_VIEWS_SITE}${view.query ?? ""}`, snap)
      );
    }
  }
});
