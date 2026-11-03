/**
 * The sun study's places in the scene (plan 054 phase 2, the spike of
 * 2026-11-03): each ranked place's ground hatched, the denser the more of
 * the window it lies in shade — the scene's own hand, no text and no
 * colour scale (plan 054). One mesh for all of them, laid on the ground's
 * height at every vertex (study-marks-geometry.ts) a little over the
 * playground slab, built when a study shows its result and freed when it
 * closes; nothing of it exists before (ADR 0047). A place whose tile has
 * not streamed in lies on the coarse ground until it has: the marks are
 * laid again when a tile comes under one (`groundChanged`). It casts no shadow
 * and takes the sun's, so the live shadows of the hour lie over the hatch.
 */
import type { Object3D } from "three/webgpu";
import {
  BufferGeometry,
  Float32BufferAttribute,
  Mesh,
  MeshStandardNodeMaterial,
} from "three/webgpu";
import {
  attribute,
  color,
  float,
  fract,
  mix,
  positionWorld,
  step,
} from "three/tsl";
import { epsgToWorld, type RecenterOffset } from "@/lib/city/ground-clamp";
import { markTriangles, type StudyMark } from "./study-marks-geometry";
import { sceneMaterial } from "./three-utils";

/** How far over the ground the hatch lies (m): over the playground slab. */
const LIFT_M = 0.2;
/** The hatch: diagonal lines this many per metre, from a hair at full sun
 *  to nearly solid at full shade, in the sketches' ink on paper. */
const HATCH_PER_M = float(0.7);
const HATCH_MIN = float(0.06);
const HATCH_SPAN = float(0.8);
const PAPER = color(0xf4f2ed);
const INK = color(0x3f4fb8);

function hatchMaterial(): MeshStandardNodeMaterial {
  return sceneMaterial("study-hatch", () => {
    const m = new MeshStandardNodeMaterial({ roughness: 0.95, metalness: 0 });
    m.polygonOffset = true;
    m.polygonOffsetFactor = -2;
    m.polygonOffsetUnits = -4;
    const shade = attribute("studyShade", "float");
    const across = fract(positionWorld.x.add(positionWorld.z).mul(HATCH_PER_M));
    const line = step(across, HATCH_MIN.add(shade.mul(HATCH_SPAN)));
    m.colorNode = mix(PAPER, INK, line);
    return m;
  });
}

export interface StudyMarksDeps {
  /** the group it hangs in (the Y-up scene frame) */
  parent: Object3D;
  offset: RecenterOffset;
  /** the ground's elevation at EPSG (x, y), where a tile has it */
  heightAt: (x: number, y: number) => number | null;
  /** the coarse ground where no tile has come yet (the site's plate) */
  roughAt: (x: number, y: number) => number | null;
  /** builds an object's programs before it shows (PostStack.compile) */
  compile: (object: Object3D) => Promise<void>;
  /** the marks came or went: shadows, the still frame */
  changed: () => void;
}

export interface StudyMarks {
  /** hatches these places (and drops what showed before) */
  show: (marks: readonly StudyMark[]) => Promise<void>;
  /** the tiles changed: marks laid on the coarse ground are laid again */
  groundChanged: () => void;
  clear: () => void;
  dispose: () => void;
}

function markGeometry(
  marks: readonly StudyMark[],
  deps: StudyMarksDeps
): { geometry: BufferGeometry; rough: [number, number][] } | null {
  const position: number[] = [];
  const shade: number[] = [];
  // per mark the first vertex off the streamed tiles: when one of them
  // has a tile under it, the marks are laid again
  const rough: [number, number][] = [];
  let markRough = false;
  const groundAt = (x: number, y: number, fallback: number) => {
    const fine = deps.heightAt(x, y);
    if (fine !== null) {
      return fine;
    }
    if (!markRough) {
      markRough = true;
      rough.push([x, y]);
    }
    return deps.roughAt(x, y) ?? fallback;
  };
  for (const mark of marks) {
    markRough = false;
    const tris = markTriangles(mark);
    const centre = groundAt(mark.x, mark.y, 0);
    for (let i = 0; i < tris.length; i += 2) {
      const [x, y] = [tris[i], tris[i + 1]];
      const w = epsgToWorld(x, y, deps.offset);
      position.push(w.x, groundAt(x, y, centre) + LIFT_M, w.z);
      shade.push(mark.shade);
    }
  }
  if (position.length === 0) {
    return null;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(position, 3));
  geometry.setAttribute("studyShade", new Float32BufferAttribute(shade, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return { geometry, rough };
}

export function createStudyMarks(deps: StudyMarksDeps): StudyMarks {
  let mesh: Mesh | null = null;
  // what shows, and where some of it lies on the coarse ground
  let shown: readonly StudyMark[] = [];
  let rough: [number, number][] = [];
  // a newer show wins over one still compiling
  let generation = 0;
  const drop = () => {
    if (mesh) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
      mesh = null;
      deps.changed();
    }
  };
  const show = async (marks: readonly StudyMark[]) => {
    const mine = ++generation;
    shown = marks;
    const built = markGeometry(marks, deps);
    if (!built) {
      rough = [];
      drop();
      return;
    }
    const next = new Mesh(built.geometry, hatchMaterial());
    next.name = "study-marks";
    next.castShadow = false;
    next.receiveShadow = true;
    await deps.compile(next);
    if (mine !== generation) {
      built.geometry.dispose();
      return;
    }
    drop();
    mesh = next;
    rough = built.rough;
    deps.parent.add(next);
    deps.changed();
  };
  return {
    show,
    // only when a tile came under a mark that lay on the coarse ground:
    // a wide study's far places may never stream in
    groundChanged: () => {
      if (mesh && rough.some(([x, y]) => deps.heightAt(x, y) !== null)) {
        rough = [];
        void show(shown);
      }
    },
    clear: () => {
      generation++;
      shown = [];
      rough = [];
      drop();
    },
    dispose: () => {
      generation++;
      shown = [];
      mesh?.removeFromParent();
      mesh?.geometry.dispose();
      mesh = null;
    },
  };
}
