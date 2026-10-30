import {
  type DataTexture,
  DoubleSide,
  FrontSide,
  InterpolationSamplingType,
  MeshStandardNodeMaterial,
  type Node,
  type Texture,
  type UniformNode,
  Vector3,
} from "three/webgpu";
import {
  abs,
  attribute,
  cameraWorldMatrix,
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
  normalFlat,
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
import {
  OBJECT_FLAG_FLOODLIT,
  OBJECT_TEXTURE_WIDTH,
} from "@/lib/city/city-mesh";
import { FACADE_UNIT } from "@/lib/city/facade-reading";
import { SELECTION_ACCENT } from "@/lib/city/outline";
import { FACADE_ROOF, NO_DOOR, WALL_EAVE } from "@/lib/city/windows";
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
import { clayWindows } from "./clay-windows";
import { nightShadowFree } from "./lantern";
import {
  claySkySlots,
  createClaySky,
  openSkySlots,
  SKY_VIEW,
} from "./sky-light";
import { mirrorWeight, REFLECTIONS, skyReflection } from "./sky-reflection";
import { viewDirection } from "./view-direction";

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
  /** the sun's light where a window's sill or reveal shades it */
  receivedShadow: (shadow?: Node) => Node;
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

/** The clay's live uniforms, shared by every tile (the sun rig writes them). */
export interface ClayDetailUniforms {
  /** night factor 0..1, driven by the sun rig (gates the dusk glow) */
  uNight: Live;
  /** world, surface → sun (the sun rig's vector, shared by reference):
   *  the windows' own shadows */
  uSun: UniformNode<"vec3", Vector3>;
}

// --- the fixed look ----------------------------------------------------------
// Each facade term's strength, fixed at what its slider stood at by default
// before the sliders went (plan 073, ADR 0018): tuning one is an edit here,
// judged by snapshots of place and time.

/** Farbvariation: the clay colour each building takes from its use and
 *  height, mixed into the base — a middling mix breaks the uniform massing
 *  and stays painterly. The shopfronts' baked colours assume it
 *  (scripts/bake-city-mesh.ts `WALL_TINT_SHOWN`): tune both together. */
const TINT = float(0.6);
/** Dachfarbe: terracotta or slate per roof, from its form and pitch —
 *  roofs carry more colour than walls, the strongest readability cue. */
const ROOF_TINT = float(0.7);
/** Dachsättigung: the roof colours' chroma lifted without moving their hue
 *  — copper green, terracotta and slate alike (0 = the raw aerial). */
const ROOF_VIBRANCE = float(0.5);
/** Dachwärme: from how warm a roof's own colour reads — red over blue
 *  against its lightness, a zinc, concrete or bitumen grey at or under
 *  0.1, terracotta about 2 — to where it is warm: below, the roof mixes
 *  toward the clay's lightness as grey and takes no warm nudge, so a cool
 *  grey stays cool (it turned warm in a fifth to half of each city's grey
 *  roofs); above, it keeps the clay's warm hue as before. */
const ROOF_WARM_FROM = 0.1;
const ROOF_WARM_TO = 0.4;
/** Boden-Verlauf: the walls darkened over their lowest ~5 m. */
const GROUND_SHADE = float(0.34);
/** Höhenlinien: the storey lines. */
const BANDS = float(0.18);
/** Streiflicht: the Fresnel rim. */
const RIM = float(0.6);
/** Traufkante: the soft stroke where wall meets roof. */
const EAVE = float(0.35);
/** Gliederung: the painted plinth and shop zone (plinth and cornices
 *  above the ground floor are modelled). */
const ARTICULATION = float(0.8);
/** Fenster: the window rows on every facade (clay-windows.ts). */
const WINDOWS = float(1);
/** Fassadenbild: what street photos say about a facade — fine relief
 *  where it is busy, a darker tone, a shop's ground floor. */
const FACADE_READING = float(1);
/** Abendlicht: the lit windows' strength after dark (clay-windows.ts),
 *  and the shops' (`SHOP_LIGHT`). */
const DUSK_GLOW = float(0.5);
/** Streiflicht's share left at night: a rim is the sky's light on a
 *  grazing wall, and the night sky has none to give. */
const NIGHT_RIM = float(0.1);
/** Lichtkegel: the light at a commercial or public wall's foot after dark
 *  (`nightLight`) — light on the wall from in front, never the wall
 *  glowing. */
const GROUND_LIGHT = float(0.15);
/** Anstrahlung: the floodlights after dark on the landmarks a city
 *  lights (OBJECT_FLAG_FLOODLIT, `FLOODLIT_SHARE` of them, whole
 *  buildings at once — lib/city/city-mesh.ts `isFloodlit`), and the share
 *  of the lamps along a lit wall that are on (`FLOOD_ON`): unevenly. */
const FLOODLIGHT = float(0.12);
const FLOOD_ON = float(0.7);
/** Ladenlicht: a shop's lit ground floor, × Abendlicht. */
const SHOP_LIGHT = float(0.14);
/** A shop window's pane lit from inside after dark. */
const PANE_LIGHT = float(0.22);
/** Materialstreuung: the matte sheen's spread from house to house. */
const ROUGHNESS = float(0.12);

/**
 * What every tile's clay material shares: the facade uniforms and the
 * material settings the look drives. Each tile's buildings get their own
 * material (it binds that tile's object table).
 */
export interface StyleResources {
  /** the clay's live uniforms (the night, the sun) */
  clayDetail: ClayDetailUniforms;
  /** every live clay material, for the Schnitt's fan-out (setClaySection) */
  materials: Set<MeshStandardNodeMaterial>;
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
 *  - Farbvariation (TINT): blends each building's own muted clay-family colour
 *    into the flat base so a dense block stops reading as one uniform mass.
 *    Applied FIRST so the shading below (ground-darken, contour lines)
 *    modulates the tinted colour. A zero tint reads as "no tint" rather than
 *    darkening the building to black.
 *  - Boden-Verlauf (GROUND_SHADE): a soft darkening over the lowest ~5 m
 *    (ambient-occlusion surrogate that gives the massing physical contact
 *    with the ground).
 *  - Höhenlinien (BANDS): thin, crisp horizontal contour strokes every storey
 *    (~3 m), drawn with fwidth for constant on-screen width — the SAME hand-drawn
 *    contour-line language as the terrain, so facades read height/scale without a
 *    heavy "banded" look. Walls only.
 *  - Streiflicht (RIM): a Fresnel rim that separates silhouettes from like-
 *    coloured neighbours. Strength is squared-Fresnel + a healthy multiplier
 *    because there is no bloom.
 *  - Traufkante (EAVE): one soft cornice stroke at the wall/roof boundary.
 *  - Materialstreuung (ROUGHNESS): the matte sheen varies house to house.
 *  - Dachsättigung (ROOF_VIBRANCE): the real roof colour lifted into a
 *    confident watercolour register without choosing a target hue.
 *  - Dachwärme (ROOF_WARM_FROM…TO): a grey roof mixes toward the clay's
 *    lightness, not its warm hue — zinc, concrete and bitumen stay cool.
 *  - Himmelslicht: the courtyard's ground floor gets less of the sky
 *    (sky-light.ts `createClaySky`, the aoNode, at `SKY_VIEW`).
 *  - after dark (× uNight): light on the walls from in front of them —
 *    cones at a commercial or public wall's foot, floodlights on a
 *    landmark, a shop's ground floor — and the lit windows (`nightLight`,
 *    clay-windows.ts); the walls themselves never glow.
 * Heights come from world space (world Y is elevation). The strengths are
 * the fixed look's constants above; the night and the sun are shared
 * uniform nodes the sun rig writes.
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
  // Flat: the windows' style word runs to 2²¹, where an interpolated
  // float's drift of a few ulps (0.125 there) reaches its low bits.
  const spec = varying(band(3)).setInterpolation(
    InterpolationSamplingType.FLAT
  );
  // The roof flag rides in the place on the wall's first door slot
  // (FACADE_ROOF, lib/city/windows.ts): one vertex buffer less.
  const facade = attribute("facade", "vec4");
  const roof = step(facade.z, float(FACADE_ROOF + 1e-3));
  const localH = varying(dataPosition().z.sub(a.w));
  // A mix, not a select: three emits a select as if/else, and the texel
  // reads first built inside one arm would be assigned in that arm only —
  // every other varying here reads them too.
  // A roof vertex carries its face's own colour in its wall slots, where
  // the orthophoto read the face apart from its building (roof_colour.py;
  // zero: the building's).
  const faceRgb = vec3(facade.x, facade.y, facade.w);
  const ownFace = step(1e-5, faceRgb.x.add(faceRgb.y).add(faceRgb.z));
  const roofRgb = mix(b.rgb, faceRgb, ownFace);
  const tint = varying(mix(a.rgb, roofRgb, step(0.5, roof)));
  // A wall's own eave rides in its second door slot where no door needs
  // it (WALL_EAVE): a front over its object's lowest roof keeps its top
  // row of windows, its eave stroke and its cornice line under its own.
  const build = varying(
    vec4(roof, c.x, b.w.add(wallEaveUp(facade, roof)), c.y)
  );
  // Flat: it seeds the windows' hashes (clay-windows.ts), which magnify an
  // interpolated float's last-bit drift into a different window position
  // every pixel — a loose grid's openings frayed at their sides.
  const rough = varying(c.z).setInterpolation(InterpolationSamplingType.FLAT);
  const flags = varying(c.w);
  // A triangle that was degenerate when its flat normal was baked has a zero
  // normal, and position quantisation can give it area again: it then
  // rasterises with normalize(0) = NaN lighting — single black pixels on
  // roofs that the DoF blur spread into black squares. Any unit vector will
  // do for a sliver that thin.
  const raw = attribute("normal", "vec3");
  const safe = select(dot(raw, raw).lessThan(1e-8), vec3(0, 1, 0), raw);
  // The facet's own plane, from the view position's derivatives: the
  // vertex normal rounds a curve's facets (lib/city/crease-normals.ts) and
  // turns across each one, but the windows, the relief and the glow cells
  // are laid on the facet itself (`_FACADE`), so their frame is the flat one.
  const wn = normalize(cameraWorldMatrix.mul(vec4(normalFlat, 0)).xyz);
  // … while what turns with the view (the rim, a pane's mirror) follows the
  // rounded surface: on the flat frame a dome's facets each took their own
  // rim and the curve read as a grid of tones again
  const viewNormal = normalize(varying(transformNormalToView(safe)));
  const sn = normalize(cameraWorldMatrix.mul(vec4(viewNormal, 0)).xyz);
  const h = max(localH, 0);
  // A steep roof face is no wall: a mansard's slopes took storey lines,
  // the eave stroke and plaster relief by their normal alone.
  const wall = float(1)
    .sub(smoothstep(0.5, 0.7, abs(wn.y)))
    .mul(float(1).sub(build.x));
  // along the view, in Modell's parallel projection too
  const view = viewDirection();
  const windows = clayWindows({
    eave: build.z,
    // the windows read no roof vertex's slots: they hold its colour
    facade: varying(mix(facade, vec4(0, 0, FACADE_ROOF, NO_DOOR), roof)),
    h,
    seed: rough,
    shop: shopOf(flags),
    spec,
    storey: build.y,
    strength: WINDOWS,
    sun: d.uSun,
    view,
    wall,
    wn,
  });
  // the wall's own looks (relief, tone, ledges) stay off the openings
  const plaster = wall.mul(float(1).sub(windows.opening));
  return {
    normal: normalize(mix(viewNormal, windows.normal, windows.normalMix)),
    // A facet turned from the sun is in its own shadow, whatever its
    // rounded normal says: buildings cast with their back faces (sun-rig.ts),
    // so its shadow-map depth is its own and the test would speckle it.
    receivedShadow: (shadow?: Node) => {
      // the sun's own, which after dark gives way for the lantern's light
      // (three hands this every casting light's term; lantern.ts)
      const own = max(
        windows.sun.mul(smoothstep(-0.02, 0.06, dot(wn, d.uSun))),
        nightShadowFree
      );
      return shadow ? (shadow as F).mul(own) : own;
    },
    // Materialstreuung: nudge roughness per building so the matte sheen
    // varies house-to-house (clamped to stay matte, no shiny clay).
    roughness: facadeRoughness(
      clamp(float(1).add(ROUGHNESS.mul(rough)), 0.55, 1),
      facadeMaterial(flags, wall),
      shopPane(flags),
      rough
    ),
    // A mix, not a select: three emits a select as if/else, and the facade
    // drawn inside its arm — the windows first among it — would be built
    // twice (the normal, light and glow read it outside), its derivatives in
    // a branch.
    colour: mix(
      askedColour(
        windows
          .colour(
            facadeReading(
              clayColour(tint, build, h, wall, flags),
              build,
              h,
              plaster,
              flags,
              wn
            )
          )
          .mul(float(1).sub(facadeMirror(flags, wall, sn).mul(0.6))),
        h,
        wall,
        flags,
        wn
      ),
      POCHE,
      step(0.5, clayPoche).mul(float(1).sub(float(frontFacing)))
    ),
    // Himmelslicht: the courtyard's ground floor gets less of the sky;
    // a window's recess and the wall under its sill less still.
    ao: createClaySky().ao(h, build.z, SKY_VIEW).mul(windows.ao),
    emissive: clayGlow(d, build, h, wall, flags, wn, sn).add(
      windows.glow.mul(DUSK_GLOW).mul(d.uNight)
    ),
  };
}

