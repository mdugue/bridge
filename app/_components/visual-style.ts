import {
  type DataTexture,
  DoubleSide,
  FrontSide,
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
  frontFacing,
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
import { SELECTION_ACCENT } from "@/lib/city/outline";
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
  type V2,
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
import {
  mirrorWeight,
  reflectionStrength,
  skyReflection,
} from "./sky-reflection";

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
  /** Gliederung: plinth, ground-floor and eave cornices, shop zones */
  uArticulation: Live;
  uFacadeReading: Live;
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
  /** Modell's Schnitt is shown: the clay is drawn from both sides */
  section: boolean;
}

/**
 * The Schnitt's poché (plan 055): where the cut opens a building, its
 * inside — the back faces, drawn while a Schnitt is shown — is filled
 * near-black, as a drawn section fills the walls it cuts. One shared
 * uniform; the clay's colour reads it on its back faces only.
 */
export const clayPoche = uniform(0);
const POCHE = vec3(0.025, 0.024, 0.027);

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
      facadeMaterial(flags, wall),
      shopPane(flags),
      rough
    ),
    colour: select(
      clayPoche.greaterThan(0.5).and(frontFacing.not()),
      POCHE,
      askedColour(
        facadeReading(
          d,
          clayColour(d, tint, build, h, wall, flags),
          build,
          h,
          wall,
          flags,
          wn
        ).mul(float(1).sub(facadeMirror(flags, wall, wn).mul(0.6))),
        h,
        wall,
        flags,
        wn
      )
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
  // a door wears its own colour (OBJECT_FLAG_OWN_COLOUR, 64) at full strength
  const own = mod(floor(floor(flags.add(0.5)).div(64)), 2);
  const tintMix = max(mix(d.uTint, d.uRoofTint, isRoof), own);
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
  // a shop window's eave is the glass's top (no stroke): the head's soft
  // shadow falls there instead
  const pane = shopPane(flags);
  col = col.mul(
    float(1).sub(eave.mul(d.uEave).mul(wall).mul(0.6).mul(float(1).sub(pane)))
  );
  col = col.mul(mix(1, paneShade(h, build.z), pane));
  col = articulation(d, col, build, h, wall, flags);
  return osmColour(d, col, build, h, wall, flags).mul(ownTopShade(flags, wall));
}

/** A door's or a shopfront's faces that look up (sills, heads, ledge and
 *  fascia tops, 8–10 cm deep — flag 64, not the glass): half as bright,
 *  so a ledge in the open sky reads as a soft edge, not a white line. */
function ownTopShade(flags: F, wall: F): F {
  const own = mod(floor(floor(flags.add(0.5)).div(64)), 2);
  return float(1).sub(
    own
      .mul(float(1).sub(wall))
      .mul(float(1).sub(shopPane(flags)))
      .mul(0.5)
  );
}

/** A ledge drawn in shade (Gliederung): a lit face `size` metres tall whose
 *  top is at `top`, and a soft shadow `drop` metres deep under it. Its edges
 *  are fwidth-crisp, so it reads at any distance without shimmering. The
 *  multiplier for the colour (1 off the ledge). */
function ledge(h: F, top: F, size: number, drop: number, strength: F): F {
  const px = max(fwidth(h), 1e-4);
  const face = clamp(top.sub(h).div(px), 0, 1).mul(
    clamp(h.sub(top.sub(size)).div(px), 0, 1)
  );
  const below = top.sub(size).sub(h);
  const shade = clamp(below.div(px), 0, 1).mul(
    float(1).sub(smoothstep(0, drop, below))
  );
  return float(1)
    .add(face.mul(0.22).mul(strength))
    .sub(shade.mul(0.4).mul(strength));
}

