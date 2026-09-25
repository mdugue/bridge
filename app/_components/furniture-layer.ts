import {
  BufferGeometry,
  CapsuleGeometry,
  CatmullRomCurve3,
  CircleGeometry,
  Color,
  DoubleSide,
  ExtrudeGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  Shape,
  ShapeUtils,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
} from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { FurnitureFeature } from "@/lib/city/features";
import {
  type FurnitureArea,
  FURNITURE_MODELS,
  type FurnitureModel,
  type FurniturePiece,
  furnitureAreas,
  furniturePieces,
  inRing,
} from "@/lib/city/furniture";
import { epsgToWorld, type GroundContext } from "@/lib/city/ground-clamp";
import { subdividePolyline } from "@/lib/city/polyline";
import { type HeightFogUniforms, injectHeightFog } from "./height-fog";

/**
 * Street furniture (`pipeline/bake/furniture.py`: OSM benches, picnic
 * tables, litter bins, bicycle stands, bollards, post boxes and stop
 * shelters, and playgrounds). Each kind is one small, abstracted model —
 * softened blocks, capsules and single tube strokes, like the pieces of an
 * architect's model, in the scene's pastels carried as vertex colours —
 * instanced once per tile under one matte material. A model's front is its local
 * +Z, turned to the bearing the bake gave (towards the nearest way); a
 * bench is stretched to its mapped length, a bollard to its tagged height.
 *
 * A playground is its OSM outline as a pale sand floor flush on the
 * ground (a sandpit drawn as an area, a sand slab on it), merged into one
 * mesh per tile; only the equipment OSM maps stands on it, each piece a
 * soft one-coloured sculpture — an arch for a swing, a wave for a slide, a
 * faceted dome for a climbing frame. An empty playground stays empty.
 *
 * Plan 030 added the street's smaller signs of life in the same idiom: the
 * advertising column (*Litfaßsäule*: a paper-pale drum with a few poster
 * fields in the palette — colour, no text — the four `lit=yes` ones glowing
 * softly at dusk), the traffic signal (a grey pole, a three-lamp head a shade deeper,
 * its glass unlit: there is no traffic to time), the hydrant (a red-ochre
 * pillar; an underground one only its small sign plate on a post, drawn
 * 30 % under size so 450 of them do not read as a forest of signs), the
 * clock (a double face on a post, or a disc on its facade) whose hands
 * show the scene's time, the drinking fountain and the bus stop's "H".
 *
 * Built per fine terrain tile by the dressing plugin (tile-stream.ts), in
 * the Y-up frame, stood on that tile's ground. Non-fatal: missing or empty
 * input yields an empty group.
 */

export interface FurnitureContext extends GroundContext {
  heightFog?: HeightFogUniforms;
}

/*
 * The palette: the scene's own — the pale clay of the buildings (0xece7df)
 * and the ground's pastels (lib/city/landcover.ts: taupe, clay, sand, the
 * roads' grey-lavender, the meadow's sage, the water's dusty blue) — kept
 * at their brightness and only a breath more saturated, so the pieces sit
 * in the scene like the buildings do, told apart by form and shadow rather
 * than by contrast. Seating is a warm sand-clay, metal the roads'
 * lavender-grey, stone the buildings' clay.
 */
const HONEY = 0xdc_c8_b2; // seats, tables, playground timber
const HONEY_DEEP = 0xcf_bc_a7; // what carries them
const SLATE = 0xc6_c5_d0; // hoops, frames, bins, posts
const STONE = 0xe6_df_d3; // stone bollards
const BRONZE = 0xc2_b3_9c; // metal bollards (the Stallhof's bronze columns)
const MUSTARD = 0xe6_d7_ab; // post boxes
const ROOF = 0xd2_d3_da;
const PANE = 0xe6_eb_ed;
/*
 * The playground's pieces are soft, single-coloured sculptures — a play
 * landscape in an architect's model rather than catalogue equipment — each
 * in one of five of those pastels, lifted to the buildings' brightness:
 * sage, dusty blue, a peach and a butter from the sandstone, a lilac from
 * the roads. The floor is the ground's own sand, a touch warmer, so the
 * playground reads as a place, not as a slab.
 */