/** How far a wall vertex's own eave lies over its object's (m), from the
 *  code in its second door slot (lib/city/windows.ts `WALL_EAVE`,
 *  `slotWallEave`); 0 on a door's code, `NO_DOOR` and every roof vertex
 *  (whose slots hold its colour). */
function wallEaveUp(facade: V4, roof: F): F {
  const code = floor(facade.w.mul(32_767).add(0.5));
  const own = step(WALL_EAVE.code0 - 0.5, code)
    .mul(step(code, WALL_EAVE.top + 0.5))
    .mul(float(1).sub(roof));
  return code.sub(WALL_EAVE.code0).mul(WALL_EAVE.step).mul(own);
}

/**
 * The clay's colour: Farbvariation first (so the shading below modulates
 * it) — roof faces (build.x = 1) carry the roof colour at the roof mix
 * strength, walls the wall colour, and a zero tint (no colour known) keeps
 * the base rather than mixing toward black — a roof that is not warm
 * (Dachwärme) toward the clay's lightness as grey, not its warm hue;
 * Dachsättigung, a hue-preserving chroma boost around the grey axis (dull,
 * hazy roofs lifted most, vivid ones barely, so nothing blows out) plus a
 * tiny warm nudge on the muddy, warm roofs only, roofs only;
 * Boden-Verlauf over the lowest ~5 m; the storey lines at the building's
 * own storey height (fwidth-constant width) and the eave stroke, walls
 * only; then Denkmal.
 */
