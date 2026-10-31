/**
 * The nameplate: the name of the thing asked, set in the city beside it
 * (lib/city/nameplate.ts says what, lib/city/nameplate-place.ts where,
 * lib/city/nameplate-type.ts in which letters). A landmark's name stands
 * large in the sky beside it with its facts under it and a hairline down
 * to it; seen from above it lies on the free ground like map lettering; up
 * close it is an inscription before the plinth. A named building, bridge
 * or monument shows its name, an ordinary house its address, small.
 *
 * Drawn after the frame is finished (post-stack.ts `setOverlay`), onto the
 * canvas, so no picture style's ink, halftone or grain eats the letters;
 * no target of its own. The letters are signed distance fields
 * (nameplate-glyphs.ts) — sharp at any size, their halo or the comic's
 * box drawn by the same quads. Each pixel asks the scene pass's depth
 * whether something stands in front: what a tree or a house hides is
 * drawn as a faint outline only, like a draughtsman's hidden edge (the
 * selection outline's language, selection-outline.ts). Its place is chosen
 * a few times a second (`CHOOSE_MS`) with rays through the city's BVHs,
 * so it avoids what would hide it in the first place; a new place
 * cross-fades. Nothing of it reaches the shadow map, and it holds memory
 * only while something is asked (its atlas ≈ 0.25 MB at most, a few
 * hundred vertices).
 */
import {
  BufferGeometry,
  type Camera,
  DataTexture,
  type DepthTexture,
  DoubleSide,
  Float32BufferAttribute,
  LinearFilter,
  LinearSRGBColorSpace,
  Matrix4,
  Mesh,
  MeshBasicNodeMaterial,
  NoToneMapping,
  type OrthographicCamera,
  type PerspectiveCamera,
  RedFormat,
  type TextureNode,
  Scene,
  Uint16BufferAttribute,
  UnsignedByteType,
  Vector3,
  type WebGPURenderer,
} from "three/webgpu";
import {
  abs,
  attribute,
  float,
  fwidth,
  max,
  min,
  mix,
  positionView,
  screenUV,
  smoothstep,
  step,
  texture,
  uniform,
  vec4,
} from "three/tsl";
import type { NameplateText } from "@/lib/city/nameplate";
import {
  type NameplateBlock,
  type NameplateBody,
  type NameplateCamera,
  type NameplateLayout,
  type NameplatePose,
  type NameplateScene,
  type Vec3,
  chooseNameplate,
  nameplateBody,
  nameplatePose,
  sameLayout,
} from "@/lib/city/nameplate-place";
import {
  NAMEPLATE_CAPS,
  NAMEPLATE_TYPES,
  type NameplateType,
  atNight,
  nightDim,
} from "@/lib/city/nameplate-type";
import type { RenderStyle } from "@/lib/city/render-style";
import { compileInTurn } from "./compile-lanes";
import {
  type Align,
  FIELD_RADIUS,
  KIND,
  PAINT,
  type PlateGeometry,
  buildPlate,
  loadFaces,
} from "./nameplate-glyphs";
import type { Live } from "./shader-chunks";
import type { ViewLens } from "./view-lens";

/** How often the place is chosen again (ms). */
const CHOOSE_MS = 250;
/** A change of place: out, then in (ms). */
const CROSS_MS = 180;
/** The plate's letters build in this long after a question (ms). */
const ARRIVE_MS = 420;
/** Hidden: the scene's surface this far in front (m, and a share of the
 *  distance) — a plate a little behind a facade's relief still shows. */
const HIDDEN_SLACK_M = 0.8;
const HIDDEN_SLACK_SHARE = 0.01;
/** The hidden part's outline: how strong, how wide (field units). */
const GHOST = { alpha: 0.45, width: 0.05 } as const;
/** The leader: its width (title caps) and at least this (CSS px); the
 *  anchor dot's radius (title caps). */
const LEADER_CAPS = 0.045;
const LEADER_MIN_PX = 1.1;
const DOT_CAPS = 0.16;

/** What is asked, and what the plate is to say of it. */
export interface NameplateSubject {
  text: NameplateText;
  /** the thing's triangles, world space (the selection outline's) */
  positions: Float32Array;
}

