import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  Color,
  MeshStandardNodeMaterial,
  Sphere,
  Vector2,
  Vector3,
  Vector4,
} from "three/webgpu";
import type {
  InterleavedBufferAttribute,
  Mesh,
  UniformNode,
  Matrix4,
  Texture,
} from "three/webgpu";
import {
  abs,
  cameraViewMatrix,
  clamp,
  cos,
  dot,
  float,
  floor,
  fract,
  Fn,
  fwidth,
  If,
  length,
  materialColor,
  max,
  min,
  mix,
  normalize,
  normalView,
  positionWorld,
  property,
  select,
  sin,
  smoothstep,
  step,
  texture,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import { sampleHeightfield } from "@/lib/city/terrain-geometry";
import type { TerrainBounds } from "@/lib/city/terrain-geometry";
import {
  ARABLE_CLASS,
  LANDCOVER_CLASSES,
  MEADOW_CLASS,
  ROAD_CLASS,
  srgbToLinear,
} from "@/lib/city/landcover";
import type { ReachBox } from "@/lib/city/ground-reach";
import type { WaterMask } from "@/lib/city/water-mask";
import type {
  GroundPositions,
  GroundPrep,
  GroundPrepInput,
  SheetPrep,
} from "@/lib/city/ground-prep";
import { colonyCropUv } from "@/lib/city/cultivated";
import {
  planOf,
  planTriangles,
  sameNumbers,
  TinIndex,
} from "@/lib/city/terrain-tin";
import type { TerrainExtras } from "@/lib/city/tileset";
import { groundUnderDesign } from "./design-site";
import { colonyGarden } from "./cultivated-layer";
import { prepareGroundOffThread } from "./ground-prep-client";
import {
  bsplineSample,
  groundDetail,
  groundFields,
  groundNormal,
  smoothPaths,
  urbanGreen,
} from "./ground-detail";
import type { GroundColour, GroundFields, GroundInputs } from "./ground-detail";
import { PAPER_HEX, paperGroundOn } from "./paper-scene";
import { roadMarkings } from "./road-markings";
import {
  dataXY,
  gdNoise,
  gdNoiseSlope,
  rasterUv,
  texelSize,
} from "./shader-chunks";
import { splatSize } from "./splat-uv";
import { streamTimings } from "./stream-timing";
import type { F, Tex, V3 } from "./shader-chunks";
import { RASTER_KINDS, REACH_KINDS } from "./tile-rasters";
import type { IndexedRaster, RasterHold, SplatRasters } from "./tile-rasters";
import {
  setGraph,
  setSlots,
  slotsOf,
  slotTexture,
  slotUniform,
} from "./material-slots";
import type { Slots } from "./material-slots";
import { applyGroundLight } from "./sky-light";
import type { GroundLight } from "./sky-light";
import { sportGround } from "./sport-ground";
import {
  detachShared,
  disposeGeometry,
  isSceneShared,
  markSceneShared,
} from "./three-utils";
import type { AnyAttribute } from "./three-utils";
import { createWaterLayer } from "./water-layer";
import type { WaterLayer } from "./water-layer";

/**
 * One tile's terrain at one level: the baked glTF mesh (scripts/bake-tiles.ts,
 * streamed by tile-stream.ts) dressed with the land-cover material, its
 * water and mist sheets, and a ground-height sampler read from its grid —
 * or, on the fine level, from its TIN's triangles.
 */
export interface TerrainLayer {
  /** [minX, minY, maxX, maxY] in the projected CRS */
  bounds: TerrainBounds;
  /**
   * The rasters this level owns itself, each once: only the water sheet's
   * tint, which the tile cache weighs whole (tile-stream.ts
   * `calculateBytesUsed`). What it holds of the site's is weighed by
   * tile-rasters.ts. The water sheets hang in the content: the renderer
   * weighs them with it.
   */
  rasters: Texture[];
  /** Frees the rasters (the tile's geometry and materials go with it). */
  dispose: () => void;
  /** bilinear elevation lookup at projected (not recentered) coordinates */
  heightAt: (x: number, y: number) => number | null;
  /** what that lookup keeps on the page's process (bytes): a grid's
   *  elevations, a TIN's vertices and bucket index */
  heightBytes: number;
  level: 0 | 1;
  mesh: Mesh;
  /** whether the ground is a TIN (its height index reads the mesh's index:
   *  lib/city/terrain-tin.ts `TinIndex`), not the grid */
  tin: boolean;
  /** the tile's baked stairs (fine level only; stair-layer.ts) */
  stairs?: Mesh;
  /** the tile's baked kerb stones (fine level only; kerb-layer.ts) */
  kerbs?: Mesh;
  /** the tile's baked fences and gates (fine level only; fence-layer.ts) */
  fences?: Mesh;
  /** the tile's baked walls (fine level only; wall-layer.ts) */
  walls?: Mesh;
  /** lowest valid elevation (m) on this tile — the valley/river floor */
  minElevation: number;
  tile: string;
  vertexCount: number;
  /** animated water surface, present only when the class raster loaded */
  water?: WaterLayer;
  /** the tile's baked light for what stands on this level (kerbs, fences,
   *  stairs, walls; sky-light.ts `applyGroundLight`), when it has any */
  light?: GroundLight;
  /** the level's close-range rasters and their twins, where the content
   *  names twins (the fine level) */
  detail?: GroundDetail;
}

/**
 * Which set of its close-range rasters (tile-rasters.ts `REACH_KINDS`) a
 * level reads: the full ones near the camera, their twins beyond the
 * detail's reach (lib/city/ground-reach.ts). The frame asks
 * (ground-reach-follow.ts); a swap is a slot write, no shader build.
 */
export interface GroundDetail {
  /** the level's ground in the scene's frame (Y up, recentered) */
  box: ReachBox;
  /** whether it reads the twins now */
  far: () => boolean;
  /**
   * Loads the other set, on the GPU before it is read, hands it to the
   * material and lets the old one go. Resolves true when the ground now
   * draws other rasters; false when nothing changed (a swap under way, a
   * load that failed, the level gone, a twin missing beside its full file).
   */
  setFar: (far: boolean) => Promise<boolean>;
}

export interface TerrainOptions {
  /** the scene fog's colour (height-fog.ts), the water's sky tint */
  fogColor: UniformNode<"color", Color>;
  /** the ground's light: the shadow rings' reach and the sun (uniform nodes,
   *  shared by every tile) */
  ground: GroundUniforms;
  /** recenter offset shared with the city layer */
  offset: { cx: number; cy: number };
  /** this level's hold on the site's rasters (tile-rasters.ts), let go when
   *  its dressing fails or the layer is disposed */
  rasters: RasterHold;
  /** aborts the level's waits on its rasters and rejects the dressing with
   *  the abort, everything it took let go (its tile left, or the stream
   *  went) */
  signal?: AbortSignal;
  /** the grid level's index and water index, one copy for the site */
  grids?: GridShare;
  /** whether the level starts on its close-range rasters' twins, given
   *  where its ground lies (ground-reach.ts); without it, the full ones */
  far?: (box: ReachBox) => boolean;
}

/**
 * What the sun rig keeps for the terrain: uniform nodes shared by every
 * tile's material (a uniform write, no rebuild). The ground's look
 * strengths are constants of their terms (`GROUND_DETAIL`, `URBAN_GREEN`
 * in ground-detail.ts, `MEADOW_NDVI` below, `SKY_VIEW`, `HORIZON_SHADE`
 * in sky-light.ts).
 */
export interface GroundUniforms {
  /** the shadow rings' reach: its centre (data frame x, y) and half-size (z), kept
   *  by the sun rig: where the horizon's near band takes over (sky-light.ts) */
  shadowReach: UniformNode<"vec3", Vector3>;
  /** world (Y-up) sun direction, surface → sun, kept by the sun rig: the
   *  kerb's drawn shadow, the horizon, the water's Fresnel and glitter */
  sunDirection: UniformNode<"vec3", Vector3>;
}

/** Land-cover splatmap aligned to the terrain, for per-surface tinting. */
export interface SplatLayer {
  bounds: TerrainBounds;
  /** the palette-painted colours (RGB) + water coverage (A); LINEAR +
   *  mipmapped for soft transitions (landcover-splat.ts) */
  colorTexture: Texture;
  /** the shadow reach and the sun (shared uniform nodes) */
  ground: GroundUniforms;
  /** DOP NDVI raster (LINEAR) for the meadow and urban-green tints */
  ndviTexture?: Texture;
  offset: { cx: number; cy: number };
  /** OSM paving raster (NEAREST, RGBA) for the paving and parking patterns */
  surfaceTexture?: Texture;
  /** baked road/meadow edge distances (LINEAR, RG) for kerbs, lanes, lawns */
  edgesTexture?: Texture;
  /** sports grounds: the index raster (NEAREST, RGBA) and its table */
  sport?: { raster: Texture; table: Texture };
  /** allotment colonies (LINEAR, RG): the garden edge and the axis, and
   *  where the (cropped) raster lies in the tile's uv */
  colonies?: { rect: [number, number, number, number]; texture: Texture };
  /** road markings: the index raster (NEAREST, RGBA) and its table */
  markings?: { raster: Texture; table: Texture };
  /** sky-view factor (LINEAR, R) for the ambient light */
  svfTexture?: Texture;
  /** far horizon, 4 RGBA layers (LINEAR) for the far sun shadow */
  horizonTexture?: Texture;
  /** class-id raster (NEAREST); the meadow detail tests it */
  texture: Texture;
}

/**
 * What a terrain variant's shared graph reads (material-slots.ts): the
 * tile's rasters and corner as slots, the shared uniforms as they are
 * (every tile shares those anyway). A tile's own values are `splatSlots`.
 */
interface SplatNodes {
  size: [number, number];
  origin: UniformNode<"vec2", Vector2>;
  classTexture: Tex;
  colorTexture: Tex;
  ndvi?: Tex;
  surface?: Tex;
  edges?: Tex;
  sport?: { raster: Tex; table: Tex };
  markings?: { raster: Tex; table: Tex };
  colonies?: { rect: UniformNode<"vec4", Vector4>; texture: Tex };
  ground: GroundUniforms;
}

/** The tile's corner (recentered, data frame): the uv's origin. */
const splatOrigin = (splat: SplatLayer): Vector2 => {
  const minX = splat.bounds[0];
  const maxY = splat.bounds[3];
  return new Vector2(minX - splat.offset.cx, maxY - splat.offset.cy);
};

/** A variant: which optional rasters it reads, and the tile's size. */
const splatVariant = (splat: SplatLayer): string =>
  [
    splat.ndviTexture ? "ndvi" : "",
    splat.surfaceTexture ? "surface" : "",
    splat.edgesTexture ? "edges" : "",
    splat.sport ? "sport" : "",
    splat.markings ? "markings" : "",
    splat.colonies ? "colonies" : "",
    splat.svfTexture ? "svf" : "",
    splat.horizonTexture ? "horizon" : "",
    ...splatSize(splat),
  ].join("|");

/** The slots of a variant's graph, made from one of its tiles. */
function splatNodes(splat: SplatLayer): SplatNodes {
  return {
    size: splatSize(splat),
    // reason: a Vector2 slot is a vec2 uniform; slotUniform types it loosely.
    origin: slotUniform("origin", splatOrigin(splat)) as unknown as UniformNode<
      "vec2",
      Vector2
    >,
    classTexture: slotTexture("class", splat.texture),
    colorTexture: slotTexture("color", splat.colorTexture),
    ndvi: splat.ndviTexture && slotTexture("ndvi", splat.ndviTexture),
    surface:
      splat.surfaceTexture && slotTexture("surface", splat.surfaceTexture),
    edges: splat.edgesTexture && slotTexture("edges", splat.edgesTexture),
    sport: splat.sport && {
      raster: slotTexture("sportRaster", splat.sport.raster),
      table: slotTexture("sportTable", splat.sport.table),
    },
    markings: splat.markings && {
      raster: slotTexture("markingsRaster", splat.markings.raster),
      table: slotTexture("markingsTable", splat.markings.table),
    },
    colonies: splat.colonies && {
      rect: slotUniform(
        "colonyRect",
        new Vector4(...splat.colonies.rect)
      ) as unknown as UniformNode<"vec4", Vector4>,
      texture: slotTexture("colonies", splat.colonies.texture),
    },
    ground: splat.ground,
  };
}

/** A tile's values for its variant's slots. */
function splatSlots(splat: SplatLayer): Slots {
  return {
    origin: splatOrigin(splat),
    class: splat.texture,
    color: splat.colorTexture,
    ndvi: splat.ndviTexture,
    surface: splat.surfaceTexture,
    edges: splat.edgesTexture,
    sportRaster: splat.sport?.raster,
    sportTable: splat.sport?.table,
    markingsRaster: splat.markings?.raster,
    markingsTable: splat.markings?.table,
    colonies: splat.colonies?.texture,
    colonyRect: splat.colonies && new Vector4(...splat.colonies.rect),
  };
}

/** The meadow's palette colour, linear — the urban green and grass pavers. */
const MEADOW_LINEAR = LANDCOVER_CLASSES[MEADOW_CLASS].srgb.map(srgbToLinear);

/** The road's palette colour, linear — sealed ground off the carriageway. */
const ROAD_LINEAR = LANDCOVER_CLASSES[ROAD_CLASS].srgb.map(srgbToLinear);

/**
 * The meadow detail the colour writes and the normal reads: the grass
 * normal's weight and the ground detail's accumulated tilt. Named shader
 * variables (`property`), assigned by the colour node — which three builds
 * before the lighting that asks for the normal — so the normal does not
 * recompute the ground detail, the sports grounds' row search with it.
 * Unwritten (no class raster), they read 0.
 */
const grassDetail = property("float", "terrainGrassDetail", float(0));
const groundTilt = property("vec3", "terrainGroundTilt", vec3(0));

/**
 * Meadow (class 1) painterly depth, in the colour node — zero geometry. A
 * value mottle (±~6%) plus a faint shading-normal break-up (`terrainNormal`)
 * so the grazing sun catches texture; the class id comes from the NEAREST
 * class raster, not RGB colour-distance, which would misfire on the
 * forest/copse/farmland greens. Distance-faded via `fwidth` so it never
 * aliases/shimmers in the far field (the failure mode that got plain
 * foliage translucency rejected as "noise").
 */
function grassMottle(inp: GroundInputs, painted: V3): GroundColour {
  const { xy, cls, fw } = inp;
  const meadow = float(1)
    .sub(step(0.5, abs(cls.sub(MEADOW_CLASS))))
    .toVar();
  // value noise, two octaves (~8 m and ~2.5 m): the product of two sines
  // it replaced is a chequerboard, which from afar is what it read as
  const mottle = gdNoise(xy.mul(MOTTLE_BROAD))
    .sub(0.5)
    .mul(1.4)
    .add(gdNoise(xy.mul(0.4).add(17.3)).sub(0.5).mul(0.6))
    .toVar();
  const paths = smoothPaths(inp, painted);
  const col: GroundColour = {
    baseCol: paths.col,
    path: paths.path,
    pathSide: paths.side,
    pathNear: paths.near,
    pathToward: paths.toward,
    meadow,
    detail: meadow.mul(float(1).sub(smoothstep(0.5, 2.5, fw))).toVar(),
    mottle,
    paperInk: float(0).toVar(),
  };
  col.baseCol.mulAssign(mottle.mul(0.035).mul(col.detail).add(1));
  return col;
}

/**
 * Wiesenfärbung's strength: a middling tint reads without looking like a
 * heat map — fixed at what its slider stood at (plan 073).
 */
const MEADOW_NDVI = float(0.6);

/** The meadow mottle's broad octave (per m: ~8 m drifts), and how much
 *  its slope tilts the grass normal (× the noise's gradient per cell). */
const MOTTLE_BROAD = 0.125;
const MOTTLE_SLOPE = 1.6;

/** The NDVI's mip the meadows read smoothed (2: 8 m a texel). */
const NDVI_LEVEL = 2;

/**
 * Meadow NDVI tint (Wiesenfärbung): on class-1 farmland/meadow only, shift
 * the pastel sage toward lush deep-green where the DOP greenness is high
 * and a drier yellow-tan where it's low — large-area colour variation the
 * flat splat can't give. The NDVI is LINEAR-filtered so the ~2 m raster
 * reads smooth, and a tiny `step` gates out zero/nodata texels (keep the
 * base sage, don't grey out). `g` is that NDVI from a coarser mip, read
 * once for the meadows and the crops (`arableGround`).
 */
function meadowNdvi(col: GroundColour, g: F, strength: F): void {
  const t = smoothstep(0.1, 0.6, g);
  const c = col.baseCol;
  const tint = mix(
    c.mul(vec3(1.08, 1.02, 0.88)), // dry: paler warm hay
    c.mul(vec3(0.84, 1.06, 0.74)), // lush: deeper grass
    t
  );
  c.assign(mix(c, tint, strength.mul(col.meadow).mul(step(0.012, g))));
}

/**
 * The arable land's crop: where the DOP's greenness says something grows,
 * the loam turns toward a young crop's green (a gain on the splat's colour,
 * so the class border keeps its blend), fixed at CROP of the way: bare
 * soil and stubble stay loam, a green crop turns green — in Grimma's and
 * Unna's flights about 40 % of the arable land reads as crop. The gain
 * is the crop's sRGB [178, 198, 146] over the palette's loam [204, 186,
 * 154], linear.
 */
const CROP = float(0.85);
const LOAM_LINEAR = LANDCOVER_CLASSES[ARABLE_CLASS].srgb.map(srgbToLinear);
const CROP_GAIN = vec3(
  ...([178, 198, 146].map((v, i) => srgbToLinear(v) / LOAM_LINEAR[i]) as [
    number,
    number,
    number,
  ])
);

/**
 * Furrows: a faint ±FURROWS value ripple every FURROW_M across the field's
 * long axis (the paving raster's frame there, surface.py `field_frames`),
 * half as strong under a crop, gone before the ripple is a pixel's size.
 */
const FURROWS = float(0.05);
const FURROW_M = 0.75;

/**
 * Arable land (class 9; landcover.py ARABLE_VEG, OSM farmland): the crop's
 * green by the NDVI, read as the meadow's from a coarser mip, and the
 * furrows along the field. Selects, no branch: the NDVI's biased read
 * must stay in uniform control flow.
 */
function arableGround(
  inp: GroundInputs,
  col: GroundColour,
  g: GroundFields,
  v?: F
): void {
  const arable = float(1)
    .sub(step(0.5, abs(inp.cls.sub(ARABLE_CLASS))))
    .toVar();
  const c = col.baseCol;
  const crop = float(0).toVar();
  if (v) {
    crop.assign(smoothstep(0.12, 0.42, v).mul(step(0.012, v)));
    c.assign(mix(c, c.mul(CROP_GAIN), crop.mul(CROP).mul(arable)));
  }
  const across = dot(g.local, vec2(sin(g.head).negate(), cos(g.head))).toVar();
  const fade = float(1).sub(smoothstep(0.12, 0.35, fwidth(across)));
  const ripple = sin(across.mul((2 * Math.PI) / FURROW_M));
  const framed = select(g.hasFrame, float(1), float(0));
  c.mulAssign(
    ripple
      .mul(FURROWS)
      .mul(float(1).sub(crop.mul(0.5)))
      .mul(fade)
      .mul(framed)
      .mul(arable)
      .add(1)
  );
}

/**
 * Sketch contour lines (2 m minor / 10 m major) on the data-frame elevation,
 * one pixel wide via fwidth. Each set fades out once its lines crowd closer
 * than a few pixels: past that a 1 px line per contour is no longer a line
 * but a grey stipple, and on the gently rolling DGM (streets, meadows, the
 * river surface) it read as dirty blotches across the whole middle distance.
 */
function contourInk(elevation: F): F {
  const set = (spacing: number, fade: [number, number]): F => {
    const d = elevation.div(spacing);
    const w = fwidth(d);
    // A flat quad lying exactly on a contour has fwidth 0: 0/0 there
    // striped it with NaN ink (and NaN survives the slope gate's
    // multiply) — the select keeps the 0.
    const line = select(
      w.greaterThan(1e-6),
      float(1).sub(min(abs(fract(d.sub(0.5)).sub(0.5)).div(w), 1)),
      0
    );
    return line.mul(float(1).sub(smoothstep(fade[0], fade[1], w)));
  };
  const minor = set(2, [0.08, 0.2]);
  const major = set(10, [0.06, 0.16]);
  return clamp(minor.mul(0.08).add(major.mul(0.14)), 0, 0.22);
}

/**
 * Where contours mean nothing, drop them: on near-flat ground (a street,
 * a meadow, the river's DGM surface) every centimetre of measurement noise
 * crosses the 2 m level in a squiggle — the lines only belong on real
 * slopes. The slope is the elevation change per metre across the pixel
 * footprint. Under water the ink is gone too (the sheet is translucent, it
 * showed).
 */
function contourGate(inp: GroundInputs, elevation: F, water: F): F {
  const run = max(length(fwidth(inp.xy)), 1e-4);
  const slope = fwidth(elevation).div(run);
  return smoothstep(0.025, 0.09, slope).mul(
    float(1).sub(smoothstep(0.05, 0.4, water))
  );
}

/** The contour ink's colour, over the ground by the ink's weight. */
const INK = vec3(0.3, 0.33, 0.38);

/**
 * The colour node over the class raster: the palette splat, then — term by
 * term in the order they compose — the meadow mottle, the ground fields,
 * urban green, the ground detail, the allotment gardens, the sports
 * grounds, the road markings, the NDVI tint, the arable land's crop and
 * furrows, and the gated contour ink on top. The optional rasters that did
 * not load leave their term out (a different variant, built apart;
 * `terrainGraph`).
 */
function splatColour(splat: SplatNodes): V3 {
  return Fn(() => {
    const uv = rasterUv(dataXY(), splat.origin, splat.size).toVar();
    const xy = dataXY().toVar();
    const inp: GroundInputs = {
      uv,
      xy,
      size: splat.size,
      classTexture: splat.classTexture,
      fw: max(fwidth(xy.x), fwidth(xy.y)).toVar(),
      cls: floor(texture(splat.classTexture, uv).r.mul(255).add(0.5)).toVar(),
      sunDirection: splat.ground.sunDirection,
      meadowColor: vec3(MEADOW_LINEAR[0], MEADOW_LINEAR[1], MEADOW_LINEAR[2]),
      roadColor: vec3(ROAD_LINEAR[0], ROAD_LINEAR[1], ROAD_LINEAR[2]),
    };
    // the painted ground, read once: its colour, and in alpha the water
    const painted = texture(splat.colorTexture, uv).toVar();
    const col = grassMottle(inp, painted.rgb);
    const g = groundFields(
      inp,
      splat.surface,
      splat.edges,
      splat.markings?.raster
    );
    const ugW = urbanGreen(inp, col, g, splat.ndvi);
    groundDetail(inp, col, g, ugW);
    if (splat.colonies) {
      colonyGarden(inp, col, g, splat.colonies);
    }
    if (splat.sport) {
      sportGround(inp, col, g, splat.sport);
    }
    if (splat.markings) {
      roadMarkings(inp, col, g, splat.markings);
    }
    // the NDVI averaged over ~10 m: the 2 m raster carries every path,
    // tree shadow and bare patch, which painted the meadows in dark
    // flecks; what it should give is broad lush and dry drifts. Its mip 2
    // (8 m) read through a cubic B-spline — the biased bilinear read it
    // replaced drew those drifts as a chequerboard of ~10 m squares from
    // afar — and only far out, where a square is under a few pixels, the
    // plain mip as before.
    const coarseNdvi = splat.ndvi
      ? texture(splat.ndvi, inp.uv).bias(float(2.5)).r.toVar()
      : undefined;
    if (splat.ndvi && coarseNdvi) {
      const { ndvi } = splat;
      // (explicit-level reads: safe in a branch; none past 16 m a pixel)
      If(inp.fw.lessThan(16), () => {
        coarseNdvi.assign(
          mix(
            bsplineSample(ndvi, uv, texelSize(ndvi, uv), NDVI_LEVEL).r,
            coarseNdvi,
            smoothstep(6, 16, inp.fw)
          )
        );
      });
    }
    if (coarseNdvi) {
      meadowNdvi(col, coarseNdvi, MEADOW_NDVI);
    }
    arableGround(inp, col, g, coarseNdvi);
    const baseCol = paperGround(col, painted.a);
    grassDetail.assign(col.detail);
    groundTilt.assign(g.tilt);
    const elevation = positionWorld.y;
    const ink = contourInk(elevation)
      .mul(contourGate(inp, elevation, painted.a))
      .mul(contourKept);
    return mix(baseCol, INK, ink);
  })();
}

/** The Schwarzplan's ground is a plain white sheet, Sin City's a card:
 *  no contours either. */
const contourKept = select(paperGroundOn.greaterThan(2.5), 0, 1);

/**
 * The paper styles' ground (paper-scene.ts): for their frames the terrain
 * keeps its own shader instead of wearing the swap's material, because the
 * paint on it — road markings, parking bays, sports lines — and the water's
 * extent exist only here. Papier: the ground turns to paper, the paint to a
 * light pencil grey and the water to a cool, slightly deeper paper. Strich:
 * the ground's own colours, muted and lightened into a plan's (green
 * parks, blue water, near-white streets), the paint grey. The Schwarzplan:
 * plain white. Light, sky view and contours stay the terrain's own. One
 * shared uniform switches it (`paperGroundOn`), so it is the same program
 * in every style.
 */
function paperGround(col: GroundColour, waterCoverage: F): V3 {
  const water = smoothstep(0.05, 0.5, waterCoverage).toVar();
  const ink = clamp(col.paperInk, 0, 1).toVar();
  const paper = mix(PAPER_LINEAR, PAPER_WATER_LINEAR, water);
  const papered = mix(paper, PAPER_PAINT_LINEAR, ink);
  // a plan's palette: the paved and the built ground a light neutral, the
  // green a plan's green (the painted ground's olive reads as sand once
  // lightened), the water a plan's blue
  const c = col.baseCol;
  const grey = dot(c, vec3(0.2126, 0.7152, 0.0722));
  const green = smoothstep(0.015, 0.06, c.y.sub(max(c.x, c.z)));
  const ground = mix(mix(vec3(grey), vec3(1), 0.62), PLAN_GREEN_LINEAR, green);
  const plan = mix(
    mix(ground, PLAN_WATER_LINEAR, water),
    PLAN_PAINT_LINEAR,
    ink.mul(0.6)
  );
  // Sin City (always in its own afternoon light): the white card, the
  // water black
  const inked = mix(vec3(1), vec3(0.015), step(0.5, water));
  return select(
    paperGroundOn.greaterThan(3.5),
    inked,
    select(
      paperGroundOn.greaterThan(2.5),
      vec3(1),
      select(
        paperGroundOn.greaterThan(1.5),
        plan,
        select(paperGroundOn.greaterThan(0.5), papered, col.baseCol)
      )
    )
  );
}

/** Papier's tones, linear (paper-scene.ts's sheet). */
const PAPER_LINEAR = linearVec3(PAPER_HEX);
// Darker than they look: the Papier pass lifts everything sunlit above
// mid-grey to the paper itself, so these land as a faint cool grey.
const PAPER_WATER_LINEAR = linearVec3(0x5a_61_6b);
const PAPER_PAINT_LINEAR = linearVec3(0x60_60_66);
/** Strich's green, water and paint (the plan palette's). */
const PLAN_GREEN_LINEAR = linearVec3(0xc9_df_bd);
const PLAN_WATER_LINEAR = linearVec3(0xb4_cd_e2);
const PLAN_PAINT_LINEAR = linearVec3(0x9a_9c_a3);

function linearVec3(hex: number): V3 {
  const c = new Color(hex);
  return vec3(c.r, c.g, c.b);
}

/** The flat sage ground with its contour ink (no class raster). */
function plainColour(): V3 {
  const ground = select(
    paperGroundOn.greaterThan(2.5),
    vec3(1),
    select(paperGroundOn.greaterThan(0.5), PAPER_LINEAR, vec3(materialColor))
  );
  return mix(ground, INK, contourInk(positionWorld.y).mul(contourKept));
}

/**
 * The ground's shading normal (view space). Calm first: the DGM1 carries
 * every kerb, rut and survey wobble, and the baked normals are quantised to
 * 8 bits, so lit by a low sun a street, a meadow or a quay reads as coarse
 * dark-and-light flecks — "dirty" rather than drawn. Near-flat normals
 * (under ~12°) are pulled to straight up, keeping a trace of the relief;
 * real slopes (embankments, the valley sides) keep their full shading, and
 * the contour ink carries the rest of the terrain's form. With the class
 * raster, then the meadow-only break-up and the kerbs', lawn edges' and
 * stones' tilt (the colour node's `terrainGrassDetail`/`terrainGroundTilt`).
 */
function terrainNormal(withDetail: boolean): V3 {
  return Fn(() => {
    const up = normalize(cameraViewMatrix.mul(vec4(0, 1, 0, 0)).xyz);
    const keep = float(1).sub(smoothstep(0.93, 0.985, dot(normalView, up)));
    const calm = normalize(mix(up, normalView, max(keep, 0.12)));
    if (!withDetail) {
      return calm;
    }
    // the slope of the mottle's broad octave (`grassMottle`), analytic
    // (four hashes on every ground pixel): the light catches the same
    // drifts the colour has
    const g = gdNoiseSlope(dataXY().mul(MOTTLE_BROAD)).mul(MOTTLE_SLOPE / 2);
    const grass = normalize(
      calm.add(vec3(g.x, g.y, 0).mul(grassDetail.mul(0.06)))
    );
    return groundNormal(grass, groundTilt);
  })();
}

/** A terrain variant's shared colour and normal nodes. */
interface TerrainGraph {
  color: V3;
  normal: V3;
}

/**
 * The terrain's graphs, one per variant (`splatVariant`; the plain ground
 * without a class raster is one more), per app — keyed by the look's
 * uniforms, which every tile of an app shares (material-slots.ts).
 */
const terrainGraphs = new WeakMap<object, Map<string, TerrainGraph>>();
let plainGraph: TerrainGraph | null = null;

function terrainGraph(splat: SplatLayer | undefined): TerrainGraph {
  if (!splat) {
    plainGraph ??= { color: plainColour(), normal: terrainNormal(false) };
    return plainGraph;
  }
  let graphs = terrainGraphs.get(splat.ground);
  if (!graphs) {
    graphs = new Map();
    terrainGraphs.set(splat.ground, graphs);
  }
  const key = splatVariant(splat);
  let graph = graphs.get(key);
  if (!graph) {
    graph = {
      color: splatColour(splatNodes(splat)),
      normal: terrainNormal(true),
    };
    graphs.set(key, graph);
  }
  return graph;
}

/**
 * Light paper-sage ground with sketch-style contour lines (2 m minor / 10 m
 * major), on the data-frame elevation derived from world space. When a
 * `splat` is given, the base colour comes from the ATKIS land-cover at each
 * fragment (streets, water, meadow, …) instead of the flat sage, with the
 * ground's detail over it (`splatColour`); the contour ink is composited on
 * top. The city's large-scale light (sky-light.ts) folds in last: the sky
 * view on the ambient term, the far horizon on the sun.
 */
export function createTerrainMaterial(
  splat?: SplatLayer
): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial({
    color: 0xad_b2_9e,
    roughness: 1,
  });
  material.name = "terrain";
  // pressed under a loaded design's floor where it stands (design-site.ts)
  material.positionNode = groundUnderDesign;
  // The variant's graph, shared by every tile of it: a tile that arrives
  // builds no shader; its own rasters go into the slots.
  const graph = terrainGraph(splat);
  material.colorNode = graph.color;
  material.normalNode = graph.normal;
  if (splat) {
    setSlots(material, splatSlots(splat));
  }
  applyGroundLight(material, splat ? groundLightOf(splat) : undefined);
  // The variant names the graph and, with it, the light's (its rasters).
  setGraph(material, `terrain|${splat ? splatVariant(splat) : "plain"}`);
  // Papier draws the ground with this material (see `paperGround`).
  material.userData.paperOwn = true;
  return material;
}