function clayColour(tint: V3, build: V4, h: F, wall: F, flags: F): V3 {
  const isRoof = step(0.5, build.x);
  // a door wears its own colour (OBJECT_FLAG_OWN_COLOUR, 64) at full strength
  const own = mod(floor(floor(flags.add(0.5)).div(64)), 2);
  const tintMix = max(mix(TINT, ROOF_TINT, isRoof), own);
  const luma = vec3(0.299, 0.587, 0.114);
  const roofL = dot(tint, luma);
  const roofC = tint.sub(roofL);
  const dull = float(1).sub(smoothstep(0.04, 0.3, length(roofC)));
  const vib = ROOF_VIBRANCE.mul(dull);
  const warm = smoothstep(
    ROOF_WARM_FROM,
    ROOF_WARM_TO,
    tint.x.sub(tint.z).div(max(roofL, 0.02))
  );
  const roofCol = vec3(roofL)
    .add(roofC.mul(float(1).add(vib.mul(2.4))))
    .add(vec3(0.018, 0.004, -0.014).mul(ROOF_VIBRANCE).mul(dull).mul(warm));
  const clayCol = mix(tint, clamp(roofCol, 0, 1), isRoof);
  // what the colour mixes toward: the clay, a roof that is not warm the
  // clay's lightness as grey
  const clayGrey = vec3(dot(materialColor.rgb, luma));
  const base = mix(
    materialColor.rgb,
    mix(clayGrey, materialColor.rgb, warm),
    isRoof
  );
  let col: V3 = select(
    dot(tint, tint).greaterThan(1e-4),
    mix(base, clayCol, tintMix),
    materialColor.rgb
  );
  col = col.mul(
    mix(float(1).sub(GROUND_SHADE.mul(0.55)), 1, smoothstep(0, 5, h))
  );
  const storeys = h.div(max(build.y, 0.5));
  const line = float(1).sub(
    min(
      abs(fract(storeys.sub(0.5)).sub(0.5)).div(max(fwidth(storeys), 1e-4)),
      1
    )
  );
  // no storey lines on a facade of its own (flag 512): a palace's or a
  // hall's storeys are not the height's 3.2 m
  const ownFacade = mod(floor(floor(flags.add(0.5)).div(512)), 2);
  col = col.mul(
    float(1).sub(line.mul(BANDS).mul(wall).mul(float(1).sub(ownFacade)))
  );
  const eave = float(1).sub(
    min(abs(h.sub(build.z)).div(max(fwidth(h).mul(2), 1e-4)), 1)
  );
  // a shop window's eave is the glass's top (no stroke): the head's soft
  // shadow falls there instead
  const pane = shopPane(flags);
  col = col.mul(
    float(1).sub(eave.mul(EAVE).mul(wall).mul(0.6).mul(float(1).sub(pane)))
  );
  col = col.mul(mix(1, paneShade(h, build.z), pane));
  col = articulation(col, build, h, wall, flags);
  return osmColour(col, build, h, wall, flags).mul(ownTopShade(flags, wall));
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
 * Gliederung (ARTICULATION): what a house shows at eye level before its
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
function articulation(col: V3, build: V4, h: F, wall: F, flags: F): V3 {
  const f = floor(flags.add(0.5));
  const own = mod(floor(f.div(64)), 2);
  const shop = shopOf(flags);
  const grounded = mod(floor(f.div(128)), 2);
  // a landmark's or a church's facade is its own (flag 16): no town
  // house's plinth and cornices on it
  // … nor a flat-roofed one's (flag 256): a post-war slab or a modern
  // block has no town house's plinth and cornices
  const plain = max(
    max(own, mod(floor(f.div(16)), 2)),
    mod(floor(f.div(256)), 2)
  );
  const on = ARTICULATION.mul(wall).mul(float(1).sub(plain));
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
  // the readings' 5 bits; the runtime's floodlit bit sits above them
  const code = mod(floor(floor(flags.add(0.5)).div(FACADE_UNIT)), 32);
  return {
    busy: mod(code, 4),
    dark: mod(floor(code.div(4)), 4),
    shop: floor(code.div(16)),
  };
}

/** A shop on the ground floor: OSM's (flag 1), or a shop sign the street
 *  photos saw (on Fassadenbild's strength). */
function shopOf(flags: F): F {
  return max(
    mod(floor(flags.add(0.5)), 2),
    readingOf(flags).shop.mul(FACADE_READING)
  );
}

/** Where on its wall a fragment lies: metres along the wall and up. */
function wallPlane(wn: V3, h: F): V2 {
  const along = normalize(vec2(wn.z.negate(), wn.x).add(1e-5));
  return vec2(dot(positionWorld.xz, along), h);
}

/**
 * Fassadenbild (FACADE_READING): what street photos say about a facade
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
 *    the first (on Gliederung's strength too).
 *  - Ladensockel: a shop sign at the wall or an open ground floor joins
 *    OSM's shops (`shopOf`), so Gliederung's Ladenzone and the dusk's
 *    shop light take it as they are.
 */
function facadeReading(
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
  const on = FACADE_READING.mul(wall).mul(float(1).sub(plain));
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
    .mul(ARTICULATION);
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
 * view, and a metal one (flag 8) a third as much — weighted by its
 * strength (REFLECTIONS), at 0 the clay it was. The clay's own colour
 * gives way by part of it (clayGraph), as a pane's would.
 */
function facadeMirror(flags: F, wall: F, normal: V3): F {
  const m = facadeMaterial(flags, wall);
  // a shop window's pane keeps its own calm sky (paneSky), never a mirror
  const glass = m.glass.mul(float(1).sub(shopPane(flags)));
  return mirrorWeight(normal, 0.1)
    .mul(glass.add(m.metal.mul(0.35)))
    .mul(REFLECTIONS);
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
 * colour and glow at the same strengths — it adds none:
 *  - Ladenlicht: drawn after dark by `nightLight`, not here.
 *  - Denkmal: a barely-there warm lift of a listed facade (on the
 *    Farbvariation's strength) and a finer second cornice line under the
 *    eave (at Traufkante's).
 *  - Glas (flag 4): a glass facade (OSM `building:material=glass`) keeps
 *    its clay but turns a little cooler and smoother, and its grazing
 *    angle catches a pale sky sheen (at Streiflicht's strength, dimmed at
 *    night, and only below full Spiegelung). No panes, no mullions — the
 *    window-grid veto holds.
 *  - Metall (flag 8): metal cladding, cooler and a little smoother, no
 *    sheen.
 * Strengths are conservative defaults, not yet judged on a real GPU.
 */
function osmColour(col: V3, build: V4, h: F, wall: F, flags: F): V3 {
  const f = floor(flags.add(0.5));
  const listed = mod(floor(f.div(2)), 2);
  const lifted = col.mul(
    vec3(1).add(vec3(0.035, 0.012, -0.012).mul(listed.mul(TINT).mul(wall)))
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
        cornice.mul(listed).mul(step(2, build.z)).mul(EAVE).mul(wall).mul(0.35)
      )
    )
    .mul(cool);
}

/**
 * What the clay emits: Streiflicht (a squared Fresnel rim, warm, a tenth
 * of it at night; on glass a pale sky sheen as well) and the night's light
 * on the walls (`nightLight`). A shop window's pane takes its own sky
 * (`paneSky`) in place of the rim and the glass sheen. The rim and the
 * mirror follow the rounded normal `sn`, the night's light the facet's
 * flat frame `wn`.
 */
function clayGlow(
  d: ClayDetailUniforms,
  build: V4,
  h: F,
  wall: F,
  flags: F,
  wn: V3,
  sn: V3
): V3 {
  const view = viewDirection().negate();
  const fres = float(1).sub(clamp(dot(view, sn), 0, 1));
  // a shop window has its own grazing light (paneSky), not the clay's rim
  const pane = shopPane(flags);
  const clayOnly = float(1).sub(pane);
  // … nor on a door's or a shopfront's sills, heads and undersides: seen
  // edge-on, 8 cm faces are slivers a pixel high, and the rim (Fresnel → 1
  // there) lit them into a dotted white line along every frame
  const own = mod(floor(floor(flags.add(0.5)).div(64)), 2);
  const rimOn = clayOnly.mul(float(1).sub(own.mul(float(1).sub(wall))));
  // Streiflicht stands in for the sky's light on a grazing wall: at night
  // there is none, and a full rim lit every grazing roof and wall pale
  const rim = vec3(1, 0.95, 0.8).mul(
    fres
      .mul(fres)
      .mul(RIM)
      .mul(rimOn)
      .mul(float(1).sub(d.uNight.mul(float(1).sub(NIGHT_RIM))))
  );
  // Glas: the grazing angle catches a pale sky sheen, dimmed at night —
  // the stand-in for the reflection below full Spiegelung (REFLECTIONS is
  // 1, so none is drawn)
  const sheen = facadeMaterial(flags, wall)
    .glass.mul(fres.mul(fres).mul(fres))
    .mul(RIM)
    .mul(clayOnly)
    .mul(float(1).sub(d.uNight.mul(0.7)))
    .mul(float(1).sub(REFLECTIONS));
  // The asked building's light, in the accent's pale: faint by day, a
  // glow after dark.
  const askedLight = vec3(...SELECTION_ACCENT.halo).mul(
    askedFlag(flags).mul(d.uNight.mul(0.08).add(0.06))
  );
  return rim
    .add(nightLight(d, build, h, wall, flags, wn))
    .add(vec3(0.55, 0.68, 0.85).mul(sheen.mul(0.5)))
    .add(skyReflection(sn, 0.22).mul(facadeMirror(flags, wall, sn)))
    .add(paneSky(d, h, fres).mul(paneShade(h, build.z)).mul(pane))
    .add(askedLight);
}

/** A hash of a light's cell along the wall, 0…1 (`k` picks the stream). */
function cellHash(c: F, k: number): F {
  return fract(sin(c.mul(12.9898).add(k)).mul(43_758.5453));
}

/** A shop front's 3.5 m cell after dark: about two in three lit, each at
 *  its own strength — a row of shops is never one lit band. */
function shopCell(c: F): F {
  return step(0.35, cellHash(c, 4.1)).mul(mix(0.5, 1, cellHash(c, 0)));
}

/**
 * The buildings' light after dark: never the walls themselves, but light
 * on them from somewhere in front, as a street is lit at night.
 *  - Lichtkegel (GROUND_LIGHT): a commercial or public building
 *    (build.w = 1) is lit from sources at its foot — a soft cone every
 *    6 m along the wall, about half of them on, each gone by a storey and
 *    a half — the shop windows', the entrances' and the forecourts' light.
 *  - Anstrahlung (FLOODLIGHT): a landmark the city floodlights (flag
 *    32768, OBJECT_FLAG_FLOODLIT: three in five of them, whole buildings
 *    at once), whatever its use, gets uneven cones every 7 m up to the
 *    eave over a faint wash instead.
 *  - Ladenlicht: a shop's ground floor (`shopOf`) keeps a low warm band
 *    under the first storey line in 3.5 m cells, about two in three lit
 *    (`shopCell`), a shop window's pane a light of its own. Not on a
 *    landmark: a palace's café does not light its walls all round.
 * Housing gets none of it: its light is its windows (clay-windows.ts).
 * Every term × night, walls only, all in the facet's flat frame `wn`.
 */
function nightLight(
  d: ClayDetailUniforms,
  build: V4,
  h: F,
  wall: F,
  flags: F,
  wn: V3
): V3 {
  const pane = shopPane(flags);
  const clayOnly = float(1).sub(pane);
  const along = wallPlane(wn, h).x;
  const seg = along.div(3.5);
  const cell = floor(seg);
  const lit = mix(
    shopCell(cell),
    shopCell(cell.add(1)),
    smoothstep(0, 1, fract(seg))
  );
  const floorBand = float(1).sub(smoothstep(0.7, 1, h.div(max(build.y, 0.5))));
  const f = floor(flags.add(0.5));
  const landmark = mod(floor(f.div(16)), 2);
  const floodlit = mod(floor(f.div(OBJECT_FLAG_FLOODLIT)), 2);
  const shop = shopOf(flags)
    .mul(float(1).sub(landmark))
    .mul(floorBand)
    .mul(lit);
  const lights = wall.mul(clayOnly);
  const cones = groundCones(h, along).mul(build.w).mul(float(1).sub(floodlit));
  const flood = floodCones(h, along, build.z).mul(floodlit);
  return vec3(1, 0.8, 0.56)
    .mul(cones.mul(GROUND_LIGHT))
    .add(vec3(1, 0.88, 0.7).mul(flood.mul(FLOODLIGHT)))
    .add(vec3(1, 0.78, 0.45).mul(shop.mul(DUSK_GLOW).mul(SHOP_LIGHT)))
    .mul(lights)
    .add(vec3(1, 0.8, 0.55).mul(pane.mul(wall).mul(lit).mul(PANE_LIGHT)))
    .mul(d.uNight);
}

/** Light from small sources at a wall's foot, 6 m apart and about half of
 *  them on: each a soft cone widening upwards, gone by a storey and a
 *  half. `along`: metres along the wall. */
function groundCones(h: F, along: F): F {
  const spacing = 6;
  const seg = along.div(spacing);
  const c = floor(seg);
  const on = step(0.45, cellHash(c, 1.7));
  const k = mix(0.6, 1, cellHash(c, 5.3));
  const u = abs(fract(seg).sub(0.5)).mul(spacing);
  const w = h.mul(0.5).add(0.8);
  const soft = float(1).sub(smoothstep(0, w, u));
  const lateral = soft.mul(soft);
  const rise = smoothstep(0, 0.6, h);
  const fall = float(1).div(float(1).add(h.div(2.2).mul(h.div(2.2))));
  return lateral.mul(rise).mul(fall).mul(on).mul(k);
}

/** Floodlights at a landmark's foot, 7 m apart and about `FLOOD_ON` of
 *  them on, each a little off its slot and of its own strength: cones up
 *  to the eave over a faint wash, a fifth as bright at the top as at the
 *  foot. */
function floodCones(h: F, along: F, eave: F): F {
  const spacing = 7;
  const seg = along.div(spacing);
  const c = floor(seg);
  const on = step(float(1).sub(FLOOD_ON), cellHash(c, 3.9));
  const k = mix(0.4, 1, cellHash(c, 2.1));
  const shift = cellHash(c, 6.7).sub(0.5).mul(0.4);
  const u = abs(fract(seg).sub(0.5).sub(shift)).mul(spacing);
  const w = h.mul(0.3).add(1);
  const soft = float(1).sub(smoothstep(0, w, u));
  const lateral = soft.mul(soft).mul(on).mul(0.9).add(0.06);
  const top = max(eave, 4);
  const fall = float(1).sub(smoothstep(0, top.mul(1.1), h).mul(0.8));
  return lateral
    .mul(fall)
    .mul(k)
    .mul(smoothstep(0, 0.6, h));
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
 * sun rig's night factor (0 = day, 1 = night) gating the dusk glow, `sun`
 * its vector — both shared nodes.
 */
export function createStyleResources(
  night: Live,
  sun: UniformNode<"vec3", Vector3> = uniform(new Vector3(0, 1, 0))
): StyleResources {
  return {
    clayDetail: { uNight: night, uSun: sun },
    materials: new Set(),
    section: false,
  };
}

/** The clay graph per app (keyed by its live uniforms). */
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
  // three's ShadowNode hands this the sun's filtered shadow term
  clay.receivedShadowNode = graph.receivedShadow;
  setSlots(clay, {
    clayObjects: objects.texture,
    clayRows: objects.rows,
    ...openSkySlots(),
  });
  clay.name = "clay";
  // the figure of a figure-ground plan (the Schwarzplan, paper-scene.ts)
  clay.userData.figure = true;
  applySides(clay, resources.section);
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
 * The clay's sides: the front only, or both while a Schnitt shows its
 * poché. The side is part of the built node graph, so a switch flags
 * needsUpdate — the two builds of the one graph (material-slots.ts).
 */
function applySides(clay: MeshStandardNodeMaterial, section: boolean): void {
  const wasSide = clay.side;
  clay.side = section ? DoubleSide : FrontSide;
  setGraph(clay, section ? "clay|double" : "clay");
  if (clay.side !== wasSide) {
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
    applySides(clay, on);
  }
}
