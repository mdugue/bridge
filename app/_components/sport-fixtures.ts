import {
  BoxGeometry,
  type BufferGeometry,
  DoubleSide,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  TorusGeometry,
  Vector3,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { epsgToWorld, type GroundContext } from "@/lib/city/ground-clamp";
import type { SportFixture } from "@/lib/city/sport";
import { type HeightFogUniforms, injectHeightFog } from "./height-fog";

/**
 * What stands on the sports grounds (lib/city/sport.ts `sportFixtures`):
 * football and handball goals, basketball posts, the nets across tennis and
 * volleyball courts. Drawn as the rest of the city's furniture is — plain
 * bars in a pale clay, no brand colours, no mesh detail — so a pitch reads
 * as a pitch from the ground without a single texture. Everything of a tile
 * is two merged meshes: the frames (casting shadows) and the nets (a
 * translucent, shadowless dark grey). Lives in the Y-up frame (world
 * coordinates), like the lamps.
 */
export interface SportFixtureLayer {
  dispose: () => void;
  group: Group;
}

export interface SportFixtureContext extends GroundContext {
  /** the table's frame: the tile's north-west corner, EPSG */
  origin: { x: number; y: number };
  heightFog?: HeightFogUniforms;
}

/** Pale clay, a shade lighter than the monuments: painted steel, washed out. */
const FRAME_COLOR = 0xf1_ee_e6;
const NET_COLOR = 0x4a_4f_56;
const POST = 0.12; // m, a goal post's and a hoop pole's section
const STAY = 0.05; // m, a goal's back stays and a net's posts' tape

/** A bar from a to b (local frame: x = facing, y = up, z = lateral). */
function bar(a: Vector3, b: Vector3, t: number): BufferGeometry {
  const d = new Vector3().subVectors(b, a);
  const g = new BoxGeometry(t, d.length(), t);
  const q = new Quaternion().setFromUnitVectors(
    new Vector3(0, 1, 0),
    d.normalize()
  );
  const mid = new Vector3().addVectors(a, b).multiplyScalar(0.5);
  return g.applyMatrix4(new Matrix4().compose(mid, q, new Vector3(1, 1, 1)));
}

const v = (x: number, y: number, z: number) => new Vector3(x, y, z);

/** Posts, crossbar, the frame the net would hang on sloping back. */
function goal(w: number, h: number): BufferGeometry[] {
  const z = w / 2;
  const back = Math.max(0.8, h * 0.6);
  return [
    bar(v(0, 0, -z), v(0, h, -z), POST),
    bar(v(0, 0, z), v(0, h, z), POST),
    bar(v(0, h, -z - POST / 2), v(0, h, z + POST / 2), POST),
    bar(v(0, h, -z), v(-back, 0, -z), STAY),
    bar(v(0, h, z), v(-back, 0, z), STAY),
    bar(v(-back, STAY / 2, -z), v(-back, STAY / 2, z), STAY),
  ];
}

/** A pole behind the baseline, the arm, the board 1.2 m in, the rim. */
function hoop(rim: number): BufferGeometry[] {
  const board = 1.2;
  const top = rim + 0.9;
  const ring = new TorusGeometry(0.23, 0.02, 6, 20).rotateX(Math.PI / 2);
  ring.translate(board + 0.15 + 0.23, rim, 0);
  return [
    bar(v(-1, 0, 0), v(-1, top - 0.3, 0), POST * 1.3),
    bar(v(-1, top - 0.45, 0), v(board, top - 0.45, 0), STAY * 1.6),
    new BoxGeometry(0.05, 1.05, 1.8).translate(board, rim + 0.4, 0),
    ring,
  ];
}

/** Two posts and the top tape; the net itself is `netPanel`. */
function netFrame(w: number, h: number): BufferGeometry[] {
  const z = w / 2;
  return [
    bar(v(0, 0, -z), v(0, h, -z), POST * 0.7),
    bar(v(0, 0, z), v(0, h, z), POST * 0.7),
    bar(v(0, h - 0.03, -z), v(0, h - 0.03, z), STAY),
  ];
}

/** The net: a court-high panel (tennis) or a 1 m band under the top
 *  (volleyball). */
function netPanel(w: number, h: number): BufferGeometry {
  const depth = h > 2 ? 1 : h - 0.12;
  return new PlaneGeometry(w, depth)
    .rotateY(Math.PI / 2)
    .translate(0, h - 0.06 - depth / 2, 0);
}

function fixtureParts(f: SportFixture): {
  frames: BufferGeometry[];
  nets: BufferGeometry[];
} {
  if (f.kind === "goal") {
    return { frames: goal(f.width, f.height), nets: [] };
  }
  if (f.kind === "hoop") {
    return { frames: hoop(f.height), nets: [] };
  }
  return {
    frames: netFrame(f.width, f.height),
    nets: [netPanel(f.width, f.height)],
  };
}

function fogged(
  material: MeshStandardMaterial,
  heightFog?: HeightFogUniforms
): MeshStandardMaterial {
  if (heightFog) {
    material.onBeforeCompile = (sh) => injectHeightFog(sh, heightFog);
  }
  return material;
}

export function buildSportFixtures(
  fixtures: SportFixture[],
  ctx: SportFixtureContext
): SportFixtureLayer {
  const group = new Group();
  group.name = "sport-fixtures";
  const frames: BufferGeometry[] = [];
  const nets: BufferGeometry[] = [];
  for (const f of fixtures) {
    const ex = ctx.origin.x + f.x;
    const ey = ctx.origin.y + f.y;
    const ground = ctx.heightAt(ex, ey);
    if (ground === null) {
      continue;
    }
    const { x, z } = epsgToWorld(ex, ey, ctx.offset);
    // Data bearing (from east, ccw) → a turn about world Y: world x is east,
    // world z south, so the local +x axis turns by the bearing itself.
    const m = new Matrix4().makeRotationY(f.angle).setPosition(x, ground, z);
    const parts = fixtureParts(f);
    for (const g of parts.frames) {
      frames.push(g.applyMatrix4(m));
    }
    for (const g of parts.nets) {
      nets.push(g.applyMatrix4(m));
    }
  }
  const frameMat = fogged(
    new MeshStandardMaterial({ color: FRAME_COLOR, roughness: 0.8 }),
    ctx.heightFog
  );
  const netMat = fogged(
    new MeshStandardMaterial({
      color: NET_COLOR,
      roughness: 1,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      side: DoubleSide,
    }),
    ctx.heightFog
  );
  const meshes: Mesh[] = [];
  if (frames.length > 0) {
    const mesh = new Mesh(mergeGeometries(frames.map(plain)), frameMat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    meshes.push(mesh);
  }
  if (nets.length > 0) {
    const mesh = new Mesh(mergeGeometries(nets.map(plain)), netMat);
    mesh.receiveShadow = true;
    meshes.push(mesh);
  }
  for (const [i, mesh] of meshes.entries()) {
    mesh.name = i === 0 && frames.length > 0 ? "sport-frames" : "sport-nets";
    group.add(mesh);
  }
  for (const g of [...frames, ...nets]) {
    g.dispose();
  }
  return {
    group,
    dispose: () => {
      frameMat.dispose();
      netMat.dispose();
    },
  };
}

/** Position + normal only, non-indexed-agnostic: the box, plane and torus
 *  geometries carry uvs the merge would otherwise have to match. */
function plain(g: BufferGeometry): BufferGeometry {
  g.deleteAttribute("uv");
  return g;
}
