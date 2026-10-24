import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SITES } from "../../sites";
import {
  HORIZON_AZIMUTHS,
  HORIZON_FAR_M,
  HORIZON_LAYERS,
  HORIZON_MAX_DEG,
  HORIZON_NEAR_M,
  HORIZON_PX,
  NEAR_BAND_M,
  NEAR_MAX_DEG,
} from "./skyview";
import { sideFileSource, tileIds } from "./tile";

const ROOT = join(import.meta.dir, "..", "..");

/** Every tile of every site, with its site (the ones whose bakes are on
 *  disk are checked; Dresden's are committed). */
const TILES = Object.values(SITES).flatMap((site) =>
  tileIds(site).map((tile) => ({ site, tile }))
);

test("the committed horizon legends match the constants the shader uses", () => {
  let checked = 0;
  for (const { site, tile } of TILES) {
    const path = join(ROOT, sideFileSource(site, `horizon_${tile}.json`));
    if (!existsSync(path)) {
      continue;
    }
    const legend = JSON.parse(readFileSync(path, "utf8")) as {
      attribution: string;
      azimuthsDeg: number[];
      bands: {
        degPerUnit: number;
        farM: number;
        name: string;
        nearM: number;
        planes: [number, number];
      }[];
      px: number;
    };
    expect(legend.azimuthsDeg).toEqual(
      Array.from({ length: HORIZON_AZIMUTHS }, (_, k) => k * 22.5)
    );
    expect(legend.px).toBe(HORIZON_PX);
    // derived from the provider's DGM1 and LoD2: its credit travels with
    // the data
    expect(legend.attribution).toStartWith(site.provider.credit);
    const [far, near] = legend.bands;
    expect(far.name).toBe("far");
    expect(far.planes).toEqual([0, HORIZON_LAYERS]);
    expect(far.degPerUnit).toBeCloseTo(HORIZON_MAX_DEG / 255, 9);
    expect(far.nearM).toBe(HORIZON_NEAR_M);
    expect(far.farM).toBe(HORIZON_FAR_M);
    expect(near.name).toBe("near");
    expect(near.planes).toEqual([HORIZON_LAYERS, 2 * HORIZON_LAYERS]);
    expect(near.degPerUnit).toBeCloseTo(NEAR_MAX_DEG / 255, 9);
    expect(near.nearM).toBe(NEAR_BAND_M);
    expect(near.farM).toBe(HORIZON_NEAR_M);
    checked++;
  }
  expect(checked).toBeGreaterThan(0);
});