/** A level's ground height, and the bytes its lookup keeps on the CPU. */
interface HeightLookup {
  heightAt: (x: number, y: number) => number | null;
  bytes: number;
}

/**
 * Ground height over a TIN (`extras.tin`, the fine level): its surface
 * triangles indexed in the projected frame (lib/city/terrain-tin.ts
 * TinIndex), its vertices read back from the mesh and the index's buckets
 * built by the ground worker (`groundPrepInput`; 0.3–0.6 s a fine level on
 * the phone profile when built here) — so the walker stands on exactly the
 * triangles the GPU draws.
 */
function tinHeightAt(
  mesh: Mesh,
  bounds: TerrainBounds,
  ground: GroundPrep
): HeightLookup {
  const index = mesh.geometry.getIndex();
  if (!(index && ground.xy && ground.z && ground.tin)) {
    return { heightAt: () => null, bytes: 0 };
  }
  const tin = TinIndex.fromBuckets(
    {
      bounds,
      xy: ground.xy,
      z: ground.z,
      // every triangle, skirt included, as the worker indexed them
      triangles: index.array,
    },
    ground.tin
  );
  return { heightAt: (x, y) => tin.heightAt(x, y), bytes: tin.bytes };
}

/** The level's ground prep from the ground worker (ground-prep-client.ts). */
async function groundOf(
  mesh: Mesh,
  extras: TerrainExtras,
  toData: Matrix4,
  opts: TerrainOptions,
  mask: WaterMask | null
): Promise<GroundPrep> {
  const level = mesh.geometry.getIndex();
  return await prepareGroundOffThread(
    groundPrepInput(mesh, extras, toData, opts.offset, mask),
    {
      // the site's grid index (GridShare) goes to the worker once
      shared: level && isSceneShared(level) ? level : undefined,
      signal: opts.signal,
    }
  );
}

