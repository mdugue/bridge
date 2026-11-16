/**
 * What the parts of the building bake share (scripts/bake-city-mesh.ts):
 * the tile as it is baked (`BakedCityMesh`), what is laid on its walls
 * (`OnWalls`), the rounding of what goes into the tables and the
 * triangulator. No DOM.
 */
import type { CityVertices } from "./vertex-stream";
import { ShapeUtils, Vector2 } from "three";
import type { Matrix4 } from "three";
import type { CityObjectRow } from "../lib/city/city-mesh";
import type {
  DoorFeature,
  DormerFeature,
  PassageFeature,
  ShopfrontWall,
  PlinthFeature,
} from "../lib/city/features";
import type { WindowWall } from "../lib/city/windows";

/** Trims JSON noise: colours to 3 decimals, metres to centimetres. */
export const r3 = (x: number) => Math.round(x * 1000) / 1000;
export const cm = (x: number) => Math.round(x * 100) / 100;
export const rgb = (c: [number, number, number]): [number, number, number] => [
  r3(c[0]),
  r3(c[1]),
  r3(c[2]),
];

/** What the bake lays on the LoD2 walls, each feature on its host. */
export interface OnWalls {
  doors?: readonly DoorFeature[];
  dormers?: readonly DormerFeature[];
  /** the fine ground's height (EPSG), which the ground-floor windows clear */
  groundAt?: (x: number, y: number) => number | null;
  /** OSM's passages through the buildings, cut open and lined
   *  (`withPassages`) */
  passages?: readonly PassageFeature[];
  plinths?: readonly PlinthFeature[];
  shopfronts?: readonly ShopfrontWall[];
  windows?: readonly WindowWall[];
}

export interface BakedCityMesh {
  epsg: number;
  /** the recenter matrix, to be shared with the block's other tiles */
  matrix: Matrix4;
  objects: CityObjectRow[];
  /** recenter offset: mesh x = epsgX − cx, mesh y = epsgY − cy (Z-up) */
  offset: { cx: number; cy: number };
  vertices: CityVertices;
}

/** THREE's polygon triangulation behind lib/city/structures.ts's
 *  `Triangulate` (flat coordinates, hole starts → flat index triples). */
export const triangulateXY = (data: number[], holes: number[]): number[] => {
  const pts: Vector2[] = [];
  for (let i = 0; i + 1 < data.length; i += 2) {
    pts.push(new Vector2(data[i], data[i + 1]));
  }
  const cuts = [...holes, pts.length];
  const contour = pts.slice(0, cuts[0]);
  const rings = holes.map((start, i) => pts.slice(start, cuts[i + 1]));
  // triangulateShape indexes contour ++ holes, as Triangulate does
  return ShapeUtils.triangulateShape(contour, rings).flat();
};

/** A segment the plinth breaks for (EPSG) and the building tree whose
 *  plinth it breaks: a neighbour's set back beside it keeps its own. */
export interface PlinthBreak {
  at: readonly (readonly number[])[];
  root: number;
}

export const mixRgb = (
  a: readonly number[],
  b: readonly number[],
  t: number
): [number, number, number] => [
  r3(a[0] + (b[0] - a[0]) * t),
  r3(a[1] + (b[1] - a[1]) * t),
  r3(a[2] + (b[2] - a[2]) * t),
];

/** Each building tree's triangles (its root → each triangle's first vertex):
 *  the walls a door is laid on. */
export function treeTriangles(
  baked: Pick<BakedCityMesh, "objects" | "vertices">
): Map<number, number[]> {
  const out = new Map<number, number[]>();
  const ids = baked.vertices.objectIds;
  for (let t = 0; t + 2 < ids.length; t += 3) {
    const root = baked.objects[ids[t]]?.root;
    if (root !== undefined) {
      const list = out.get(root);
      if (list) {
        list.push(t);
      } else {
        out.set(root, [t]);
      }
    }
  }
  return out;
}
