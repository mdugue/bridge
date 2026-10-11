import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TerrainBounds } from "../lib/city/terrain-geometry";
import {
  fineTin,
  gridMesh,
  shapeGrid,
  terrainMesh,
  tinMesh,
  tinTerrainMesh,
} from "./bake-tiles";
import { packGround, readGroundHeader, unpackGround } from "./ground-pack";

// 65×65 cells of 1 m off the origin: a slope with a 6 m step across it.
const N = 65;
const BOUNDS: TerrainBounds = [411_000, 5_655_000, 411_000 + N, 5_655_000 + N];
const OFFSET = { cx: 411_030, cy: 5_655_020 };

function dgm(hole = false) {
  const elevations = new Float32Array(N * N);
  for (let row = 0; row < N; row++) {
    for (let col = 0; col < N; col++) {
      elevations[row * N + col] =
        100 + row * 0.03 + (col < 30 ? 0 : col > 31 ? 6 : (col - 30) * 3);
    }
  }
  if (hole) {
    elevations[200] = Number.NaN;
  }
  return { bounds: BOUNDS, elevations, n: N };
}

/** Ground heights over the tile, off the pixel centres. */
function heights(heightAt: (x: number, y: number) => number | null) {
  const out: (number | null)[] = [];
  for (let i = 0; i <= 40; i++) {
    out.push(heightAt(BOUNDS[0] + i * 1.63, BOUNDS[1] + i * 1.41 + 0.2));
  }
  return out;
}

test("a TIN rebuilt from its cache entry meshes and stands as the bake's", () => {
  const tin = fineTin(dgm(), [], {}, 0.1);
  if (!tin) {
    throw new Error("the fixture has no hole");
  }
  const baked = tinTerrainMesh(dgm(), [], OFFSET, {}, 0.1);
  const back = unpackGround(packGround({ kind: "tin", tin }));
  if (back.kind !== "tin") {
    throw new Error(`a TIN came back as a ${back.kind}`);
  }
  const rebuilt = tinMesh(back.tin, OFFSET, 0.1);
  expect(rebuilt.input).toEqual(baked?.input as typeof rebuilt.input);
  expect(rebuilt.tin).toEqual(baked?.tin);
  expect(heights(rebuilt.heightAt)).toEqual(
    heights(baked?.heightAt ?? (() => null))
  );
});

test("the shaped grid of a DGM with NoData comes back as the grid mesh", () => {
  expect(fineTin(dgm(true), [], {}, 0.1)).toBeNull();
  const baked = terrainMesh(dgm(true), [], OFFSET);
  const back = unpackGround(
    packGround({ kind: "grid", grid: shapeGrid(dgm(true), []) })
  );
  if (back.kind !== "grid") {
    throw new Error(`a grid came back as a ${back.kind}`);
  }
  const rebuilt = gridMesh(back.grid, OFFSET);
  expect(rebuilt.input).toEqual(baked.input);
  expect(heights(rebuilt.heightAt)).toEqual(heights(baked.heightAt));
});

test("an entry read as a Buffer at an offset comes back whole", () => {
  const tin = fineTin(dgm(), [], {}, 0.1);
  if (!tin) {
    throw new Error("the fixture has no hole");
  }
  // a Buffer's slice() shares its memory, unlike a Uint8Array's
  const bytes = Buffer.concat([
    Buffer.alloc(8),
    packGround({ kind: "tin", tin }),
  ]).subarray(8);
  expect(unpackGround(bytes)).toEqual({ kind: "tin", tin });
});

test("the header alone names the kind and the bounds", () => {
  const tin = fineTin(dgm(), [], {}, 0.1);
  const path = join(mkdtempSync(join(tmpdir(), "ground-pack-")), "g.bin");
  writeFileSync(
    path,
    packGround({ kind: "tin", tin: tin as NonNullable<typeof tin> })
  );
  expect(readGroundHeader(path)).toEqual({ bounds: BOUNDS, kind: "tin" });
  writeFileSync(path, new Uint8Array(16));
  expect(() => readGroundHeader(path)).toThrow("ground entry");
});