/**
 * Gliederung (uArticulation): what a house shows at eye level before its
 * windows, from the heights the table already carries — walls only, never
 * on a part with its own colour (a door, flag 64) or on a facade that is
 * its own (a landmark, a church, a theatre, a hall: flag 16,
 * `ownFacade` in lib/city/building-tint.ts) or under a flat roof (flag
 * 256, `markFlatRoofs`: post-war and modern buildings), and only on a facade
 * tall enough to have it; the ground floor's three only on a part standing
 * on the ground (flag 128), not on a tower's part on a roof:
 *  - Sockel: the lowest 0.6 m a little darker and cooler, a stone plinth,
 *    with a crisp top edge (from 3 m of wall) — under the modelled plinth
 *    where the street side has one (lib/city/plinths.ts), which also
 *    models the Gurtgesims at the first storey line and the Traufgesims
 *    under a level eave (no painted ones: their painted shadows read as
 *    a smear, a stain under the roof);
 *  - Ladenzone: a shop's ground floor (flag 1) a shade darker and cooler
 *    under the Gurtgesims, read as the recessed shop front — no panes.
 * Not sun-dependent: the ledges' light and shadow are painted, like the
 * storey lines.
 */
function articulation(
  d: ClayDetailUniforms,
  col: V3,
  build: V4,
  h: F,
  wall: F,
  flags: F
): V3 {
  const f = floor(flags.add(0.5));
  const own = mod(floor(f.div(64)), 2);
  const shop = shopOf(d, flags);
  const grounded = mod(floor(f.div(128)), 2);
  // a landmark's or a church's facade is its own (flag 16): no town
  // house's plinth and cornices on it
  // … nor a flat-roofed one's (flag 256): a post-war slab or a modern
  // block has no town house's plinth and cornices
  const plain = max(
    max(own, mod(floor(f.div(16)), 2)),
    mod(floor(f.div(256)), 2)
  );
  const on = d.uArticulation.mul(wall).mul(float(1).sub(plain));
  // the ground floor's parts on a part standing on the ground only
  const low = on.mul(grounded);
  const storey = max(build.y, 2.4);
  const eave = build.z;
  const px = max(fwidth(h), 1e-4);
  // Sockel
  const plinth = clamp(float(0.6).sub(h).div(px), 0, 1).mul(step(3, eave));
  let out: V3 = mix(col, col.mul(vec3(0.78, 0.79, 0.83)), plinth.mul(low));
  out = out.mul(
    ledge(h, float(0.64), 0.04, 0.12, low.mul(step(3, eave)).mul(0.8))
  );
  // Ladenzone under the first storey's ledge
  const zone = clamp(storey.sub(0.35).sub(h).div(px), 0, 1)
    .mul(clamp(h.sub(0.6).div(px), 0, 1))
    .mul(shop);
  out = mix(out, out.mul(vec3(0.74, 0.76, 0.8)), zone.mul(low));
  // the Gurtgesims and the Traufgesims are modelled: lib/city/plinths.ts
  return out;
}

/** Smooth value noise in [0, 1] (two hashed corners per axis, eased):
 *  blotches, never a grid's lines. */
function valueNoise(p: V2): F {
  const i = floor(p);
  const f = fract(p);
  const u = f.mul(f).mul(f.mul(-2).add(3));
  const hash = (o: [number, number]) =>
    fract(sin(dot(i.add(vec2(...o)), vec2(127.1, 311.7))).mul(43_758.5453));
  return mix(
    mix(hash([0, 0]), hash([1, 0]), u.x),
    mix(hash([0, 1]), hash([1, 1]), u.x),
    u.y
  );
}

/** A building's facade readings from its flags (lib/city/facade-reading.ts:
 *  FACADE_UNIT × (busy + 4 × dark), each graded 0 unseen, 1–3). */
function readingOf(flags: F): { busy: F; dark: F; shop: F } {
  const code = floor(floor(flags.add(0.5)).div(512));
  return {
    busy: mod(code, 4),
    dark: mod(floor(code.div(4)), 4),
    shop: floor(code.div(16)),
  };
}

/** A shop on the ground floor: OSM's (flag 1), or a shop sign the street
 *  photos saw (on the Fassadenbild slider). */
function shopOf(d: ClayDetailUniforms, flags: F): F {
  return max(
    mod(floor(flags.add(0.5)), 2),
    readingOf(flags).shop.mul(d.uFacadeReading)
  );
}

/** Where on its wall a fragment lies: metres along the wall and up. */
function wallPlane(wn: V3, h: F): V2 {
  const along = normalize(vec2(wn.z.negate(), wn.x).add(1e-5));
  return vec2(dot(positionWorld.xz, along), h);
}