/** What the plate asks of the scene. */
export interface NameplateDeps {
  /** what the passes know of the camera (view-lens.ts) */
  lens: ViewLens;
  /** the scene pass's depth */
  depthTexture: DepthTexture;
  /** the element the page's faces are read off (its CSS variables) */
  fonts: () => Element | null;
  /** the share of these points the city hides from the camera */
  hidden: (camera: Camera, points: Vec3[]) => number;
  groundAt: (x: number, z: number) => number;
  /** the HUD's panels over the canvas, NDC boxes */
  hud: () => readonly [number, number, number, number][];
  /** a phone's sizes */
  phone: boolean;
}

export interface Nameplate {
  set: (subject: NameplateSubject | null) => void;
  applyLook: (style: RenderStyle) => void;
  setNight: (factor: number) => void;
  /** places the plate for this frame's camera; `hold` keeps its place
   *  (an export's tiles each see a part of the picture) */
  update: (
    camera: Camera,
    viewport: { width: number; height: number },
    hold?: boolean
  ) => void;
  /** draws it onto the canvas, after the frame */
  render: (renderer: WebGPURenderer, camera: Camera) => void;
  compile: (renderer: WebGPURenderer, camera: Camera) => Promise<void>;
  /** whether a plate shows (QA) */
  shown: () => { title: string; mode: string; spot: string } | null;
  dispose: () => void;
}

const isOrtho = (c: Camera): c is OrthographicCamera =>
  (c as OrthographicCamera).isOrthographicCamera === true;

function atlasTexture(data: Uint8Array, width: number, height: number) {
  const t = new DataTexture(data, width, height, RedFormat, UnsignedByteType);
  t.minFilter = LinearFilter;
  t.magFilter = LinearFilter;
  t.generateMipmaps = false;
  t.colorSpace = "";
  t.needsUpdate = true;
  t.name = "NameplateAtlas";
  return t;
}

/** The plate's material: one graph for the letters, the box and the
 *  leader (the quad's kind picks, by `step`, never a branch). */
function plateMaterial(
  deps: Pick<NameplateDeps, "depthTexture" | "lens">,
  atlas: TextureNode<"vec4">,
  haloWidth: Live,
  fade: Live
) {
  const uvk = attribute<"vec3">("uvk", "vec3");
  const ink = attribute<"vec4">("ink", "vec4");
  const halo = attribute<"vec4">("halo", "vec4");
  const field = atlas.sample(uvk.xy).r;
  const kind = uvk.z;
  const isGlyph = float(1).sub(step(0.5, kind));
  const isDisc = step(1.5, kind);
  const isSolid = float(1).sub(isGlyph).sub(isDisc);
  // a letter: its fill on the field's mid level, its halo further out
  const aa = max(fwidth(field), 1e-4);
  const fill = smoothstep(float(0.5).sub(aa), float(0.5).add(aa), field);
  const haloEdge = float(0.5).sub(haloWidth.mul(0.5));
  const haloA = smoothstep(
    haloEdge.sub(aa),
    haloEdge.add(haloWidth.mul(0.3)),
    field
  );
  const glyphA = max(fill.mul(ink.a), haloA.mul(halo.a));
  const glyphRgb = mix(halo.rgb, ink.rgb, fill);
  const ghostGlyph = float(1)
    .sub(
      smoothstep(GHOST.width, aa.add(GHOST.width * 1.6), abs(field.sub(0.5)))
    )
    .mul(ink.a);
  // a solid: its uv's distance to the edges, antialiased
  const u = uvk.x;
  const v = uvk.y;
  const edge = min(
    min(u, float(1).sub(u)).div(max(fwidth(u), 1e-5)),
    min(v, float(1).sub(v)).div(max(fwidth(v), 1e-5))
  );
  const solidA = smoothstep(0, 1, edge).mul(ink.a);
  // a disc in its quad
  const r = uvk.xy.mul(2).sub(1).length();
  const discA = float(1)
    .sub(smoothstep(float(1).sub(max(fwidth(r), 1e-4).mul(1.5)), float(1), r))
    .mul(ink.a);
  const rgb = mix(ink.rgb, glyphRgb, isGlyph);
  const shownA = glyphA
    .mul(isGlyph)
    .add(solidA.mul(isSolid))
    .add(discA.mul(isDisc));
  const ghostA = ghostGlyph
    .mul(isGlyph)
    .add(solidA.add(discA.mul(isDisc)).mul(float(1).sub(isGlyph)).mul(0.35))
    .mul(GHOST.alpha);
  // hidden: the scene's surface in front of this fragment
  const sceneZ = deps.lens.viewZ(texture(deps.depthTexture, screenUV).r);
  const slack = deps.lens
    .fade(positionView.z.negate())
    .mul(HIDDEN_SLACK_SHARE)
    .add(HIDDEN_SLACK_M);
  const hidden = smoothstep(slack, slack.mul(2), sceneZ.sub(positionView.z));
  const a = mix(shownA, ghostA, hidden).mul(fade);
  const colour = mix(rgb, ink.rgb, hidden);
  const m = new MeshBasicNodeMaterial();
  m.colorNode = vec4(colour, 1);
  m.opacityNode = a;
  m.transparent = true;
  m.depthTest = false;
  m.depthWrite = false;
  m.side = DoubleSide;
  m.fog = false;
  m.name = "nameplate";
  return m;
}

