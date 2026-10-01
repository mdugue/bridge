import {
  type BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Matrix4,
  type Mesh,
  type Object3D,
  Quaternion,
  Shape,
  SphereGeometry,
  Vector2,
  Vector3,
} from "three/webgpu";
import {
  type AskSolid,
  ringDistanceXz,
  type Slab,
} from "@/lib/city/ask-solids";
import { liveTriangles } from "@/lib/city/city-mesh";
import type { CityLayer } from "./city-layer";

/**
 * What the outline is drawn around (selection-outline.ts): the asked
 * element's triangles in world space, non-indexed. A building is its own
 * triangles out of the tile's mesh; a bridge its own out of the tile's
 * bridge meshes; a tree or a monument, which the scene draws in instanced
 * sets, a simple shape after its data — a crown's ellipsoid (a cone for a
 * conifer) on its trunk, a marker's cylinder, a basin's prism. The blur
 * softens the difference: the outline is a little rounded anyway.
 */

const at = new Vector3();

/** A geometry's triangles through `matrix`, appended to `out`. */
function appendTriangles(
  out: number[],
  geometry: BufferGeometry,
  matrix: Matrix4,
  index: ArrayLike<number> | null = geometry.getIndex()?.array ?? null
): void {
  const position = geometry.getAttribute("position");
  const count = index ? index.length : position.count;
  for (let i = 0; i < count; i++) {
    at.fromBufferAttribute(position, index ? index[i] : i).applyMatrix4(matrix);
    out.push(at.x, at.y, at.z);
  }
}

/** A building tree's triangles (the objects of `layer` in `objects`). */
export function buildingShape(
  layer: CityLayer,
  objects: ReadonlySet<number>
): Float32Array {
  const geometry = layer.mesh.geometry;
  const ids = geometry.getAttribute("featureId");
  const index = geometry.getIndex();
  if (!(ids && index)) {
    return new Float32Array();
  }
  const out: number[] = [];
  layer.mesh.updateWorldMatrix(true, false);
  appendTriangles(
    out,
    geometry,
    layer.mesh.matrixWorld,
    liveTriangles(index.array, ids.array, (i) => objects.has(i))
  );
  return Float32Array.from(out);
}

/** A pier just outside its deck's outline is still its bridge (m). */
const PIER_REACH = 12;

/** A bridge's own triangles out of its tile's bridge meshes: those whose
 *  middle lies on its deck's outline, or within a pier's reach of it. */
export function bridgeShape(
  rail: Object3D | undefined,
  deck: Slab
): Float32Array {
  const out: number[] = [];
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  rail?.traverse((o) => {
    const mesh = o as Mesh;
    if (o.userData.bridge !== true || !mesh.isMesh) {
      return;
    }
    mesh.updateWorldMatrix(true, false);
    const position = mesh.geometry.getAttribute("position");
    const index = mesh.geometry.getIndex()?.array ?? null;
    const count = index ? index.length : position.count;
    const vertex = (i: number, v: Vector3) =>
      v
        .fromBufferAttribute(position, index ? index[i] : i)
        .applyMatrix4(mesh.matrixWorld);
    for (let i = 0; i + 2 < count; i += 3) {
      vertex(i, a);
      vertex(i + 1, b);
      vertex(i + 2, c);
      const mx = (a.x + b.x + c.x) / 3;
      const mz = (a.z + b.z + c.z) / 3;
      if (ringDistanceXz(deck.ring, mx, mz) <= PIER_REACH) {
        out.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
      }
    }
  });
  return Float32Array.from(out);
}

const placed = new Matrix4();
const UPRIGHT = new Quaternion();

/** A shape after a thing's solids: a tree's crown as an ellipsoid (a cone
 *  for a conifer) on its trunk, any other cylinder as it is, a prism. */
export function solidShape(
  solids: readonly AskSolid[],
  conifer = false
): Float32Array {
  const out: number[] = [];
  const isTree = solids.length === 2;
  solids.forEach((s, k) => {
    if ("cylinder" in s) {
      const c = s.cylinder;
      const h = Math.max(c.y1 - c.y0, 0.1);
      const crown = isTree && k === 1;
      const geometry = crown
        ? conifer
          ? new ConeGeometry(1, 1, 24, 1)
          : new SphereGeometry(1, 24, 16)
        : new CylinderGeometry(1, 1, 1, 24, 1);
      // a sphere spans twice its radius; a cone or a cylinder one unit
      placed.compose(
        new Vector3(c.x, (c.y0 + c.y1) / 2, c.z),
        UPRIGHT,
        new Vector3(c.r, crown && !conifer ? h / 2 : h, c.r)
      );
      appendTriangles(out, geometry, placed);
      geometry.dispose();
    } else if ("prism" in s) {
      const p = s.prism;
      const shape = new Shape(p.ring.map(([x, z]) => new Vector2(x, -z)));
      const geometry = new ExtrudeGeometry(shape, {
        depth: Math.max(p.y1 - p.y0, 0.1),
        bevelEnabled: false,
      });
      // the shape lies in x–y (y = −z), extruded along +z: turn it upright
      placed.makeRotationX(-Math.PI / 2).setPosition(0, p.y0, 0);
      appendTriangles(out, geometry, placed);
      geometry.dispose();
    }
  });
  return Float32Array.from(out);
}

/** How far behind a stand-in shape's front the drawn element may lie (m):
 *  half the widest of its solids — the drawn crown or figure sits inside
 *  the stand-in near its front, a neighbour's crown mostly farther back. */
export function standInDepth(solids: readonly AskSolid[]): number {
  let depth = 0;
  for (const s of solids) {
    if ("cylinder" in s) {
      depth = Math.max(depth, s.cylinder.r);
    } else if ("prism" in s) {
      const xs = s.prism.ring.map(([x]) => x);
      const zs = s.prism.ring.map(([, z]) => z);
      depth = Math.max(
        depth,
        Math.hypot(
          Math.max(...xs) - Math.min(...xs),
          Math.max(...zs) - Math.min(...zs)
        ) / 2
      );
    }
  }
  return depth;
}