/**
 * What the ground worker needs of a level (lib/city/ground-prep.ts): its
 * positions as stored, its index, the local → data matrix and, where the
 * tile has water, its water cells — the sheets' triangles are chosen
 * there. A grid level's elevations are its first n² vertices.
 */
function groundPrepInput(
  mesh: Mesh,
  extras: TerrainExtras,
  toData: Matrix4,
  offset: { cx: number; cy: number },
  mask: WaterMask | null
): GroundPrepInput {
  const position = mesh.geometry.getAttribute("position");
  const raw = rawPositions(position);
  const index = mesh.geometry.getIndex();
  return {
    positions: raw.array,
    stride: raw.stride,
    offset: raw.offset,
    count: position.count,
    normalized: position.normalized,
    index: index ? (index.array as Uint16Array | Uint32Array) : null,
    toData: toData.elements,
    origin: offset,
    bounds: extras.bounds,
    grid: extras.tin ? null : extras.n,
    mask,
  };
}

/** A mesh's positions as the numbers they are stored as (quantised, maybe
 *  interleaved): the array, numbers per vertex, and where x sits. */
function rawPositions(position: BufferAttribute | InterleavedBufferAttribute): {
  array: GroundPositions;
  offset: number;
  stride: number;
} {
  const interleaved = (position as InterleavedBufferAttribute)
    .isInterleavedBufferAttribute;
  return interleaved
    ? {
        array: (position as InterleavedBufferAttribute).data
          .array as Int16Array,
        stride: (position as InterleavedBufferAttribute).data.stride,
        offset: (position as InterleavedBufferAttribute).offset,
      }
    : {
        array: (position as BufferAttribute).array as Float32Array,
        stride: position.itemSize,
        offset: 0,
      };
}