const PLAY_FLOOR = 0xe8_df_cf;
const SAND = 0xec_e2_ca;
const PEACH = 0xe9_d3_c5;
const SAGE = 0xd3_db_c5;
const DUSK_BLUE = 0xc9_d6_de;
const BUTTER = 0xec_e1_c0;
const LILAC = 0xd9_d2_df;
/* The street's signs and fixtures (plan 030), in the same pastels. */
const PAPER = 0xef_e9_dc; // the advertising column's drum, timetables
const RING = 0xb3_b3_bf; // its cap ring and crown, a clock's rim
const SIGNAL_HEAD = 0xa9_ab_b6; // the metal's lavender-grey, a shade deeper
const GLASS = 0x93_96_a2; // unlit signal lamps, barely darker
const OCHRE = 0xd2_9f_8c; // pillar hydrants: red ochre in the pastel range
const SIGN_PLATE = 0xe9_c9_c1; // the hydrant sign: one soft rose field
const CLOCK_FACE = 0xf3_ef_e6;
const STOP_DISC = 0xea_dc_a8; // the stop sign's yellow, softened
const STOP_RING = 0xb9_c9_a8; // its green, as a colour field (no letter)
const INK = 0x86_8a_96; // clock hands: soft slate, not black
/** The underground hydrant's sign plate is drawn at this scale. */
const HYDRANT_SIGN_SCALE = 0.7;
/** Clock centres over the ground (m): a pole clock's, a wall clock's. */
const CLOCK_Y = { clock: 3.5, wallClock: 3.5 };

/** A playground slab's top over the ground (m), and a sandpit's over that. */
const PATCH_LIFT = 0.04;
const SAND_LIFT = 0.06;
/** The slab's edge reaches this far below its top, so no slope shows under it. */
const PATCH_SKIRT = 0.2;
/** Ring vertices this far apart at most, each seated on the ground (m). */
const PATCH_STEP = 2;

/** A part in one colour, non-indexed: RoundedBoxGeometry has no index and
 *  mergeGeometries needs every part alike. */
function tinted(source: BufferGeometry, hex: number): BufferGeometry {
  const geo = source.index ? source.toNonIndexed() : source;
  if (geo !== source) {
    source.dispose();
  }
  const c = new Color(hex);
  const n = geo.getAttribute("position").count;
  const rgb = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    rgb.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute("color", new Float32BufferAttribute(rgb, 3));
  return geo;
}

/** A softened block: chamfered edges catch the light like a model's card. */
function block(
  size: [number, number, number],
  at: [number, number, number],
  hex: number,
  radius = Math.min(...size) * 0.3
): BufferGeometry {
  const geo = new RoundedBoxGeometry(...size, 1, radius);
  geo.translate(...at);
  return tinted(geo, hex);
}

/** A rounded column standing on the ground (a capsule sunk to its waist). */
function pillar(
  radius: number,
  height: number,
  at: [number, number],
  hex: number
): BufferGeometry {
  const geo = new CapsuleGeometry(
    radius,
    Math.max(height - radius, 0.01),
    3,
    8
  );
  geo.translate(at[0], (height - radius) / 2, at[1]);
  return tinted(geo, hex);
}

/** One continuous soft tube through the points (arches, frames). */
function tube(
  points: [number, number, number][],
  radius: number,
  hex: number,
  segments = 12
): BufferGeometry {
  const curve = new CatmullRomCurve3(
    points.map((p) => new Vector3(...p)),
    false,
    "centripetal"
  );
  return tinted(new TubeGeometry(curve, segments, radius, 5, false), hex);
}

/**
 * A bench as one soft profile run along its length: the seat, and with a
 * back the rest curving up out of it — drawn as a section (x = −depth, so
 * the front ends up at local +Z), extruded, bevelled — on two inset cheeks.
 */
function bench(back: boolean): BufferGeometry[] {
  const section = new Shape();
  section.moveTo(-0.22, 0.4);
  section.lineTo(-0.22, 0.49);
  if (back) {
    section.lineTo(0.12, 0.49);
    section.quadraticCurveTo(0.2, 0.5, 0.24, 0.62);
    section.lineTo(0.32, 0.88);
    section.lineTo(0.38, 0.88);
    section.lineTo(0.3, 0.56);
    section.quadraticCurveTo(0.26, 0.42, 0.18, 0.4);
  } else {
    section.lineTo(0.22, 0.49);
    section.lineTo(0.22, 0.4);
  }
  section.closePath();
  const body = new ExtrudeGeometry(section, {
    depth: 1.76,
    bevelEnabled: true,
    bevelSize: 0.02,
    bevelThickness: 0.02,
    bevelSegments: 2,
    curveSegments: 4,
  });
  body.rotateY(Math.PI / 2);
  body.translate(-0.88, 0, 0);
  return [
    tinted(body, HONEY),
    block([0.12, 0.42, 0.34], [-0.62, 0.21, 0], HONEY_DEEP, 0.04),
    block([0.12, 0.42, 0.34], [0.62, 0.21, 0], HONEY_DEEP, 0.04),
  ];
}