/** An empty geometry with every attribute (the build needs them all). */
function emptyGeometry(): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute(
    "position",
    new Float32BufferAttribute(new Float32Array(12), 3)
  );
  g.setAttribute("uvk", new Float32BufferAttribute(new Float32Array(12), 3));
  g.setAttribute("ink", new Float32BufferAttribute(new Float32Array(16), 4));
  g.setAttribute("halo", new Float32BufferAttribute(new Float32Array(16), 4));
  g.setIndex(new Uint16BufferAttribute(new Uint16Array([0, 1, 2]), 1));
  return g;
}

/** The plate's colours per vertex, by what paints it, at a night factor. */
function paintColours(
  paint: Uint8Array,
  type: NameplateType,
  night: number,
  ink: Float32Array,
  halo: Float32Array
): void {
  const dim = nightDim(night);
  const h = atNight(type.halo, night);
  const colours: Record<number, readonly [number, number, number]> = {
    [PAINT.title]: atNight(type.ink, night),
    [PAINT.lines]: atNight(type.lines.ink, night),
    [PAINT.boxFill]: type.box ? atNight(type.box.fill, night) : h,
    [PAINT.boxEdge]: type.box ? atNight(type.box.edge, night) : h,
    [PAINT.shadow]: [0, 0, 0],
  };
  for (let i = 0; i < paint.length; i++) {
    const c = colours[paint[i]];
    ink.set([c[0], c[1], c[2], dim], i * 4);
    halo.set([h[0], h[1], h[2], type.halo.alpha * dim], i * 4);
  }
}

const tmp = new Vector3();

/** The scene's camera as the placement reads it. */
function plateCamera(
  camera: Camera,
  viewport: { width: number; height: number }
): NameplateCamera {
  camera.updateMatrixWorld();
  const e = camera.matrixWorld.elements;
  const right: Vec3 = [e[0], e[1], e[2]];
  const forward: Vec3 = [-e[8], -e[9], -e[10]];
  const position: Vec3 = [e[12], e[13], e[14]];
  if (isOrtho(camera)) {
    const span = (camera.top - camera.bottom) / camera.zoom;
    return {
      position,
      forward,
      right,
      ortho: true,
      pxPerM: viewport.height / span,
    };
  }
  const fov = ((camera as PerspectiveCamera).fov * Math.PI) / 180;
  return {
    position,
    forward,
    right,
    ortho: false,
    pxPerM: viewport.height / 2 / Math.tan(fov / 2),
  };
}