/**
 * Fassadenbild (uFacadeReading): what street photos say about a facade
 * (lib/city/facade-reading.ts), painted onto the clay as Gliederung's
 * ledges are — walls only, never on a part with its own colour (64), a
 * landmark's facade (16) or glass and metal (4, 8: the photos cannot tell
 * glass from stucco), and nothing on a facade nobody photographed:
 *  - Unruhe: a mid or busy facade (much of it not plain render) gets a
 *    fine plaster relief lit from above (the slope of a flat-lying noise
 *    up the wall, ±10 % at busy, two octaves of 0.3 and 0.13 m), above the
 *    plinth and under the eave, each octave faded out once it is a few
 *    pixels. No blotch darker than the wall, no lattice: the window-grid
 *    veto holds.
 *  - Ton: much dark in it (frames, openings, soot) up to 8 % darker, a
 *    touch cooler; little dark 3 % lighter — capped, so a misreading is
 *    never a colour error.
 *  - Geschossgesimse: a busy facade under a pitched roof (the Gründerzeit
 *    front) carries a ledge at every storey line up to the eave, not only
 *    the first (on Gliederung's slider too).
 *  - Ladensockel: a shop sign at the wall or an open ground floor joins
 *    OSM's shops (`shopOf`), so Gliederung's Ladenzone and the dusk's
 *    shop light take it as they are.
 */