/** A table between its two benches, long side across the front. */
function picnic(): BufferGeometry[] {
  return [
    block([1.8, 0.08, 0.8], [0, 0.74, 0], HONEY),
    block([1.8, 0.07, 0.3], [0, 0.44, 0.62], HONEY),
    block([1.8, 0.07, 0.3], [0, 0.44, -0.62], HONEY),
    block([0.1, 0.72, 1.4], [-0.7, 0.36, 0], HONEY_DEEP),
    block([0.1, 0.72, 1.4], [0.7, 0.36, 0], HONEY_DEEP),
  ];
}

/** An inverted U in the plane of its front, one soft stroke. */
function hoop(): BufferGeometry[] {
  return [
    tube(
      [
        [0, 0, 0.35],
        [0, 0.55, 0.35],
        [0, 0.78, 0.2],
        [0, 0.82, 0],
        [0, 0.78, -0.2],
        [0, 0.55, -0.35],
        [0, 0, -0.35],
      ],
      0.035,
      SLATE
    ),
  ];
}

/** A thin roof over a frosted back pane: the open side (local +Z) to the street. */
function shelter(): BufferGeometry[] {
  return [
    block([3.6, 0.1, 1.6], [0, 2.4, 0], ROOF, 0.05),
    block([3.4, 1.9, 0.06], [0, 1.3, -0.7], PANE, 0.03),
    block([0.06, 1.9, 1.2], [-1.7, 1.3, -0.1], PANE, 0.03),
    pillar(0.06, 2.4, [-1.75, -0.75], SLATE),
    pillar(0.06, 2.4, [1.75, -0.75], SLATE),
    block([1.4, 0.07, 0.35], [0.6, 0.47, -0.5], HONEY),
  ];
}

/** A shape's section extruded `depth` along local X, softly bevelled and
 *  centred (the section is drawn in the YZ plane, x = −z). */
function extrudedX(section: Shape, depth: number, hex: number): BufferGeometry {
  const geo = new ExtrudeGeometry(section, {
    depth,
    bevelEnabled: true,
    bevelSize: 0.04,
    bevelThickness: 0.04,
    bevelSegments: 3,
    curveSegments: 12,
  });
  geo.rotateY(Math.PI / 2);
  geo.translate(-depth / 2, 0, 0);
  return tinted(geo, hex);
}

/** One soft arch, and a pill-shaped seat hanging from it. */
function swing(): BufferGeometry[] {
  const seat = new CapsuleGeometry(0.08, 0.34, 3, 8);
  seat.rotateZ(Math.PI / 2);
  seat.translate(0, 0.5, 0);
  return [
    tube(
      [
        [-1.25, 0, 0],
        [-1.15, 1.6, 0],
        [-0.75, 2.15, 0],
        [0, 2.3, 0],
        [0.75, 2.15, 0],
        [1.15, 1.6, 0],
        [1.25, 0, 0],
      ],
      0.09,
      DUSK_BLUE,
      28
    ),
    tinted(seat, DUSK_BLUE),
    block([0.03, 1.7, 0.03], [-0.2, 1.4, 0], DUSK_BLUE, 0.012),
    block([0.03, 1.7, 0.03], [0.2, 1.4, 0], DUSK_BLUE, 0.012),
  ];
}

/** A wave: a soft rise at the back falling in one curve to the front. */
function slide(): BufferGeometry[] {
  const wave = new Shape();
  wave.moveTo(1.1, 0);
  wave.lineTo(1.1, 1.3);
  wave.quadraticCurveTo(1.1, 1.55, 0.8, 1.55);
  wave.quadraticCurveTo(0.2, 1.55, -0.4, 0.6);
  wave.quadraticCurveTo(-0.8, 0.12, -1.5, 0.12);
  wave.lineTo(-1.5, 0);
  wave.closePath();
  return [extrudedX(wave, 0.7, PEACH)];
}

/** A low faceted dome, the climbing hill. */
function climb(): BufferGeometry[] {
  const dome = new SphereGeometry(1.2, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2);
  const faceted = dome.toNonIndexed();
  dome.dispose();
  faceted.scale(1, 0.85, 1);
  faceted.computeVertexNormals();
  return [tinted(faceted, SAGE)];
}

