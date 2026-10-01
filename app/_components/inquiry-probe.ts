import type { Camera, Raycaster } from "three";
import type { Inquiry, InquiryObject } from "@/lib/city/inquiry";
import { type CityLayer, pickCityObject } from "./city-layer";

/**
 * The scene side of the "Befragen" mode (ADR 0037): asks the city what
 * stands under a screen point and marks it. Only buildings answer — a ray
 * that meets the ground first finds nothing, so a building behind a hill
 * cannot be picked through it. A finger is not a pixel: when nothing
 * stands exactly under the point, rays on two rings around it (TOLERANCE_PX)
 * vote, and the building most of them hit wins (the nearest on a tie). The
 * mark (the clay's pencil hatch) is the whole building tree, the same set
 * demolish would take; it stays until the next question or `clear`, and is
 * dropped with the tile if the tile unloads. The HUD owns the card; this
 * module owns only the scene state.
 */
export interface InquiryProbe {
  /** asks at a screen point (NDC; the crosshair when omitted) */
  ask: (ndc?: { x: number; y: number }) => Inquiry | null;
  /** removes the mark */
  clear: () => void;
}

/** The radius (CSS px) of the outer ring of rays around a tap. */
export const TOLERANCE_PX = 22;
/** Rays per ring (two rings: half and full radius). */
const RING_RAYS = 8;

/** One ring ray's answer: which building tree it hit, and how far away. */
export interface PickSample<T> {
  distance: number;
  hit: T;
  /** the building tree it hit (tile + root), for the vote */
  key: string;
}

/**
 * The building a tap means when nothing stands exactly under it: the tree
 * most ring rays hit, the nearest hit on a tie.
 */
export function chooseSample<T>(
  samples: readonly PickSample<T>[]
): PickSample<T> | null {
  const votes = new Map<string, { best: PickSample<T>; count: number }>();
  for (const s of samples) {
    const v = votes.get(s.key);
    if (!v) {
      votes.set(s.key, { best: s, count: 1 });
    } else {
      v.count += 1;
      if (s.distance < v.best.distance) {
        v.best = s;
      }
    }
  }
  let winner: { best: PickSample<T>; count: number } | null = null;
  for (const v of votes.values()) {
    if (
      !winner ||
      v.count > winner.count ||
      (v.count === winner.count && v.best.distance < winner.best.distance)
    ) {
      winner = v;
    }
  }
  return winner?.best ?? null;
}

/** NDC offsets of the rays around a point: two rings of RING_RAYS. */
export function ringOffsets(
  radiusPx: number,
  viewport: { height: number; width: number }
): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (const r of [radiusPx / 2, radiusPx]) {
    for (let i = 0; i < RING_RAYS; i++) {
      const a = ((i + (r === radiusPx ? 0.5 : 0)) / RING_RAYS) * Math.PI * 2;
      out.push({
        x: ((Math.cos(a) * r) / viewport.width) * 2,
        y: ((Math.sin(a) * r) / viewport.height) * 2,
      });
    }
  }
  return out;
}

export function createInquiryProbe(deps: {
  camera: Camera;
  /** the city layers on screen now */
  cities: () => readonly CityLayer[];
  /** whether a layer's tile is still loaded (shown or not) */
  isLoaded: (layer: CityLayer) => boolean;
  /** distance along the pick ray to the ground, or null within `far` */
  groundAlong: (raycaster: Raycaster, far: number) => number | null;
  /** the canvas size in CSS px, for the tolerance rings */
  viewport: () => { height: number; width: number };
}): InquiryProbe {
  let marked: CityLayer | null = null;

  const clear = () => {
    // A tile that unloaded took its texture with it: never touch it again.
    // One merely out of view keeps its texture, and its mark must go.
    if (marked && deps.isLoaded(marked)) {
      marked.mark(new Set());
    }
    marked = null;
  };

  /** One ray: the building it meets before the ground, if any. */
  const sample = (ndc: { x: number; y: number } | undefined) => {
    const picked = pickCityObject(deps.camera, deps.cities(), ndc);
    if (!picked) {
      return null;
    }
    const ground = deps.groundAlong(picked.raycaster, picked.distance);
    if (ground !== null && ground < picked.distance) {
      return null;
    }
    const { layer, objectIndex, distance } = picked;
    return {
      distance,
      hit: { layer, objectIndex },
      key: `${layer.tile}:${layer.table.root[objectIndex]}`,
    };
  };

  const pick = (ndc?: { x: number; y: number }) => {
    const exact = sample(ndc);
    if (exact || !ndc) {
      return exact?.hit ?? null;
    }
    const samples: PickSample<{ layer: CityLayer; objectIndex: number }>[] = [];
    for (const d of ringOffsets(TOLERANCE_PX, deps.viewport())) {
      const s = sample({ x: ndc.x + d.x, y: ndc.y + d.y });
      if (s) {
        samples.push(s);
      }
    }
    return chooseSample(samples)?.hit ?? null;
  };

  const ask = (ndc?: { x: number; y: number }): Inquiry | null => {
    clear();
    const picked = pick(ndc);
    if (!picked) {
      return null;
    }
    const { layer, objectIndex } = picked;
    const { table } = layer;
    const tree: number[] = [];
    for (let i = 0; i < table.count; i++) {
      if (table.root[i] === table.root[objectIndex] && layer.alive[i] === 1) {
        tree.push(i);
      }
    }
    layer.mark(new Set(tree));
    marked = layer;
    const object = (i: number): InquiryObject => ({
      objectIndex: i,
      building: table.building[i] === 1,
      eaveH: table.eaveH[i],
      flags: table.flags[i],
      source: table.source[i],
      facts: layer.facts(i),
    });
    return {
      kind: "building",
      tile: layer.tile,
      picked: object(objectIndex),
      tree: tree.map(object),
    };
  };

  return { ask, clear };
}
