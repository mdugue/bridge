/**
 * The ground plate (lib/city/ground-plate.ts) in the scene: one mesh per
 * site tile, a 33² grid in the land cover's palette, under every tile that
 * has no terrain level on screen. It is fetched with the tileset (a few
 * tens of kB) and stays for the session: a tile that never streamed, or
 * that the cache let go of, shows the plate instead of the sky — on a
 * flight, a turn, a jump to another part of the city. A tile's own
 * terrain hides its plate the moment either level is shown (`showUnder`),
 * and the plate comes back when that tile leaves.
 *
 * Y-up scene frame, beside the rotated `world` group in Modell's clipping
 * group (create-app.ts), so an Ausschnitt cuts it like the terrain.
 * The material is a `sceneMaterial`: one build for the site.
 */
import {
  BufferAttribute,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardNodeMaterial,
} from "three/webgpu";
import {
  decodePlate,
  type PlateRef,
  type PlateTile,
  plateHeightIndex,
  plateIndex,
  plateNormals,
  platePositions,
} from "@/lib/city/ground-plate";
import { landcoverSrgb, srgbToLinear } from "@/lib/city/landcover";
import { fetchOptionalBinary } from "./fetch-optional";
import { disposeObject3D, sceneMaterial } from "./three-utils";

export interface GroundPlate {
  group: Group;
  /** Shows each tile's plate unless that tile has a terrain level on
   *  screen (`covered`: tile ids). */
  showUnder: (covered: ReadonlySet<string>) => void;
  dispose: () => void;
}

/** Linear vertex colours from a tile's classes (the palette's sRGB), as
 *  normalised bytes, four a vertex (WebGPU has no three-byte format). */
export function plateColours(classes: Uint8Array): Uint8Array {
  const out = new Uint8Array(classes.length * 4);
  classes.forEach((id, v) => {
    const [r, g, b] = landcoverSrgb(id);
    out[v * 4] = Math.round(srgbToLinear(r) * 255);
    out[v * 4 + 1] = Math.round(srgbToLinear(g) * 255);
    out[v * 4 + 2] = Math.round(srgbToLinear(b) * 255);
    out[v * 4 + 3] = 255;
  });
  return out;
}

function plateMaterial(): MeshStandardNodeMaterial {
  return sceneMaterial(
    "ground-plate",
    () =>
      new MeshStandardNodeMaterial({
        vertexColors: true,
        roughness: 1,
        metalness: 0,
      })
  );
}

/** The meshes over the decoded tiles (each its own index: a shared one
 *  would be destroyed with the first geometry disposed). */
export function buildGroundPlate(
  tiles: readonly PlateTile[],
  n: number,
  offset: { cx: number; cy: number }
): GroundPlate {
  const group = new Group();
  group.name = "ground-plate";
  const index = plateIndex(n);
  const material = plateMaterial();
  const meshes = new Map<string, Mesh>();
  const heightAt = plateHeightIndex(tiles, n);
  for (const tile of tiles) {
    const geometry = new BufferGeometry();
    geometry.setAttribute(
      "position",
      new Float32BufferAttribute(platePositions(tile, n, offset), 3)
    );
    geometry.setAttribute(
      "color",
      new BufferAttribute(plateColours(tile.classes), 4, true)
    );
    // across the tile edges, so the plate shades without seams
    geometry.setAttribute(
      "normal",
      new Float32BufferAttribute(plateNormals(tile, n, heightAt), 3)
    );
    geometry.setIndex(new BufferAttribute(index.slice(), 1));
    geometry.computeBoundingSphere();
    const mesh = new Mesh(geometry, material);
    mesh.name = "ground-plate";
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    // nothing to pick or stand on: rays go to the terrain
    mesh.raycast = () => undefined;
    meshes.set(tile.id, mesh);
    group.add(mesh);
  }
  return {
    group,
    showUnder: (covered) => {
      for (const [id, mesh] of meshes) {
        mesh.visible = !covered.has(id);
      }
    },
    dispose: () => {
      group.removeFromParent();
      disposeObject3D(group);
    },
  };
}

/**
 * Fetches and builds the site's plate for the tiles the tileset streams
 * (`streamed`: the spawn-only tileset's one tile, or all); null when the
 * tileset names none (baked before it) or its file cannot be had — the
 * viewer then streams as it did before, holes and all.
 */
export async function loadGroundPlate(
  ref: PlateRef | undefined,
  streamed: ReadonlySet<string>,
  tilesetUrl: string,
  offset: { cx: number; cy: number },
  signal?: AbortSignal
): Promise<GroundPlate | null> {
  if (!ref) {
    return null;
  }
  const buffer = await fetchOptionalBinary(
    new URL(ref.file, tilesetUrl).href,
    signal
  );
  if (!buffer) {
    return null;
  }
  const tiles = decodePlate(new Uint8Array(buffer), ref.tiles, ref.n);
  return buildGroundPlate(
    tiles.filter((t) => streamed.has(t.id)),
    ref.n,
    offset
  );
}
