import {
  type DataTexture,
  MeshStandardNodeMaterial,
  type Texture,
} from "three/webgpu";
import {
  abs,
  attribute,
  cameraPosition,
  clamp,
  dot,
  float,
  floor,
  fract,
  fwidth,
  int,
  ivec2,
  length,
  materialColor,
  max,
  min,
  mix,
  mod,
  modelWorldMatrix,
  normalize,
  positionWorld,
  screenCoordinate,
  select,
  sin,
  smoothstep,
  step,
  textureLoad,
  transformNormalToView,
  uniform,
  varying,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import { OBJECT_TEXTURE_WIDTH } from "@/lib/city/city-mesh";
import {
  type ClayLookKey,
  LOOK_DEFAULTS,
  type LookValues,
} from "@/lib/city/look-controls";
import {
  dataPosition,
  type F,
  type Live,
  type V3,
  type V4,
} from "./shader-chunks";
import {
  setGraph,
  setSlots,
  slotsOf,
  slotTexture,
  slotUniform,
} from "./material-slots";
import { claySkySlots, createClaySky, openSkySlots } from "./sky-light";

/** A building tile's object table (lib/city/city-mesh.ts). */
interface ObjectTable {
  rows: number;
  texture: DataTexture;
}

/** The clay's nodes, one set per app for every building tile. */
interface ClayGraph {
  ao: F;
  colour: V3;
  emissive: V3;
  normal: V3;
  roughness: F;
}

/**
 * The city is rendered in one style: archviz clay — opaque, cheap, and the
 * carrier for all the facade detail below. Picking/demolish read geometry
 * attributes, not materials, so swapping the loader's own per-type material
 * for the shared clay one costs nothing but the swap.
 *
 * Two earlier styles were dropped: "standard" (the loader's LoD colours) and
 * "ghost" (MeshPhysicalMaterial transmission — frosted massing, but it
 * re-rendered the whole scene into a transmission buffer every frame).
 */

/** The clay's facade uniforms, shared by every tile (write `.value`). */
export interface ClayDetailUniforms {
  uAO: Live;
  uBands: Live;
  /** dusk interior glow strength (commercial/public) */
  uDuskGlow: Live;
  /** eave cornice-stroke strength */
  uEave: Live;
  /** night factor 0..1, driven by the sun rig (gates the dusk glow) */
  uNight: Live;
  uRim: Live;
  /** roof colour mix strength */
  uRoofTint: Live;
  /** roof vividness (Dachsättigung): hue-preserving chroma boost on DOP colour */
  uRoofVibrance: Live;
  /** per-building roughness jitter strength */
  uRough: Live;
  /** the sky view's hold on the facades' ambient light (Himmelslicht; the
   *  terrain's node, a scene row) */
  uSkyView: Live;
  uTint: Live;
}

/**
 * What every tile's clay material shares: the facade uniforms and the
 * material settings the look drives. Each tile's buildings get their own
 * material (it binds that tile's object table).
 */
export interface StyleResources {
  /** the clay's facade uniforms (Boden-Verlauf, Streiflicht, …) */
  clayDetail: ClayDetailUniforms;
  /** every live clay material, for the look (transparency) fan-out */
  materials: Set<MeshStandardNodeMaterial>;
  /** the current transparency, applied to materials created later too */
  transparency: number;
}

/**
 * Procedural facade detail on the opaque clay node material, keyed to each
 * building's OWN base (its row of the object table, lib/city/city-mesh.ts —
 * read per vertex with `textureLoad` by the `featureId` attribute) so it
 * works despite buildings standing on terrain at different elevations:
 *  - Farbvariation (uTint): blends each building's own muted clay-family colour
 *    into the flat base so a dense block stops reading as one uniform mass.
 *    Applied FIRST so the shading below (ground-darken, contour lines)
 *    modulates the tinted colour. A zero tint reads as "no tint" rather than
 *    darkening the building to black.
 *  - Boden-Verlauf (uAO): a soft darkening over the lowest ~5 m (ambient-occlusion
 *    surrogate that gives the massing physical contact with the ground).
 *  - Höhenlinien (uBands): thin, crisp horizontal contour strokes every storey
 *    (~3 m), drawn with fwidth for constant on-screen width — the SAME hand-drawn
 *    contour-line language as the terrain, so facades read height/scale without a
 *    heavy "banded" look. Walls only.
 *  - Streiflicht (uRim): a Fresnel rim that separates silhouettes from like-
 *    coloured neighbours. Strength is squared-Fresnel + a healthy multiplier
 *    because there is no bloom.
 *  - Traufkante (uEave): one soft cornice stroke at the wall/roof boundary.
 *  - Materialstreuung (uRough): the matte sheen varies house to house.
 *  - Dachsättigung (uRoofVibrance): the real roof colour lifted into a
 *    confident watercolour register without choosing a target hue.
 *  - Himmelslicht: the courtyard's ground floor gets less of the sky
 *    (sky-light.ts `createClaySky`, the aoNode).
 *  - Abendlicht (uDuskGlow × uNight): a warm interior glow at dusk on
 *    commercial and public buildings, walls only.
 * Heights come from world space (world Y is elevation). The uniforms are
 * shared nodes, so a slider retunes every tile live.
 */
function clayGraph(d: ClayDetailUniforms, objects: ObjectTable): ClayGraph {
  // The tile's object table and its row count are slots: every tile's
  // clay shares this graph (material-slots.ts).
  const table = slotTexture("clayObjects", objects.texture);
  // reason: slotUniform types its node loosely; the row count is a float.
  const rows = slotUniform("clayRows", objects.rows) as unknown as F;
  // --- per vertex: the object's three texels (lib/city/city-mesh.ts
  // packObjectTexels): A (tint rgb, baseZ), B (roof rgb, eaveH),
  // C (storeyH, glow, rough, flags) ------------------------------------------
  const id = int(attribute("featureId", "float").add(0.5));
  const at = ivec2(id.mod(OBJECT_TEXTURE_WIDTH), id.div(OBJECT_TEXTURE_WIDTH));
  const band = (k: number) =>
    textureLoad(table, at.add(ivec2(0, int(rows).mul(k))));
  const a = band(0);
  const b = band(1);
  const c = band(2);
  const roof = attribute("roof", "float");
  const localH = varying(dataPosition().z.sub(a.w));
  // A mix, not a select: three emits a select as if/else, and the texel
  // reads first built inside one arm would be assigned in that arm only —
  // every other varying here reads them too.
  const tint = varying(mix(a.rgb, b.rgb, step(0.5, roof)));
  const build = varying(vec4(roof, c.x, b.w, c.y));
  const rough = varying(c.z);
  const flags = varying(c.w);
  // A triangle that was degenerate when its flat normal was baked has a zero
  // normal, and position quantisation can give it area again: it then
  // rasterises with normalize(0) = NaN lighting — single black pixels on
  // roofs that the DoF blur spread into black squares. Any unit vector will
  // do for a sliver that thin.
  const raw = attribute("normal", "vec3");
  const safe = select(dot(raw, raw).lessThan(1e-8), vec3(0, 1, 0), raw);
  const wn = normalize(varying(modelWorldMatrix.mul(vec4(safe, 0)).xyz));
  const h = max(localH, 0);
  const wall = float(1).sub(smoothstep(0.5, 0.7, abs(wn.y)));
  return {
    normal: normalize(varying(transformNormalToView(safe))),
    // Materialstreuung: nudge roughness per building so the matte sheen
    // varies house-to-house (clamped to stay matte, no shiny clay).
    roughness: facadeRoughness(
      clamp(float(1).add(d.uRough.mul(rough)), 0.55, 1),
      facadeMaterial(flags, wall)
    ),
    colour: askedColour(
      clayColour(d, tint, build, h, wall, flags),
      h,
      wall,
      flags,
      wn
    ),
    // Himmelslicht: the courtyard's ground floor gets less of the sky.
    ao: createClaySky().ao(h, build.z, d.uSkyView),
    emissive: clayGlow(d, build, h, wall, flags, wn),
  };
}

/**
 * The clay's colour: Farbvariation first (so the shading below modulates
 * it) — roof faces (build.x = 1) carry the roof colour at the roof mix
 * strength, walls the wall colour, and a zero tint (no colour known) keeps
 * the base rather than mixing toward black; Dachsättigung, a hue-preserving
 * chroma boost around the grey axis (dull, hazy roofs lifted most, vivid
 * ones barely, so nothing blows out) plus a tiny warm nudge on the
 * muddy-grey roofs only (the audited cool haze cast), roofs only;
 * Boden-Verlauf over the lowest ~5 m; the storey lines at the building's
 * own storey height (fwidth-constant width) and the eave stroke, walls
 * only; then Denkmal.
 */
function clayColour(
  d: ClayDetailUniforms,
  tint: V3,
  build: V4,
  h: F,
  wall: F,
  flags: F
): V3 {
  const isRoof = step(0.5, build.x);
  const tintMix = mix(d.uTint, d.uRoofTint, isRoof);
  const roofL = dot(tint, vec3(0.299, 0.587, 0.114));
  const roofC = tint.sub(roofL);
  const dull = float(1).sub(smoothstep(0.04, 0.3, length(roofC)));
  const vib = d.uRoofVibrance.mul(dull);
  const roofCol = vec3(roofL)
    .add(roofC.mul(float(1).add(vib.mul(2.4))))
    .add(vec3(0.018, 0.004, -0.014).mul(d.uRoofVibrance).mul(dull));
  const clayCol = mix(tint, clamp(roofCol, 0, 1), isRoof);
  let col: V3 = select(
    dot(tint, tint).greaterThan(1e-4),
    mix(materialColor.rgb, clayCol, tintMix),
    materialColor.rgb
  );
  col = col.mul(mix(float(1).sub(d.uAO.mul(0.55)), 1, smoothstep(0, 5, h)));
  const storeys = h.div(max(build.y, 0.5));
  const line = float(1).sub(
    min(
      abs(fract(storeys.sub(0.5)).sub(0.5)).div(max(fwidth(storeys), 1e-4)),
      1
    )
  );
  col = col.mul(float(1).sub(line.mul(d.uBands).mul(wall)));
  const eave = float(1).sub(
    min(abs(h.sub(build.z)).div(max(fwidth(h).mul(2), 1e-4)), 1)
  );
  col = col.mul(float(1).sub(eave.mul(d.uEave).mul(wall).mul(0.6)));
  return osmColour(d, col, build, h, wall, flags);
}

/** A facade's mapped material from the object's flags (lib/city/
 *  city-mesh.ts: glass 4, metal 8), walls only. */
function facadeMaterial(flags: F, wall: F): { glass: F; metal: F } {
  const f = floor(flags.add(0.5));
  return {
    glass: mod(floor(f.div(4)), 2).mul(wall),
    metal: mod(floor(f.div(8)), 2).mul(wall),
  };
}

/** Glass and metal cladding read a little smoother than the clay. */
function facadeRoughness(r: F, m: { glass: F; metal: F }): F {
  return mix(mix(r, 0.42, m.glass), 0.5, m.metal);
}

/**
 * What OSM knows about a building (the `flags` float of its third texel,
 * lib/city/city-mesh.ts: shop 1, heritage 2, glass 4, metal 8), layered onto the clay's
 * colour and glow on the same sliders — it adds none:
 *  - Ladenlicht: a warm wash on a shop's ground floor at dusk, under the
 *    first storey line with a soft top edge, walls only, on the dusk-glow
 *    slider × nightFactor. A low-frequency hash along the facade (≈3.5 m
 *    cells) keeps a long front from reading as one strip. No window
 *    structure: the procedural window grid is a recorded veto.
 *  - Denkmal: a barely-there warm lift of a listed facade (on the
 *    Farbvariation slider) and a finer second cornice line under the eave
 *    (on the Traufkante slider).
 *  - Glas (flag 4): a glass facade (OSM `building:material=glass`) keeps
 *    its clay but turns a little cooler and smoother, and its grazing
 *    angle catches a pale sky sheen (on the Streiflicht slider, dimmed at
 *    night). No panes, no mullions — the window-grid veto holds.
 *  - Metall (flag 8): metal cladding, cooler and a little smoother, no
 *    sheen.
 * Strengths are conservative defaults, not yet judged on a real GPU.
 */
function osmColour(
  d: ClayDetailUniforms,
  col: V3,
  build: V4,
  h: F,
  wall: F,
  flags: F
): V3 {
  const f = floor(flags.add(0.5));
  const listed = mod(floor(f.div(2)), 2);
  const lifted = col.mul(
    vec3(1).add(vec3(0.035, 0.012, -0.012).mul(listed.mul(d.uTint).mul(wall)))
  );
  const cornice = float(1).sub(
    min(abs(h.sub(build.z.sub(0.45))).div(max(fwidth(h), 1e-4)), 1)
  );
  const m = facadeMaterial(flags, wall);
  const cool = mix(
    vec3(1),
    vec3(0.93, 0.99, 1.07),
    max(m.glass, m.metal.mul(0.6))
  );
  return lifted
    .mul(
      float(1).sub(
        cornice
          .mul(listed)
          .mul(step(2, build.z))
          .mul(d.uEave)
          .mul(wall)
          .mul(0.35)
      )
    )
    .mul(cool);
}

/**
 * What the clay emits: Streiflicht (a squared Fresnel rim, warm; on glass a
 * pale sky sheen as well), Abendlicht (build.w = 1: commercial/public,
 * walls only, × night) and Ladenlicht (a shop's ground floor under the
 * first storey line with a soft top edge, broken along the facade by a
 * low-frequency hash in ≈ 3.5 m cells).
 */
function clayGlow(
  d: ClayDetailUniforms,
  build: V4,
  h: F,
  wall: F,
  flags: F,
  wn: V3
): V3 {
  const view = normalize(cameraPosition.sub(positionWorld));
  const fres = float(1).sub(clamp(dot(view, wn), 0, 1));
  const rim = vec3(1, 0.95, 0.8).mul(fres.mul(fres).mul(d.uRim));
  const dusk = build.w.mul(d.uDuskGlow).mul(d.uNight);
  const glow = vec3(1, 0.82, 0.5).mul(dusk.mul(wall).mul(0.5));
  const shop = mod(floor(flags.add(0.5)), 2);
  const floorBand = float(1).sub(smoothstep(0.7, 1, h.div(max(build.y, 0.5))));
  const along = normalize(vec2(wn.z.negate(), wn.x).add(1e-5));
  const seg = dot(positionWorld.xz, along).div(3.5);
  const cell = floor(seg);
  const n0 = fract(sin(cell.mul(12.9898)).mul(43_758.5453));
  const n1 = fract(sin(cell.add(1).mul(12.9898)).mul(43_758.5453));
  const lit = mix(0.45, 1, mix(n0, n1, smoothstep(0, 1, fract(seg))));
  const shopGlow = shop
    .mul(floorBand)
    .mul(wall)
    .mul(lit)
    .mul(d.uDuskGlow)
    .mul(d.uNight);
  // Glas: the grazing angle catches a pale sky sheen, dimmed at night
  const sheen = facadeMaterial(flags, wall)
    .glass.mul(fres.mul(fres).mul(fres))
    .mul(d.uRim)
    .mul(float(1).sub(d.uNight.mul(0.7)));
  // The asked building's paper light: faint by day, a glow after dark.
  const askedLight = vec3(0.97, 0.9, 0.78).mul(
    askedFlag(flags).mul(d.uNight.mul(0.08).add(0.06))
  );
  return rim
    .add(glow)
    .add(vec3(1, 0.78, 0.45).mul(shopGlow.mul(0.4)))
    .add(vec3(0.55, 0.68, 0.85).mul(sheen.mul(0.5)))
    .add(askedLight);
}

/** 1 on the building someone asked about (OBJECT_FLAG_ASKED, 32). */
function askedFlag(flags: F): F {
  return mod(floor(floor(flags.add(0.5)).div(32)), 2);
}

/**
 * The building someone asks about (flag 32, OBJECT_FLAG_ASKED — set in the
 * packed table at runtime by the inquiry probe, ADR 0041): lifted towards
 * paper white (a faint paper light of its own in clayGlow, so it
 * reads in shade too), and drawn over with a pencil hatch. Near, the
 * strokes lie on the building — every 0.9 m, along the wall and up it (so
 * they climb the facade at 45°), straight across the roof, fwidth-constant
 * like the storey lines. Where they would crowd closer than a few pixels
 * (far off, or from the air) the hatch hands over to strokes on the paper
 * itself: 45° lines every 7 px in screen space, so the mark stays legible
 * at any distance and never shimmers. No slider: it marks a choice, it is
 * not part of the look. Branch-free (mixes, no select): fwidth needs
 * uniform control flow, and the flag changes from building to building.
 */
function askedColour(col: V3, h: F, wall: F, flags: F, wn: V3): V3 {
  const asked = askedFlag(flags);
  const along = normalize(vec2(wn.z.negate(), wn.x).add(1e-5));
  const u = mix(
    positionWorld.x.add(positionWorld.z),
    dot(positionWorld.xz, along).add(h),
    wall
  ).div(0.9);
  const w = max(fwidth(u), 1e-4);
  const line = float(1).sub(min(abs(fract(u.sub(0.5)).sub(0.5)).div(w), 1));
  const near = float(1).sub(smoothstep(0.3, 0.7, w));
  const s = screenCoordinate.x.add(screenCoordinate.y).div(7);
  const paper = float(1).sub(
    min(abs(fract(s.sub(0.5)).sub(0.5)).mul(7 / 1.2), 1)
  );
  const ink = mix(paper.mul(0.55), line.mul(0.6), near).mul(asked);
  const lifted = mix(col, vec3(0.97, 0.93, 0.85), asked.mul(0.4));
  return mix(lifted, vec3(0.24, 0.22, 0.21), ink);
}

/**
 * The shared clay state, created once per app instance. `night` is the
 * sun rig's night factor (0 = day, 1 = night) gating the dusk glow;
 * `skyView` the terrain's Himmelslicht row — both shared nodes.
 */
export function createStyleResources(
  night: Live,
  skyView: Live
): StyleResources {
  // Booted at the table defaults; applyCityLook retunes them live.
  return {
    clayDetail: {
      uAO: uniform(LOOK_DEFAULTS.groundShade),
      uBands: uniform(LOOK_DEFAULTS.bands),
      uDuskGlow: uniform(LOOK_DEFAULTS.duskGlow),
      uEave: uniform(LOOK_DEFAULTS.eave),
      uNight: night,
      uRim: uniform(LOOK_DEFAULTS.rim),
      uRoofTint: uniform(LOOK_DEFAULTS.roofTint),
      uRoofVibrance: uniform(LOOK_DEFAULTS.roofVibrance),
      uRough: uniform(LOOK_DEFAULTS.roughness),
      uSkyView: skyView,
      uTint: uniform(LOOK_DEFAULTS.tint),
    },
    materials: new Set(),
    transparency: LOOK_DEFAULTS.transparency,
  };
}

/** The clay graph per app (keyed by its facade uniforms). */
const clayGraphs = new WeakMap<ClayDetailUniforms, ClayGraph>();

/**
 * One tile's clay material: the app's one clay graph, reading that tile's
 * object table and (once it lands) sky view through its slots. Registered
 * in `resources.materials` until the tile disposes it.
 */
export function createClayMaterial(
  resources: StyleResources,
  objects: ObjectTable
): MeshStandardNodeMaterial {
  const d = resources.clayDetail;
  let graph = clayGraphs.get(d);
  if (!graph) {
    graph = clayGraph(d, objects);
    clayGraphs.set(d, graph);
  }
  const clay = new MeshStandardNodeMaterial({
    color: 0xec_e7_df,
    roughness: 1,
    metalness: 0,
  });
  clay.normalNode = graph.normal;
  clay.roughnessNode = graph.roughness;
  clay.colorNode = graph.colour;
  clay.aoNode = graph.ao;
  clay.emissiveNode = graph.emissive;
  setSlots(clay, {
    clayObjects: objects.texture,
    clayRows: objects.rows,
    ...openSkySlots(),
  });
  clay.name = "clay";
  applyTransparency(clay, resources.transparency);
  resources.materials.add(clay);
  clay.addEventListener("dispose", () => resources.materials.delete(clay));
  return clay;
}

/**
 * Hands a tile's clay its sky-view raster (loaded after the tile shows, so
 * the buildings never wait on it): a texture and uniform swap, no rebuild.
 * `origin` is the raster's north-west corner in the recentered data frame,
 * `size` its extent (m).
 */
export function setClaySkyView(
  clay: MeshStandardNodeMaterial,
  texture: Texture,
  origin: [number, number],
  size: [number, number]
): void {
  setSlots(clay, { ...slotsOf(clay), ...claySkySlots(texture, origin, size) });
}

/**
 * Building transparency, 0 (solid) .. 1 (fully see-through).
 *
 * Hash-dithered (`alphaHash`): stochastic coverage composited in the OPAQUE
 * pass with full depth testing, so buildings behind buildings, backsides and
 * roofs all occlude correctly — the batched mesh makes sorted alpha blending
 * impossible.
 *
 * NOTE on needsUpdate: the alpha-hash test is part of the built node graph.
 * Crossing the on/off boundary without flagging needsUpdate leaves the stale
 * build running until something else happens to force a rebuild.
 */
function applyTransparency(clay: MeshStandardNodeMaterial, t: number): void {
  const wasHashed = clay.alphaHash;
  clay.opacity = 1 - t;
  clay.alphaHash = t > 0;
  clay.transparent = false;
  // The two builds of the one graph (material-slots.ts).
  setGraph(clay, clay.alphaHash ? "clay|hashed" : "clay|solid");
  if (clay.alphaHash !== wasHashed) {
    clay.needsUpdate = true;
  }
}

export function setCityTransparency(
  resources: StyleResources,
  transparency: number
): void {
  resources.transparency = Math.min(Math.max(transparency, 0), 1);
  for (const clay of resources.materials) {
    applyTransparency(clay, resources.transparency);
  }
}

/**
 * The clay uniform each building row drives. Transparency is the material's
 * opacity (setCityTransparency), not a uniform. A Record over the row keys,
 * so a row added to the table cannot go unapplied.
 */
const CLAY_UNIFORM_FOR: Record<
  Exclude<ClayLookKey, "transparency">,
  keyof Omit<ClayDetailUniforms, "uNight">
> = {
  bands: "uBands",
  duskGlow: "uDuskGlow",
  eave: "uEave",
  groundShade: "uAO",
  rim: "uRim",
  roofTint: "uRoofTint",
  roofVibrance: "uRoofVibrance",
  roughness: "uRough",
  tint: "uTint",
};

/**
 * Pushes the building rows of the look into the clay: the nine facade
 * detail uniforms (shared nodes, no rebuild) and the transparency.
 */
export function applyCityLook(
  resources: StyleResources,
  look: LookValues
): void {
  for (const [key, uniform] of Object.entries(CLAY_UNIFORM_FOR) as [
    keyof typeof CLAY_UNIFORM_FOR,
    keyof ClayDetailUniforms,
  ][]) {
    resources.clayDetail[uniform].value = look[key];
  }
  setCityTransparency(resources, look.transparency);
}
