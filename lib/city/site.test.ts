import { expect, test } from "bun:test";
import { DEFAULT_SITE, SITES } from "../../sites";
import { DRESDEN } from "../../sites/dresden";
import {
  osmExtractUrl,
  siteAttribution,
  siteTitle,
  startViewpoint,
  TILE_KM,
  tileExtentOf,
  tileIdOf,
} from "./site";

const sites = Object.entries(SITES);

test("the registry key is the site's id, and the default exists", () => {
  for (const [key, site] of sites) {
    expect(site.id).toBe(key);
  }
  expect(SITES[DEFAULT_SITE]).toBeDefined();
});

test.each(sites)(
  "%s: every viewpoint stands on one of its tiles",
  (_, site) => {
    const onSite = (x: number, y: number) =>
      site.tiles.some((cell) => {
        const [x0, y0, x1, y1] = tileExtentOf(cell);
        return x >= x0 && x < x1 && y >= y0 && y < y1;
      });
    expect(site.viewpoints.length).toBeGreaterThanOrEqual(3);
    for (const v of site.viewpoints) {
      expect(onSite(v.epsg.x, v.epsg.y)).toBe(true);
      expect(v.headingDeg).toBeGreaterThanOrEqual(0);
      expect(v.headingDeg).toBeLessThan(360);
    }
    expect(new Set(site.viewpoints.map((v) => v.id)).size).toBe(
      site.viewpoints.length
    );
  }
);

test.each(sites)(
  "%s: tiles sit on the even 2 km grid, once each",
  (_, site) => {
    const ids = site.tiles.map((cell) => tileIdOf(site, cell));
    expect(new Set(ids).size).toBe(ids.length);
    for (const cell of site.tiles) {
      expect(cell.e % TILE_KM).toBe(0);
      expect(cell.n % TILE_KM).toBe(0);
    }
  }
);

test.each(sites)(
  "%s: the start viewpoint exists, on the spawn tile",
  (_, site) => {
    if (site.start === undefined) {
      return;
    }
    const start = startViewpoint(site);
    expect(start).toBeDefined();
    const [x0, y0, x1, y1] = tileExtentOf(site.tiles[0]);
    const { x, y } = start?.epsg ?? { x: Number.NaN, y: Number.NaN };
    expect(x >= x0 && x < x1 && y >= y0 && y < y1).toBe(true);
  }
);

test("Dresden keeps its tile ids, credits and extract", () => {
  expect(tileIdOf(DRESDEN, DRESDEN.tiles[0])).toBe("33412_5656_2_sn");
  expect(tileExtentOf(DRESDEN.tiles[0])).toEqual([
    412_000, 5_656_000, 414_000, 5_658_000,
  ]);
  expect(siteAttribution(DRESDEN)).toEqual([
    "Quelle: GeoSN, dl-de/by-2-0",
    "Lampen, Mauern, Bahnsteige und Brücken © OpenStreetMap-Mitwirkende (ODbL)",
  ]);
  expect(siteTitle(DRESDEN)).toBe("City Walk — Dresden");
  expect(osmExtractUrl(DRESDEN)).toBe(
    "https://download.geofabrik.de/europe/germany/sachsen-latest.osm.pbf"
  );
});

test("a site without an open Basis-DLM credits OSM for its land cover", () => {
  expect(siteAttribution(SITES.hamburg)[1]).toStartWith("Landbedeckung");
});