export function createNameplate(deps: NameplateDeps): Nameplate {
  const scene = new Scene();
  const haloWidth = uniform(0.5);
  const fade = uniform(0);
  let atlas = atlasTexture(new Uint8Array(64 * 64), 64, 64);
  const atlasNode = texture(atlas);
  const material = plateMaterial(deps, atlasNode, haloWidth, fade);
  const plate = new Mesh(emptyGeometry(), material);
  plate.frustumCulled = false;
  plate.matrixAutoUpdate = false;
  plate.visible = false;
  plate.renderOrder = 1;
  const leader = new Mesh(emptyGeometry(), material);
  leader.frustumCulled = false;
  leader.visible = false;
  leader.renderOrder = 0;
  scene.add(leader, plate);

  let style: RenderStyle = "pastel";
  let night = 0;
  let subject: NameplateSubject | null = null;
  let body: NameplateBody | null = null;
  let geometry: PlateGeometry | null = null;
  let builtFor: {
    align: Align;
    style: RenderStyle;
    text: NameplateText;
  } | null = null;
  let layout: NameplateLayout | null = null;
  let pending: NameplateLayout | null = null;
  let chosenAt = Number.NEGATIVE_INFINITY;
  let crossAt = Number.NEGATIVE_INFINITY;
  let askedAt = Number.NEGATIVE_INFINITY;
  let pose: NameplatePose | null = null;
  let generation = 0;
  let disposed = false;

  const type = () => NAMEPLATE_TYPES[style];
  const alignFor = (l: NameplateLayout | null): Align =>
    l?.mode === "street" || l?.mode === "far"
      ? l.spot === "left"
        ? "right"
        : l.spot === "right"
          ? "left"
          : "center"
      : "center";

  const block = (): NameplateBlock => ({
    width: geometry?.block.width ?? 6,
    height: geometry?.block.height ?? 2,
  });

  const recolour = () => {
    if (!geometry) {
      return;
    }
    const ink = plate.geometry.getAttribute("ink") as Float32BufferAttribute;
    const halo = plate.geometry.getAttribute("halo") as Float32BufferAttribute;
    paintColours(
      geometry.paint,
      type(),
      night,
      ink.array as Float32Array,
      halo.array as Float32Array
    );
    ink.needsUpdate = true;
    halo.needsUpdate = true;
    haloWidth.value = type().halo.width;
  };

  /** (Re)builds the plate's letters for the text, style and alignment. */
  const rebuild = (align: Align) => {
    const s = subject;
    const from = deps.fonts();
    if (!(s && from)) {
      return;
    }
    if (
      builtFor &&
      builtFor.text === s.text &&
      builtFor.style === style &&
      builtFor.align === align
    ) {
      return;
    }
    const g = buildPlate(s.text, type(), align, from);
    builtFor = { text: s.text, style, align };
    geometry = g;
    plate.geometry.dispose();
    if (!g) {
      plate.geometry = emptyGeometry();
      plate.visible = false;
      return;
    }
    const geo = new BufferGeometry();
    geo.setAttribute("position", new Float32BufferAttribute(g.positions, 3));
    geo.setAttribute("uvk", new Float32BufferAttribute(g.uvk, 3));
    const n = g.positions.length / 3;
    geo.setAttribute(
      "ink",
      new Float32BufferAttribute(new Float32Array(n * 4), 4)
    );
    geo.setAttribute(
      "halo",
      new Float32BufferAttribute(new Float32Array(n * 4), 4)
    );
    geo.setIndex(new Uint16BufferAttribute(g.index, 1));
    plate.geometry = geo;
    atlas.dispose();
    atlas = atlasTexture(g.atlas.data, g.atlas.width, g.atlas.height);
    atlasNode.value = atlas;
    recolour();
  };

  /** Loads the style's faces, then sets the letters again (a face that
   *  arrived late would leave the fallback's shapes). */
  const withFaces = () => {
    const from = deps.fonts();
    const asked = ++generation;
    if (!from) {
      return;
    }
    void loadFaces(type(), from).then(() => {
      if (disposed || asked !== generation) {
        return;
      }
      builtFor = null;
      rebuild(alignFor(layout));
    });
  };

  /** The leader and the anchor's dot (or the comic's tail), in world
   *  space, for this frame's pose. */
  const placeLeader = (p: NameplatePose, camera: NameplateCamera) => {
    const t = type();
    const anchor = p.anchor;
    if (!anchor || !geometry) {
      leader.visible = false;
      return;
    }
    const b = block();
    const at = (s: number, u: number): Vec3 => [
      p.origin[0] + p.right[0] * s * p.cap + p.up[0] * u * p.cap,
      p.origin[1] + p.right[1] * s * p.cap + p.up[1] * u * p.cap,
      p.origin[2] + p.right[2] * s * p.cap + p.up[2] * u * p.cap,
    ];
    // the leader leaves the plate's foot on the side nearest the anchor
    const rel = [
      anchor[0] - p.origin[0],
      anchor[1] - p.origin[1],
      anchor[2] - p.origin[2],
    ];
    const along =
      (rel[0] * p.right[0] + rel[1] * p.right[1] + rel[2] * p.right[2]) / p.cap;
    const footS = Math.min(Math.max(along, 0.15), b.width - 0.15);
    const foot = at(footS, 0.05);
    const distance = camera.ortho
      ? 1
      : Math.max(
          (anchor[0] - camera.position[0]) * camera.forward[0] +
            (anchor[1] - camera.position[1]) * camera.forward[1] +
            (anchor[2] - camera.position[2]) * camera.forward[2],
          0.5
        );
    const minW = (LEADER_MIN_PX * distance) / camera.pxPerM;
    const w = Math.max(LEADER_CAPS * p.cap, minW) / 2;
    const pos: number[] = [];
    const uvk: number[] = [];
    const ink: number[] = [];
    const idx: number[] = [];
    const dim = nightDim(night);
    const push = (
      corners: Vec3[],
      uv: number[][],
      kind: number,
      c: readonly [number, number, number]
    ) => {
      const base = pos.length / 3;
      for (const [i, q] of corners.entries()) {
        pos.push(q[0], q[1], q[2]);
        uvk.push(uv[i][0], uv[i][1], kind);
        ink.push(c[0], c[1], c[2], dim);
      }
      if (corners.length === 4) {
        idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      } else {
        idx.push(base, base + 1, base + 2);
      }
    };
    const r = p.right;
    if (t.leader === "tail" && t.box) {
      // the caption box's tail: from its foot to the anchor, edged
      const half = Math.min(0.5, b.width * 0.12);
      const a = at(footS - half, 0.2);
      const c = at(footS + half, 0.2);
      const edge = atNight(t.box.edge, night);
      const fill = atNight(t.box.fill, night);
      const grow = 0.09 * p.cap;
      const out = (q: Vec3, s: number): Vec3 => [
        q[0] + r[0] * s,
        q[1] + r[1] * s,
        q[2] + r[2] * s,
      ];
      const solid = [
        [0.5, 0.5],
        [0.5, 0.5],
        [0.5, 0.5],
      ];
      push([out(a, -grow), out(c, grow), anchor], solid, KIND.solid, edge);
      push([a, c, anchor], solid, KIND.solid, fill);
    } else {
      const line = atNight(t.lines.ink, night);
      const quad = (
        from: Vec3,
        to: Vec3,
        width: number,
        c: readonly [number, number, number]
      ) => {
        // across the line, in the plate's plane
        const d = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
        const l = Math.hypot(d[0], d[1], d[2]) || 1;
        // the plate's normal × the line: across it in the plane
        const n = [
          p.right[1] * p.up[2] - p.right[2] * p.up[1],
          p.right[2] * p.up[0] - p.right[0] * p.up[2],
          p.right[0] * p.up[1] - p.right[1] * p.up[0],
        ];
        const x: Vec3 = [
          (n[1] * d[2] - n[2] * d[1]) / l,
          (n[2] * d[0] - n[0] * d[2]) / l,
          (n[0] * d[1] - n[1] * d[0]) / l,
        ];
        const o = (q: Vec3, s: number): Vec3 => [
          q[0] + x[0] * s,
          q[1] + x[1] * s,
          q[2] + x[2] * s,
        ];
        push(
          [o(from, -width), o(from, width), o(to, width), o(to, -width)],
          [
            [0, 0.5],
            [1, 0.5],
            [1, 0.5],
            [0, 0.5],
          ],
          KIND.solid,
          c
        );
      };
      quad(foot, anchor, w, line);
      if (t.leader === "dimension") {
        // ticks across both ends, a drawn dimension line
        const tick = 0.35 * p.cap;
        const o = (q: Vec3, s: number): Vec3 => [
          q[0] + r[0] * s,
          q[1] + r[1] * s,
          q[2] + r[2] * s,
        ];
        quad(o(foot, -tick), o(foot, tick), w, line);
        quad(o(anchor, -tick), o(anchor, tick), w, line);
      } else {
        const d = DOT_CAPS * p.cap;
        const u = p.up;
        const q = (sx: number, sy: number): Vec3 => [
          anchor[0] + r[0] * sx * d + u[0] * sy * d,
          anchor[1] + r[1] * sx * d + u[1] * sy * d,
          anchor[2] + r[2] * sx * d + u[2] * sy * d,
        ];
        push(
          [q(-1, -1), q(1, -1), q(1, 1), q(-1, 1)],
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
          ],
          KIND.disc,
          t.accent
        );
      }
    }
    const g = leader.geometry;
    const posAttr = g.getAttribute("position") as Float32BufferAttribute;
    if (posAttr.array.length !== pos.length) {
      g.dispose();
      leader.geometry = new BufferGeometry();
      leader.geometry.setAttribute(
        "position",
        new Float32BufferAttribute(pos, 3)
      );
      leader.geometry.setAttribute("uvk", new Float32BufferAttribute(uvk, 3));
      leader.geometry.setAttribute("ink", new Float32BufferAttribute(ink, 4));
      leader.geometry.setAttribute(
        "halo",
        new Float32BufferAttribute(new Float32Array((pos.length / 3) * 4), 4)
      );
      leader.geometry.setIndex(
        new Uint16BufferAttribute(new Uint16Array(idx), 1)
      );
    } else {
      (posAttr.array as Float32Array).set(pos);
      posAttr.needsUpdate = true;
      const inkAttr = g.getAttribute("ink") as Float32BufferAttribute;
      (inkAttr.array as Float32Array).set(ink);
      inkAttr.needsUpdate = true;
      const uvAttr = g.getAttribute("uvk") as Float32BufferAttribute;
      (uvAttr.array as Float32Array).set(uvk);
      uvAttr.needsUpdate = true;
    }
    leader.visible = true;
  };

  const placeScene = (
    camera: Camera,
    cam: NameplateCamera
  ): NameplateScene => ({
    camera: cam,
    project: (p) => {
      tmp.set(p[0], p[1], p[2]).project(camera);
      return { x: tmp.x, y: tmp.y, front: tmp.z > -1 && tmp.z < 1 };
    },
    hidden: (points) => deps.hidden(camera, points),
    hud: deps.hud(),
    groundAt: deps.groundAt,
  });

  const matrix = new Matrix4();
  const range = () => {
    const caps = NAMEPLATE_CAPS[subject?.text.rank ?? "address"];
    return deps.phone ? caps.phone : caps.desktop;
  };
  const forStyle = (l: NameplateLayout): NameplateLayout =>
    type().onGround && l.mode !== "air"
      ? { ...l, mode: "air", spot: "front" }
      : l;

  return {
    set: (next) => {
      subject = next;
      body = next ? nameplateBody(next.positions) : null;
      layout = null;
      pending = null;
      pose = null;
      builtFor = null;
      chosenAt = Number.NEGATIVE_INFINITY;
      askedAt = performance.now();
      if (!(next && body)) {
        plate.visible = false;
        leader.visible = false;
        geometry = null;
        plate.geometry.dispose();
        plate.geometry = emptyGeometry();
        atlas.dispose();
        atlas = atlasTexture(new Uint8Array(64 * 64), 64, 64);
        atlasNode.value = atlas;
        generation++;
        return;
      }
      rebuild("center");
      withFaces();
    },
    applyLook: (next) => {
      if (next === style) {
        return;
      }
      style = next;
      builtFor = null;
      layout = null;
      if (subject) {
        rebuild(alignFor(layout));
        withFaces();
      }
    },
    setNight: (factor) => {
      if (Math.abs(factor - night) < 1e-3) {
        return;
      }
      night = factor;
      recolour();
    },
    update: (camera, viewport, hold = false) => {
      if (!(subject && body && geometry)) {
        plate.visible = false;
        leader.visible = false;
        return;
      }
      const now = performance.now();
      const cam = plateCamera(camera, viewport);
      if (now - chosenAt >= CHOOSE_MS && !(hold && layout)) {
        chosenAt = now;
        const chosen = forStyle(
          chooseNameplate(
            body,
            layout,
            block(),
            range(),
            placeScene(camera, cam)
          )
        );
        if (layout === null) {
          layout = chosen;
          rebuild(alignFor(layout));
        } else if (
          !sameLayout(chosen, layout) &&
          !sameLayout(chosen, pending)
        ) {
          pending = chosen;
          crossAt = now;
        }
      }
      // a change of place: out, then the new place in
      let crossFade = 1;
      if (pending) {
        const t = (now - crossAt) / CROSS_MS;
        if (t >= 1) {
          layout = pending;
          pending = null;
          crossAt = now;
          rebuild(alignFor(layout));
          crossFade = 0;
        } else {
          crossFade = 1 - t;
        }
      } else if (now - crossAt < CROSS_MS) {
        crossFade = (now - crossAt) / CROSS_MS;
      }
      if (!layout || !geometry) {
        return;
      }
      pose = nameplatePose(body, layout, cam, block(), range(), deps.groundAt);
      const n: Vec3 = [
        pose.right[1] * pose.up[2] - pose.right[2] * pose.up[1],
        pose.right[2] * pose.up[0] - pose.right[0] * pose.up[2],
        pose.right[0] * pose.up[1] - pose.right[1] * pose.up[0],
      ];
      const c = pose.cap;
      matrix.set(
        pose.right[0] * c,
        pose.up[0] * c,
        n[0] * c,
        pose.origin[0],
        pose.right[1] * c,
        pose.up[1] * c,
        n[1] * c,
        pose.origin[1],
        pose.right[2] * c,
        pose.up[2] * c,
        n[2] * c,
        pose.origin[2],
        0,
        0,
        0,
        1
      );
      plate.matrix.copy(matrix);
      plate.matrixWorld.copy(matrix);
      plate.matrixWorldNeedsUpdate = false;
      const arrive = Math.min((now - askedAt) / ARRIVE_MS, 1);
      fade.value = pose.fade * crossFade * (arrive * arrive * (3 - 2 * arrive));
      plate.visible = fade.value > 0.001;
      if (plate.visible) {
        placeLeader(pose, cam);
      } else {
        leader.visible = false;
      }
    },
    render: (renderer, camera) => {
      if (!plate.visible) {
        return;
      }
      // onto the canvas, over the finished frame: the colours are sRGB
      // already, so the output transform stays off for this draw
      const previous = renderer.getRenderTarget();
      const autoClear = renderer.autoClear;
      const toneMapping = renderer.toneMapping;
      const colorSpace = renderer.outputColorSpace;
      renderer.setRenderTarget(null);
      renderer.autoClear = false;
      renderer.toneMapping = NoToneMapping;
      renderer.outputColorSpace = LinearSRGBColorSpace;
      try {
        renderer.render(scene, camera);
      } finally {
        renderer.outputColorSpace = colorSpace;
        renderer.toneMapping = toneMapping;
        renderer.autoClear = autoClear;
        renderer.setRenderTarget(previous);
      }
    },
    compile: (renderer, camera) =>
      compileInTurn(renderer, () => {
        if (disposed) {
          return Promise.resolve();
        }
        const shown = [plate.visible, leader.visible] as const;
        const previous = renderer.getRenderTarget();
        const toneMapping = renderer.toneMapping;
        const colorSpace = renderer.outputColorSpace;
        plate.visible = true;
        leader.visible = true;
        renderer.setRenderTarget(null);
        renderer.toneMapping = NoToneMapping;
        renderer.outputColorSpace = LinearSRGBColorSpace;
        try {
          return renderer.compileAsync(scene, camera);
        } finally {
          [plate.visible, leader.visible] = shown;
          renderer.outputColorSpace = colorSpace;
          renderer.toneMapping = toneMapping;
          renderer.setRenderTarget(previous);
        }
      }),
    shown: () =>
      plate.visible && subject && layout
        ? { title: subject.text.title, mode: layout.mode, spot: layout.spot }
        : null,
    dispose: () => {
      disposed = true;
      plate.geometry.dispose();
      leader.geometry.dispose();
      material.dispose();
      atlas.dispose();
    },
  };
}

export { FIELD_RADIUS };
