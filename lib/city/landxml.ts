/**
 * Reads a planned ground from LandXML (ADR 0054): each `<Surface>`'s TIN
 * — its points (`<P id>` as northing, easting, elevation: LandXML writes
 * north first) and faces (`<F>` three point ids) — as plan meshes, and
 * the EPSG code its `<CoordinateSystem>` names. Read by patterns, not a
 * DOM: a surveyor's LandXML is regular, and a page-free reader is
 * testable. No THREE, no DOM.
 */

import type { PlanFeature, PlanPoint } from "./plan-geometry";

export interface LandXmlPlan {
  features: PlanFeature[];
  epsg: number | null;
  /** the surfaces' names */
  surfaces: string[];
}

const SURFACE = /<Surface\b([^>]*)>([\s\S]*?)<\/Surface>/g;
const POINT = /<P\b[^>]*\bid="([^"]+)"[^>]*>([^<]+)<\/P>/g;
const FACE = /<F\b([^>]*)>([^<]+)<\/F>/g;
const NAME = /\bname="([^"]*)"/;
const EPSG = /<CoordinateSystem\b[^>]*\bepsgCode="(\d+)"/;

/** Reads a LandXML file's surfaces as planned ground. */
export function readLandXml(text: string): LandXmlPlan {
  const features: PlanFeature[] = [];
  const surfaces: string[] = [];
  for (const [, attributes, body] of text.matchAll(SURFACE)) {
    surfaces.push(NAME.exec(attributes)?.[1] ?? "");
    const points = new Map<string, PlanPoint>();
    for (const [, id, coords] of body.matchAll(POINT)) {
      const [n, e, z] = coords.trim().split(/\s+/).map(Number);
      if (Number.isFinite(n) && Number.isFinite(e)) {
        points.set(id, Number.isFinite(z) ? [e, n, z] : [e, n]);
      }
    }
    const triangles: [PlanPoint, PlanPoint, PlanPoint][] = [];
    for (const [, faceAttributes, ids] of body.matchAll(FACE)) {
      // an invisible face (i="1") is outside the surface
      if (/\bi="1"/.test(faceAttributes)) {
        continue;
      }
      const [a, b, c] = ids
        .trim()
        .split(/\s+/)
        .map((id) => points.get(id));
      if (a && b && c) {
        triangles.push([a, b, c]);
      }
    }
    if (triangles.length > 0) {
      features.push({ kind: "mesh", cls: "terrain", triangles });
    }
  }
  const epsg = EPSG.exec(text)?.[1];
  return { features, epsg: epsg ? Number(epsg) : null, surfaces };
}
