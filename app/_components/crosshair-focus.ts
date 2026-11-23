/** What the lens focuses on: the nearest thing under the crosshair. */
import { Raycaster, Vector2, Vector3 } from "three/webgpu";
import type { PerspectiveCamera } from "three/webgpu";
import { toleranceBox } from "@/lib/city/ask-items";
import { nearestInSets, rayAabb, setsBox } from "@/lib/city/ask-solids";
import type { Aabb, AskHit, AskSet } from "@/lib/city/ask-solids";
import type { FeatureInquiry } from "@/lib/city/inquiry-features";
import type { Xyz } from "@/lib/city/pose";
import { nearestCityHit } from "./city-layer";
import type { CityLayer } from "./city-layer";

/** How deep under the ground a design may stand for the focus (m): a
 *  site's ground is pressed under the design (design-site.ts), which the
 *  ground's rays do not see — a sunken court, not a design across a hill. */
const DESIGN_PRESS_M = 5;

export interface CrosshairFocusContext {
  camera: PerspectiveCamera;
  /** the visible building tiles (their BVHs, where built) */
  cities: () => readonly CityLayer[];
  /** every visible tile's built ask sets (trees, lamps, furniture, …) */
  tileAsks: () => Iterable<AskSet<FeatureInquiry>[] | undefined>;
  /** a loaded design's ask sets */
  designAsks: () => AskSet<{ kind: string }>[];
  /** where a ray meets the ground before `far` (m along it) */
  groundAlong: (ray: Raycaster, far: number) => number | null;
  /** an instance a design's site folded away: not there to focus on */
  folded: (target: FeatureInquiry, at: { x: number; z: number }) => boolean;
  /** the point the lens pulls its focus to (null: nothing met) */
  focusOn: (point: Vector3 | null) => void;
}

/**
 * Crosshair autofocus for the photographic DoF, one owner of the scene's
 * (create-app.ts casts it ten times a second, like the pose): every
 * visible tile's buildings (their BVHs), the ground by marching its height
 * grid, and the things the probe can ask (trees, lamps, …) — the nearest
 * hit wins.
 */
export interface CrosshairFocus {
  /** casts the ray and hands the lens what it met */
  update: () => void;
  /** what the last cast met (the debug readout's) */
  last: () => { dist: number; name: string } | null;
}

export function createCrosshairFocus(
  ctx: CrosshairFocusContext
): CrosshairFocus {
  const { camera } = ctx;
  const raycaster = new Raycaster();
  raycaster.firstHitOnly = true;
  raycaster.far = 6000;
  const crosshair = new Vector2(0, 0);
  let lastHit: { dist: number; name: string } | null = null;
  const focusAt = new Vector3();
  // What the probe can ask that the lens can focus on, without a copy ten
  // times a second: the built ask sets of every visible tile whose sets'
  // box the ray enters before `far` (the box kept while a tile's list
  // stays as long), and a design's. Not glass, which writes no depth —
  // focused on, the thing aimed at would blur: a set in the tiles' lists
  // drawn as glass says so (`AskSet.glass`, the traffic flows), and the
  // data layers' counters are never in them (one hung there takes the
  // flag).
  const boxes = new WeakMap<object, { count: number; box: Aabb | null }>();
  function* setsOnRay(o: Xyz, d: Xyz, far: number) {
    for (const sets of ctx.tileAsks()) {
      if (!sets) {
        continue;
      }
      let kept = boxes.get(sets);
      if (kept?.count !== sets.length) {
        kept = { count: sets.length, box: setsBox(sets) };
        boxes.set(sets, kept);
      }
      const enter = kept.box ? rayAabb(o, d, kept.box) : null;
      if (enter !== null && enter <= far) {
        yield* sets;
      }
    }
  }
  // what the lens may focus on of what a ray met: not a box the probe
  // tolerates round a landing stage or a playground's outline (it stands
  // over the surface drawn), nor what a design's site folded away
  const focusable = (t: AskHit<FeatureInquiry>) =>
    !toleranceBox(t) &&
    !ctx.folded(t.target, raycaster.ray.at(t.distance, focusAt));
  // The trees, lamps, furniture and monuments the probe can ask (their
  // sets come in idle time, a mesh's BVH with a question: the focus never
  // builds either) before `far`: a tree in the middle of the view is what
  // the lens focuses on, not the facade behind it. A design stands on
  // ground pressed under it, which the ground's rays do not know: it may
  // lie behind the ground they meet by as far as the ray runs to sink
  // `DESIGN_PRESS_M` (far at a walker's grazing angle), never behind a
  // building (`buildingFar`).
  const thingOnRay = (far: number, buildingFar: number) => {
    const { origin, direction } = raycaster.ray;
    const tileThing = nearestInSets(
      origin,
      direction,
      setsOnRay(origin, direction, far),
      far,
      focusable
    );
    const designThing = nearestInSets(
      origin,
      direction,
      ctx.designAsks(),
      tileThing?.distance ??
        Math.min(
          buildingFar,
          far + DESIGN_PRESS_M / Math.max(-direction.y, 1e-3)
        )
    );
    return designThing ?? tileThing;
  };
  const update = () => {
    raycaster.setFromCamera(crosshair, camera);
    // Only the tiles whose BVH is built: the focus never builds one (ten
    // times a second), and a far tile without one lies past the lens's
    // depth anyway.
    const hit = nearestCityHit(raycaster, ctx.cities(), false)?.hit;
    const groundAt = ctx.groundAlong(raycaster, hit?.distance ?? raycaster.far);
    const thing = thingOnRay(
      groundAt ?? hit?.distance ?? raycaster.far,
      hit?.distance ?? raycaster.far
    );
    if (thing) {
      const point = raycaster.ray.at(thing.distance, new Vector3());
      lastHit = { dist: thing.distance, name: thing.target.kind };
      ctx.focusOn(point);
      return;
    }
    if (groundAt !== null && (!hit || groundAt < hit.distance)) {
      const point = raycaster.ray.at(groundAt, new Vector3());
      lastHit = { dist: camera.position.distanceTo(point), name: "terrain" };
      ctx.focusOn(point);
      return;
    }
    lastHit = hit
      ? {
          dist: camera.position.distanceTo(hit.point),
          name: hit.object.name || hit.object.type,
        }
      : null;
    ctx.focusOn(hit?.point ?? null);
  };
  return { update, last: () => lastHit };
}
