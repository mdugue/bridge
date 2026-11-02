/**
 * The nameplate: the name of the thing asked, set in the city beside it
 * (lib/city/nameplate.ts says what, lib/city/nameplate-place.ts where,
 * lib/city/nameplate-type.ts in which letters). Built letters, not a
 * label: a landmark's name stands large on its roof with its facts under
 * it (or beside it in the sky, a hairline down to it); seen steeply from
 * above it lies on the free ground like map lettering; up close the
 * letters stand on the ground before it. A named building, bridge or
 * monument shows its name, an ordinary house its address, a tree, a lamp
 * or a bench what it is, small.
 *
 * The letters are a little deep (`EXTRUDE_CAPS`): the same quads drawn
 * again in layers behind the face (`SIDE_LAYERS`, one mesh each over one
 * geometry, the layer a per-object uniform), their returns lit by the sun
 * from the field's own gradient. They cast a shadow on whatever the sun
 * puts behind them — a facade, a roof, the ground: a box swept from the
 * plate away from the sun, each of its pixels finding the scene's surface
 * from the depth and asking whether the sun's ray from there crosses a
 * letter (a small silhouette mask, nameplate-glyphs.ts `shadowMask`).
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
 * only while something is asked (its atlas ≤ 0.5 MB and its shadow mask
 * ≤ 64 kB on the GPU, no CPU copy of either, a few hundred vertices).
 */
