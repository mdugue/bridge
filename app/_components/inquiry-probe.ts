import { type Camera, Raycaster, Vector2 } from "three/webgpu";
import { type AskHit, type AskSet, hitsInSets } from "@/lib/city/ask-solids";
import type { FeatureInquiry } from "@/lib/city/inquiry-features";
import type { Inquiry, InquiryObject } from "@/lib/city/inquiry";
import { type CityLayer, cityObjectsAlong } from "./city-layer";
import { setPickRay } from "./view-ray";

/**
 * The scene side of the "Befragen" mode (ADR 0042): asks the city what
 * stands under a screen point and marks it. A ray meets everything on its
 * way until the ground (a building behind a hill cannot be picked through
 * it); what it chooses is the first solid thing — a building, a bridge, a
 * monument, a counted flow — and a tree only where nothing solid stands on
 * the ray: a crown is a stand-in wider than its leaves, and a house half
 * behind one is what a click on it most often means. Everything else the
 * ray met is a candidate, nearest first (`Asked.candidates`): the trees in
 * front, the houses behind. A finger is not a pixel: rays on two rings
 * around the point (TOLERANCE_PX) add what they meet first to the
 * candidates, and when nothing stands exactly under the point, the thing
 * most of them chose wins (the nearest on a tie). The mark (the clay's
 * pencil hatch, and the outline round the whole of it) is the whole
 * building tree, the same set demolish would take; a tree, monument or
 * bridge gets the outline alone. It stays until the next question or
 * `clear`; the hatch goes with its tile if the tile unloads. `preview`
 * moves the outline alone to another candidate for a moment. The HUD owns
 * the card and the candidates' strip; this module owns only the scene
 * state.
 */
export interface InquiryProbe {
  /** asks at a screen point (NDC; the crosshair when omitted) and marks
   *  what it chose */
  ask: (ndc?: { x: number; y: number }) => Asked | null;
  /** marks another candidate of the last question; its inquiry */
  select: (index: number) => Inquiry | null;
  /** outlines a candidate of the last question for a moment (null: the
   *  chosen one again) */
  preview: (index: number | null) => void;
  /** removes the mark */
  clear: () => void;
}

/** What a question met: its candidates, nearest first, and the chosen. */
export interface Asked {
  candidates: { distance: number; inquiry: Inquiry; key: string }[];
  selected: number;
}

/** The radius (CSS px) of the outer ring of rays around a tap. */
export const TOLERANCE_PX = 22;
/** Rays per ring (two rings: half and full radius). */
const RING_RAYS = 8;
/** The most candidates a question offers. */
export const MAX_CANDIDATES = 8;
/** What one ring ray adds to the candidates: its first few hits. */
const RING_HITS = 2;

/** One ray's answer: which thing it hit, and how far away. */
export interface PickSample<T> {
  distance: number;
  hit: T;
  /** the thing it hit (a building tree: tile + root), for the vote */
  key: string;
  /** a stand-in wider than what it stands for (a tree's crown) */
  porous?: boolean;
}

/**
 * The thing a ray means among what it met, nearest first: the first solid
 * one; a porous one (a crown) only when nothing solid stands behind it.
 */
export function firstSolid<T>(
  hits: readonly PickSample<T>[]
): PickSample<T> | null {
  return hits.find((h) => !h.porous) ?? hits[0] ?? null;
}

/**
 * The thing a tap means when nothing stands exactly under it: the one
 * most ring rays chose, the nearest hit on a tie.
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

/**
 * The candidates of a question, nearest first, each thing once (its
 * nearest hit): everything the exact ray met and the first few each ring
 * ray met, at most `max` — the chosen one always among them.
 */
