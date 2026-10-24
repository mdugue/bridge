import {
  type BufferGeometry,
  ClampToEdgeWrapping,
  type Color,
  DataTexture,
  LinearFilter,
  Mesh,
  MeshBasicNodeMaterial,
  MeshStandardNodeMaterial,
  RGBAFormat,
  SRGBColorSpace,
  type UniformArrayNode,
  type UniformNode,
  UnsignedByteType,
  Vector4,
} from "three/webgpu";
import {
  cameraPosition,
  cameraViewMatrix,
  clamp,
  distance,
  dot,
  Fn,
  float,
  floor,
  fract,
  int,
  length,
  Loop,
  materialOpacity,
  max,
  min,
  mix,
  modelWorldMatrixInverse,
  normalize,
  positionLocal,
  positionWorld,
  pow,
  sin,
  smoothstep,
  step,
  texture,
  uniform,
  uniformArray,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import {
  FOAM_LINES,
  fromBase64,
  WATER_SHEET,
  type WaterLook,
} from "@/lib/city/water-bodies";
import { lampNight } from "./lamp-layer";
import { dataXY, type F, type V2, type V3 } from "./shader-chunks";
import { REFLECTIONS, skyReflection } from "./sky-reflection";
import { type SplatLayer, splatUv } from "./terrain-layer";
import { viewDirection } from "./view-direction";
import { RIVER_WAVES, waveNormal, waves } from "./water-waves";

/** Animated water surface, masked to the land-cover "water" class (id 8). */
export interface WaterLayer {
  mesh: Mesh;
  /** drifting river-haze sheet (added to the Z-up `world`, like the water) */
  mistMesh: Mesh;
  /** the tint grid's texture (`tintTexture`): the tile's own, freed by
   *  `dispose`, weighed with its rasters */
  tint: DataTexture;
  /** Frees what the sheets own beyond the content (the tint texture). */
  dispose: () => void;
  /** Advance the ripple, glitter and mist animation (elapsed seconds). The
   *  sky tint is the fog's colour node itself: nothing to copy per frame. */
  update: (seconds: number) => void;
}

/** The animation clock, shared by every tile's water and mist. */
const waterTime = uniform(0);

/** How strongly the view-angle Fresnel tints toward the sky. */
const FRESNEL = 0.4;
/** The sun glitter's strength and colour (warm white). */
const GLITTER = 0.7;
/** How much steeper the glitter's facets are than the shading's. */
const GLITTER_TILT = 2;
const SUN_COLOUR = vec3(1, 0xf4 / 255, 0xe0 / 255);

// --- the river mist ------------------------------------------------------------------

const mistHash = (p: V2): F =>
  fract(sin(dot(p, vec2(127.1, 311.7))).mul(43_758.5453));

function mistNoise(p: V2): F {
  const i = floor(p);
  const f = fract(p);
  const u = f.mul(f).mul(f.mul(-2).add(3));
  return mix(
    mix(mistHash(i), mistHash(i.add(vec2(1, 0))), u.x),
    mix(mistHash(i.add(vec2(0, 1))), mistHash(i.add(vec2(1, 1))), u.x),
    u.y
  );
}

function mistFbm(p: V2): F {
  let v: F = float(0);
  let q = p;
  let a = 0.5;
  for (let i = 0; i < 3; i++) {
    v = v.add(mistNoise(q).mul(a));
    q = q.mul(2);
    a *= 0.5;
  }
  return v;
}

/**
 * Water coverage blurred over tens of metres: the colour splat's alpha read
 * from a coarse mip (bias) at five spread taps. The shoreline in the splat
 * is ~1 m wide, which is what made the mist end on a crisp outline of the
 * river; the haze has to thin out over the banks instead.
 */
function mistCoverage(splat: SplatLayer, uv: V2, size: [number, number]): F {
  const tap = (du: number, dv: number) =>
    texture(splat.colorTexture, uv.add(vec2(du, dv))).bias(float(5)).a;
  const ox = 18 / size[0];
  const oy = 18 / size[1];
  return tap(0, 0)
    .mul(0.4)
    .add(tap(ox, 0).mul(0.15))
    .add(tap(-ox, 0).mul(0.15))
    .add(tap(0, oy).mul(0.15))
    .add(tap(0, -oy).mul(0.15));
}

/** m from the eye where the river mist begins, and where it is full. */
const MIST_NEAR_M = 120;
const MIST_FULL_M = 1200;
/** The sheet's opacity at full distance — 60 % of 0.4, where the
 *  *Flussnebel* slider stood by default before it went — and how far its
 *  colour goes from the sky's tint towards white. */
const MIST_OPACITY = 0.24;
const MIST_WHITE = 0.3;
/** …and after dark (with the lamps' night): the mist is unlit, so 30 %
 *  white drew the far river as a pale band across the night city, brighter
 *  the farther off; at night it keeps barely more than the sky's tint. */
const MIST_WHITE_NIGHT = 0.03;

/**
 * Drifting river haze as a SINGLE masked sheet sharing the Z-up terrain
 * geometry (the right tool — thousands of particles over a river is not).
 * A scrolling ≤3-octave fbm "steam" band, gated to the water class, tinted
 * from the same palette sky colour as the water. `depthWrite: false` so it
 * never punches the shared depth (DoF would otherwise focus on the haze);
 * `fog = false`: it is haze itself.
 */
function createWaterMist(
  geometry: BufferGeometry,
  splat: SplatLayer,
  size: [number, number],
  skyTint: UniformNode<"color", Color>
): Mesh {
  const material = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
  });
  material.fog = false;
  // Float the sheet a few metres above the water (world Y is up) so it has
  // vertical presence — a sheet lying ON the water is edge-on (and so
  // invisible) from street level. The lift is world-space, taken back into
  // the mesh's (Z-up) local frame.
  material.positionNode = positionLocal.add(
    modelWorldMatrixInverse.mul(vec4(0, 4, 0, 0)).xyz
  );
  // The float is along world Y, so the data-frame XY (and the splat uv)
  // are the water's own.
  const xy = dataXY();
  const cov = mistCoverage(splat, splatUv(splat), size);
  // Broad feather, then a smooth cubic so the haze has no visible rim.
  const feather = smoothstep(0.02, 0.85, cov);
  const wcov = feather.mul(feather).mul(feather.mul(-2).add(3));
  // Two slowly drifting fbm layers at different scales and directions:
  // large soft banks and thinner wisps, no threshold anywhere, so the
  // density varies continuously instead of forming blobs with edges.
  const t = waterTime;
  const q = xy.mul(0.012).add(vec2(t.mul(0.01), t.mul(0.006)));
  const r = xy.mul(0.031).sub(vec2(t.mul(0.004), t.mul(0.013)));
  const banks = smoothstep(0.15, 0.85, mistFbm(q));
  const wisps = mistFbm(r.add(banks.mul(1.7)));
  const steam = mix(0.25, 1, banks).mul(mix(0.7, 1.15, wisps));
  // A sheet has an outline where it meets the eye up close: thin it out
  // over the first kilometre so it gathers with distance, as air does. It
  // used to be full from 90 m, and the river in the lower half of the
  // start view lay under a pale, drifting band that read as a smear on the
  // screen, not as mist out on the water.
  const nearFade = smoothstep(
    MIST_NEAR_M,
    MIST_FULL_M,
    distance(cameraPosition, positionWorld)
  );
  const alpha = wcov.mul(steam).mul(nearFade).mul(MIST_OPACITY);
  material.maskNode = cov.greaterThan(0.01).and(alpha.greaterThan(0.002));
  // A haze a little brighter than the sky's tint, so it reads as mist over
  // the water; near-white, it turned the far river into a white band.
  material.colorNode = mix(
    skyTint.rgb,
    vec3(1, 1, 1),
    mix(float(MIST_WHITE), float(MIST_WHITE_NIGHT), lampNight)
  );
  material.opacityNode = alpha;
  const mesh = new Mesh(geometry, material);
  mesh.name = "water-mist";
  mesh.renderOrder = 3; // after the water sheet (2)
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
}

