/**
 * Between a question and its nameplate (nameplate-layer.ts): what the
 * plate says of the inquiry (lib/city/nameplate.ts — from the card's own
 * model, with a landmark's facts fetched from the site's file on the first
 * landmark asked and a tree's from its tile's file, ADR 0042), what the city hides of a candidate place (rays
 * through the buildings' BVHs, never a tile whose BVH is being built), and
 * where the HUD covers the canvas (the panels marked `data-scene-cover`).
 */
import { type Camera, Raycaster, Vector3 } from "three/webgpu";
import { cardCredits } from "@/lib/city/card-lines";
import type { Inquiry } from "@/lib/city/inquiry";
import { inquiryCard } from "@/lib/city/inquiry";
import { type TreeFacts, treeFactsAt } from "@/lib/city/inquiry-features";
import {
  factsFor,
  type LandmarkFactsIndex,
  landmarkFactsUrl,
} from "@/lib/city/landmark-facts";
import {
  inquiryBuildings,
  isLandmarkInquiry,
  type NameplateText,
  nameplateText,
} from "@/lib/city/nameplate";
import type { NameplateBody, Vec3 } from "@/lib/city/nameplate-place";
import type { Site } from "@/lib/city/site";
import { loadTreeFacts } from "./card-fetch";
import { type CityLayer, nearestCityHit } from "./city-layer";
import { loadLandmarkFacts } from "./landmark-facts-load";
import type { Nameplate } from "./nameplate-layer";
import { setPickRay } from "./view-ray";

/** How far short of a point a ray stops (m): the plate's own building
 *  stands right behind it. */
const RAY_SHORT_M = 1;

/** The site's landmark facts file, absolute, from the tileset's extras;
 *  null where it names none. */
export function landmarkFactsHref(
  extras: unknown,
  tilesetUrl: string
): string | null {
  const file = landmarkFactsUrl(extras);
  return file ? new URL(file, tilesetUrl).href : null;
}

export interface NameplateAsk {
  /** a question answered (or nothing asked), with its outline's body */
  ask: (inquiry: Inquiry | null, body: NameplateBody | null) => void;
  /** the question's outline redrawn (another level of its tile shows) */
  reshape: (body: NameplateBody | null) => void;
}

export function createNameplateAsk(deps: {
  plate: Nameplate;
  site: Site;
  /** the site's landmark facts file, absolute; null where it has none */
  factsUrl: string | null;
  signal?: AbortSignal;
}): NameplateAsk {
  const credits = cardCredits(deps.site);
  let asked = 0;
  // the asked thing's body as last outlined: a redraw while the facts
  // load reaches the plate when it shows
  let body: NameplateBody | null = null;
  // a question asked before its outline had a body: answered once a
  // redraw brings one
  let waiting: Inquiry | null = null;
  // the building the plate names now, so asking it again keeps the plate
  let named: string | null = null;
  let namedText: NameplateText | null = null;
  // the asked building's eave over its foot (m; 0 none): what rooftop
  // letters stand on under a tower
  let eaveH = 0;
  const withEave = (b: NameplateBody): NameplateBody =>
    eaveH > 0 ? { ...b, eave: b.base + eaveH } : b;
  const ask = (inquiry: Inquiry | null, next: NameplateBody | null) => {
    const token = ++asked;
    body = next;
    waiting = inquiry && !next ? inquiry : null;
    eaveH = inquiry ? eaveOf(inquiry) : 0;
    if (!(inquiry && next)) {
      named = null;
      deps.plate.set(null);
      return;
    }
    const key = plateKey(inquiry);
    const show = (
      index: LandmarkFactsIndex | null,
      treeFacts: TreeFacts | null = null
    ) => {
      if (token !== asked || deps.signal?.aborted || !body) {
        return;
      }
      const card = inquiryCard(inquiry, null, credits, treeFacts);
      const text = nameplateText(
        inquiry,
        card,
        index ? factsFor(index, inquiryBuildings(inquiry), card.title) : null
      );
      if (text && key !== null && key === named && sameText(text, namedText)) {
        // the named building asked again: it keeps its place, no arrival
        deps.plate.reshape(withEave(body));
        return;
      }
      named = text ? key : null;
      namedText = text;
      deps.plate.set(text ? { text, body: withEave(body) } : null);
    };
    if (isLandmarkInquiry(inquiry) && deps.factsUrl) {
      // the last plate goes at once where it named another thing
      if (key === null || key !== named) {
        named = null;
        deps.plate.set(null);
      }
      void loadLandmarkFacts(deps.factsUrl).then((index) => show(index));
    } else if (inquiry.kind === "tree" && inquiry.factsUrl) {
      // the register's species, as the card names the tree (the same
      // file, fetched once between them)
      const { index } = inquiry;
      deps.plate.set(null);
      named = null;
      void loadTreeFacts(inquiry.factsUrl).then((file) =>
        show(null, file ? treeFactsAt(file, index) : null)
      );
    } else {
      show(null);
    }
  };
  return {
    reshape: (next) => {
      if (!next) {
        return;
      }
      if (waiting) {
        ask(waiting, next);
        return;
      }
      body = next;
      deps.plate.reshape(withEave(next));
    },
    ask,
  };
}