/** The triangles of `index` with area in plan, as an index attribute of
 *  their own (`waterGeometryOf`). */
function ownWaterIndex(
  index: BufferAttribute,
  position: BufferAttribute | InterleavedBufferAttribute
): BufferAttribute {
  // The quantised numbers as they are (lib/city/terrain-tin.ts).
  const raw = rawPositions(position);
  return new BufferAttribute(
    planTriangles(
      index.array as Uint16Array | Uint32Array,
      raw.array,
      raw.stride,
      raw.offset
    ),
    1
  );
}

/**
 * The coarse terrain's grid index and the water index made from it, one
 * copy for the whole site (the water index only for a class raster the
 * browser decoded: with the raster's water cells each tile's sheets keep
 * their own, far smaller indices — `waterSheetsOf`). Every coarse tile carries the same index byte
 * for byte (the bake triangulates every tile's grid and skirt alike) —
 * 6 MB on the GPU and as much on the CPU, its water index another 6 MB,
 * i.e. 80 % of a coarse tile's geometry. The first tile's become the
 * site's (three-utils.ts `markSceneShared`: no tile's release frees them,
 * the app's device does); a later tile's are swapped for them where they
 * hold the same numbers — the water's where its plan (the quantised x and
 * z it is chosen by) is the first tile's too. A tile whose own differ keeps
 * its own. One per app: the stream makes it (tile-stream.ts).
 */