import {
  BackSide,
  BufferGeometry,
  type Camera,
  DataTexture,
  type DepthTexture,
  DoubleSide,
  Group,
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
  type UniformNode,
  Scene,
  Uint16BufferAttribute,
  UnsignedByteType,
  Vector2,
  Vector3,
  Vector4,
  type WebGPURenderer,
} from "three/webgpu";
import {
  abs,
  attribute,
  cameraWorldMatrix,
  dot,
  float,
  fwidth,
  max,
  min,
  mix,
  normalize,
  positionLocal,
  positionView,
  screenUV,
  smoothstep,
  step,
  texture,
  uniform,
  vec2,
  vec3,
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
  EXTRUDE_CAPS,
  add,
  bodySize,
  chooseNameplate,
  cross,
  dot as dot3,
  nameplatePose,
  sameLayout,
  scale,
  sub,
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
import { dropDataOnUpload } from "./raster-upload";
import { trackTexture } from "./three-utils";
import {
  type Align,
  KIND,
  PAINT,
  type PlateGeometry,
  type PlateRaster,
  DESKTOP_RESOLUTION,
  facesReady,
  layPlate,
  PHONE_RESOLUTION,
  loadFaces,
  rasterPlate,
} from "./nameplate-glyphs";
import type { F, Live, V3 } from "./shader-chunks";
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
/** The layers the letters' depth is drawn in, behind the face: enough
 *  that their steps stay under a pixel at a plate's largest. */
const SIDE_LAYERS = { desktop: 10, phone: 6 } as const;
/** The returns' light: in shade, and what full sun adds (and takes on the
 *  side away from it). */
const SIDE_SHADE = { ambient: 0.62, sun: 0.5, away: 0.12 } as const;
/** The shadow reaches this far from the letters (m) at most, and fades
 *  in over its last fifth; it shows from this sun height (sin) up. */
const SHADOW_REACH_M = 220;
const SHADOW_SUN = { from: 0.03, full: 0.18 } as const;

/** What is asked, and what the plate is to say of it. */
export interface NameplateSubject {
  text: NameplateText;
  /** the thing's body (`nameplateBody` of the outline's triangles: the
   *  triangles themselves are not kept) */
  body: NameplateBody;
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
  /** the world direction to the sun (the rig keeps it) */
  sunDirection: Vector3;
}

export interface Nameplate {
  set: (subject: NameplateSubject | null) => void;
  /** the same thing's body again (its outline moved to the level the
   *  renderer shows): the plate keeps its words and its place's choice */
  reshape: (body: NameplateBody) => void;
  applyLook: (style: RenderStyle) => void;
  setNight: (factor: number) => void;
  /** places the plate for this frame's camera; `hold` keeps its place
   *  (an export's tiles each see a part of the picture) */
  update: (
    camera: Camera,
    viewport: () => { width: number; height: number },
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
  // the GPU holds it: no CPU copy kept (ADR 0047); counted in the
  // rasters' readout while it is
  dropDataOnUpload(t);
  trackTexture(t, width * height);
  return t;
}

/** What moves in the plate's material: set per frame, per style. */
interface PlateUniforms {
  haloWidth: Live;
  fade: Live;
  /** the atlas's texel (u, v) */
  texel: UniformNode<"vec2", Vector2>;
  /** the plate's right and up in the world, and the sun's direction */
  right: UniformNode<"vec3", Vector3>;
  up: UniformNode<"vec3", Vector3>;
  sun: UniformNode<"vec3", Vector3>;
  /** 0 in the night … 1 in full sun */
  sunLight: Live;
  /** the returns' colour (sRGB) */
  side: UniformNode<"vec3", Vector3>;
}

/** The shadow's silhouette mask (R8, linear: its edge stays soft). */
function maskTexture(data: Uint8Array, width: number, height: number) {
  const t = new DataTexture(data, width, height, RedFormat, UnsignedByteType);
  t.minFilter = LinearFilter;
  t.magFilter = LinearFilter;
  t.generateMipmaps = false;
  t.colorSpace = "";
  t.needsUpdate = true;
  t.name = "NameplateShadowMask";
  // rows of any width: one byte per texel, no row padding
  t.unpackAlignment = 1;
  dropDataOnUpload(t);
  trackTexture(t, width * height);
  return t;
}

const smoothUnit = (a: number, b: number, x: number) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

/** A box's faces, outward when its three edges turn right-handed: the
 *  plate's rectangle (corners 0–3) and the same swept (4–7). */
const PRISM_INDEX = [
  0, 3, 2, 0, 2, 1, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 3, 7, 6, 3, 6, 2, 0, 4,
  7, 0, 7, 3, 1, 2, 6, 1, 6, 5,
];
const PRISM_INDEX_FLIPPED = PRISM_INDEX.map(
  (_, i) => PRISM_INDEX[i - (i % 3) + [0, 2, 1][i % 3]]
);

/** The shadow's box: eight corners, its faces outward. */
function prismGeometry(): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute(
    "position",
    new Float32BufferAttribute(new Float32Array(24), 3)
  );
  g.setIndex(new Uint16BufferAttribute(new Uint16Array(PRISM_INDEX), 1));
  return g;
}

/** Writes the box: `corners` swept by `d`; `handed` the sign of its
 *  edges' triple product (its faces turn to stay outward). */
function writePrism(
  g: BufferGeometry,
  corners: Vec3[],
  d: Vec3,
  handed: number
): void {
  const pos = g.getAttribute("position") as Float32BufferAttribute;
  const a = pos.array as Float32Array;
  for (const [i, c] of corners.entries()) {
    for (let k = 0; k < 3; k++) {
      a[i * 3 + k] = c[k];
      a[(i + 4) * 3 + k] = c[k] + d[k];
    }
  }
  pos.needsUpdate = true;
  const index = g.getIndex();
  const want = handed >= 0 ? PRISM_INDEX : PRISM_INDEX_FLIPPED;
  if (index && index.array[1] !== want[1]) {
    (index.array as Uint16Array).set(want);
    index.needsUpdate = true;
  }
}

/** The plate's two materials over one geometry (the quad's kind picks,
 *  by `step`, never a branch): the face, for the letters, the box and the
 *  leader; and the returns, drawn by every layer behind it (the drawn
 *  object's layer, a per-object uniform, pushes it back that far), lit by
 *  the sun from the letters' field. Each graph holds only its own work. */
function plateMaterials(
  deps: Pick<NameplateDeps, "depthTexture" | "lens">,
  atlas: TextureNode<"vec4">,
  u: PlateUniforms
) {
  const uvk = attribute<"vec3">("uvk", "vec3");
  const ink = attribute<"vec4">("ink", "vec4");
  const field = atlas.sample(uvk.xy).r;
  const kind = uvk.z;
  const isGlyph = float(1).sub(step(0.5, kind));
  const isDisc = step(1.5, kind);
  const isSolid = float(1).sub(isGlyph).sub(isDisc);
  // a letter's fill on the field's mid level
  const aa = max(fwidth(field), 1e-4);
  const fill = smoothstep(float(0.5).sub(aa), float(0.5).add(aa), field);
  // a solid: its uv's distance to the edges, antialiased
  const uu = uvk.x;
  const vv = uvk.y;
  const edge = min(
    min(uu, float(1).sub(uu)).div(max(fwidth(uu), 1e-5)),
    min(vv, float(1).sub(vv)).div(max(fwidth(vv), 1e-5))
  );
  const solidA = smoothstep(0, 1, edge).mul(ink.a);
  // hidden: the scene's surface in front of this fragment
  const sceneZ = deps.lens.viewZ(texture(deps.depthTexture, screenUV).r);
  const slack = deps.lens
    .fade(positionView.z.negate())
    .mul(HIDDEN_SLACK_SHARE)
    .add(HIDDEN_SLACK_M);
  const hidden = smoothstep(slack, slack.mul(2), sceneZ.sub(positionView.z));

  // the face: a letter with its halo further out, a solid, a disc; its
  // hidden part shown as a ghost
  const halo = attribute<"vec4">("halo", "vec4");
  const haloEdge = float(0.5).sub(u.haloWidth.mul(0.5));
  const haloA = smoothstep(
    haloEdge.sub(aa),
    haloEdge.add(u.haloWidth.mul(0.3)),
    field
  );
  const glyphA = max(fill.mul(ink.a), haloA.mul(halo.a));
  const glyphRgb = mix(halo.rgb, ink.rgb, fill);
  const ghostGlyph = float(1)
    .sub(
      smoothstep(GHOST.width, aa.add(GHOST.width * 1.6), abs(field.sub(0.5)))
    )
    .mul(ink.a);
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
    .add(solidA.mul(isSolid).add(discA.mul(isDisc)).mul(0.35))
    .mul(GHOST.alpha);
  const face = plateMaterial(
    mix(rgb, ink.rgb, hidden),
    mix(shownA, ghostA, hidden).mul(u.fade)
  );

  // the returns: the letter's outward normal from its field (the field
  // rises inward; the atlas's v runs down the plate), in the world, lit
  // by the sun; a box's sides take the shade alone; none of it hidden
  const layer = uniform(0).onObjectUpdate(
    ({ object }) => (object?.userData.nameplateLayer as number | undefined) ?? 0
  );
  const fx = atlas.sample(uvk.xy.add(vec2(u.texel.x, 0))).r.sub(field);
  const fy = atlas.sample(uvk.xy.add(vec2(0, u.texel.y))).r.sub(field);
  const outward = u.right.mul(fx.negate()).add(u.up.mul(fy));
  const normal = normalize(outward.add(u.up.mul(1e-5)));
  const lit = dot(normal, u.sun).mul(isGlyph);
  const shade = float(SIDE_SHADE.ambient).add(
    u.sunLight.mul(
      max(lit, 0)
        .mul(SIDE_SHADE.sun)
        .sub(max(lit.negate(), 0).mul(SIDE_SHADE.away))
    )
  );
  const sideA = fill.mul(isGlyph).add(solidA.mul(isSolid)).mul(ink.a);
  const side = plateMaterial(
    u.side.mul(shade).min(1),
    sideA.mul(float(1).sub(hidden)).mul(u.fade)
  );
  side.positionNode = positionLocal.sub(vec3(0, 0, layer));
  side.name = "nameplate-returns";
  return { face, side };
}

/** One of the plate's materials: over the frame, no depth, both sides. */
function plateMaterial(colour: V3, alpha: F) {
  const m = new MeshBasicNodeMaterial();
  m.colorNode = vec4(colour, 1);
  m.opacityNode = alpha;
  m.transparent = true;
  m.depthTest = false;
  m.depthWrite = false;
  m.side = DoubleSide;
  // one pass for both faces: a plate is flat, one side is always away
  m.forceSinglePass = true;
  m.fog = false;
  m.name = "nameplate";
  return m;
}

/** What moves in the shadow's material. */
interface ShadowUniforms {
  /** world → the plate's own units (title caps; z out of its face) */
  inverse: UniformNode<"mat4", Matrix4>;
  /** the way to the sun in the plate's units, unit */
  sun: UniformNode<"vec3", Vector3>;
  /** the mask's rectangle (caps: corner x, y, width, height), how far
   *  the shadow reaches (caps) */
  area: UniformNode<"vec4", Vector4>;
  reach: Live;
  strength: Live;
  colour: UniformNode<"vec3", Vector3>;
}

/**
 * The letters' cast shadow: drawn on the back faces of a box swept from
 * the plate away from the sun. Each pixel takes the scene's surface on its
 * ray (the depth; a parallel view's ray runs straight), follows the sun's
 * ray from there back to the plate's plane and reads the silhouette mask
 * where it crosses: shadow where a letter stands between.
 */
function shadowMaterial(
  deps: Pick<NameplateDeps, "depthTexture" | "lens">,
  mask: TextureNode<"vec4">,
  fade: Live,
  u: ShadowUniforms
) {
  const sceneZ = deps.lens.viewZ(texture(deps.depthTexture, screenUV).r);
  const ray = positionView;
  const perspective = ray.mul(sceneZ.div(min(ray.z, -1e-4)));
  const parallel = vec3(ray.x, ray.y, sceneZ);
  const surface = mix(perspective, parallel, deps.lens.ortho);
  const world = cameraWorldMatrix.mul(vec4(surface, 1));
  const local = u.inverse.mul(world).xyz;
  // along the sun's ray to the plate's plane: k caps
  const k = local.z.negate().div(u.sun.z);
  const hit = local.xy.add(u.sun.xy.mul(k)).sub(u.area.xy).div(u.area.zw);
  const inside = step(0, hit.x)
    .mul(step(hit.x, 1))
    .mul(step(0, hit.y))
    .mul(step(hit.y, 1));
  const reach = step(0, k).mul(
    float(1).sub(smoothstep(u.reach.mul(0.8), u.reach, k))
  );
  const a = mask.sample(hit).r.mul(inside).mul(reach).mul(u.strength);
  const m = new MeshBasicNodeMaterial();
  m.colorNode = vec4(u.colour, 1);
  m.opacityNode = a.mul(fade);
  m.transparent = true;
  m.depthTest = false;
  m.depthWrite = false;
  // the box's far side: each pixel once, the camera inside it or not
  m.side = BackSide;
  m.fog = false;
  m.name = "nameplate-shadow";
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
  };
  for (let i = 0; i < paint.length; i++) {
    const c = colours[paint[i]];
    ink.set([c[0], c[1], c[2], dim], i * 4);
    halo.set([h[0], h[1], h[2], type.halo.alpha * dim], i * 4);
  }
}

