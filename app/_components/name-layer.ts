import {
  BufferGeometry,
  CanvasTexture,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  SRGBColorSpace,
} from "three";
import type { NameClass, NameFeature } from "@/lib/city/features";
import { epsgToWorld, type GroundContext } from "@/lib/city/ground-clamp";
import {
  type AtlasSlot,
  LETTER_M,
  labelPath,
  type NamedWay,
  packAtlas,
} from "@/lib/city/names";
import { type HeightFogUniforms, injectHeightFog } from "./height-fog";
import { MAP_FADE_GLSL, MAP_OVERLAY_UNIFORMS } from "./map-overlay";
import { trackTexture } from "./three-utils";

/**
 * Street names lettered on the ground, as a map would (plan 032;
 * pipeline/bake/names.py). The text is rasterised in the browser with
 * Canvas 2D, in the page's own font (Inter), so shaping, umlauts and ß come
 * from the browser: one atlas per tile, each label drawn once in the ink
 * colour with a pale halo, shelf-packed in rows. Each label is a ribbon
 * lying on the ground along its line (4 m samples, 20 cm over the TIN),
 * turned to read left to right, 4 m tall letters (main roads, squares 6 m,
 * bridges 5 m), unlit, never casting, with the height fog.
 *
 * It is a map element: invisible on foot, it fades in with the camera's
 * height over the ground (25 → 60 m, map-overlay.ts), and the minor roads'
 * names fade out again above 200–250 m, leaving the main roads — the
 * conservative end of the plan's aliasing STOP, taken without a GPU plate.
 * An atlas that would outgrow 2048 × 2048 drops the minor roads first.
 *
 * Built per fine terrain tile; `dispose` frees the atlas texture, which
 * disposeObject3D does not reach.
 */

export interface NameContext extends GroundContext {
  /** a canvas to draw the atlas on (tests pass a stand-in) */
  canvas?: (width: number, height: number) => AtlasCanvas;
  heightFog?: HeightFogUniforms;
}

/** What the layer needs of a canvas: HTMLCanvasElement or OffscreenCanvas. */
export interface AtlasCanvas {
  getContext(id: "2d"): AtlasContext | null;
  height: number;
  width: number;
}

/** The part of CanvasRenderingContext2D the layer draws with. */
export interface AtlasContext {
  fillStyle: string | CanvasGradient | CanvasPattern;
  fillText(text: string, x: number, y: number): void;
  font: string;
  lineJoin: CanvasLineJoin;
  lineWidth: number;
  measureText(text: string): { width: number };
  strokeStyle: string | CanvasGradient | CanvasPattern;
  strokeText(text: string, x: number, y: number): void;
  textBaseline: CanvasTextBaseline;
}

export interface NameLayer {
  dispose: () => void;
  group: Group;
  /** the tile's named streets, for the on-foot caption */
  ways: NamedWay[];
}

const ATLAS_PX = 2048;
const FONT_PX = 32;
const ROW_PX = 44;
/** clear space either side of a name in its slot (px) */
const PAD_PX = 8;
const HALO_PX = 6;
const INK = "rgb(122, 130, 145)"; // the contour lines' ink, a shade deeper
const HALO = "rgba(246, 242, 234, 0.75)";
const SAMPLE_M = 4;
const LIFT_M = 0.2; // over the TIN between samples
const OPACITY = 0.8;
/** minor roads' names leave above this (m over the ground) */
const MINOR_OUT_M = { from: 200, to: 250 };

