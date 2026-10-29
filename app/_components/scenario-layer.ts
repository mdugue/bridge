/**
 * The Szenario-Assistent's two objects in the scene (ADR 0058): a flood's
 * water surface over the whole site and a planned volume. *Frag die Stadt*
 * sets them through the handle (`setFlood`, `setVolume`); the numbers
 * behind them are `lib/city/scenario.ts`, the same the server tools give
 * the model.
 *
 * - The flood is one grid over the site's bounds at the water level of
 *   each vertex (the surface tilts with the river), drawn half see-through
 *   over everything below it: the ground, the river and the lower floors.
 *   It receives shadows and casts none.
 * - The volume is a plain light box on the lowest ground under its corners
 *   (sunk by `SINK.box`), casting and receiving the sun's shadow like a
 *   building. It is not asked or walked into: rays pass it.
 *
 * Each builds its own material on first use and compiles before it shows
 * (`compile`); both are freed when replaced and on dispose. Nothing loads
 * before a scenario is asked for.
 */
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  type Group,
  Mesh,
  MeshStandardNodeMaterial,
} from "three/webgpu";
import { epsgToWorld } from "@/lib/city/ground-clamp";
import { SINK } from "@/lib/city/ground-join";
import {
  type FloodSurface,
  type PlannedVolume,
  volumeCorners,
} from "@/lib/city/scenario";
import { disposeObject3D } from "./three-utils";

/** Cells along the longer side of the site's flood grid. */
export const FLOOD_GRID = 128;

export interface ScenarioLayer {
  setFlood: (surface: FloodSurface | null) => void;
  setVolume: (volume: PlannedVolume | null) => void;
  dispose: () => void;
}

export interface ScenarioContext {
  /** the site's extent, [minX, minY, maxX, maxY] in the CRS */
  bounds: readonly [number, number, number, number];
  /** compiles an object's programs before it shows */
  compile: (object: Mesh) => Promise<unknown>;
  /** the ground at a CRS point, null off the loaded terrain */
  heightAt: (x: number, y: number) => number | null;
  offset: { cx: number; cy: number };
  /** what a change asks of the scene: the shadow map, the styles' gathering */
  changed: () => void;
  parent: Group;
}

/** The flood grid's positions and index over `bounds` (world frame). */
export function floodGeometry(
  bounds: ScenarioContext["bounds"],
  offset: ScenarioContext["offset"],
  surface: FloodSurface,
  cells = FLOOD_GRID
): BufferGeometry {
  const [x0, y0, x1, y1] = bounds;
  const step = Math.max(x1 - x0, y1 - y0) / cells;
  const nx = Math.max(1, Math.ceil((x1 - x0) / step));
  const ny = Math.max(1, Math.ceil((y1 - y0) / step));
  const positions = new Float32Array((nx + 1) * (ny + 1) * 3);
  let p = 0;
  for (let j = 0; j <= ny; j++) {
    const y = Math.min(y0 + j * step, y1);
    for (let i = 0; i <= nx; i++) {
      const x = Math.min(x0 + i * step, x1);
      const w = epsgToWorld(x, y, offset);
      positions[p++] = w.x;
      positions[p++] = surface(x, y);
      positions[p++] = w.z;
    }
  }
  const index = new Uint32Array(nx * ny * 6);
  let k = 0;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i;
      const b = a + 1;
      const c = a + nx + 1;
      const d = c + 1;
      // facing up: y grows north, which is world −z
      index.set([a, b, c, b, d, c], k);
      k += 6;
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setIndex(new BufferAttribute(index, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

/** The lowest ground under a volume's corners and centre, or null. */
export function volumeFoot(
  v: PlannedVolume,
  heightAt: ScenarioContext["heightAt"]
): number | null {
  const heights = [...volumeCorners(v), v]
    .map((c) => heightAt(c.x, c.y))
    .filter((h): h is number => h !== null);
  return heights.length > 0 ? Math.min(...heights) : null;
}

const FLOOD_COLOUR = new Color().setRGB(0.16, 0.38, 0.6);
const VOLUME_COLOUR = new Color().setRGB(0.93, 0.9, 0.85);

export function createScenarioLayer(ctx: ScenarioContext): ScenarioLayer {
  let flood: Mesh | null = null;
  let volume: Mesh | null = null;
  // a newer call wins over a compile still under way
  let floodTurn = 0;
  let volumeTurn = 0;
  let disposed = false;

  const remove = (mesh: Mesh | null) => {
    if (mesh) {
      mesh.removeFromParent();
      disposeObject3D(mesh);
    }
  };
  const show = async (
    mesh: Mesh,
    current: () => boolean,
    keep: (m: Mesh) => void
  ) => {
    await ctx.compile(mesh).catch(() => undefined);
    if (disposed || !current()) {
      disposeObject3D(mesh);
      return;
    }
    keep(mesh);
    ctx.parent.add(mesh);
    ctx.changed();
  };

  return {
    setFlood: (surface) => {
      const turn = ++floodTurn;
      remove(flood);
      flood = null;
      if (!surface) {
        ctx.changed();
        return;
      }
      const mesh = new Mesh(
        floodGeometry(ctx.bounds, ctx.offset, surface),
        new MeshStandardNodeMaterial({
          color: FLOOD_COLOUR,
          roughness: 0.3,
          metalness: 0,
          transparent: true,
          opacity: 0.78,
        })
      );
      mesh.name = "scenario-flood";
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.raycast = () => undefined;
      void show(
        mesh,
        () => turn === floodTurn,
        (m) => {
          flood = m;
        }
      );
    },
    setVolume: (v) => {
      const turn = ++volumeTurn;
      remove(volume);
      volume = null;
      const foot = v ? volumeFoot(v, ctx.heightAt) : null;
      if (!v || foot === null) {
        ctx.changed();
        return;
      }
      const tall = v.hoehe + SINK.box;
      const mesh = new Mesh(
        new BoxGeometry(v.breite, tall, v.tiefe),
        new MeshStandardNodeMaterial({
          color: VOLUME_COLOUR,
          roughness: 0.9,
          metalness: 0,
        })
      );
      const at = epsgToWorld(v.x, v.y, ctx.offset);
      mesh.position.set(at.x, foot - SINK.box + tall / 2, at.z);
      // clockwise from north seen from above: a negative turn about +y
      mesh.rotation.y = (-v.drehung * Math.PI) / 180;
      mesh.name = "scenario-volume";
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.raycast = () => undefined;
      mesh.updateMatrixWorld();
      void show(
        mesh,
        () => turn === volumeTurn,
        (m) => {
          volume = m;
        }
      );
    },
    dispose: () => {
      disposed = true;
      remove(flood);
      remove(volume);
      flood = null;
      volume = null;
    },
  };
}