export interface GridShare {
  /** the site's index for an `n`·`n` grid, or `own` when it differs */
  index: (n: number, own: BufferAttribute) => BufferAttribute;
  /** the water triangles of `index` over `position`'s plan */
  water: (
    n: number,
    index: BufferAttribute,
    position: BufferAttribute | InterleavedBufferAttribute
  ) => BufferAttribute;
}

export function createGridShare(): GridShare {
  const indices = new Map<number, BufferAttribute>();
  const waters = new Map<
    number,
    { index: BufferAttribute; plan: ArrayLike<number> }
  >();
  return {
    index: (n, own) => {
      const kept = indices.get(n);
      if (!kept) {
        markSceneShared(own);
        indices.set(n, own);
        return own;
      }
      return sameNumbers(kept.array, own.array) ? kept : own;
    },
    water: (n, index, position) => {
      if (indices.get(n) !== index) {
        return ownWaterIndex(index, position);
      }
      const raw = rawPositions(position);
      const plan = planOf(raw.array, raw.stride, raw.offset, position.count);
      const kept = waters.get(n);
      if (kept && sameNumbers(kept.plan, plan)) {
        return kept.index;
      }
      const own = ownWaterIndex(index, position);
      if (!kept) {
        markSceneShared(own);
        waters.set(n, { index: own, plan });
      }
      return own;
    },
  };
}