function facadeReading(
  d: ClayDetailUniforms,
  col: V3,
  build: V4,
  h: F,
  wall: F,
  flags: F,
  wn: V3
): V3 {
  const f = floor(flags.add(0.5));
  const { busy, dark } = readingOf(flags);
  const plain = max(
    max(mod(floor(f.div(64)), 2), mod(floor(f.div(16)), 2)),
    max(mod(floor(f.div(4)), 2), mod(floor(f.div(8)), 2))
  );
  const on = d.uFacadeReading.mul(wall).mul(float(1).sub(plain));
  const eave = build.z;
  // Unruhe: mid 0.5, busy 1 — a relief lit from above: the slope of a
  // fine, flat-lying noise up the wall, so its edges catch light on top and
  // shade below (a plaster texture), never a blotch darker than the wall
  const amp = clamp(busy.sub(1).mul(0.5), 0, 1);
  const p = wallPlane(wn, h);
  const px = max(fwidth(p.x), fwidth(h));
  const nearC = float(1).sub(smoothstep(0.1, 0.3, px));
  const nearF = float(1).sub(smoothstep(0.04, 0.12, px));
  const relief = (q: V2): F =>
    valueNoise(q.div(vec2(0.55, 0.32)))
      .mul(0.6)
      .mul(nearC)
      .add(
        valueNoise(q.div(vec2(0.22, 0.13)).add(17.3))
          .mul(0.4)
          .mul(nearF)
      );
  const slope = relief(p).sub(relief(p.sub(vec2(0, 0.05))));
  // falling as it rises: the face tilts up, towards the sky
  const lit = clamp(slope.mul(-4), -1, 1);
  const band = smoothstep(0.6, 1.2, h).mul(
    float(1).sub(smoothstep(eave.sub(0.6), eave.sub(0.2), h))
  );
  let out: V3 = col.mul(
    float(1).add(lit.mul(0.1).add(0.015).mul(amp).mul(band).mul(on))
  );
  // Ton: dark 1 lifts 3 %, 2 darkens 2 %, 3 darkens 8 % (a touch cool)
  const tone = mix(
    mix(vec3(1.03), vec3(0.98), step(1.5, dark)),
    vec3(0.92, 0.92, 0.94),
    step(2.5, dark)
  );
  out = mix(out, out.mul(tone), on.mul(step(0.5, dark)));
  // Geschossgesimse on a busy facade under a pitched roof
  const storey = max(build.y, 2.4);
  const k = floor(h.sub(0.1).div(storey)).add(1);
  const top = k.mul(storey).add(0.1);
  const pitched = float(1).sub(mod(floor(f.div(256)), 2));
  const busyFront = step(2.5, busy)
    .mul(pitched)
    .mul(step(1.5, k))
    .mul(step(top, eave.sub(0.8)))
    .mul(d.uArticulation);
  return out.mul(ledge(h, top, 0.2, 0.35, on.mul(busyFront)));
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

/**
 * Spiegelung on a facade (sky-reflection.ts): how much of the sky a glass
 * wall (flag 4) mirrors, from a tenth face on to all of it at a grazing
 * view, and a metal one (flag 8) a third as much — weighted by the row,
 * so at 0 the facade is the clay it was. The clay's own colour gives way
 * by part of it (clayGraph), as a pane's would.
 */
function facadeMirror(flags: F, wall: F, wn: V3): F {
  const m = facadeMaterial(flags, wall);
  // a shop window's pane keeps its own calm sky (paneSky), never a mirror
  const glass = m.glass.mul(float(1).sub(shopPane(flags)));
  return mirrorWeight(wn, 0.1)
    .mul(glass.add(m.metal.mul(0.35)))
    .mul(reflectionStrength);
}

/** Glass and metal cladding read a little smoother than the clay; a shop
 *  window's pane (`shopPane`) takes its own roughness from the `rough`
 *  column, smooth enough to mirror the sun and the sky. */
function facadeRoughness(
  r: F,
  m: { glass: F; metal: F },
  pane: F,
  paneRough: F
): F {
  return mix(mix(mix(r, 0.42, m.glass), 0.5, m.metal), paneRough, pane);
}

/** 1 on a shop window's pane: glass (4) that wears its own colour (64) —
 *  the shopfronts' panes (lib/city/shopfronts.ts), the one exception to
 *  the glass veto. Its `rough` column is then a roughness, not a jitter. */
function shopPane(flags: F): F {
  const f = floor(flags.add(0.5));
  return mod(floor(f.div(64)), 2).mul(mod(floor(f.div(4)), 2));
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
 * low-frequency hash in ≈ 3.5 m cells). A shop window's pane takes its
 * own sky (`paneSky`) in place of the rim and the glass sheen.
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
  // a shop window has its own grazing light (paneSky), not the clay's rim
  const pane = shopPane(flags);
  const clayOnly = float(1).sub(pane);
  // … nor on a door's or a shopfront's sills, heads and undersides: seen
  // edge-on, 8 cm faces are slivers a pixel high, and the rim (Fresnel → 1
  // there) lit them into a dotted white line along every frame
  const own = mod(floor(floor(flags.add(0.5)).div(64)), 2);
  const rimOn = clayOnly.mul(float(1).sub(own.mul(float(1).sub(wall))));
  const rim = vec3(1, 0.95, 0.8).mul(fres.mul(fres).mul(d.uRim).mul(rimOn));
  const dusk = build.w.mul(d.uDuskGlow).mul(d.uNight);
  const glow = vec3(1, 0.82, 0.5).mul(dusk.mul(wall).mul(0.5));
  const shop = shopOf(d, flags);
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
  // Glas: the grazing angle catches a pale sky sheen, dimmed at night —
  // the stand-in for the reflection, drawn only as Spiegelung is turned down
  const sheen = facadeMaterial(flags, wall)
    .glass.mul(fres.mul(fres).mul(fres))
    .mul(d.uRim)
    .mul(clayOnly)
    .mul(float(1).sub(d.uNight.mul(0.7)))
    .mul(float(1).sub(reflectionStrength));
  // The asked building's light, in the accent's pale: faint by day, a
  // glow after dark.
  const askedLight = vec3(...SELECTION_ACCENT.halo).mul(
    askedFlag(flags).mul(d.uNight.mul(0.08).add(0.06))
  );
  return rim
    .add(glow)
    .add(vec3(1, 0.78, 0.45).mul(shopGlow.mul(0.4)))
    .add(vec3(0.55, 0.68, 0.85).mul(sheen.mul(0.5)))
    .add(skyReflection(wn, 0.22).mul(facadeMirror(flags, wall, wn)))
    .add(paneSky(d, h, fres).mul(paneShade(h, build.z)).mul(pane))
    .add(askedLight);
}

/** The soft shadow the surround's head throws onto a shop window's glass:
 *  its upper half metre darkening towards the top (`top`, the glass's top
 *  over the object's foot — its `eaveH`), a gradient, never an edge. The
 *  multiplier for the pane's colour and sky. */
