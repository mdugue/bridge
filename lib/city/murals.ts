/**
 * The murals as photo textures on their walls (pipeline/bake/murals.py →
 * `data/<site>/murals/murals.json` and one WebP each): the file's shape,
 * what the tileset's extras say of it, the credit each photo needs, and
 * the strip a mural is drawn as. The pure half of
 * app/_components/mural-layer.ts. No THREE, no DOM.
 *
 * A mural is drawn as a strip along its wall: one column of two vertices
 * (its bottom and its top) per vertex of its path, the photo's left edge
 * at the path's start — the path runs with the wall's outside on its
 * right, so the photo reads as seen from the street.
 */

/** The committed file (pipeline/bake/murals.py) and the name
 *  scripts/prepare-data.ts publishes it under (before hashing). */
export function muralsSource(dataDir: string): string {
  return `${dataDir}/murals/murals.json`;
}
export const MURALS_FILE = "murals.json";

/** The committed WebP of a mural (`Mural.image` is its file name). */
export function muralImageSource(dataDir: string, image: string): string {
  return `${dataDir}/murals/${image}`;
}

/** A photo's Commons credit. */
export interface MuralPhoto {
  author: string;
  licence: string;
  /** the Commons title, `File:…` */
  title: string;
  /** its Commons page */
  url: string;
}

export interface Mural {
  /** the LoD2 building it hangs on (`buildingId` in the city's table):
   *  it goes when the building does */
  building: string;
  /** how the photo shows it: all of it, or the band of a line's whole
   *  length that it shows (pipeline/bake/murals.py `choose`) */
  how: "band" | "whole";
  /** OSM's id: `n…` a node, `w…` a way */
  id: string;
  /** the WebP: its file name in the committed folder, its published name
   *  once prepare-data has published it */
  image: string;
  kind: string;
  name: string;
  /** along the wall, a few cm in front of it, the wall's outside on its
   *  right (projected metres) */
  path: [number, number][];
  photo: MuralPhoto;
  /** the WebP's width and height (pixels) */
  px: [number, number];
  /** its width along the wall and its height (m) */
  size: [number, number];
  /** the tile whose buildings hold its wall */
  tile: string;
  /** above sea level (m) */
  bottom: number;
  top: number;
}

export interface MuralFile {
  attribution: string;
  murals: Mural[];
}

/** What the tileset's extras say of the murals: the published file and the
 *  photos' credits (the HUD's sources list them). Absent where the site has
 *  none. */
export interface MuralExtras {
  murals?: { credits: string[]; file: string };
}

/** The murals a tileset's extras name, if they name them well-formed. */
export function muralsOf(extras: unknown): MuralExtras["murals"] {
  const murals = (extras as MuralExtras | null)?.murals;
  return murals &&
    typeof murals.file === "string" &&
    Array.isArray(murals.credits) &&
    murals.credits.every((c) => typeof c === "string")
    ? murals
    : undefined;
}

/** A photo's credit line, as the HUD's sources list it. */
export function muralCredit(mural: Pick<Mural, "name" | "photo">): string {
  const author = mural.photo.author.replace(/^User:/, "");
  const name = mural.name ? `„${mural.name}“` : "";
  return `Wandbild ${name}: Foto ${author}, ${mural.photo.licence}, Wikimedia Commons`
    .replace(/ {2,}/g, " ")
    .replace(" :", ":");
}

function isPoint(p: unknown): p is [number, number] {
  return (
    Array.isArray(p) &&
    p.length === 2 &&
    p.every((v) => typeof v === "number" && Number.isFinite(v))
  );
}

function isMural(m: unknown): m is Mural {
  const o = m as Partial<Mural> | null;
  return (
    typeof o?.id === "string" &&
    typeof o.tile === "string" &&
    typeof o.building === "string" &&
    typeof o.image === "string" &&
    Array.isArray(o.path) &&
    o.path.length >= 2 &&
    o.path.every(isPoint) &&
    typeof o.bottom === "number" &&
    typeof o.top === "number" &&
    o.top > o.bottom &&
    isPoint(o.px) &&
    typeof o.photo?.author === "string"
  );
}