/**
 * The water's geometry: the terrain's positions without its skirt. The water
 * and mist sheets drape the terrain mesh, and its skirt — the 30 m vertical
 * wall that hides cracks between tiles — would otherwise be drawn as a wall
 * of water at every seam across the river, a bright band where the two
 * sheets meet. A skirt triangle is vertical: two of its corners share a plan
 * position (the same quantised x and z, glTF being Y-up), so it has no area
 * in plan. A TIN's water also faces straight up (`upFacing`): it spans the
 * river with a few huge triangles whose vertex normals are averaged with the
 * steep bank faces they share a vertex with, so the water's shading would
 * fan out in streaks across them. `waterIndex` picks its triangles (on the
 * grid, the site's shared ones: `GridShare`).
 */
function waterGeometryOf(
  geometry: BufferGeometry,
  upFacing: boolean,
  waterIndex: (
    index: BufferAttribute,
    position: BufferAttribute | InterleavedBufferAttribute
  ) => BufferAttribute = ownWaterIndex
): BufferGeometry {
  const position = geometry.getAttribute("position");
  const index = geometry.getIndex();
  const water = new BufferGeometry();
  water.setAttribute("position", position);
  if (upFacing) {
    const normals = new Float32Array(position.count * 3);
    for (let i = 1; i < normals.length; i += 3) {
      normals[i] = 1;
    }
    water.setAttribute("normal", new BufferAttribute(normals, 3));
  } else {
    water.setAttribute("normal", geometry.getAttribute("normal"));
  }
  if (index) {
    water.setIndex(waterIndex(index, position));
  }
  water.boundingBox = geometry.boundingBox?.clone() ?? null;
  water.boundingSphere = geometry.boundingSphere?.clone() ?? null;
  return water;
}

/** What a terrain level reads; `class` null: the flat sage ground. */
interface TerrainRasters {
  class: SplatRasters | null;
  colonies?: Texture;
  edges?: Texture;
  horizon?: Texture;
  markings?: IndexedRaster;
  ndvi?: Texture;
  sport?: IndexedRaster;
  surface?: Texture;
  svf?: Texture;
}

/**
 * Every promise settled, then their values — or the first rejection, once
 * none is still running: what the others brought is on the hold by then,
 * so the caller's release lets go of all of it.
 */
async function settledAll<T extends readonly unknown[]>(promises: {
  [K in keyof T]: Promise<T[K]>;
}): Promise<T> {
  const results = await Promise.allSettled(promises);
  const failed = results.find((r) => r.status === "rejected");
  if (failed) {
    throw failed.reason;
  }
  // reason: every result is fulfilled here, in the tuple's order
  return results.map(
    (r) => (r as PromiseFulfilledResult<unknown>).value
  ) as unknown as T;
}

/**
 * The level's rasters (tile-rasters.ts). They are all asked for at once —
 * each is a round trip of its own, and a fine level names up to ten — while
 * their decodes and uploads still take turns site-wide (raster-upload.ts):
 * several 4096² rasters decoding at once is a peak mobile Safari kills the
 * tab for, a few compressed files waiting for their turn are not. On an
 * abort everything taken is let go again — on the GPU already, so let go
 * means freed there too. Without a class raster there is nothing to paint
 * the detail over: all of it goes.
 */
async function loadTerrainRasters(
  extras: TerrainExtras,
  opts: TerrainOptions,
  far: boolean
): Promise<TerrainRasters> {
  const { rasters: hold, signal } = opts;
  const how = { far };
  try {
    const [
      splats,
      ndvi,
      surface,
      edges,
      sport,
      markings,
      colonies,
      horizon,
      svf,
    ] = await settledAll([
      hold.acquire("class", extras, signal),
      hold.acquire("ndvi", extras, signal),
      hold.acquire("surface", extras, signal, how),
      hold.acquire("edges", extras, signal, how),
      hold.acquire("sport", extras, signal, how),
      hold.acquire("markings", extras, signal, how),
      hold.acquire("colonies", extras, signal, how),
      hold.acquire("horizon", extras, signal),
      hold.acquire("svf", extras, signal),
    ]);
    signal?.throwIfAborted();
    if (!splats) {
      hold.release();
      return { class: null };
    }
    return {
      class: splats,
      ndvi: ndvi ?? undefined,
      surface: surface ?? undefined,
      edges: edges ?? undefined,
      sport: sport ?? undefined,
      markings: markings ?? undefined,
      colonies: colonies ?? undefined,
      horizon: horizon ?? undefined,
      svf: svf ?? undefined,
    };
  } catch (error) {
    hold.release();
    throw error;
  }
}

/** A level's ground in the scene's frame (Y up, recentered): its bounds,
 *  and the heights its mesh spans. */
function reachBoxOf(
  mesh: Mesh,
  extras: TerrainExtras,
  toData: Matrix4,
  offset: { cx: number; cy: number }
): ReachBox {
  const [minX, minY, maxX, maxY] = extras.bounds;
  const { geometry } = mesh;
  if (!geometry.boundingBox) {
    geometry.computeBoundingBox();
  }
  // (the data frame is Z up: the mesh's box there has the heights)
  const heights = geometry.boundingBox?.clone().applyMatrix4(toData);
  const low = heights && Number.isFinite(heights.min.z) ? heights.min.z : 0;
  const high = heights && Number.isFinite(heights.max.z) ? heights.max.z : low;
  return {
    min: [
      minX - offset.cx,
      Math.min(low, extras.minElevation),
      -(maxY - offset.cy),
    ],
    max: [
      maxX - offset.cx,
      Math.max(high, extras.minElevation),
      -(minY - offset.cy),
    ],
  };
}