/** An egg on a short stem. */
function springy(): BufferGeometry[] {
  const egg = new SphereGeometry(0.3, 12, 8);
  egg.scale(0.75, 0.9, 1.2);
  egg.translate(0, 0.62, 0);
  return [pillar(0.06, 0.36, [0, 0], BUTTER), tinted(egg, BUTTER)];
}

/** A long soft plank on a half-round pivot. */
function seesaw(): BufferGeometry[] {
  const pivot = new CylinderGeometry(0.22, 0.22, 0.3, 14, 1, false, 0, Math.PI);
  pivot.rotateZ(Math.PI / 2);
  pivot.rotateY(Math.PI / 2);
  return [
    tinted(pivot, LILAC),
    block([3, 0.1, 0.3], [0, 0.28, 0], LILAC, 0.05),
  ];
}

/** A flat disc with a rounded rim. */
function roundabout(): BufferGeometry[] {
  const disc = new CylinderGeometry(1, 1, 0.12, 24);
  disc.translate(0, 0.28, 0);
  const rim = new TorusGeometry(1, 0.06, 6, 24);
  rim.rotateX(Math.PI / 2);
  rim.translate(0, 0.34, 0);
  return [
    tinted(disc, DUSK_BLUE),
    tinted(rim, DUSK_BLUE),
    pillar(0.12, 0.28, [0, 0], DUSK_BLUE),
  ];
}

/** A house silhouette, extruded and softened. */
function playhouse(): BufferGeometry[] {
  const house = new Shape();
  house.moveTo(-0.7, 0);
  house.lineTo(0.7, 0);
  house.lineTo(0.7, 1.1);
  house.lineTo(0, 1.8);
  house.lineTo(-0.7, 1.1);
  house.closePath();
  return [extrudedX(house, 1.4, PEACH)];
}

/** Sand in a soft rounded frame (a sandpit mapped as a point). */
function sandbox(): BufferGeometry[] {
  const frame = new TorusGeometry(1.35, 0.1, 6, 4);
  frame.rotateX(Math.PI / 2);
  frame.rotateY(Math.PI / 4);
  frame.translate(0, 0.1, 0);
  return [
    block([2.6, 0.12, 2.6], [0, 0.06, 0], SAND, 0.04),
    tinted(frame, SAGE),
  ];
}

/** A disc facing +Z (a sign, a clock face), `depth` thick. */
function disc(
  radius: number,
  depth: number,
  at: [number, number, number],
  hex: number
): BufferGeometry {
  const geo = new CylinderGeometry(radius, radius, depth, 24);
  geo.rotateX(Math.PI / 2);
  geo.translate(...at);
  return tinted(geo, hex);
}

/** A flat circle facing +Z (or −Z, `back`). */
function face(
  radius: number,
  at: [number, number, number],
  hex: number,
  back = false
): BufferGeometry {
  const geo = new CircleGeometry(radius, 24);
  if (back) {
    geo.rotateY(Math.PI);
  }
  geo.translate(...at);
  return tinted(geo, hex);
}

/** The Litfaßsäule: a pale drum on a plinth, a darker ring and a low dome
 *  on top, and poster fields wrapped round it (colour, no text). */
