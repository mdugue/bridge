/**
 * What a loaded design may hold (ADR 0054). A phone's page lives within a
 * line the memory governor keeps (ADR 0047), and a design must not move
 * it: its bytes are taken from the tile cache while it is loaded
 * (create-app.ts `reserveCache`), and a design past its tier's budget is
 * not loaded at all — its textures go first, then it is refused with the
 * numbers, so the planner can export it lighter. No THREE, no DOM.
 */

export type DesignTier = "desktop" | "mobile";

export interface DesignLimits {
  /** triangles, the BVH's and the shadow pass's cost too */
  triangles: number;
  /** what it holds, on the GPU and on the page's process (bytes) */
  bytes: number;
}

const MB = 1024 * 1024;

export const DESIGN_LIMITS: Readonly<Record<DesignTier, DesignLimits>> = {
  desktop: { triangles: 3_000_000, bytes: 400 * MB },
  mobile: { triangles: 250_000, bytes: 40 * MB },
};

/** A design's weight as read. */
export interface DesignWeight {
  triangles: number;
  /** geometry: attributes and index, once on the GPU and once on the
   *  page's process (the collider reads them), plus its BVH */
  geometryBytes: number;
  /** textures as uploaded (with mips) */
  textureBytes: number;
}

export type DesignVerdict =
  | { ok: true; keepTextures: boolean; bytes: number }
  | { ok: false; reason: string };

const count = (n: number) => n.toLocaleString("de-DE");
const mb = (bytes: number) =>
  `${Math.ceil(bytes / MB).toLocaleString("de-DE")} MB`;

/**
 * The largest file a tier parses where the reader builds the whole model
 * in memory before it is weighed — an IFC in web-ifc's heap, a Rhino file
 * in rhino3dm's (bytes): those go while reading, but a phone's tab must
 * survive them. A desktop's is half a gigabyte: the file is held twice
 * (its bytes and their copy in the 32-bit wasm heap, at most 4 GB) beside
 * its tessellation, and past that the read fails as a memory abort rather
 * than with this sentence.
 */
export const DESIGN_FILE_LIMITS: Readonly<Record<DesignTier, number>> = {
  desktop: 512 * MB,
  mobile: 80 * MB,
};

/** Why a file is too large to read on this tier, or null. */
export function judgeFile(bytes: number, tier: DesignTier): string | null {
  const limit = DESIGN_FILE_LIMITS[tier];
  if (bytes <= limit) {
    return null;
  }
  const where = tier === "mobile" ? "auf dem Handy" : "hier";
  return `Die Datei ist ${mb(bytes)} groß, ${where} gehen ${mb(limit)}. Bitte nur den Entwurf ohne Umgebung exportieren.`;
}

/** Whether a design fits its tier's budget, and with its textures. */
export function judgeDesign(
  weight: DesignWeight,
  tier: DesignTier
): DesignVerdict {
  const limits = DESIGN_LIMITS[tier];
  const where = tier === "mobile" ? "auf dem Handy" : "hier";
  if (weight.triangles > limits.triangles) {
    return {
      ok: false,
      reason: `Der Entwurf hat ${count(weight.triangles)} Dreiecke, ${where} gehen ${count(limits.triangles)}. Bitte vereinfacht exportieren.`,
    };
  }
  if (weight.geometryBytes > limits.bytes) {
    return {
      ok: false,
      reason: `Der Entwurf braucht ${mb(weight.geometryBytes)}, ${where} gehen ${mb(limits.bytes)}. Bitte vereinfacht exportieren.`,
    };
  }
  const whole = weight.geometryBytes + weight.textureBytes;
  return whole <= limits.bytes
    ? { ok: true, keepTextures: true, bytes: whole }
    : { ok: true, keepTextures: false, bytes: weight.geometryBytes };
}

/** Bytes per vertex the layer keeps: position, normal and uv. */
export const VERTEX_BYTES = 12 + 12 + 8;
/** The geometry's bytes: attributes and index on the GPU and on the
 *  page's process, and the BVH's nodes (about one per two triangles at
 *  32 bytes). */
export function geometryBytes(vertices: number, triangles: number): number {
  return 2 * (vertices * VERTEX_BYTES + triangles * 12) + triangles * 16;
}

/** An RGBA8 texture's bytes with its mips. */
export function textureBytesOf(width: number, height: number): number {
  return Math.ceil(width * height * 4 * (4 / 3));
}