/** Where a level's ground lies, and the set it starts on there. */
function reachStart(
  mesh: Mesh,
  extras: TerrainExtras,
  toData: Matrix4,
  opts: TerrainOptions
): { box: ReachBox; far: boolean } {
  const box = reachBoxOf(mesh, extras, toData, opts.offset);
  return { box, far: opts.far?.(box) ?? false };
}

/** Whether the content names a twin for any close-range raster. */
function hasTwins(extras: TerrainExtras): boolean {
  // reason: the extras name only some of the raster keys
  const named = extras as unknown as Partial<Record<string, string>>;
  return REACH_KINDS.some((kind) => {
    const { far } = RASTER_KINDS[kind];
    return far !== undefined && named[far] !== undefined;
  });
}

/** The close-range rasters of a splat, by kind (as `acquire` gave them). */
interface ReachSet {
  colonies: Texture | undefined;
  edges: Texture | undefined;
  markings: SplatLayer["markings"];
  sport: SplatLayer["sport"];
  surface: Texture | undefined;
}

const reachSetOf = (splat: SplatLayer): ReachSet => ({
  surface: splat.surfaceTexture,
  edges: splat.edgesTexture,
  sport: splat.sport,
  markings: splat.markings,
  colonies: splat.colonies?.texture,
});

/** The set a swap loaded, all of it or (one missing, the level gone)
 *  nothing: a variant's graph reads the kinds it was built with. */
async function loadReachSet(
  d: GroundDetailInput,
  far: boolean,
  now: ReachSet
): Promise<ReachSet | null> {
  const how = { far, now: true };
  const got = await settledAll([
    d.hold.acquire("surface", d.extras, d.signal, how),
    d.hold.acquire("edges", d.extras, d.signal, how),
    d.hold.acquire("sport", d.extras, d.signal, how),
    d.hold.acquire("markings", d.extras, d.signal, how),
    d.hold.acquire("colonies", d.extras, d.signal, how),
  ]);
  const next: ReachSet = {
    surface: got[0] ?? undefined,
    edges: got[1] ?? undefined,
    sport: got[2] ?? undefined,
    markings: got[3] ?? undefined,
    colonies: got[4] ?? undefined,
  };
  const whole = REACH_KINDS.every(
    (kind) => (next[kind] === undefined) === (now[kind] === undefined)
  );
  if (whole && !d.signal.aborted) {
    return next;
  }
  for (const kind of REACH_KINDS) {
    d.hold.drop(next[kind]);
  }
  return null;
}

export interface GroundDetailInput {
  box: ReachBox;
  extras: TerrainExtras;
  far: boolean;
  hold: RasterHold;
  mesh: Mesh;
  signal: AbortSignal;
  splat: SplatLayer | undefined;
}

/** A level's hold on its close-range rasters (`GroundDetail`). */
export function groundDetailOf(d: GroundDetailInput): GroundDetail | undefined {
  const { splat, mesh, hold } = d;
  if (!(splat && hasTwins(d.extras))) {
    return undefined;
  }
  let { far } = d;
  let busy = false;
  const swap = async (next: boolean): Promise<boolean> => {
    const old = reachSetOf(splat);
    const set = await loadReachSet(d, next, old);
    if (!set) {
      return false;
    }
    splat.surfaceTexture = set.surface;
    splat.edgesTexture = set.edges;
    splat.sport = set.sport;
    splat.markings = set.markings;
    if (splat.colonies && set.colonies) {
      splat.colonies = { ...splat.colonies, texture: set.colonies };
    }
    // reason: the terrain's one material (createTerrainMaterial)
    const material = mesh.material as MeshStandardNodeMaterial;
    setSlots(material, { ...slotsOf(material), ...splatSlots(splat) });
    for (const kind of REACH_KINDS) {
      hold.drop(old[kind]);
    }
    far = next;
    return true;
  };
  return {
    box: d.box,
    far: () => far,
    setFar: async (next) => {
      if (busy || next === far || d.signal.aborted) {
        return false;
      }
      busy = true;
      try {
        return await swap(next);
      } catch {
        // (a raster that did not load: the level keeps what it reads, and
        // the frame asks again)
        return false;
      } finally {
        busy = false;
      }
    },
  };
}

/** The terrain's draw order among the opaque (dressTerrain): after the
 *  rest, at 0. (The transparent, the water sheets among them, are a list
 *  of their own, drawn after every opaque thing whatever their order.) */
const TERRAIN_RENDER_ORDER = 1;

/** The splat's baked light as the fine level's kerbs, fences, stairs and
 *  walls bind it (the same textures and rows, by reference). */
function groundLightOf(splat: SplatLayer): GroundLight | undefined {
  const { ground } = splat;
  if (!(splat.svfTexture || splat.horizonTexture)) {
    return undefined;
  }
  const minX = splat.bounds[0];
  const maxY = splat.bounds[3];
  return {
    svf: splat.svfTexture,
    horizon: splat.horizonTexture,
    origin: [minX - splat.offset.cx, maxY - splat.offset.cy],
    size: splatSize(splat),
    shadowReach: ground.shadowReach,
    sunDirection: ground.sunDirection,
  };
}

/** The water and mist sheets' geometries: one, or two over the same
 *  positions with an index each. */
interface WaterSheets {
  water: BufferGeometry;
  mist: BufferGeometry;
}

/**
 * The sheets' geometries for a terrain level. Without a mask (a class
 * raster the browser decoded) both drape the whole level, as one
 * geometry, its index the site's on a grid (`GridShare`); with one, each
 * keeps the triangles within its reach of water — the mist's reaches
 * farther — over the level's own positions, with an index of its own:
 * chosen by the ground worker (lib/city/ground-prep.ts), and bounded by
 * its triangles, not the tile, so a sheet along one bank is culled while
 * the camera looks across the dry rest of the tile.
 */
function waterSheetsOf(
  mesh: Mesh,
  extras: TerrainExtras,
  ground: GroundPrep,
  grids: GridShare | undefined
): WaterSheets {
  const upFacing = extras.tin !== undefined;
  const { water: waterPrep, mist: mistPrep } = ground;
  if (!(waterPrep && mistPrep)) {
    const one = waterGeometryOf(
      mesh.geometry,
      upFacing,
      grids && ((own, position) => grids.water(extras.n, own, position))
    );
    return { water: one, mist: one };
  }
  const sheet = (prep: SheetPrep) => {
    const geometry = waterGeometryOf(
      mesh.geometry,
      upFacing,
      () => new BufferAttribute(prep.index, 1)
    );
    const box = new Box3().set(
      new Vector3(prep.box[0], prep.box[1], prep.box[2]),
      new Vector3(prep.box[3], prep.box[4], prep.box[5])
    );
    geometry.boundingBox = box;
    geometry.boundingSphere = box.getBoundingSphere(new Sphere());
    return geometry;
  };
  const water = sheet(waterPrep);
  const mist = sheet(mistPrep);
  // one set of normals for both (a TIN's own, up-facing)
  mist.setAttribute("normal", water.getAttribute("normal"));
  return { water, mist };
}

/** A mesh's named attributes and its index (none: nothing). */
const attributesOf = (mesh: Mesh | undefined, names: string[]) =>
  mesh
    ? [
        ...names.map((name) => mesh.geometry.getAttribute(name)),
        mesh.geometry.getIndex(),
      ]
    : [];

