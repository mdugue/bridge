/**
 * Cost of a date change on the trees (crown-season.ts): builds the whole
 * site's vegetation as the viewer does (canopy + rows + laser-scan trees,
 * the cadastre and OSM trees with their veto, merged into the canopy's
 * chunks) and times `setSeason` over the transitions a user can make — a
 * summer day to mid-autumn (every deciduous crown recoloured), one autumn
 * day to the next, autumn to January (every chunk switches to the bare
 * variant), January back to July. The plan's bar (docs/plans/025): a
 * recompute over 16 ms on the full site must be throttled to the end of a
 * date drag — the viewer throttles either way (SEASON_THROTTLE_MS).
 *
 * CPU only (no GPU, no browser): the numbers are the JavaScript side of the
 * change, the buffer writes; the upload of the two per-instance buffers
 * (16 bytes per crown) happens on the next frame. Placement heights do not
 * matter here, so the ground is flat.
 *
 * Run: bun scripts/eval/season-cost.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { InstancedMesh } from "three";
import { buildTreeInventory } from "../../app/_components/tree-inventory-layer";
import {
  buildVegetation,
  type VegetationControl,
} from "../../app/_components/vegetation-layer";
import type {
  CanopyExtraFeature,
  CanopyFeature,
  FeatureCollection,
  TreeFeature,
  VegRowFeature,
} from "../../lib/city/features";
import { sideFileSource, tileIds } from "../../lib/city/tile";
import { currentSite } from "../../sites";

const ROOT = join(import.meta.dir, "..", "..");
const site = currentSite();
const features = <F>(file: string): F[] => {
  try {
    return (
      (
        JSON.parse(
          readFileSync(join(ROOT, sideFileSource(site, file)), "utf8")
        ) as FeatureCollection<F>
      ).features ?? []
    );
  } catch {
    return []; // an optional artifact this tile does not have
  }
};

const ctx = { offset: { cx: 412_000, cy: 5_657_000 }, heightAt: () => 100 };
const controls: VegetationControl[] = [];
let crowns = 0;
for (const tile of tileIds(site)) {
  const rows = features<VegRowFeature>(`vegrows_${tile}.geojson`);
  const canopy = features<CanopyFeature>(`canopy_${tile}.geojson`);
  const scan = features<CanopyExtraFeature>(`canopyx_${tile}.geojson`);
  const trees = features<TreeFeature>(`trees_${tile}.geojson`);
  const inv = buildTreeInventory(trees, ctx);
  const veg = buildVegetation(
    {
      rows,
      canopy: [...canopy, ...scan],
      keepTree: inv.keepTree,
      extraTrees: inv.instances,
    },
    ctx
  );
  controls.push(veg, inv.control);
  for (const group of [veg.group, inv.control.group]) {
    // A seasonal crown carries `aBare`; count the cheap LOD (visible at
    // build), the rich one shares its buffers.
    group.traverse((o) => {
      const mesh = o as InstancedMesh;
      if (
        mesh.isInstancedMesh &&
        mesh.visible &&
        mesh.geometry.getAttribute("aBare")
      ) {
        crowns += mesh.count;
      }
    });
  }
}

const JUL_10 = 190;
const steps: [string, number][] = [
  ["July → July (nothing changes)", JUL_10],
  ["July → 20 October (all recoloured)", 292],
  ["20 → 21 October", 293],
  ["21 October → 10 January (bare variant)", 9],
  ["10 January → July", JUL_10],
];
const runs = 5;
for (const [label, day] of steps) {
  const times: number[] = [];
  for (let r = 0; r < runs; r++) {
    // Start each run from the previous step's day so the transition is real.
    const from =
      steps[Math.max(steps.findIndex((s) => s[1] === day) - 1, 0)][1];
    for (const c of controls) {
      c.setSeason(from);
    }
    const t0 = performance.now();
    for (const c of controls) {
      c.setSeason(day);
    }
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  process.stdout.write(
    `${label.padEnd(42)} median ${times[runs >> 1].toFixed(1)} ms, max ${times[runs - 1].toFixed(1)} ms\n`
  );
}
process.stdout.write(`seasonal crown instances on the site: ${crowns}\n`);