function paneShade(h: F, top: F): F {
  return float(1).sub(smoothstep(top.sub(0.6), top, h).mul(0.45));
}

/** The pale sky a shop window's muted glass holds (its lit term is the
 *  sun's: roughness 0.2). Lit or not, it reads as glass: the pane
 *  brightens a little upwards, as if the sky were mirrored (`h`, metres
 *  above the object's foot: the pane runs from 0.3–0.5 m to about 3 m),
 *  and Schlick's Fresnel lifts it more where it is seen at a grazing angle
 *  (`fres`, 1 − n·v). Calm, never a mirror: at most about a seventh of the
 *  sky's colour, dimmed at night — the glass is only a little darker than
 *  its wall, and a stronger sky would wash it out to the wall's tone. */
function paneSky(d: ClayDetailUniforms, h: F, fres: F): V3 {
  const upper = smoothstep(0.8, 2.6, h);
  const f2 = fres.mul(fres);
  const schlick = float(0.04).add(float(0.96).mul(f2.mul(f2).mul(fres)));
  return vec3(0.55, 0.66, 0.8).mul(
    upper
      .mul(0.04)
      .add(schlick.mul(0.15))
      .mul(float(1).sub(d.uNight.mul(0.85)))
  );
}

/** 1 on the building someone asked about (OBJECT_FLAG_ASKED, 32). */
function askedFlag(flags: F): F {
  return mod(floor(floor(flags.add(0.5)).div(32)), 2);
}

/**
 * The building someone asks about (flag 32, OBJECT_FLAG_ASKED — set in the
 * packed table at runtime by the inquiry probe, ADR 0042): lifted towards
 * the accent's pale (a faint light of its own in clayGlow, so it reads in
 * shade too), and drawn over with a hatch in the HUD's accent
 * (`SELECTION_ACCENT`, lib/city/outline.ts) — the selection is the
 * interface's, so it leaves the city's palette. Near, the
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
  const lifted = mix(col, vec3(...SELECTION_ACCENT.halo), asked.mul(0.4));
  return mix(lifted, vec3(...SELECTION_ACCENT.ink), ink);
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
      uArticulation: uniform(LOOK_DEFAULTS.articulation),
      uFacadeReading: uniform(LOOK_DEFAULTS.facadeReading),
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
    section: false,
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
  // the figure of a figure-ground plan (the Schwarzplan, paper-scene.ts)
  clay.userData.figure = true;
  applyTransparency(clay, resources.transparency, resources.section);
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
function applyTransparency(
  clay: MeshStandardNodeMaterial,
  t: number,
  section: boolean
): void {
  const wasHashed = clay.alphaHash;
  const wasSide = clay.side;
  clay.opacity = 1 - t;
  clay.alphaHash = t > 0;
  clay.transparent = false;
  clay.side = section ? DoubleSide : FrontSide;
  // The builds of the one graph (material-slots.ts): solid or hashed, and
  // two-sided while a Schnitt shows its poché.
  setGraph(
    clay,
    `clay|${clay.alphaHash ? "hashed" : "solid"}${section ? "|double" : ""}`
  );
  if (clay.alphaHash !== wasHashed || clay.side !== wasSide) {
    clay.needsUpdate = true;
  }
}

/**
 * Modell's Schnitt on or off (plan 055): the clay drawn from both sides,
 * so a cut building shows its inside, filled as poché. A second build of
 * the clay's graph, made once on the first Schnitt.
 */
export function setClaySection(resources: StyleResources, on: boolean): void {
  if (resources.section === on) {
    return;
  }
  resources.section = on;
  clayPoche.value = on ? 1 : 0;
  for (const clay of resources.materials) {
    applyTransparency(clay, resources.transparency, on);
  }
}

export function setCityTransparency(
  resources: StyleResources,
  transparency: number
): void {
  resources.transparency = Math.min(Math.max(transparency, 0), 1);
  for (const clay of resources.materials) {
    applyTransparency(clay, resources.transparency, resources.section);
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
  articulation: "uArticulation",
  facadeReading: "uFacadeReading",
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
