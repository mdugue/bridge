import { expect, test } from "bun:test";
import { treeRank, unpackCrowns } from "../lib/city/coarse-crowns";
import { MODEL_TREES_FLOOR } from "../lib/city/model-view";
import { tileExtentOf, tileIdOf } from "../lib/city/site";
import { sideFileSource } from "../lib/city/tile";
import { DRESDEN } from "../sites/dresden";
import { bakeCoarseCrowns } from "./coarse-crowns";

test("the spawn tile's coarse crowns: a floor's share of its trees, ranked below it", async () => {
  const cell = DRESDEN.tiles[0];
  const tile = tileIdOf(DRESDEN, cell);
  const extent = tileExtentOf(cell);
  const side = (stem: string, ext = "geojson") =>
    sideFileSource(DRESDEN, `${stem}_${tile}.${ext}`);
  const bytes = await bakeCoarseCrowns(
    {
      canopy: side("canopy"),
      canopyx: side("canopyx"),
      cultivated: side("cultivated"),
      monuments: side("monuments"),
      ndvi: side("ndvi", "png"),
      sheds: side("smallbuild"),
      trees: side("trees"),
      vegrows: side("vegrows"),
    },
    {
      bounds: extent,
      heightAt: () => 0,
      offset: { cx: 411_000, cy: 5_657_000 },
      origin: [extent[0], extent[1]],
    }
  );
  const crowns = unpackCrowns(bytes.buffer as ArrayBuffer) ?? [];
  // the register and the canopy both join, NDVI-coloured
  expect(crowns.filter((c) => c.kind === "register").length).toBeGreaterThan(
    1000
  );
  expect(crowns.filter((c) => c.kind === "canopy").length).toBeGreaterThan(
    1000
  );
  expect(crowns.some((c) => c.ndvi !== undefined)).toBe(true);
  for (const c of crowns) {
    expect(treeRank(c.x, c.z)).toBeLessThan(MODEL_TREES_FLOOR);
  }
});