/** The file's murals, the malformed ones left out; null for no file. */
export function parseMurals(json: unknown): Mural[] | null {
  const murals = (json as Partial<MuralFile> | null)?.murals;
  return Array.isArray(murals) ? murals.filter(isMural) : null;
}

/** A mural's strip in the viewer's Y-up frame (lib/city/tileset.ts:
 *  x = E − cx, z = −(N − cy)): per path vertex its bottom and its top,
 *  the photo's u along the path, v 0 at its top row (the texture is not
 *  flipped), each column's normal the mean of its segments' outside. */
export interface MuralStrip {
  index: Uint16Array;
  normals: Float32Array;
  positions: Float32Array;
  uvs: Float32Array;
}

/** The outside normal (x, y on the map) of each segment of `path`. */
function segmentNormals(path: readonly [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < path.length; i++) {
    const dx = path[i + 1][0] - path[i][0];
    const dy = path[i + 1][1] - path[i][1];
    const len = Math.hypot(dx, dy) || 1;
    // the outside is on the right of the way
    out.push([dy / len, -dx / len]);
  }
  return out;
}

export function muralStrip(
  mural: Pick<Mural, "bottom" | "path" | "top">,
  offset: { cx: number; cy: number }
): MuralStrip {
  const { path } = mural;
  const n = path.length;
  const along = [0];
  for (let i = 1; i < n; i++) {
    along.push(
      along[i - 1] +
        Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1])
    );
  }
  const total = along[n - 1] || 1;
  const segs = segmentNormals(path);
  const positions = new Float32Array(n * 6);
  const normals = new Float32Array(n * 6);
  const uvs = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const a = segs[Math.max(i - 1, 0)];
    const b = segs[Math.min(i, segs.length - 1)];
    const nx = a[0] + b[0];
    const ny = a[1] + b[1];
    const len = Math.hypot(nx, ny) || 1;
    const x = path[i][0] - offset.cx;
    const z = -(path[i][1] - offset.cy);
    const u = along[i] / total;
    // bottom then top
    positions.set([x, mural.bottom, z, x, mural.top, z], i * 6);
    normals.set([nx / len, 0, -ny / len, nx / len, 0, -ny / len], i * 6);
    uvs.set([u, 1, u, 0], i * 4);
  }
  const index = new Uint16Array((n - 1) * 6);
  for (let i = 0; i + 1 < n; i++) {
    const b0 = i * 2;
    const t0 = b0 + 1;
    const b1 = b0 + 2;
    const t1 = b0 + 3;
    // counter-clockwise seen from the outside
    index.set([b0, b1, t0, t0, b1, t1], i * 6);
  }
  return { index, normals, positions, uvs };
}

/** The most texels a metre a phone draws a mural with: half what the bake
 *  keeps for a desktop (pipeline/bake/murals.py `PX_PER_M`). */
export const PHONE_PX_PER_M = 32;

/** The size a mural's photo is decoded at: as baked, on a phone at most
 *  PHONE_PX_PER_M a metre — never larger than the file. */
export function muralTexels(
  mural: Pick<Mural, "px" | "size">,
  phone: boolean
): [number, number] {
  const [w, h] = mural.px;
  if (!phone) {
    return [w, h];
  }
  const width = Math.min(w, Math.round(mural.size[0] * PHONE_PX_PER_M));
  return [Math.max(width, 1), Math.max(Math.round((h * width) / w), 1)];
}

/** The GPU and CPU bytes a decoded mural holds: its texture with mipmaps
 *  and the bitmap kept for an upload again (RGBA). */
export function muralBytes(texels: readonly [number, number]): number {
  const base = texels[0] * texels[1] * 4;
  return Math.round(base * (4 / 3)) + base;
}
