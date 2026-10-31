/**
 * Between a question and its nameplate (nameplate-layer.ts): what the
 * plate says of the inquiry (lib/city/nameplate.ts — from the card's own
 * model, with a landmark's facts fetched from the site's file on the first
 * landmark asked, ADR 0042), what the city hides of a candidate place (rays
 * through the buildings' BVHs, never a tile whose BVH is being built), and
 * where the HUD covers the canvas (the panels marked `data-scene-cover`).
 */
import { type Camera, Raycaster, Vector3 } from "three/webgpu";
import { cardCredits } from "@/lib/city/card-lines";
import type { Inquiry } from "@/lib/city/inquiry";
import { inquiryCard } from "@/lib/city/inquiry";
import {
  factsFor,
  indexLandmarkFacts,
  isLandmarkFactsFile,
  type LandmarkFactsIndex,
} from "@/lib/city/landmark-facts";
import {
  inquiryBuildings,
  isLandmarkInquiry,
  nameplateText,
} from "@/lib/city/nameplate";
import type { Vec3 } from "@/lib/city/nameplate-place";
import type { Site } from "@/lib/city/site";
import { type CityLayer, nearestCityHit } from "./city-layer";
import type { Nameplate } from "./nameplate-layer";

/** How far short of a point a ray stops (m): the plate's own building
 *  stands right behind it. */
const RAY_SHORT_M = 1;
/** A parallel camera's rays start this far back (m). */
const ORTHO_BACK_M = 5000;

export interface NameplateAsk {
  /** a question answered (or nothing asked), with the outline's triangles */
  ask: (inquiry: Inquiry | null, positions: Float32Array | null) => void;
}

export function createNameplateAsk(deps: {
  plate: Nameplate;
  site: Site;
  /** the site's landmark facts file, absolute; null where it has none */
  factsUrl: string | null;
  signal?: AbortSignal;
}): NameplateAsk {
  const credits = cardCredits(deps.site);
  let facts: Promise<LandmarkFactsIndex | null> | null = null;
  let asked = 0;
  const loadFacts = () => {
    const url = deps.factsUrl;
    if (!url) {
      return Promise.resolve(null);
    }
    facts ??= fetch(url, { signal: deps.signal })
      .then((r) => (r.ok ? (r.json() as Promise<unknown>) : null))
      .then((json) =>
        isLandmarkFactsFile(json) ? indexLandmarkFacts(json) : null
      )
      .catch(() => {
        // not kept: the next landmark asks again
        facts = null;
        return null;
      });
    return facts;
  };
  return {
    ask: (inquiry, positions) => {
      const token = ++asked;
      if (!(inquiry && positions && positions.length >= 9)) {
        deps.plate.set(null);
        return;
      }
      const card = inquiryCard(inquiry, null, credits);
      const show = (index: LandmarkFactsIndex | null) => {
        if (token !== asked) {
          return;
        }
        const text = nameplateText(
          inquiry,
          card,
          index ? factsFor(index, inquiryBuildings(inquiry)) : null
        );
        deps.plate.set(text ? { text, positions } : null);
      };
      if (isLandmarkInquiry(inquiry) && deps.factsUrl) {
        void loadFacts().then(show);
      } else {
        show(null);
      }
    },
  };
}

const raycaster = new Raycaster();
raycaster.firstHitOnly = true;
const from = new Vector3();
const to = new Vector3();

/** The share of `points` the city's buildings hide from `camera`. */
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
  const forward = camera.getWorldDirection(new Vector3());
  let hidden = 0;
  for (const p of points) {
    to.set(p[0], p[1], p[2]);
    const origin = ortho
      ? to.clone().addScaledVector(forward, -ORTHO_BACK_M)
      : from;
    const d = to.clone().sub(origin);
    const length = d.length();
    if (length <= RAY_SHORT_M) {
      continue;
    }
    raycaster.set(origin, d.divideScalar(length));
    raycaster.near = 0;
    raycaster.far = length - RAY_SHORT_M;
    if (nearestCityHit(raycaster, cities, false)) {
      hidden++;
    }
  }
  return hidden / points.length;
}

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
  for (const el of document.querySelectorAll("[data-scene-cover]")) {
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