function defaultCanvas(width: number, height: number): AtlasCanvas {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/** The page's own sans (next/font's Inter, via its CSS variable). */
async function labelFont(): Promise<string> {
  const family =
    typeof document === "undefined"
      ? ""
      : getComputedStyle(document.documentElement)
          .getPropertyValue("--font-sans")
          .trim();
  const font = `600 ${FONT_PX}px ${family || "system-ui"}, sans-serif`;
  if (typeof document !== "undefined") {
    await document.fonts?.load(font).catch(() => []);
  }
  return font;
}

/** The atlas's height: the rows used, to a multiple of 4 px (no
 *  power-of-two padding: WebGL 2 mips any size). */
function atlasHeight(n: number): number {
  return Math.max(Math.ceil(n / 4) * 4, 4);
}

interface Label {
  cls: NameClass;
  line: [number, number][];
  name: string;
}

function labelsOf(features: NameFeature[]): Label[] {
  return features.flatMap((f) => {
    const p = f.properties;
    if (p?.k !== "label" || !p.name || f.geometry.coordinates.length < 2) {
      return [];
    }
    return [
      { name: p.name, cls: p.c ?? "minor", line: f.geometry.coordinates },
    ];
  });
}

/** Packs the labels, dropping the minor roads' when the atlas overflows. */
function fit(
  labels: Label[],
  widths: number[]
): { height: number; labels: Label[]; slots: AtlasSlot[] } {
  let keep = labels.map((_, i) => i);
  let packed = packAtlas(widths, ROW_PX, ATLAS_PX);
  if (packed.height > ATLAS_PX) {
    keep = keep.filter((i) => labels[i].cls !== "minor");
    packed = packAtlas(
      keep.map((i) => widths[i]),
      ROW_PX,
      ATLAS_PX
    );
  }
  const within = packed.slots
    .map((slot, j) => ({ slot, i: keep[j] }))
    .filter(({ slot }) => slot.y + slot.h <= ATLAS_PX);
  return {
    labels: within.map(({ i }) => labels[i]),
    slots: within.map(({ slot }) => slot),
    height: Math.min(packed.height, ATLAS_PX),
  };
}

/** The ribbon of one label: two vertices per sample, top edge on the
 *  text's left (it reads along the path). */
function addRibbon(
  out: { minor: number[]; pos: number[]; uv: number[]; index: number[] },
  label: Label,
  slot: AtlasSlot,
  atlasH: number,
  ctx: NameContext
): void {
  const letter = LETTER_M[label.cls];
  const lengthM = ((slot.w - 2 * PAD_PX) * letter) / FONT_PX;
  const padM = (PAD_PX * letter) / FONT_PX;
  const heightM = (ROW_PX * letter) / FONT_PX;
  const { pts, s } = labelPath(label.line, lengthM + 2 * padM, SAMPLE_M);
  const total = s.at(-1) ?? 0;
  if (pts.length < 2 || total <= 0) {
    return;
  }
  const vTop = 1 - slot.y / atlasH;
  const vBottom = 1 - (slot.y + slot.h) / atlasH;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(i - 1, 0)];
    const b = pts[Math.min(i + 1, pts.length - 1)];
    const tx = b[0] - a[0];
    const ty = b[1] - a[1];
    const t = Math.hypot(tx, ty) || 1;
    const lx = (-ty / t) * (heightM / 2);
    const ly = (tx / t) * (heightM / 2);
    const u = (slot.x + (s[i] / total) * slot.w) / ATLAS_PX;
    const base = out.pos.length / 3;
    for (const [side, v] of [
      [1, vTop],
      [-1, vBottom],
    ]) {
      const x = pts[i][0] + lx * side;
      const y = pts[i][1] + ly * side;
      const g = ctx.heightAt(x, y) ?? ctx.heightAt(pts[i][0], pts[i][1]) ?? 0;
      const w = epsgToWorld(x, y, ctx.offset);
      out.pos.push(w.x, g + LIFT_M, w.z);
      out.uv.push(u, v);
      out.minor.push(label.cls === "minor" ? 1 : 0);
    }
    if (i > 0) {
      out.index.push(base - 2, base - 1, base, base - 1, base + 1, base);
    }
  }
}

