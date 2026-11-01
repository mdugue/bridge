/**
 * A site's extent over all its tiles, for the routines' scripts. Not in
 * site.ts: that module is in every ground's bake key (bake-entries.ts
 * `GROUND`), and a change there re-bakes every site.
 */
import { type Site, tileExtentOf } from "./site";

/** A site's extent over all its tiles, [minX, minY, maxX, maxY] (m). */
export function siteExtentOf(site: Site): [number, number, number, number] {
  const extents = site.tiles.map(tileExtentOf);
  return [
    Math.min(...extents.map((e) => e[0])),
    Math.min(...extents.map((e) => e[1])),
    Math.max(...extents.map((e) => e[2])),
    Math.max(...extents.map((e) => e[3])),
  ];
}
