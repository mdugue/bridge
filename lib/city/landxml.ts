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

const SURFACE = /<Surface\b(?<attributes>[^>]*)>(?<body>[\s\S]*?)<\/Surface>/gu;
const POINT = /<P\b[^>]*\bid="(?<id>[^"]+)"[^>]*>(?<coords>[^<]+)<\/P>/gu;
const FACE = /<F\b(?<attributes>[^>]*)>(?<ids>[^<]+)<\/F>/gu;
const NAME = /\bname="(?<name>[^"]*)"/u;
const EPSG = /<CoordinateSystem\b[^>]*\bepsgCode="(?<epsg>\d+)"/u;

/** A surface body's `<P>` points by id. */
function readPoints(body: string): Map<string, PlanPoint> {
  const points = new Map<string, PlanPoint>();
  for (const point of body.matchAll(POINT)) {
    const { id = "", coords = "" } = point.groups ?? {};
    const [n, e, z] = coords.trim().split(/\s+/u).map(Number);
    if (Number.isFinite(n) && Number.isFinite(e)) {
      points.set(id, Number.isFinite(z) ? [e, n, z] : [e, n]);
    }
  }
  return points;
}

/** A surface body's visible `<F>` faces as triangles of its points. */
function readTriangles(
  body: string,
  points: Map<string, PlanPoint>
): [PlanPoint, PlanPoint, PlanPoint][] {
  const triangles: [PlanPoint, PlanPoint, PlanPoint][] = [];
  for (const face of body.matchAll(FACE)) {
    const { attributes: faceAttributes = "", ids = "" } = face.groups ?? {};
    // an invisible face (i="1") is outside the surface
    if (/\bi="1"/u.test(faceAttributes)) {
      continue;
    }
    const [a, b, c] = ids
      .trim()
      .split(/\s+/u)
      .map((id) => points.get(id));
    if (a && b && c) {
      triangles.push([a, b, c]);
    }
  }
  return triangles;
}

/** Reads a LandXML file's surfaces as planned ground. */
export function readLandXml(text: string): LandXmlPlan {
  const features: PlanFeature[] = [];
  const surfaces: string[] = [];
  for (const surface of text.matchAll(SURFACE)) {
    const { attributes = "", body = "" } = surface.groups ?? {};
    surfaces.push(NAME.exec(attributes)?.groups?.name ?? "");
    const triangles = readTriangles(body, readPoints(body));
    if (triangles.length > 0) {
      features.push({ kind: "mesh", cls: "terrain", triangles });
    }
  }
  const epsg = EPSG.exec(text)?.groups?.epsg;
  return { features, epsg: epsg ? Number(epsg) : null, surfaces };
}