// --- the water sheet -----------------------------------------------------------------

/**
 * The tile's tint grid as a texture over it (LINEAR, sRGB, row 0 = north
 * like the splat): each cell its body's colour, the sheet's own where none
 * (lib/city/water-bodies.ts). A tile without one gets a 1×1 of the sheet's
 * colour, so every tile builds the same shader.
 */
export function tintTexture(look: WaterLook | undefined): DataTexture {
  const tint = look?.tint;
  const n = tint?.n ?? 1;
  const cells = tint ? fromBase64(tint.cells) : new Uint8Array(1);
  const data = new Uint8Array(n * n * 4);
  for (let i = 0; i < n * n; i++) {
    const k = cells[i] ?? 0;
    const rgb = k > 0 ? (tint?.colours[k - 1] ?? WATER_SHEET) : WATER_SHEET;
    data.set([(rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255, 255], i * 4);
  }
  const texture = new DataTexture(data, n, n, RGBAFormat, UnsignedByteType);
  texture.colorSpace = SRGBColorSpace;
  texture.flipY = false;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.generateMipmaps = false;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

/** A tile's foam lines as uniforms: the segments (data frame x0, y0, x1,
 *  y1) and per line its drop and downstream direction, FOAM_LINES each. */
interface FoamUniforms {
  count: UniformNode<"int", number>;
  info: UniformArrayNode<"vec4">;
  lines: UniformArrayNode<"vec4">;
}

function foamUniforms(look: WaterLook | undefined): FoamUniforms {
  const foam = look?.foam ?? [];
  const row = (i: number, at: number) =>
    foam[i]
      ? new Vector4(
          foam[i][at],
          foam[i][at + 1],
          foam[i][at + 2],
          foam[i][at + 3] ?? 0
        )
      : new Vector4();
  const rows = (at: number) =>
    Array.from({ length: FOAM_LINES }, (_, i) => row(i, at));
  return {
    count: uniform(Math.min(foam.length, FOAM_LINES), "int"),
    lines: uniformArray(rows(0), "vec4" as const),
    info: uniformArray(rows(4), "vec4" as const),
  };
}

/** m of foam downstream of a fall: a base, more per metre of drop, at most
 *  the last; upstream it is the crest's width, and past a line's end it
 *  thins out over a metre. A line without a direction foams both ways. */
const FOAM_REACH = [2, 3, 12] as const;
const FOAM_CREST_M = 0.8;
const FOAM_SIDE_M = 1;
const FOAM_COLOUR = vec3(0.93, 0.95, 0.96);
/** How far the foam whitens the sheet, and how opaque it makes it. */
const FOAM = 0.8;
const FOAM_OPACITY = 0.97;

/** The foam at data-frame `xy` (0..1): the strongest of the tile's lines'
 *  bands (water.py `foam`: weirs, cascades), churned by a drifting noise. */
function foamAt(xy: V2, f: FoamUniforms): F {
  const band = Fn(() => {
    // The place, taken before the loop: three assigns a shared node where
    // it is first built, and built first in the loop's body it is assigned
    // only when the loop runs — on a tile without foam lines never, and
    // the sheet's waves, which read the same node, lay flat there (the
    // Elbe's hard edge at a tile seam, 2026-10-23).
    const at = xy.toVar();
    const most = float(0).toVar();
    Loop(
      { start: int(0), end: f.count, type: "int", condition: "<" },
      ({ i }) => {
        const seg = f.lines.element(i);
        const info = f.info.element(i);
        const ab = seg.zw.sub(seg.xy);
        const t = clamp(
          dot(at.sub(seg.xy), ab).div(max(dot(ab, ab), 1e-4)),
          0,
          1
        );
        const d = at.sub(seg.xy.add(ab.mul(t)));
        const down = info.yz;
        const s = dot(d, down); // + downstream
        const side = length(d.sub(down.mul(s)));
        const reach = min(
          info.x.mul(FOAM_REACH[1]).add(FOAM_REACH[0]),
          FOAM_REACH[2]
        );
        // 1 on a weir's line (a flow direction), 0 on a shore's: a mix,
        // not a select, in a per-pixel graph
        const flows = step(0.25, dot(down, down));
        const along = mix(
          float(1),
          float(1)
            .sub(smoothstep(0, reach, s))
            .mul(float(1).sub(smoothstep(0, FOAM_CREST_M, s.negate()))),
          flows
        );
        const width = mix(reach, float(FOAM_SIDE_M), flows);
        const across = float(1).sub(smoothstep(width.mul(0.3), width, side));
        most.assign(max(most, along.mul(across)));
      }
    );
    return most;
  })();
  const t = waterTime;
  const churn = mistNoise(xy.mul(0.9).add(vec2(t.mul(0.7), t.mul(-0.5))));
  return smoothstep(0.15, 0.6, band.mul(mix(0.55, 1.15, churn)));
}

/** The sheet's diffuse colour: its body's tint (`base`), the depth tone by
 *  distance from the bank, then the Fresnel sky — mirrored, or the fog's
 *  tint — off the waves' normal `n` (Y-up world), so the sky's gradient
 *  rides the ripples; sharper where the water lies calm (`gust` 0). */
function waterColour(
  base: V3,
  splat: SplatLayer,
  uv: V2,
  view: V3,
  n: V3,
  gust: F,
  skyTint: UniformNode<"color", Color>
): V3 {
  // Depth by distance from the bank, as on a drawn map: the coverage read
  // from a coarse mip (~30 m) is 1 mid-stream and falls toward the shore,
  // so the channel deepens in tone and the shallows lighten.
  const deep = smoothstep(
    0.55,
    1,
    texture(splat.colorTexture, uv).bias(float(6)).a
  );
  const toned = base.mul(
    mix(vec3(1.1, 1.08, 1.04), vec3(0.86, 0.92, 0.98), deep)
  );
  const fresnel = pow(float(1).sub(clamp(dot(view, n), 0, 1)), 4);
  // Spiegelung (sky-reflection.ts): the sky the sheet mirrors, its
  // gradient and the glow around the sun; below full strength, the fog's
  // flat colour it stood in for (REFLECTIONS is 1: none).
  const sky = mix(
    skyTint.rgb,
    skyReflection(n, mix(0.18, 0.4, gust)),
    REFLECTIONS
  );
  return mix(toned, sky, fresnel.mul(FRESNEL));
}

/**
 * A translucent water sheet that re-uses the terrain geometry (so it drapes
 * on the same heightfield) but discards every fragment whose land-cover
 * class is not water. A standard node material, so the scene's sun,
 * shadows and fog apply for free; the wind's wave field (water-waves.ts)
 * tilts its normal, uneven under drifting gusts.
 *
 * On top of the base sheet it fakes poetic water at standard-material cost
 * (no transmission): a view-angle Fresnel sky tint (the fog's colour, which
 * follows the time-of-day palette), a tight additive sun-glitter lobe that
 * fades out at night, and a feathered shoreline. The Fresnel and glitter
 * need world (Y-up) vectors, so they come from `positionWorld` and the
 * camera, NOT the shading normal.
 *
 * Water coverage is the ALPHA channel of the palette-painted colour splat
 * (landcover-splat.ts), a soft coverage field sampled LINEAR + mipmapped +
 * anisotropic, so the shoreline is hardware anti-aliased.
 *
 * Each body takes its own colour (`look`'s tint grid: the Isar's green,
 * the Hamburg Elbe's ochre, the palette's blue where the water reads it),
 * and where the water falls — a weir, a cascade — a band of foam churns
 * downstream of the line (`foamAt`).
 *
 * Geometry is SHARED with the terrain mesh — do not dispose it here. Both
 * sheets sit beside the terrain mesh with its transform.
 */
export function createWaterLayer(
  geometry: BufferGeometry,
  splat: SplatLayer,
  skyTint: UniformNode<"color", Color>,
  look?: WaterLook,
  /** the mist's triangles (terrain-layer.ts `waterSheetsOf`: it reaches
   *  farther from the water than the water's own) */
  mistGeometry: BufferGeometry = geometry
): WaterLayer {
  const sun = splat.ground.sunDirection;
  const [minX, minY, maxX, maxY] = splat.bounds;
  const size: [number, number] = [maxX - minX, maxY - minY];
  const uv = splatUv(splat);
  const xy = dataXY();

  const material = new MeshStandardNodeMaterial({
    color: 0x7a_9e_bc,
    roughness: 0.3,
    metalness: 0,
    transparent: true,
    opacity: 0.9,
    // Pull slightly towards camera so it never z-fights the shared terrain.
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  // A widened, feathered band dissolves the bank instead of stair-stepping.
  const wcov = smoothstep(0.28, 0.72, texture(splat.colorTexture, uv).a);
  material.maskNode = wcov.greaterThan(0.001);
  const tint = tintTexture(look);
  const foam = foamAt(xy, foamUniforms(look)).toVar();
  material.opacityNode = mix(materialOpacity, FOAM_OPACITY, foam).mul(wcov);
  // The waves (water-waves.ts) on the shading normal (view space, as the
  // slot takes it). The sheet shares the terrain's grid, whose normals
  // carry the DGM's noisy river surface (and 8-bit quantisation): lit,
  // that painted the Elbe in dark blotches. Water is level — the waves'
  // normal stands on up, and depends on nothing but the place and the
  // clock, so two tiles' sheets (and a tile's two levels) meet seamlessly.
  const field = waves(xy, waterTime, RIVER_WAVES);
  const n = waveNormal(field.slope).toVar();
  material.normalNode = cameraViewMatrix.mul(vec4(n, 0)).xyz.normalize();
  const view = viewDirection().negate();
  material.colorNode = mix(
    waterColour(texture(tint, uv).rgb, splat, uv, view, n, field.gust, skyTint),
    FOAM_COLOUR,
    foam.mul(FOAM)
  );

  // Sun glitter: a tight specular lobe off the waves' normal tilted
  // further, so it reads as a real highlight, sparkling on the crests
  // where a gust roughens the water. Gated by the sun's height so it
  // vanishes after sunset.
  const glitterN = waveNormal(field.slope, GLITTER_TILT);
  const half = normalize(view.add(sun));
  const spec = pow(clamp(dot(glitterN, half), 0, 1), 120);
  material.emissiveNode = SUN_COLOUR.mul(
    spec.mul(GLITTER).mul(clamp(sun.y, 0, 1))
  );

  const mesh = new Mesh(geometry, material);
  mesh.name = "water";
  mesh.renderOrder = 2; // among the transparent, which draw after the opaque
  mesh.castShadow = false;
  mesh.receiveShadow = true;

  // River mist: a second masked sheet on the SAME (shared) geometry, on the
  // same clock and sky tint.
  const mistMesh = createWaterMist(mistGeometry, splat, size, skyTint);

  return {
    mesh,
    mistMesh,
    tint,
    dispose: () => tint.dispose(),
    update: (seconds) => {
      waterTime.value = seconds;
    },
  };
}