function column(): BufferGeometry[] {
  const body = new CylinderGeometry(0.6, 0.6, 2.4, 28);
  body.translate(0, 1.35, 0);
  const plinth = new CylinderGeometry(0.66, 0.68, 0.15, 28);
  plinth.translate(0, 0.075, 0);
  const ring = new CylinderGeometry(0.66, 0.66, 0.12, 28);
  ring.translate(0, 2.61, 0);
  const crown = new SphereGeometry(0.63, 28, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  crown.scale(1, 0.42, 1);
  crown.translate(0, 2.67, 0);
  const posters: [number, number, number, number, number][] = [
    // theta start, theta length, height, centre y, colour
    [0.2, 1.6, 1.5, 1.45, PEACH],
    [2.3, 1.6, 1.4, 1.4, SAGE],
    [4.3, 1.5, 1.5, 1.45, DUSK_BLUE],
  ];
  return [
    tinted(body, PAPER),
    tinted(plinth, RING),
    tinted(ring, RING),
    tinted(crown, RING),
    ...posters.map(([t0, tl, h, y, hex]) => {
      const sheet = new CylinderGeometry(0.606, 0.606, h, 8, 1, true, t0, tl);
      sheet.translate(0, y, 0);
      return tinted(sheet, hex);
    }),
  ];
}

/** A traffic signal: a grey pole, the three-lamp head facing +Z. */
function signal(): BufferGeometry[] {
  return [
    pillar(0.06, 3.2, [0, 0], SLATE),
    block([0.32, 0.95, 0.22], [0, 2.72, 0.13], SIGNAL_HEAD, 0.05),
    ...[-0.29, 0, 0.29].map((dy) =>
      disc(0.085, 0.04, [0, 2.72 + dy, 0.25], GLASS)
    ),
  ];
}

/** A pillar hydrant: a squat ochre post with its two side outlets. */
function hydrant(): BufferGeometry[] {
  const outlet = (side: number) => {
    const geo = new CylinderGeometry(0.045, 0.05, 0.14, 10);
    geo.rotateZ(Math.PI / 2);
    geo.translate(side * 0.15, 0.52, 0);
    return tinted(geo, OCHRE);
  };
  const cap = new SphereGeometry(0.13, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  cap.translate(0, 0.72, 0);
  return [
    pillar(0.12, 0.74, [0, 0], OCHRE),
    tinted(cap, OCHRE),
    outlet(1),
    outlet(-1),
  ];
}

/** An underground hydrant's sign: one soft rose plate on a post (the
 *  red-bordered white plate, abstracted to a colour field), drawn under
 *  size (HYDRANT_SIGN_SCALE). */
function hydrantSign(): BufferGeometry[] {
  const parts = [
    pillar(0.025, 1.8, [0, 0], SLATE),
    block([0.27, 0.22, 0.03], [0, 1.66, 0.03], SIGN_PLATE, 0.01),
  ];
  for (const p of parts) {
    p.scale(HYDRANT_SIGN_SCALE, HYDRANT_SIGN_SCALE, HYDRANT_SIGN_SCALE);
  }
  return parts;
}

/** A street clock: a double face on a post (the hands are clockHands). */
function poleClock(): BufferGeometry[] {
  const y = CLOCK_Y.clock;
  return [
    pillar(0.07, y - 0.2, [0, 0], SLATE),
    disc(0.36, 0.14, [0, y, 0], RING),
    face(0.31, [0, y, 0.071], CLOCK_FACE),
    face(0.31, [0, y, -0.071], CLOCK_FACE, true),
  ];
}

/** A clock on a facade: a bracket out of the wall (local −Z) and one face. */
function wallClock(): BufferGeometry[] {
  const y = CLOCK_Y.wallClock;
  return [
    block([0.08, 0.08, 0.3], [0, y, 0.15], SLATE, 0.02),
    disc(0.3, 0.1, [0, y, 0.35], RING),
    face(0.26, [0, y, 0.401], CLOCK_FACE),
  ];
}

/** A drinking fountain: a slim bronze column with a small basin in front. */
function drinkingWater(): BufferGeometry[] {
  const basin = new SphereGeometry(
    0.19,
    14,
    6,
    0,
    Math.PI * 2,
    Math.PI / 2,
    Math.PI / 2
  );
  basin.translate(0, 0.82, 0.16);
  return [
    block([0.34, 0.08, 0.34], [0, 0.04, 0], STONE, 0.02),
    pillar(0.09, 1.0, [0, 0], BRONZE),
    tinted(basin, BRONZE),
  ];
}

/** A stop's sign: the "H" disc on a pole — abstracted to colour fields,
 *  a soft green disc in a yellow one, no letter — and a timetable box. */
function stopSign(): BufferGeometry[] {
  const y = 2.42;
  return [
    pillar(0.035, 2.6, [0, 0], SLATE),
    disc(0.22, 0.03, [0, y, 0.05], STOP_DISC),
    disc(0.13, 0.012, [0, y, 0.068], STOP_RING),
    block([0.36, 0.5, 0.06], [0, 1.45, 0.06], PAPER, 0.02),
  ];
}

const MODEL_PARTS: Record<FurnitureModel, () => BufferGeometry[]> = {
  bench: () => bench(true),
  stool: () => bench(false),
  picnic,
  // A soft drum with a darker lid.
  bin: () => [
    pillar(0.22, 0.86, [0, 0], SLATE),
    block([0.4, 0.05, 0.4], [0, 0.86, 0], HONEY_DEEP, 0.02),
  ],
  hoop,
  bollard: () => [pillar(0.09, 0.9, [0, 0], STONE)],
  post: () => [pillar(0.09, 0.9, [0, 0], BRONZE)],
  postbox: () => [
    block([0.46, 0.6, 0.34], [0, 0.84, 0], MUSTARD),
    pillar(0.05, 0.56, [0, 0], SLATE),
  ],
  shelter,
  swing,
  slide,
  climb,
  springy,
  seesaw,
  roundabout,
  playhouse,
  sandbox,
  column,
  columnLit: column,
  signal,
  hydrant,
  hydrantSign,
  clock: poleClock,
  wallClock,
  water: drinkingWater,
  stop: stopSign,
};

/*
 * The shared clock and dusk: one set of uniforms every tile's furniture
 * reads (set from create-app's setSun), like the fountains'.
 */
const FURNITURE_UNIFORMS = {
  uFurnitureNight: { value: 0 },
  /** minutes past 12 o'clock, 0–720 */
  uClockMinutes: { value: 0 },
};

/** 0 by day → 1 at night: the lit advertising columns glow with the lamps. */
export function setFurnitureNight(t: number): void {
  FURNITURE_UNIFORMS.uFurnitureNight.value = Math.min(Math.max(t, 0), 1);
}

/**
 * The clocks' hands show the scene's time — on the minute only (a uniform,
 * no re-upload; the hands cast no shadow, so the shadow map is untouched).
 * Returns whether the hands moved.
 */
export function setClockTime(date: Date): boolean {
  const minutes = (date.getHours() % 12) * 60 + date.getMinutes();
  if (FURNITURE_UNIFORMS.uClockMinutes.value === minutes) {
    return false;
  }
  FURNITURE_UNIFORMS.uClockMinutes.value = minutes;
  return true;
}

/** Hands per face: (pivot z, side ±1) — a pole clock has two faces. */
const CLOCK_FACES: Record<"clock" | "wallClock", [number, number][]> = {
  clock: [
    [0.074, 1],
    [-0.074, -1],
  ],
  wallClock: [[0.404, 1]],
};

/** The hour and minute hands of one clock model, pointing at 12, with the
 *  attributes the hand shader turns them by. */
function handGeometry(model: "clock" | "wallClock"): BufferGeometry {
  const y = CLOCK_Y[model];
  const pos: number[] = [];
  const kind: number[] = [];
  const side: number[] = [];
  const pivot: number[] = [];
  for (const [z, s] of CLOCK_FACES[model]) {
    // [hand, half width, length]
    for (const [hand, w, len] of [
      [0, 0.018, 0.17],
      [1, 0.011, 0.25],
    ]) {
      const quad = [
        [-w, -0.03],
        [w, -0.03],
        [w, len],
        [-w, -0.03],
        [w, len],
        [-w, len],
      ];
      for (const [x, dy] of quad) {
        pos.push(x, y + dy, z);
        kind.push(hand);
        side.push(s);
        pivot.push(0, y, z);
      }
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute("position", new Float32BufferAttribute(pos, 3));
  geo.setAttribute("handKind", new Float32BufferAttribute(kind, 1));
  geo.setAttribute("faceSide", new Float32BufferAttribute(side, 1));
  geo.setAttribute("handPivot", new Float32BufferAttribute(pivot, 3));
  return geo;
}

const HAND_VERTEX = `
	vec3 transformed = vec3( position );
	float handTurn = ( handKind < 0.5 ? uClockMinutes / 720.0 : mod( uClockMinutes, 60.0 ) / 60.0 ) * 6.2831853;
	// clockwise as seen from the face's own side
	float handA = - handTurn * faceSide;
	vec2 handRel = transformed.xy - handPivot.xy;
	transformed.xy = handPivot.xy + vec2(
		cos( handA ) * handRel.x - sin( handA ) * handRel.y,
		sin( handA ) * handRel.x + cos( handA ) * handRel.y );
`;

function handMaterial(ctx: FurnitureContext): MeshBasicMaterial {
  const m = new MeshBasicMaterial({ color: new Color(INK), side: DoubleSide });
  const { heightFog } = ctx;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, FURNITURE_UNIFORMS);
    sh.vertexShader = `attribute float handKind;
attribute float faceSide;
attribute vec3 handPivot;
uniform float uClockMinutes;
${sh.vertexShader.replace("#include <begin_vertex>", HAND_VERTEX)}`;
    if (heightFog) {
      injectHeightFog(sh, heightFog);
    }
  };
  return m;
}

/** The hands of every clock of one model, on the clocks' own instances. */
function clockHands(
  model: "clock" | "wallClock",
  stood: Stood[],
  ctx: FurnitureContext
): InstancedMesh {
  const mesh = new InstancedMesh(
    handGeometry(model),
    handMaterial(ctx),
    stood.length
  );
  const m = new Matrix4();
  const q = new Quaternion();
  const one = new Vector3(1, 1, 1);
  const up = new Vector3(0, 1, 0);
  for (let i = 0; i < stood.length; i++) {
    q.setFromAxisAngle(up, stood[i].piece.yaw);
    mesh.setMatrixAt(i, m.compose(stood[i].at, q, one));
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.name = `furniture-${model}-hands`;
  return mesh;
}

function modelGeometry(model: FurnitureModel): BufferGeometry | null {
  const parts = MODEL_PARTS[model]();
  const geo = parts.length > 0 ? mergeGeometries(parts) : null;
  for (const p of parts) {
    p.dispose();
  }
  return geo;
}

interface Stood {
  at: Vector3;
  piece: FurniturePiece;
}

function instanced(
  model: FurnitureModel,
  stood: Stood[],
  material: MeshStandardMaterial
): InstancedMesh | null {
  const geo = modelGeometry(model);
  if (!geo) {
    return null;
  }
  const mesh = new InstancedMesh(geo, material, stood.length);
  const m = new Matrix4();
  const q = new Quaternion();
  const s = new Vector3();
  const up = new Vector3(0, 1, 0);
  for (let i = 0; i < stood.length; i++) {
    const { at, piece } = stood[i];
    q.setFromAxisAngle(up, piece.yaw);
    s.set(piece.scaleX, piece.scaleY, 1);
    mesh.setMatrixAt(i, m.compose(at, q, s));
  }
  mesh.instanceMatrix.needsUpdate = true;
  // Spread-out cloud: recompute the sphere or it culls when the origin is off-screen.
  mesh.computeBoundingSphere();
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = `furniture-${model}`;
  return mesh;
}

/** Non-indexed triangles with per-vertex normal and colour. */
interface Tris {
  colors: number[];
  normals: number[];
  positions: number[];
}

function pushVertex(t: Tris, p: Vector3, n: Vector3, c: Color): void {
  t.positions.push(p.x, p.y, p.z);
  t.normals.push(n.x, n.y, n.z);
  t.colors.push(c.r, c.g, c.b);
}

/** One area as a slab: the top at `lift` over the ground under each ring
 *  vertex, its edge dropping PATCH_SKIRT. */
function addSlab(
  t: Tris,
  area: FurnitureArea,
  lift: number,
  hex: number,
  ctx: FurnitureContext
): void {
  const closed = [...area.ring, area.ring[0]];
  const ring = subdividePolyline(closed, PATCH_STEP).slice(0, -1);
  const top: Vector3[] = [];
  for (const [ex, ey] of ring) {
    const ground = ctx.heightAt(ex, ey);
    if (ground === null) {
      return; // part off the loaded ground: leave the patch out
    }
    const { x, z } = epsgToWorld(ex, ey, ctx.offset);
    top.push(new Vector3(x, ground + lift, z));
  }
  const color = new Color(hex);
  const up = new Vector3(0, 1, 0);
  const contour = top.map((p) => new Vector2(p.x, p.z));
  // Wound either way in the data: face every triangle up.
  for (const [a, b, c] of ShapeUtils.triangulateShape(contour, [])) {
    const [pa, pb, pc] = [top[a], top[b], top[c]];
    const ccw =
      (pb.x - pa.x) * (pc.z - pa.z) - (pb.z - pa.z) * (pc.x - pa.x) < 0;
    for (const p of ccw ? [pa, pb, pc] : [pa, pc, pb]) {
      pushVertex(t, p, up, color);
    }
  }
  const centre = top
    .reduce((sum, p) => sum.add(p), new Vector3())
    .divideScalar(top.length);
  for (let i = 0; i < top.length; i++) {
    const p = top[i];
    const q = top[(i + 1) % top.length];
    const n = new Vector3(q.z - p.z, 0, p.x - q.x).normalize();
    const mid = p.clone().add(q).multiplyScalar(0.5).sub(centre);
    if (n.dot(mid) < 0) {
      n.negate();
    }
    const pd = p.clone().setY(p.y - PATCH_SKIRT);
    const qd = q.clone().setY(q.y - PATCH_SKIRT);
    // (p, pd, q) faces n when (pd − p) × (q − p) points along it.
    const face = pd.clone().sub(p).cross(q.clone().sub(p));
    const quad =
      face.dot(n) > 0 ? [p, pd, q, q, pd, qd] : [p, q, pd, q, qd, pd];
    for (const v of quad) {
      pushVertex(t, v, n, color);
    }
  }
}

function buildPatches(
  areas: FurnitureArea[],
  material: MeshStandardMaterial,
  ctx: FurnitureContext
): Mesh | null {
  const t: Tris = { positions: [], normals: [], colors: [] };
  for (const area of areas) {
    if (area.kind === "playground") {
      addSlab(t, area, PATCH_LIFT, PLAY_FLOOR, ctx);
    }
  }
  for (const area of areas) {
    if (area.kind === "sandpit") {
      addSlab(t, area, PATCH_LIFT + SAND_LIFT, SAND, ctx);
    }
  }
  if (t.positions.length === 0) {
    return null;
  }
  const geo = new BufferGeometry();
  geo.setAttribute("position", new Float32BufferAttribute(t.positions, 3));
  geo.setAttribute("normal", new Float32BufferAttribute(t.normals, 3));
  geo.setAttribute("color", new Float32BufferAttribute(t.colors, 3));
  geo.computeBoundingSphere();
  const mesh = new Mesh(geo, material);
  mesh.name = "furniture-playgrounds";
  mesh.receiveShadow = true;
  return mesh;
}

/** How far a piece stands over the ground: onto a playground's slab, or a
 *  sandpit's on it. */
function liftAt(areas: FurnitureArea[], x: number, y: number): number {
  let lift = 0;
  for (const area of areas) {
    if (inRing(area.ring, x, y)) {
      lift = Math.max(
        lift,
        area.kind === "sandpit" ? PATCH_LIFT + SAND_LIFT : PATCH_LIFT
      );
    }
  }
  return lift;
}

/** The furniture material, glowing softly at dusk (the lit columns). */
function glowMaterial(ctx: FurnitureContext): MeshStandardMaterial {
  const material = furnitureMaterial(ctx);
  const { heightFog } = ctx;
  material.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, FURNITURE_UNIFORMS);
    sh.fragmentShader = `uniform float uFurnitureNight;
${sh.fragmentShader.replace(
  "#include <emissivemap_fragment>",
  "#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += diffuseColor.rgb * uFurnitureNight * 0.55;"
)}`;
    if (heightFog) {
      injectHeightFog(sh, heightFog);
    }
  };
  return material;
}

function furnitureMaterial(
  ctx: FurnitureContext,
  flush = false
): MeshStandardMaterial {
  const material = new MeshStandardMaterial({
    vertexColors: true,
    // The buildings' matte clay, not a plastic sheen.
    roughness: 0.92,
    metalness: 0,
  });
  if (flush) {
    // The slab lies a hand's width over the ground: keep it off the terrain.
    material.polygonOffset = true;
    material.polygonOffsetFactor = -1;
    material.polygonOffsetUnits = -2;
  }
  const { heightFog } = ctx;
  if (heightFog) {
    material.onBeforeCompile = (sh) => injectHeightFog(sh, heightFog);
  }
  return material;
}

/** One tile's street furniture as instanced models on its ground. */
export function buildFurniture(
  features: FurnitureFeature[],
  ctx: FurnitureContext
): Group {
  const group = new Group();
  group.name = "furniture";
  const areas = furnitureAreas(features);
  const byModel = new Map<FurnitureModel, Stood[]>();
  for (const piece of furniturePieces(features)) {
    const ground = ctx.heightAt(piece.x, piece.y);
    if (ground === null) {
      continue; // off the tile / NoData
    }
    const { x, z } = epsgToWorld(piece.x, piece.y, ctx.offset);
    const y = ground + liftAt(areas, piece.x, piece.y);
    const list = byModel.get(piece.model) ?? [];
    list.push({ at: new Vector3(x, y, z), piece });
    byModel.set(piece.model, list);
  }
  if (byModel.size === 0 && areas.length === 0) {
    return group;
  }
  const material = furnitureMaterial(ctx);
  for (const model of FURNITURE_MODELS) {
    const stood = byModel.get(model);
    const mesh = stood
      ? instanced(
          model,
          stood,
          model === "columnLit" ? glowMaterial(ctx) : material
        )
      : null;
    if (mesh) {
      group.add(mesh);
    }
    if (stood && (model === "clock" || model === "wallClock")) {
      group.add(clockHands(model, stood, ctx));
    }
  }
  const patches = buildPatches(areas, furnitureMaterial(ctx, true), ctx);
  if (patches) {
    group.add(patches);
  }
  return group;
}