/**
 * A dressed level's buffers that nothing reads on the CPU once its compile
 * has uploaded them (tile-stream.ts drops their CPU copies then: three.js
 * keeps every one, a second copy of the tile's geometry). Each is read by
 * the material its compile builds, so it is on the GPU by then:
 * - the ground's positions and normals (the terrain material reads both;
 *   the height samplers copied what they need at dressing) and a grid's
 *   own index — not a TIN's, which its height index reads
 *   (lib/city/terrain-tin.ts `TinIndex`), nor the site's shared one;
 * - the water's and the mist's own indices (their positions are the
 *   ground's); not their
 *   normals, which its material never reads, so a later material might;
 * - the stairs', walls' and kerbs' positions, normals and index, the
 *   stairs' and walls' vertex colours (they draw with them);
 * - the fences' positions, band uv and index; not their normals (the band
 *   is lit as the ground, by a normal of its own).
 */
export function cpuDroppable(layer: TerrainLayer): AnyAttribute[] {
  const ground = layer.mesh.geometry;
  return [
    ground.getAttribute("position"),
    ground.getAttribute("normal"),
    layer.tin ? null : ground.getIndex(),
    layer.water?.mesh.geometry.getIndex(),
    layer.water && layer.water.mistMesh.geometry !== layer.water.mesh.geometry
      ? layer.water.mistMesh.geometry.getIndex()
      : null,
    ...attributesOf(layer.stairs, ["position", "normal", "color"]),
    ...attributesOf(layer.walls, ["position", "normal", "color"]),
    ...attributesOf(layer.kerbs, ["position", "normal"]),
    ...attributesOf(layer.fences, ["position", "uv"]),
  ].filter((a): a is AnyAttribute => a !== null && a !== undefined);
}

/**
 * Dresses a streamed terrain mesh: loads its class raster (and NDVI), paints
 * the colour splat, swaps in the land-cover material and hangs the water and
 * mist sheets under it. `toData` maps the mesh's local frame to the data
 * frame: the bake wrote a grid level's n·n grid first (row 0 = north),
 * quantised, with the node carrying the dequantisation and the renderer
 * the glTF→3D Tiles up-axis turn — that chain up to (not including) the
 * viewer's `world` group. It is read after the rasters load (the ground
 * worker's input, `groundPrepInput`), so it must be this level's alone.
 * The mesh stays owned by the tile.
 */
export async function dressTerrain(
  mesh: Mesh,
  extras: TerrainExtras,
  toData: Matrix4,
  opts: TerrainOptions
): Promise<TerrainLayer> {
  const { bounds, n } = extras;
  // The fine level is a TIN; the coarse one (and a fine level whose DGM had
  // holes) the grid, whose index (and water index) the site shares.
  const grids = extras.tin ? undefined : opts.grids;
  const index = mesh.geometry.getIndex();
  if (grids && index) {
    mesh.geometry.setIndex(grids.index(n, index));
  }
  const { box, far: startsFar } = reachStart(mesh, extras, toData, opts);
  const loaded = await streamTimings.timed(
    "terrain:rasters",
    async () => await loadTerrainRasters(extras, opts, startsFar),
    extras.tileId
  );
  const free = opts.rasters.release;
  const classes = loaded.class;
  // the class raster's water cells: none (null) where the tile has no
  // water, unknown (undefined) for a raster the browser decoded
  const mask = classes?.water;
  let ground: GroundPrep;
  try {
    ground = await streamTimings.timed(
      "terrain:ground",
      async () => await groundOf(mesh, extras, toData, opts, mask ?? null),
      extras.tileId
    );
  } catch (error) {
    free();
    throw error;
  }
  const { elevations } = ground;
  const { heightAt, bytes: heightBytes } = elevations
    ? {
        heightAt: (x: number, y: number) =>
          sampleHeightfield({ elevations, n, bounds }, x, y),
        bytes: elevations.byteLength,
      }
    : tinHeightAt(mesh, bounds, ground);
  const splat: SplatLayer | undefined = classes
    ? {
        texture: classes.texture,
        colorTexture: classes.painted.texture,
        ndviTexture: loaded.ndvi,
        surfaceTexture: loaded.surface,
        edgesTexture: loaded.edges,
        sport: loaded.sport,
        markings: loaded.markings,
        colonies: loaded.colonies && {
          texture: loaded.colonies,
          rect: colonyCropUv(extras.cultivatedCrop),
        },
        svfTexture: loaded.svf,
        horizonTexture: loaded.horizon,
        ground: opts.ground,
        bounds,
        offset: opts.offset,
      }
    : undefined;

  mesh.material = createTerrainMaterial(splat);
  mesh.name = "terrain";
  // The terrain only RECEIVES shadows. If it also cast, the grazing sun makes
  // every triangle face self-shadow → the jagged "staircase"/triangle acne
  // along shadow edges. Buildings and trees sit on the ground and cast onto it;
  // the ground itself has nothing meaningful to cast, so this is pure win and
  // also lets the sun rig run a much smaller shadow bias (no contact light-leak).
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  // After every other opaque thing (they sort at 0, front to back): the
  // ground's fragment pass — the splat, the kerbs' and lawns' edges, the
  // markings, the sports lines — is the scene's dearest, and drawn last it
  // shades only what the buildings, trees and walls left uncovered (the
  // early depth test rejects the rest before the shader runs — not under
  // Modell's Ausschnitt, whose clipping is per fragment). Its tile sorted
  // by its origin before, often in front of the buildings it lies under.
  // (An Apple GPU removes hidden fragments itself; every other one does
  // not.) The price: what a hill hides is shaded before the hill covers
  // it — rarer than ground under houses and trees, and fogged far off.
  mesh.renderOrder = TERRAIN_RENDER_ORDER;

  // Water re-uses the terrain geometry, masked to the water class: siblings
  // of the mesh with its (dequantising) transform, so they come and go with
  // the tile.
  // With the class raster's water cells (`classes.water`) each sheet keeps
  // only the triangles its coverage can reach (lib/city/water-mask.ts); a
  // tile without water hangs none.
  const sheets =
    splat && mask !== null ? waterSheetsOf(mesh, extras, ground, grids) : null;
  const water =
    splat && sheets
      ? createWaterLayer(
          sheets.water,
          splat,
          opts.fogColor,
          extras.water,
          sheets.mist
        )
      : undefined;
  if (water) {
    for (const sheet of [water.mesh, water.mistMesh]) {
      sheet.position.copy(mesh.position);
      sheet.quaternion.copy(mesh.quaternion);
      sheet.scale.copy(mesh.scale);
      mesh.parent?.add(sheet);
    }
  }

  const gone = new AbortController();
  return {
    mesh,
    rasters: water ? [water.tint] : [],
    light: splat ? groundLightOf(splat) : undefined,
    detail: groundDetailOf({
      box,
      extras,
      far: startsFar,
      hold: opts.rasters,
      mesh,
      signal: gone.signal,
      splat,
    }),
    tile: extras.tileId,
    level: extras.level,
    tin: extras.tin !== undefined,
    vertexCount: mesh.geometry.getAttribute("position").count,
    bounds,
    minElevation: extras.minElevation,
    water,
    heightAt,
    heightBytes,
    dispose: () => {
      gone.abort();
      try {
        // Shares the tile's positions; only its own index (and normals) go —
        // not the site's (GridShare), which other tiles draw with.
        detachShared(mesh.geometry);
        if (sheets) {
          disposeGeometry(sheets.water);
          if (sheets.mist !== sheets.water) {
            disposeGeometry(sheets.mist);
          }
        }
        water?.dispose();
      } finally {
        // (the rasters and their shares whatever else failed: left held, they
        // stay on the GPU and the tile's other level weighs half for good)
        free();
      }
    },
  };
}