const tmp = new Vector3();

/** A camera's near plane (m). */
const nearOf = (camera: Camera): number =>
  (camera as PerspectiveCamera).near ?? 0.1;

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
  const uniforms: PlateUniforms = {
    haloWidth: uniform(0.5),
    fade: uniform(0),
    texel: uniform(new Vector2(1 / 64, 1 / 64)),
    right: uniform(new Vector3(1, 0, 0)),
    up: uniform(new Vector3(0, 1, 0)),
    sun: uniform(new Vector3(0, 1, 0)),
    sunLight: uniform(1),
    side: uniform(new Vector3(0.5, 0.5, 0.5)),
  };
  const { fade } = uniforms;
  let atlas = atlasTexture(new Uint8Array(64 * 64), 64, 64);
  const atlasNode = texture(atlas);
  const { face: material, side: sideMaterial } = plateMaterials(
    deps,
    atlasNode,
    uniforms
  );
  // the face and its returns: one geometry, one material, a mesh per
  // layer (deepest drawn first), placed together by their group
  const letters = new Group();
  letters.matrixAutoUpdate = false;
  letters.visible = false;
  const plate = new Mesh(emptyGeometry(), material);
  const layers = deps.phone ? SIDE_LAYERS.phone : SIDE_LAYERS.desktop;
  const sides: Mesh[] = [];
  for (let i = layers; i >= 1; i--) {
    const side = new Mesh(plate.geometry, sideMaterial);
    side.userData.nameplateLayer = (EXTRUDE_CAPS * i) / layers;
    side.frustumCulled = false;
    sides.push(side);
    letters.add(side);
  }
  plate.frustumCulled = false;
  letters.add(plate);
  /** The layers' order (they test no depth): far to near, so from the
   *  plate's back the deepest layer comes last and the face first. */
  let orderedBehind: boolean | null = null;
  const orderLayers = (behind: boolean) => {
    if (behind === orderedBehind) {
      return;
    }
    orderedBehind = behind;
    for (const [k, side] of sides.entries()) {
      // sides[k] is layer (layers − k), deepest first
      side.renderOrder = behind ? 3 + layers - 1 - k : 3 + k;
    }
    plate.renderOrder = behind ? 2 : 3 + layers;
  };
  orderLayers(false);
  /** The letters' geometry, the face's and every layer's. */
  const setLetters = (g: BufferGeometry) => {
    plate.geometry.dispose();
    plate.geometry = g;
    for (const side of sides) {
      side.geometry = g;
    }
  };
  const leader = new Mesh(emptyGeometry(), material);
  leader.frustumCulled = false;
  leader.visible = false;
  leader.renderOrder = 1;
  // the cast shadow: its box in world space, rewritten each frame
  let mask = maskTexture(new Uint8Array(16), 4, 4);
  const maskNode = texture(mask);
  const shadowUniforms: ShadowUniforms = {
    inverse: uniform(new Matrix4()),
    sun: uniform(new Vector3(0, 0, 1)),
    area: uniform(new Vector4(0, 0, 1, 1)),
    reach: uniform(1),
    strength: uniform(0),
    colour: uniform(new Vector3()),
  };
  const shadowMat = shadowMaterial(deps, maskNode, fade, shadowUniforms);
  const shadow = new Mesh(prismGeometry(), shadowMat);
  shadow.frustumCulled = false;
  shadow.visible = false;
  shadow.renderOrder = 0;
  scene.add(shadow, leader, letters);

  let style: RenderStyle = "pastel";
  let night = 0;
  let subject: NameplateSubject | null = null;
  let body: NameplateBody | null = null;
  let geometry: PlateGeometry | null = null;
  /** the letters, rasterised once per text and style (and faces) */
  let raster: PlateRaster | null = null;
  let rasterFor: { style: RenderStyle; text: NameplateText } | null = null;
  /** the geometry laid out from them, per alignment and far or not */
  let builtFor: {
    align: Align;
    lines: boolean;
    raster: PlateRaster;
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
    uniforms.haloWidth.value = type().halo.width;
    const side = atNight(type().side, night);
    uniforms.side.value.set(side[0], side[1], side[2]);
  };

  /** The letters for the text and style, rasterised again only when
   *  either changed (or the faces arrived); null where none can be drawn. */
  const lettering = (): PlateRaster | null => {
    const s = subject;
    const from = deps.fonts();
    if (!(s && from)) {
      return null;
    }
    if (rasterFor?.text === s.text && rasterFor.style === style) {
      return raster;
    }
    raster = rasterPlate(
      s.text,
      type(),
      from,
      deps.phone ? PHONE_RESOLUTION : DESKTOP_RESOLUTION
    );
    rasterFor = { text: s.text, style };
    if (raster) {
      atlas.dispose();
      atlas = atlasTexture(
        raster.atlas.data,
        raster.atlas.width,
        raster.atlas.height
      );
      atlasNode.value = atlas;
      uniforms.texel.value.set(1 / raster.atlas.width, 1 / raster.atlas.height);
      // the texture has the bytes now; the layout needs only the size
      raster.atlas.data = new Uint8Array(0);
    }
    return raster;
  };

  /** Lays the plate out for the current layout: its alignment, and its
   *  small lines unless seen from far. Cheap: the letters are kept. */
  const rebuild = () => {
    const r = lettering();
    const align = alignFor(layout);
    const lines = layout?.mode !== "far";
    if (
      r &&
      builtFor?.raster === r &&
      builtFor.align === align &&
      builtFor.lines === lines
    ) {
      return;
    }
    if (!r) {
      builtFor = null;
      geometry = null;
      setLetters(emptyGeometry());
      letters.visible = false;
      shadow.visible = false;
      return;
    }
    const g = layPlate(r, align, lines);
    builtFor = { raster: r, align, lines };
    geometry = g;
    mask.dispose();
    mask = maskTexture(g.mask.data, g.mask.width, g.mask.height);
    maskNode.value = mask;
    // the texture has the bytes now
    g.mask.data = new Uint8Array(0);
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
    setLetters(geo);
    recolour();
  };

  /** Sets the letters once their faces are there: the first question
   *  in a style waits for them (not set twice, no swap on the plate). */
  const withFaces = () => {
    const from = deps.fonts();
    const asked = ++generation;
    // the letters as drawn (a style may set them in capitals, whose
    // part of a face can differ)
    const raw = subject
      ? [subject.text.title, ...subject.text.lines].join(" ")
      : "";
    const text = `${raw} ${raw.toLocaleUpperCase("de-DE")}`;
    if (!from || facesReady(type(), from, text)) {
      rebuild();
      return;
    }
    builtFor = null;
    geometry = null;
    setLetters(emptyGeometry());
    letters.visible = false;
    shadow.visible = false;
    void loadFaces(type(), from, text).then(() => {
      if (disposed || asked !== generation) {
        return;
      }
      rasterFor = null;
      rebuild();
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
    const at = (s: number, u: number): Vec3 =>
      add(p.origin, add(scale(p.right, s * p.cap), scale(p.up, u * p.cap)));
    // the leader leaves the plate's foot on the side nearest the anchor
    const along = dot3(sub(anchor, p.origin), p.right) / p.cap;
    const footS = Math.min(Math.max(along, 0.15), b.width - 0.15);
    const foot = at(footS, 0.05);
    const distance = camera.ortho
      ? 1
      : Math.max(dot3(sub(anchor, camera.position), camera.forward), 0.5);
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
    const quad = (
      from: Vec3,
      to: Vec3,
      width: number,
      c: readonly [number, number, number]
    ) => {
      // the plate's normal × the line: across it, in the plate's plane;
      // antialiased across by its u
      const d = sub(to, from);
      const l = Math.hypot(d[0], d[1], d[2]) || 1;
      const x = scale(cross(cross(p.right, p.up), d), 1 / l);
      const o = (q: Vec3, s: number): Vec3 => add(q, scale(x, s));
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
    if (t.leader === "tail" && t.box) {
      // the caption box's tail: from its foot to the anchor, filled, its
      // two slanted sides edged by antialiased strokes over the fill's
      const half = Math.min(0.5, b.width * 0.12);
      const a = at(footS - half, 0.2);
      const c = at(footS + half, 0.2);
      const edge = atNight(t.box.edge, night);
      const fill = atNight(t.box.fill, night);
      const stroke = 0.045 * p.cap;
      const solid = [
        [0.5, 0.5],
        [0.5, 0.5],
        [0.5, 0.5],
      ];
      push([a, c, anchor], solid, KIND.solid, fill);
      quad(a, anchor, stroke, edge);
      quad(c, anchor, stroke, edge);
    } else {
      const line = atNight(t.lines.ink, night);
      quad(foot, anchor, w, line);
      if (t.leader === "dimension") {
        // ticks across both ends, a drawn dimension line
        const tick = 0.35 * p.cap;
        const o = (q: Vec3, s: number): Vec3 => add(q, scale(r, s));
        quad(o(foot, -tick), o(foot, tick), w, line);
        quad(o(anchor, -tick), o(anchor, tick), w, line);
      } else {
        const d = DOT_CAPS * p.cap;
        const u = p.up;
        const q = (sx: number, sy: number): Vec3 =>
          add(anchor, add(scale(r, sx * d), scale(u, sy * d)));
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
      // in front by the view space's own z: NDC depth runs the other way
      // round under a reversed buffer (three's `reversedDepth` camera)
      tmp.set(p[0], p[1], p[2]).applyMatrix4(camera.matrixWorldInverse);
      const front = cam.ortho || tmp.z < -nearOf(camera);
      tmp.set(p[0], p[1], p[2]).project(camera);
      return { x: tmp.x, y: tmp.y, front };
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
  /** A new place from scratch: nothing chosen, nothing pending, the plate
   *  hidden until the next choice. */
  const forget = () => {
    layout = null;
    pending = null;
    pose = null;
    chosenAt = Number.NEGATIVE_INFINITY;
    letters.visible = false;
    leader.visible = false;
    shadow.visible = false;
  };

  /** Chooses the place again; a new one cross-fades in. */
  const choose = (
    b: NameplateBody,
    camera: Camera,
    cam: NameplateCamera,
    now: number
  ) => {
    // Schwarzplan letters the ground from above the building (its ground
    // places are the ones weighed); from the street the ground beside it
    // is hidden, so it stands upright. The roof line holds a fifth of the
    // building's size either way.
    const margin = 0.2 * bodySize(b) * (layout?.mode === "air" ? -1 : 1);
    const onGround = type().onGround && cam.position[1] > b.top + margin;
    const chosen = chooseNameplate(
      b,
      layout,
      block(),
      range(),
      placeScene(camera, cam),
      onGround ? "air" : undefined
    );
    if (layout === null) {
      layout = chosen;
      rebuild();
    } else if (!sameLayout(chosen, layout)) {
      pending = chosen;
      crossAt = now;
    }
  };

  /** The cross-fade's share now: out of the old place, then into the new
   *  one; while an image is exported, done at once. */
  const crossing = (now: number, hold: boolean): number => {
    if (pending && (hold || now - crossAt >= CROSS_MS)) {
      layout = pending;
      pending = null;
      crossAt = hold ? Number.NEGATIVE_INFINITY : now;
      rebuild();
      return hold ? 1 : 0;
    }
    if (pending) {
      return 1 - (now - crossAt) / CROSS_MS;
    }
    return hold ? 1 : Math.min((now - crossAt) / CROSS_MS, 1);
  };

  /** The plate's mesh at its pose: right, up and normal scaled by the
   *  capital height, the block's corner as origin; its layers drawn far
   *  to near (the face last, unless the camera sees the plate's back). */
  const placePlate = (p: NameplatePose, cam: NameplateCamera) => {
    const n = cross(p.right, p.up);
    const behind = cam.ortho
      ? dot3(cam.forward, n) > 0
      : dot3(sub(cam.position, p.origin), n) < 0;
    orderLayers(behind);
    const c = p.cap;
    matrix.set(
      p.right[0] * c,
      p.up[0] * c,
      n[0] * c,
      p.origin[0],
      p.right[1] * c,
      p.up[1] * c,
      n[1] * c,
      p.origin[1],
      p.right[2] * c,
      p.up[2] * c,
      n[2] * c,
      p.origin[2],
      0,
      0,
      0,
      1
    );
    letters.matrix.copy(matrix);
    letters.matrixWorldNeedsUpdate = true;
    uniforms.right.value.set(p.right[0], p.right[1], p.right[2]);
    uniforms.up.value.set(p.up[0], p.up[1], p.up[2]);
  };

  const sunLocal = new Vector3();
  // the shadow box's plate corners and sweep, rewritten each frame
  const prismCorners: Vec3[] = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const sweep: Vec3 = [0, 0, 0];
  /** The cast shadow for this frame's pose: the plate's rectangle swept
   *  away from the sun to below the thing's foot (at most
   *  `SHADOW_REACH_M`); none with the sun down or in the plate's plane. */
  const placeShadow = (p: NameplatePose, b: NameplateBody) => {
    const sun = deps.sunDirection;
    const t = type();
    const light = smoothUnit(SHADOW_SUN.from, SHADOW_SUN.full, sun.y);
    uniforms.sun.value.copy(sun);
    uniforms.sunLight.value = light;
    const strength = t.shadow.alpha * light * nightDim(night);
    shadowUniforms.inverse.value.copy(letters.matrix).invert();
    sunLocal.copy(sun).transformDirection(shadowUniforms.inverse.value);
    if (strength < 0.005 || Math.abs(sunLocal.z) < 0.02) {
      shadow.visible = false;
      return;
    }
    // the mask's rectangle on the plate (a box reaches past the block)
    const area = geometry?.mask.area ?? { x: 0, y: 0, ...block() };
    let lowest = Number.POSITIVE_INFINITY;
    for (const [i, c] of prismCorners.entries()) {
      const x = (area.x + (i === 1 || i === 2 ? area.width : 0)) * p.cap;
      const y = (area.y + (i >= 2 ? area.height : 0)) * p.cap;
      for (let k = 0; k < 3; k++) {
        c[k] = p.origin[k] + p.right[k] * x + p.up[k] * y;
      }
      lowest = Math.min(lowest, c[1]);
    }
    const length = Math.min(
      Math.max((lowest - (b.base - 2)) / Math.max(sun.y, 0.05), 2),
      SHADOW_REACH_M
    );
    sweep[0] = -sun.x * length;
    sweep[1] = -sun.y * length;
    sweep[2] = -sun.z * length;
    const handed = dot3(cross(p.right, p.up), sweep);
    writePrism(shadow.geometry, prismCorners, sweep, handed);
    shadowUniforms.sun.value.copy(sunLocal);
    shadowUniforms.area.value.set(area.x, area.y, area.width, area.height);
    shadowUniforms.reach.value = length / p.cap;
    shadowUniforms.strength.value = strength;
    const c = t.shadow.colour;
    shadowUniforms.colour.value.set(c[0], c[1], c[2]);
    shadow.visible = true;
  };

  return {
    set: (next) => {
      if (disposed) {
        return;
      }
      subject = next;
      body = next?.body ?? null;
      forget();
      builtFor = null;
      askedAt = performance.now();
      if (!(next && body)) {
        raster = null;
        rasterFor = null;
        geometry = null;
        setLetters(emptyGeometry());
        atlas.dispose();
        atlas = atlasTexture(new Uint8Array(64 * 64), 64, 64);
        atlasNode.value = atlas;
        mask.dispose();
        mask = maskTexture(new Uint8Array(16), 4, 4);
        maskNode.value = mask;
        generation++;
        return;
      }
      withFaces();
    },
    reshape: (next) => {
      if (disposed || !subject) {
        return;
      }
      subject = { ...subject, body: next };
      body = next;
    },
    applyLook: (next) => {
      if (next === style) {
        return;
      }
      style = next;
      forget();
      // the plate set anew in the new style arrives as a new one does
      askedAt = performance.now();
      if (subject) {
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
      if (!(subject && body && geometry) || (hold && !layout)) {
        // nothing asked; or an export began before a place was chosen
        // (its tiles' projections would choose a wrong one)
        letters.visible = false;
        leader.visible = false;
        shadow.visible = false;
        return;
      }
      const now = performance.now();
      const cam = plateCamera(camera, viewport());
      // no new choice while a cross-fade runs, out or in: it finishes
      // first (a flip back would flash the half-faded plate full)
      if (
        now - chosenAt >= CHOOSE_MS &&
        now - crossAt >= CROSS_MS &&
        !hold &&
        !pending
      ) {
        chosenAt = now;
        choose(body, camera, cam, now);
      }
      const crossFade = crossing(now, hold);
      if (!layout || !geometry) {
        return;
      }
      pose = nameplatePose(body, layout, cam, block(), range(), deps.groundAt);
      placePlate(pose, cam);
      // an export draws every tile alike: no fade still running
      const arrive = hold ? 1 : Math.min((now - askedAt) / ARRIVE_MS, 1);
      fade.value = pose.fade * crossFade * (arrive * arrive * (3 - 2 * arrive));
      letters.visible = fade.value > 0.001;
      if (letters.visible) {
        placeLeader(pose, cam);
        placeShadow(pose, body);
      } else {
        leader.visible = false;
        shadow.visible = false;
      }
    },
    render: (renderer, camera) => {
      if (!letters.visible) {
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
    // The output settings are set back as the call returns, so a frame
    // drawn while it compiles keeps its own. three r187 keys a canvas
    // pipeline by the output colour space when the compile's work runs,
    // after its first await: the programs and shader modules warmed here
    // are the plate's, but on WebGPU the first plate makes its pipeline
    // object from them in its frame (an upstream workaround note:
    // docs/rendering.md, "Workarounds for
    // upstream bugs").
    compile: (renderer, camera) =>
      compileInTurn(renderer, () => {
        if (disposed) {
          return Promise.resolve();
        }
        const shown = [
          letters.visible,
          leader.visible,
          shadow.visible,
        ] as const;
        const previous = renderer.getRenderTarget();
        const toneMapping = renderer.toneMapping;
        const colorSpace = renderer.outputColorSpace;
        letters.visible = true;
        leader.visible = true;
        shadow.visible = true;
        renderer.setRenderTarget(null);
        renderer.toneMapping = NoToneMapping;
        renderer.outputColorSpace = LinearSRGBColorSpace;
        try {
          return renderer.compileAsync(scene, camera);
        } finally {
          [letters.visible, leader.visible, shadow.visible] = shown;
          renderer.outputColorSpace = colorSpace;
          renderer.toneMapping = toneMapping;
          renderer.setRenderTarget(previous);
        }
      }),
    shown: () =>
      letters.visible && subject && layout
        ? { title: subject.text.title, mode: layout.mode, spot: layout.spot }
        : null,
    dispose: () => {
      disposed = true;
      plate.geometry.dispose();
      leader.geometry.dispose();
      shadow.geometry.dispose();
      material.dispose();
      sideMaterial.dispose();
      shadowMat.dispose();
      atlas.dispose();
      mask.dispose();
    },
  };
}