export function mergeCandidates<T>(
  chosen: PickSample<T>,
  exact: readonly PickSample<T>[],
  rings: readonly (readonly PickSample<T>[])[],
  max = MAX_CANDIDATES
): PickSample<T>[] {
  const byKey = new Map<string, PickSample<T>>([[chosen.key, chosen]]);
  for (const s of [...exact, ...rings.flatMap((r) => r.slice(0, RING_HITS))]) {
    const known = byKey.get(s.key);
    if (!known || (s.distance < known.distance && s.key !== chosen.key)) {
      byKey.set(s.key, s);
    }
  }
  const all = [...byKey.values()].sort((a, b) => a.distance - b.distance);
  // nearest first, but the chosen one is never cut
  const kept = all.slice(0, max);
  if (!kept.includes(chosen)) {
    kept[kept.length - 1] = chosen;
    kept.sort((a, b) => a.distance - b.distance);
  }
  return kept;
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

/** What a ray met: a building's object, or another askable thing. */
type ProbeHit =
  | { building: { layer: CityLayer; objectIndex: number } }
  | { thing: AskHit<FeatureInquiry> };

/** What the outline goes around: a building's tree, or another thing. */
export type OutlineSubject =
  | { building: { layer: CityLayer; objects: ReadonlySet<number> } }
  | { thing: AskHit<FeatureInquiry> };

/** A thing's key for the vote: one per tree, monument, deck, counted
 *  section, counter. */
function thingKey(t: FeatureInquiry): string {
  switch (t.kind) {
    case "tree":
    case "traffic":
      return `${t.kind}:${t.tile}:${t.index}`;
    case "bikes":
      return `bikes:${t.id}:${t.position.join(",")}`;
    case "bridge":
    case "monument":
    case "canopy":
    case "furniture":
    case "hedge":
    case "lamp":
    case "landing":
    case "stop":
      return `${t.kind}:${t.tile}:${t.position.join(",")}`;
  }
}

/** The kinds whose stand-in is wider than what it stands for (a crown, a
 *  hedge) or lies flat on the ground (a playground): chosen only when
 *  nothing solid stands behind them. */
function porous(t: FeatureInquiry): boolean {
  return (
    t.kind === "tree" ||
    t.kind === "canopy" ||
    t.kind === "hedge" ||
    (t.kind === "furniture" && t.properties.k === "playground")
  );
}

/** How far a ray looks for a thing when no building stops it (m). */
const FAR = 6000;
const CENTRE = new Vector2(0, 0);

export function createInquiryProbe(deps: {
  /** the camera the frame is drawn with (Modell's parallel one, or walk/fly's) */
  camera: () => Camera;
  /** the city layers on screen now */
  cities: () => readonly CityLayer[];
  /** whether a layer's tile is still loaded (shown or not) */
  isLoaded: (layer: CityLayer) => boolean;
  /** distance along the pick ray to the ground, or null within `far` */
  groundAlong: (raycaster: Raycaster, far: number) => number | null;
  /** the outline's subject: what was asked, or null when nothing is */
  outline: (subject: OutlineSubject | null) => void;
  /** the trees, monuments and decks on screen now (lib/city/ask-items.ts) */
  things: () => Iterable<AskSet<FeatureInquiry>>;
  /** the canvas size in CSS px, for the tolerance rings */
  viewport: () => { height: number; width: number };
}): InquiryProbe {
  let marked: CityLayer | null = null;
  // the last question's candidates, as the scene knows them
  let last: { hits: ProbeHit[]; selected: number } | null = null;
  const ray = new Raycaster();

  const unmark = () => {
    // A tile that unloaded took its texture with it: never touch it again.
    // One merely out of view keeps its texture, and its mark must go.
    if (marked && deps.isLoaded(marked)) {
      marked.mark(new Set());
    }
    marked = null;
  };
  const clear = () => {
    unmark();
    last = null;
    deps.outline(null);
  };

  /** One ray: everything it meets before the ground, nearest first. */
  const along = (
    ndc: { x: number; y: number } | undefined
  ): PickSample<ProbeHit>[] => {
    const camera = deps.camera();
    const buildings = cityObjectsAlong(camera, deps.cities(), ndc);
    const reach = Math.max(
      setPickRay(ray, ndc ? new Vector2(ndc.x, ndc.y) : CENTRE, camera),
      FAR
    );
    const things = hitsInSets(
      ray.ray.origin,
      ray.ray.direction,
      deps.things(),
      reach
    );
    const hits: PickSample<ProbeHit>[] = [
      ...buildings.map(({ distance, layer, objectIndex }) => ({
        distance,
        hit: { building: { layer, objectIndex } },
        key: `${layer.tile}:${layer.table.root[objectIndex]}`,
      })),
      ...things.map((thing) => ({
        distance: thing.distance,
        hit: { thing },
        key: thingKey(thing.target),
        porous: porous(thing.target),
      })),
    ].sort((a, b) => a.distance - b.distance);
    const farthest = hits.at(-1)?.distance;
    if (farthest === undefined) {
      return [];
    }
    const ground = deps.groundAlong(ray, farthest);
    return ground === null ? hits : hits.filter((h) => h.distance <= ground);
  };

  /** A building's live tree: its objects and its inquiry (unmarked). */
  const building = (layer: CityLayer, objectIndex: number) => {
    const { table } = layer;
    const tree: number[] = [];
    for (let i = 0; i < table.count; i++) {
      if (table.root[i] === table.root[objectIndex] && layer.alive[i] === 1) {
        tree.push(i);
      }
    }
    const object = (i: number): InquiryObject => ({
      objectIndex: i,
      building: table.building[i] === 1,
      eaveH: table.eaveH[i],
      flags: table.flags[i],
      source: table.source[i],
      facts: layer.facts(i),
    });
    const inquiry: Inquiry = {
      kind: "building",
      tile: layer.tile,
      picked: object(objectIndex),
      tree: tree.map(object),
    };
    return { inquiry, objects: new Set(tree) };
  };

  const describe = (hit: ProbeHit): Inquiry =>
    "thing" in hit
      ? hit.thing.target
      : building(hit.building.layer, hit.building.objectIndex).inquiry;

  /** The outline's subject for a hit (a building's whole live tree). */
  const subject = (hit: ProbeHit): OutlineSubject =>
    "thing" in hit
      ? { thing: hit.thing }
      : {
          building: {
            layer: hit.building.layer,
            objects: building(hit.building.layer, hit.building.objectIndex)
              .objects,
          },
        };

  /** Marks a hit: the hatch on a building's tree, the outline round it. */
  const mark = (hit: ProbeHit) => {
    unmark();
    if ("building" in hit) {
      const { layer, objectIndex } = hit.building;
      const { objects } = building(layer, objectIndex);
      layer.mark(objects);
      marked = layer;
      deps.outline({ building: { layer, objects } });
    } else {
      deps.outline({ thing: hit.thing });
    }
  };

  const ask = (ndc?: { x: number; y: number }): Asked | null => {
    clear();
    const exact = along(ndc);
    const rings = ndc
      ? ringOffsets(TOLERANCE_PX, deps.viewport()).map((d) =>
          along({ x: ndc.x + d.x, y: ndc.y + d.y })
        )
      : [];
    const chosen =
      firstSolid(exact) ??
      chooseSample(
        rings
          .map((r) => firstSolid(r))
          .filter((h): h is PickSample<ProbeHit> => h !== null)
      );
    if (!chosen) {
      return null;
    }
    const kept = mergeCandidates(chosen, exact, rings);
    const selected = kept.indexOf(chosen);
    last = { hits: kept.map((k) => k.hit), selected };
    mark(chosen.hit);
    return {
      candidates: kept.map((k) => ({
        distance: k.distance,
        inquiry: describe(k.hit),
        key: k.key,
      })),
      selected,
    };
  };

  const select = (index: number): Inquiry | null => {
    const hit = last?.hits[index];
    if (!(last && hit)) {
      return null;
    }
    last.selected = index;
    mark(hit);
    return describe(hit);
  };

  const preview = (index: number | null) => {
    const hit = last?.hits[index ?? last.selected];
    if (hit) {
      deps.outline(subject(hit));
    }
  };

  return { ask, clear, preview, select };
}