/** A building's eave over its foot (m): its largest object's (the main
 *  mass, not a tower or a dome's drum), 0 where none states one or for
 *  anything else. */
function eaveOf(inquiry: Inquiry): number {
  if (inquiry.kind !== "building") {
    return 0;
  }
  let best = 0;
  let area = -1;
  for (const o of inquiry.tree) {
    const a = o.facts.area > 0 ? o.facts.area : 0;
    if (o.eaveH > 0 && a > area) {
      best = o.eaveH;
      area = a;
    }
  }
  return best;
}

/** Whether two plates say the same (rank, title and lines). */
function sameText(a: NameplateText, b: NameplateText | null): boolean {
  return (
    b !== null &&
    a.rank === b.rank &&
    a.title === b.title &&
    a.lines.length === b.lines.length &&
    a.lines.every((line, i) => line === b.lines[i])
  );
}

/** A building question's identity (its tile and Buildings); null for
 *  anything else. */
function plateKey(inquiry: Inquiry): string | null {
  if (inquiry.kind !== "building") {
    return null;
  }
  // a structure LoD2 lacks has no Building id: its object, then
  const ids = inquiryBuildings(inquiry).filter((id) => id !== "");
  return ids.length > 0
    ? `${inquiry.tile}:${ids.join(",")}`
    : `${inquiry.tile}#${inquiry.picked.objectIndex}`;
}

const raycaster = new Raycaster();
raycaster.firstHitOnly = true;
const from = new Vector3();
const to = new Vector3();

/** The share of `points` the city's buildings hide from `camera`. A
 *  parallel camera's ray is its pick ray through the point (`setPickRay`:
 *  from the near plane, which Modell's cut moves to the section, along the
 *  true view a Militärperspektive shears). */
export function cityHides(
  camera: Camera,
  points: Vec3[],
  cities: readonly CityLayer[]
): number {
  if (points.length === 0) {
    return 0;
  }
  const ortho = (camera as { isOrthographicCamera?: boolean })
    .isOrthographicCamera;
  camera.getWorldPosition(from);
  let hidden = 0;
  for (const p of points) {
    to.set(p[0], p[1], p[2]);
    if (ortho) {
      const ndc = to.clone().project(camera);
      setPickRay(raycaster, { x: ndc.x, y: ndc.y }, camera);
      // from the near plane to the point; a point the cut put before
      // the near plane is not drawn, so nothing hides it
      const length = to
        .clone()
        .sub(raycaster.ray.origin)
        .dot(raycaster.ray.direction);
      if (length <= RAY_SHORT_M) {
        continue;
      }
      raycaster.near = 0;
      raycaster.far = length - RAY_SHORT_M;
    } else {
      const d = to.clone().sub(from);
      const length = d.length();
      if (length <= RAY_SHORT_M) {
        continue;
      }
      raycaster.set(from, d.divideScalar(length));
      raycaster.near = 0;
      raycaster.far = length - RAY_SHORT_M;
    }
    if (nearestCityHit(raycaster, cities, false)) {
      hidden++;
    }
  }
  return hidden / points.length;
}

/**
 * The HUD's panels over the canvas: those marked `data-scene-cover`, and
 * the phone's sidebar sheet, which the vendored sidebar renders without
 * our props (components/ui stays as `shadcn add` wrote it).
 */
const COVER_SELECTOR =
  "[data-scene-cover], [data-slot='sidebar'][data-mobile='true']";

/** The HUD's panels over the canvas as NDC boxes [x0, y0, x1, y1]. */
export function coverBoxes(
  canvas: HTMLElement
): [number, number, number, number][] {
  if (typeof document === "undefined") {
    return [];
  }
  const c = canvas.getBoundingClientRect();
  if (c.width <= 0 || c.height <= 0) {
    return [];
  }
  const out: [number, number, number, number][] = [];
  for (const el of document.querySelectorAll(COVER_SELECTOR)) {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) {
      continue;
    }
    const nx = (x: number) => ((x - c.left) / c.width) * 2 - 1;
    const ny = (y: number) => 1 - ((y - c.top) / c.height) * 2;
    out.push([nx(r.left), ny(r.bottom), nx(r.right), ny(r.top)]);
  }
  return out;
}