function nameMaterial(
  texture: CanvasTexture,
  heightFog?: HeightFogUniforms
): MeshBasicMaterial {
  const material = new MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -8,
  });
  material.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, MAP_OVERLAY_UNIFORMS);
    sh.vertexShader = `attribute float labelMinor;
varying float vLabelMinor;
${sh.vertexShader.replace(
  "#include <begin_vertex>",
  "#include <begin_vertex>\n\tvLabelMinor = labelMinor;"
)}`;
    sh.fragmentShader = `varying float vLabelMinor;
${MAP_FADE_GLSL}
${sh.fragmentShader.replace(
  "#include <map_fragment>",
  `#include <map_fragment>
	float minorOut = vLabelMinor * smoothstep( ${MINOR_OUT_M.from.toFixed(1)}, ${MINOR_OUT_M.to.toFixed(1)}, uMapAltitude );
	diffuseColor.a *= ${OPACITY.toFixed(2)} * mapFade() * ( 1.0 - minorOut );`
)}`;
    if (heightFog) {
      injectHeightFog(sh, heightFog);
    }
  };
  return material;
}

function drawAtlas(
  canvas: AtlasCanvas,
  font: string,
  labels: Label[],
  slots: AtlasSlot[]
): void {
  const g = canvas.getContext("2d");
  if (!g) {
    return;
  }
  g.font = font;
  g.textBaseline = "middle";
  g.lineJoin = "round";
  g.lineWidth = HALO_PX;
  g.strokeStyle = HALO;
  g.fillStyle = INK;
  for (let i = 0; i < labels.length; i++) {
    const { x, y, h } = slots[i];
    g.strokeText(labels[i].name, x + PAD_PX, y + h / 2);
    g.fillText(labels[i].name, x + PAD_PX, y + h / 2);
  }
}

/** One tile's street lettering and its named ways. */
export async function buildNames(
  features: NameFeature[],
  ctx: NameContext
): Promise<NameLayer> {
  const group = new Group();
  group.name = "names";
  const ways: NamedWay[] = features.flatMap((f) =>
    f.properties?.k === "way" && f.properties.name
      ? [{ name: f.properties.name, line: f.geometry.coordinates }]
      : []
  );
  const all = labelsOf(features);
  const makeCanvas = ctx.canvas ?? defaultCanvas;
  const probe = makeCanvas(1, 1).getContext("2d");
  if (all.length === 0 || !probe) {
    return { group, ways, dispose: () => undefined };
  }
  const font = await labelFont();
  probe.font = font;
  const widths = all.map((l) => probe.measureText(l.name).width + 2 * PAD_PX);
  const { labels, slots, height } = fit(all, widths);
  const atlasH = atlasHeight(height);
  const canvas = makeCanvas(ATLAS_PX, atlasH);
  drawAtlas(canvas, font, labels, slots);
  const texture = new CanvasTexture(canvas as HTMLCanvasElement);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  // RGBA8 with its mip chain
  trackTexture(texture, Math.round(ATLAS_PX * atlasH * 4 * (4 / 3)));
  const out = { pos: [], uv: [], minor: [], index: [] } as {
    index: number[];
    minor: number[];
    pos: number[];
    uv: number[];
  };
  for (let i = 0; i < labels.length; i++) {
    addRibbon(out, labels[i], slots[i], atlasH, ctx);
  }
  if (out.index.length > 0) {
    const geo = new BufferGeometry();
    geo.setAttribute("position", new Float32BufferAttribute(out.pos, 3));
    geo.setAttribute("uv", new Float32BufferAttribute(out.uv, 2));
    geo.setAttribute("labelMinor", new Float32BufferAttribute(out.minor, 1));
    geo.setIndex(out.index);
    geo.computeBoundingSphere();
    const mesh = new Mesh(geo, nameMaterial(texture, ctx.heightFog));
    mesh.name = "names-lettering";
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.renderOrder = 3;
    group.add(mesh);
  }
  return { group, ways, dispose: () => texture.dispose() };
}
