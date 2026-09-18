import {
  ACESFilmicToneMapping,
  Box3,
  Color,
  Euler,
  Fog,
  Group,
  type Object3D,
  PCFShadowMap,
  PerspectiveCamera,
  Raycaster,
  Scene,
  Timer,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import { PointerLockControls } from "three/examples/jsm/controls/PointerLockControls.js";
import { fogRangeFor } from "@/lib/city/atmosphere";
import type { RoofColorLut } from "@/lib/city/building-tint";
import {
  epsgCodeFromReferenceSystem,
  FALLBACK_LAT_LNG,
  utmToLatLng,
} from "@/lib/city/crs";
import { epsgToWorld, worldToEpsg } from "@/lib/city/ground-clamp";
import { buildingFootprintPolys, type FootprintPoly } from "@/lib/city/minimap";
import { recenterOffset } from "@/lib/city/recenter";
import type { TerrainBounds } from "@/lib/city/terrain-geometry";
import { clampPitch, nextFov } from "@/lib/city/touch";
import type { CityJsonDocument } from "@/lib/city/types";
import { createCameraFlight } from "./camera-flight";
import {
  type CityLayer,
  countBuildings,
  createCityLayer,
  demolishObject,
  pickCityObjectId,
} from "./city-layer";
import { createCityCollider } from "./collision";
import { createFpsMovement, type MovementMode } from "./fps-movement";
import { createHeightFogUniforms } from "./height-fog";
import { createInsertedBuilding } from "./inserted-building";
import {
  createLampLights,
  type LampControl,
  type LampLights,
  loadLamps,
} from "./lamp-layer";
import { tickPocFrame } from "./poc-debug";
import { createPostStack, type FocusMode } from "./post-stack";
import { loadRail, type RailControl } from "./rail-layer";
import { createSunRig, type SunState } from "./sun-rig";
import {
  DEFAULT_MEADOW_NDVI,
  loadTerrain,
  type TerrainLayer,
} from "./terrain-layer";
import { disposeObject3D } from "./three-utils";
import { attachTouchControls } from "./touch-controls";
import { loadVegetation, type VegetationControl } from "./vegetation-layer";
import type { Viewpoint } from "./viewpoints";
import {
  applyCityStyle,
  type CityStyleId,
  createStyleResources,
  setCityTransparency,
} from "./visual-style";
import { loadWalls, type WallControl } from "./wall-layer";

const EYE_HEIGHT = 1.7;
/** Keys that mean "I'm driving" — pressing any of them aborts a scenic flight. */
const MOVEMENT_KEYS = new Set([
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "KeyF",
  "Space",
  "ShiftLeft",
  "ShiftRight",
]);
/**
 * Vertical FOV. 55° (~85° horizontal at 16:9) reads like a natural human
 * walking perspective; wider than ~60° starts to feel fisheye/distorted.
 */
const DEFAULT_FOV = 55;
/** rad per CSS px of touch drag — full phone-width swipe ≈ 90° */
const TOUCH_LOOK_SPEED = 0.004;
/** EPSG:25833 spot for the inserted building (mid-tile of 33412_5656). */
const DEFAULT_INSERT_AT = { x: 413_000, y: 5_657_000 };
const SKY_COLOR = 0x9f_b6_cc;
/** Default rendering style — the "context frame" ambition. */
// Clay is OPAQUE — ghost uses MeshPhysicalMaterial.transmission, which makes
// three re-render the whole scene into a transmission buffer every frame
// (≈ 2x cost). Default to the cheap opaque style; ghost stays a choice.
export const DEFAULT_CITY_STYLE: CityStyleId = "clay";
/** Default fog amount (0..1). Kept light — a gentle far haze, not a near wall. */
export const DEFAULT_ATMOSPHERE = 0.2;

export interface CityWalkStats {
  buildingCount: number;
  shadowsEnabled: boolean;
  terrainVertexCount: number;
}

/** Player pose for the minimap: EPSG position + compass heading. */
export interface PlayerPose {
  epsgX: number;
  epsgY: number;
  /** radians, 0 = north, clockwise positive (towards east) */
  heading: number;
}

/**
 * Full camera state for reproducible snapshots: enough to drop the camera back
 * exactly where it was. `pos` is the authoritative world position (Y-up);
 * `epsg` is the human-readable ground coordinate. Angles in degrees.
 */
export interface CameraState {
  epsg: { x: number; y: number };
  fov: number;
  /** 0 = north, clockwise positive (east) */
  headingDeg: number;
  mode: MovementMode;
  /** + = looking up, - = looking down */
  pitchDeg: number;
  pos: { x: number; y: number; z: number };
}

/** A neighbouring tile loaded for visual context (no collision/demolish). */
export interface TileSrc {
  /** optional baked bridge-deck GeoJSON (Basis-DLM + DGM/DOM1 heights) */
  bridgeSrc?: string;
  citySrc: string;
  demSrc: string;
  demTfwSrc?: string;
  /** optional OSM street-lamp GeoJSON (ODbL); absent/404 = no lamps */
  lampsSrc?: string;
  landcoverSrc?: string;
  /** optional OSM station-platform GeoJSON (ODbL) */
  platformSrc?: string;
  /** optional baked dissolved ballast-area GeoJSON (Basis-DLM ver03_f) */
  railareaSrc?: string;
  /** optional baked railway-track GeoJSON (Basis-DLM ver03_l, heavy rail) */
  railSrc?: string;
  vegetationSrc?: string;
}

export interface CityWalkOptions {
  /** optional baked bridge-deck GeoJSON for the primary tile */
  bridgeSrc?: string;
  citySrc: string;
  container: HTMLElement;
  demSrc: string;
  demTfwSrc?: string;
  /** neighbouring tiles rendered around the primary one for context */
  extraTiles?: TileSrc[];
  initialDate: Date;
  insertAt?: { x: number; y: number };
  insertedModelUrl?: string;
  /** optional OSM street-lamp GeoJSON (ODbL) for the primary tile */
  lampsSrc?: string;
  /** optional ATKIS land-cover splatmap (PNG) for per-surface terrain tinting */
  landcoverSrc?: string;
  /** throttled (~2 Hz) smoothed FPS, decoupled from the heavier stats emit */
  onFps?: (fps: number) => void;
  onModeChange?: (mode: MovementMode) => void;
  /** throttled (~10 Hz) player pose updates for the minimap */
  onPose?: (pose: PlayerPose) => void;
  onProgress?: (message: string) => void;
  onStats?: (stats: CityWalkStats) => void;
  /** optional OSM station-platform GeoJSON (ODbL) for the primary tile */
  platformSrc?: string;
  /** optional baked dissolved ballast-area GeoJSON for the primary tile */
  railareaSrc?: string;
  /** optional baked railway-track GeoJSON for the primary tile */
  railSrc?: string;
  /**
   * Aborts startup mid-load (React StrictMode mounts effects twice in dev;
   * without this the doomed first instance would finish loading 19 MB of
   * tile data and leave a second canvas around until then).
   */
  signal?: AbortSignal;
  /** optional ATKIS veg04 GeoJSON for hedges + tree rows */
  vegetationSrc?: string;
}

export interface CityWalkHandle {
  /** Restores a camera pose captured by getCameraState (snapshot replay). */
  applyCameraState: (state: CameraState) => void;
  demolishAtCrosshair: () => void;
  dispose: () => void;
  /** Opt-in pointer-lock mouse-look (desktop); Esc exits natively. */
  enterImmersive: () => void;
  /**
   * Teleports the camera (world/Y-up coords) — used by tests and QA.
   * Switches to fly mode so the ground clamp doesn't drag the camera down.
   */
  flyTo: (position: Xyz, lookAt: Xyz) => void;
  /**
   * Smoothly glides the camera to a curated scenic Viewpoint (animated, unlike
   * the instant applyCameraState), landing in the viewpoint's movement mode.
   */
  flyToViewpoint: (viewpoint: Viewpoint) => void;
  /** Captures the full camera pose for a reproducible snapshot. */
  getCameraState: () => CameraState;
  /** Live DoF focus state + last crosshair raycast hit (QA/diagnostics). */
  getFocusDebug: () => {
    bokehScale: number;
    focusDistance: number;
    focusRange: number;
    hitDist: number | null;
    hitName: string | null;
  };
  /** current Building footprint polygons (EPSG) — shrinks when demolishing */
  getFootprints: () => FootprintPoly[];
  getMovementMode: () => MovementMode;
  getPose: () => PlayerPose;
  /**
   * GPU counters for perf work. `programs` is the live shader-program count;
   * `calls`/`triangles` reflect only the LAST render() pass, so with the
   * post-processing composer active they report the final fullscreen pass, not
   * the scene total (disable post-processing to read true scene counts).
   */
  getRenderInfo: () => { calls: number; triangles: number; programs: number };
  insertBuilding: () => Promise<void>;
  /** per-tile land-cover class PNGs + their EPSG bounds, for the minimap */
  landcoverTiles: { bounds: TerrainBounds; src: string }[];
  /** recenter offset, lets callers map EPSG coords -> world coords */
  offset: { cx: number; cy: number };
  /** fog amount 0..1 (0 = clear day, 1 = thick painterly haze) */
  setAtmosphere: (amount: number) => void;
  /** building storey contour-line (Höhenlinien) strength 0..1 */
  setBuildingBands: (strength: number) => void;
  /** warm dusk interior glow (Abendlicht) on commercial/public buildings 0..1 */
  setBuildingDuskGlow: (strength: number) => void;
  /** eave cornice-stroke (Traufkante) strength 0..1 */
  setBuildingEave: (strength: number) => void;
  /** building ground-contact darkening (Boden-Verlauf) strength 0..1 */
  setBuildingGroundShade: (strength: number) => void;
  /** building Fresnel rim (Streiflicht) strength 0..1 */
  setBuildingRim: (strength: number) => void;
  /** roof colour mix (Dachfarbe) 0..1; real DOP colour else terracotta/slate */
  setBuildingRoofTint: (strength: number) => void;
  /** roof vividness (Dachsättigung) 0..1; hue-preserving chroma boost on DOP colour */
  setBuildingRoofVibrance: (strength: number) => void;
  /** per-building roughness jitter (Materialstreuung) 0..1 */
  setBuildingRoughness: (strength: number) => void;
  /** per-building clay tint (Farbvariation) mix 0..1; 0 = flat clay */
  setBuildingTint: (strength: number) => void;
  /** transparency 0..1 of the ACTIVE style (ghost: frosted, clay: alpha) */
  setBuildingTransparency: (transparency: number) => void;
  /** soft contact-shadow (SSAO) strength 0..1; 0 disables the pass */
  setContactShadows: (strength: number) => void;
  /** warm-near/cool-far color grading intensity 0..1 */
  setDepthGrading: (intensity: number) => void;
  /** photographic depth of field with crosshair autofocus */
  setDepthOfField: (enabled: boolean) => void;
  /** manual focus distance (m), used when focus mode is "manual" */
  setFocusDistance: (meters: number) => void;
  /** depth-of-field focus: "auto" (crosshair) or "manual" (fixed distance) */
  setFocusMode: (mode: FocusMode) => void;
  /** valley height-fog (Talnebel) strength 0..1; pools haze in low ground */
  setHeightFog: (strength: number) => void;
  /** meadow NDVI tint (Wiesenfärbung) 0..1; lush-green↔dry on farmland/meadow */
  setMeadowNdvi: (strength: number) => void;
  /** analog joystick input: x = strafe right, y = forward, both [-1, 1] */
  setMoveInput: (x: number, y: number) => void;
  setMovementMode: (mode: MovementMode) => void;
  /** paper-grain overlay intensity 0..1 */
  setPaperGrain: (intensity: number) => void;
  setStyle: (style: CityStyleId) => void;
  setSun: (date: Date) => SunState;
  /** (B) sway-coupled crown brightness (Windhelligkeit) strength 0..1 */
  setTreeLeafBright: (strength: number) => void;
  /** (A) wind-gust leaf-flutter colour shimmer (Blattflimmern) strength 0..1 */
  setTreeLeafFlutter: (strength: number) => void;
  /** rich multi-tuft crown near the camera (LOD); off = cheap crown everywhere */
  setTreeMultiTuft: (enabled: boolean) => void;
  /** backlit canopy shimmer strength 0..1 */
  setTreeShimmer: (strength: number) => void;
  /** backlit (shadow-gated) canopy translucency strength 0..1 on near/large trees */
  setTreeTranslucency: (strength: number) => void;
  /** river-mist (Flussnebel) strength 0..1 over the water surface */
  setWaterMist: (strength: number) => void;
  /** Drops the player at EPSG coordinates, standing on the terrain. */
  teleportTo: (epsgX: number, epsgY: number) => void;
  /** DGM extent in EPSG coordinates — the minimap frame */
  terrainBounds: TerrainBounds;
}

interface Xyz {
  x: number;
  y: number;
  z: number;
}

function createRenderer(container: HTMLElement): WebGLRenderer {
  // No MSAA: everything renders through the EffectComposer and SMAA carries
  // the AA (see post-stack.ts); a multisampled default framebuffer would only
  // be resolved for a full-screen quad.
  const renderer = new WebGLRenderer({
    antialias: false,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  // The ghost style's frosted transmission renders the opaque scene a second
  // time per frame; at roughness 0.8 it samples a blurred mip anyway, so a
  // half-resolution transmission buffer is visually free.
  renderer.transmissionResolutionScale = 0.5;
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.shadowMap.enabled = true;
  // three 0.184 deprecated PCFSoftShadowMap (silently falls back to hard PCF),
  // and VSM paints a grid on lit faces here, so PCFShadowMap is the cleanest
  // option: tight contact + artefact-free surfaces. Its only weakness is the
  // texel staircase on shadow edges at a grazing sun, which a fine-texel
  // camera-following frustum (see sun-rig) keeps small.
  renderer.shadowMap.type = PCFShadowMap;
  // The on-demand shadow gate lives on the LIGHT (`sun.shadow.autoUpdate` in
  // sun-rig.ts), not here. three has both gates — WebGLShadowMap.render returns
  // early on `shadowMap.autoUpdate === false && !needsUpdate`, before it ever
  // looks at the lights — and the light-level one is the one that fits this
  // scene: the sun is the only shadow caster (lamp lights are castShadow:false)
  // and the rig re-renders the map from inside the render loop whenever its
  // camera-following frustum moves. Closing the renderer-level gate as well
  // would swallow those per-frame invalidations and freeze the shadows while
  // walking. The saving is identical either way — the ~640k-triangle depth pass
  // is what gets skipped.
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.domElement.style.display = "block";
  // Touch gestures (look/pinch/double-tap) need the browser to keep its
  // hands off scrolling and double-tap zoom on the canvas.
  renderer.domElement.style.touchAction = "none";
  container.appendChild(renderer.domElement);
  return renderer;
}

async function fetchCityJson(
  url: string,
  signal?: AbortSignal
): Promise<CityJsonDocument> {
  const res = await fetch(url, { signal });
  if (!res.ok) {
    throw new Error(`Failed to fetch CityJSON (${url}): HTTP ${res.status}`);
  }
  const data = (await res.json()) as CityJsonDocument;
  const epsg = epsgCodeFromReferenceSystem(data.metadata?.referenceSystem);
  if (epsg === null || utmToLatLng(epsg, 0, 0) === null) {
    throw new Error(
      `Unsupported CityJSON CRS "${data.metadata?.referenceSystem}" — ` +
        "expected ETRS89/UTM (EPSG:25832 or 25833). Reproject the data, " +
        "e.g. cjio in.city.json reproject 25833 save out.city.json."
    );
  }
  return data;
}

/**
 * Optional per-building roof colours baked from the DOP orthophoto
 * (`roofcolor_<tile>.json`, derived from the tile's `lod2_<tile>.city.json`
 * URL). Absent/404 → undefined, and the roof falls back to the synthesized
 * terracotta/slate palette (graceful degradation — see docs/portability.md).
 */
async function fetchRoofLut(
  citySrc: string,
  signal?: AbortSignal
): Promise<RoofColorLut | undefined> {
  const url = citySrc
    .replace("lod2_", "roofcolor_")
    .replace(".city.json", ".json");
  if (url === citySrc) {
    return;
  }
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) {
      return;
    }
    const doc = (await res.json()) as { roofs?: RoofColorLut };
    return doc.roofs;
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw err;
    }
    return;
  }
}

/**
 * Cheap CRS/alignment guard: the city's recenter point must fall inside the
 * DGM extent. If the two datasets were in different CRSs they would be
 * hundreds of kilometres apart — fail loudly instead of misplacing terrain.
 */
function assertCityOnTerrain(
  offset: { cx: number; cy: number },
  terrain: TerrainLayer
): void {
  const [minX, minY, maxX, maxY] = terrain.bounds;
  const inside =
    offset.cx >= minX &&
    offset.cx <= maxX &&
    offset.cy >= minY &&
    offset.cy <= maxY;
  if (!inside) {
    throw new Error(
      `City center (${offset.cx.toFixed(0)}, ${offset.cy.toFixed(0)}) lies ` +
        `outside the DGM extent [${terrain.bounds.join(", ")}] — likely a ` +
        "CRS mismatch between CityJSON and GeoTIFF. Reproject with " +
        "gdalwarp -t_srs EPSG:25833."
    );
  }
}

/** Reprojects the recenter point (tile center) to WGS84 for SunCalc. */
function tileLatLng(
  cityData: CityJsonDocument,
  offset: { cx: number; cy: number }
): { lat: number; lng: number } {
  const epsg = epsgCodeFromReferenceSystem(cityData.metadata?.referenceSystem);
  if (epsg === null) {
    return FALLBACK_LAT_LNG;
  }
  return utmToLatLng(epsg, offset.cx, offset.cy) ?? FALLBACK_LAT_LNG;
}

export async function createCityWalkApp(
  opts: CityWalkOptions
): Promise<CityWalkHandle> {
  const renderer = createRenderer(opts.container);
  const scene = new Scene();
  scene.background = new Color(SKY_COLOR);
  const fogRange = fogRangeFor(DEFAULT_ATMOSPHERE);
  scene.fog = new Fog(SKY_COLOR, fogRange.near, fogRange.far);

  try {
    return await bootApp(opts, renderer, scene);
  } catch (err) {
    // Centralized teardown: covers both abort (StrictMode remount) and real
    // load failures — otherwise the dead canvas would linger in the DOM.
    disposeObject3D(scene);
    renderer.dispose();
    renderer.domElement.remove();
    throw err;
  }
}

async function bootApp(
  opts: CityWalkOptions,
  renderer: WebGLRenderer,
  scene: Scene
): Promise<CityWalkHandle> {
  const { container } = opts;
  let disposed = false;

  const camera = new PerspectiveCamera(
    DEFAULT_FOV,
    container.clientWidth / Math.max(container.clientHeight, 1),
    0.3,
    6000
  );
  scene.add(camera);

  // CityJSON/DGM are Z-up (EPSG:25833); rotate the parent group -90° about X
  // so data Z (elevation) becomes three.js Y (up) and FPS controls just work.
  const world = new Group();
  world.rotation.x = -Math.PI / 2;
  scene.add(world);

  // Abort checkpoint after each async step (fetches abort via the signal
  // themselves; parsing/meshing in between does not).
  const ensureAlive = () => {
    if (opts.signal?.aborted) {
      throw new DOMException("CityWalk startup aborted", "AbortError");
    }
  };

  opts.onProgress?.("Loading CityJSON tile…");
  const cityData = await fetchCityJson(opts.citySrc, opts.signal);
  const roofLut = await fetchRoofLut(opts.citySrc, opts.signal);
  ensureAlive();

  opts.onProgress?.("Parsing buildings…");
  let cityLayer: CityLayer = createCityLayer(cityData, world, null, roofLut);
  const offset = recenterOffset(cityLayer.matrix);

  // Shared world sun direction (surface→sun), kept in sync by the sun rig and
  // read by the crown shimmer. The vegetation builds before the sun rig exists,
  // so this vector must already exist to be captured by reference.
  const sunDirection = new Vector3(0, 1, 0);
  // Shared valley height-fog uniforms (by reference): folded into every
  // fog-receiving material below; the start (river/DGM minimum) is set once the
  // world bounds are known, the strength is HUD-tunable — both without recompile.
  const heightFog = createHeightFogUniforms();
  // Shared meadow-NDVI tint strength (by reference): bound into every tile's
  // terrain material so the HUD slider retunes the Wiesenfärbung live.
  const meadowNdvi = { value: DEFAULT_MEADOW_NDVI };
  // Per-tile vegetation handles, kept so the loop can drive crown LOD and the
  // HUD can retune shimmer / multi-tuft.
  const vegControls: VegetationControl[] = [];
  // Per-tile lamp visuals; the real (shared, fixed) point-light pool is built
  // once after all tiles load so NUM_POINT_LIGHTS stays constant.
  const lampControls: LampControl[] = [];
  let lampLights: LampLights | null = null;
  // Per-tile rail/bridge/platform geometry, kept only so dispose can free it.
  const railControls: RailControl[] = [];
  const wallControls: WallControl[] = [];

  // Loads one tile's terrain (+ water + vegetation), all in the SHARED frame.
  const loadTileScene = async (
    tile: TileSrc,
    targetSize?: number
  ): Promise<TerrainLayer> => {
    const t = await loadTerrain({
      url: tile.demSrc,
      tfwUrl: tile.demTfwSrc,
      landcoverUrl: tile.landcoverSrc,
      // Retaining/city walls are burned into THIS tile's heightfield as steps so
      // the ground breaks at the wall instead of the DGM's smooth bank.
      wallLinesUrl: tile.landcoverSrc
        ?.replace("landcover_", "walls_")
        .replace(".png", ".geojson"),
      offset,
      targetSize,
      signal: opts.signal,
      sunDirection,
      heightFog,
      meadowNdvi,
    });
    world.add(t.mesh);
    if (t.water) {
      world.add(t.water.mesh);
      // River mist reuses the Z-up terrain geometry, so it lives on `world` too.
      world.add(t.water.mistMesh);
    }
    if (tile.vegetationSrc) {
      const vegetation = await loadVegetation(tile.vegetationSrc, {
        offset,
        heightAt: t.heightAt,
        canopyUrl: tile.vegetationSrc.replace("vegrows_", "canopy_"),
        ndviUrl: tile.vegetationSrc
          .replace("vegrows_", "ndvi_")
          .replace(".geojson", ".png"),
        bounds: t.bounds,
        signal: opts.signal,
        sunDirection,
        heightFog,
      });
      // Y-up scene frame (like the inserted building), NOT the Z-up `world`.
      scene.add(vegetation.group);
      vegControls.push(vegetation);
    }
    if (tile.lampsSrc) {
      const lamps = await loadLamps(tile.lampsSrc, {
        offset,
        heightAt: t.heightAt,
        signal: opts.signal,
      });
      // Lamps are authored Y-up (like vegetation), so they go on `scene`.
      scene.add(lamps.group);
      lampControls.push(lamps);
    }
    // NB: rails/bridges/ballast are NOT loaded here — they are built ONCE for the
    // whole tile block below, on the cross-tile heightAt, so tracks run
    // continuously across tile seams instead of truncating at each tile edge.
    return t;
  };

  opts.onProgress?.("Loading DGM terrain…");
  const terrain = await loadTileScene({
    citySrc: opts.citySrc,
    demSrc: opts.demSrc,
    demTfwSrc: opts.demTfwSrc,
    landcoverSrc: opts.landcoverSrc,
    vegetationSrc: opts.vegetationSrc,
    lampsSrc: opts.lampsSrc,
  });
  ensureAlive();
  assertCityOnTerrain(offset, terrain);

  // Neighbouring tiles: buildings share the primary recenter matrix so they
  // line up; terrain/water/trees load the same way. Collision and demolish
  // stay on the primary tile (these are passive visual context).
  const terrains: TerrainLayer[] = [terrain];
  const extraCities: CityLayer[] = [];
  for (const tile of opts.extraTiles ?? []) {
    opts.onProgress?.("Loading neighbouring tiles…");
    const data = await fetchCityJson(tile.citySrc, opts.signal);
    const tileRoofLut = await fetchRoofLut(tile.citySrc, opts.signal);
    ensureAlive();
    extraCities.push(
      createCityLayer(data, world, cityLayer.matrix, tileRoofLut)
    );
    // Neighbours are background — half-resolution terrain (~4 m) is plenty.
    terrains.push(await loadTileScene(tile, 512));
    ensureAlive();
  }

  // Single fixed pool of real point lights for the nearest lamps across ALL
  // tiles. Built ONCE here (before the first render) so NUM_POINT_LIGHTS is
  // baked into every lit program a single time — no per-tile recompile churn.
  const lampHeads = lampControls.flatMap((l) => l.headPositions);
  if (lampHeads.length > 0) {
    lampLights = createLampLights(lampHeads);
    for (const light of lampLights.lights) {
      scene.add(light);
    }
  }

  // First terrain that covers (x, y) wins; null only when off every tile.
  const heightAt = (x: number, y: number): number | null => {
    for (const t of terrains) {
      const h = t.heightAt(x, y);
      if (h !== null) {
        return h;
      }
    }
    return null;
  };

  // Rails / bridges / ballast yards / platforms — built ONCE for the whole tile
  // block on the cross-tile `heightAt`, so a track crossing a tile seam samples
  // the neighbour's heightfield instead of being dropped at the edge. Merges all
  // tiles' baked GeoJSONs; non-fatal (missing files yield nothing).
  const railTiles = [
    {
      railSrc: opts.railSrc,
      bridgeSrc: opts.bridgeSrc,
      platformSrc: opts.platformSrc,
      railareaSrc: opts.railareaSrc,
    },
    ...(opts.extraTiles ?? []),
  ];
  const railUrls = railTiles
    .map((t) => t.railSrc)
    .filter((u) => u !== undefined);
  if (railUrls.length > 0) {
    opts.onProgress?.("Building railway & bridges…");
    const rail = await loadRail({
      offset,
      heightAt,
      railUrls,
      bridgeUrls: railTiles
        .map((t) => t.bridgeSrc)
        .filter((u) => u !== undefined),
      railareaUrls: railTiles
        .map((t) => t.railareaSrc)
        .filter((u) => u !== undefined),
      platformUrls: railTiles
        .map((t) => t.platformSrc)
        .filter((u) => u !== undefined),
      signal: opts.signal,
      heightFog,
    });
    scene.add(rail.group);
    railControls.push(rail);
    ensureAlive();
  }

  // OSM retaining/city walls (e.g. the Brühlsche Terrasse) — the monumental
  // walls the elevation data smooths away. Built ONCE for the block on the
  // cross-tile heightAt; the URL is derived from each tile's land-cover URL.
  const wallUrls = [
    opts.landcoverSrc,
    ...(opts.extraTiles ?? []).map((t) => t.landcoverSrc),
  ]
    .filter((u): u is string => u !== undefined)
    .map((u) => u.replace("landcover_", "walls_").replace(".png", ".geojson"));
  if (wallUrls.length > 0) {
    opts.onProgress?.("Building walls…");
    const walls = await loadWalls({
      offset,
      heightAt,
      wallUrls,
      signal: opts.signal,
      heightFog,
    });
    scene.add(walls.group);
    wallControls.push(walls);
    ensureAlive();
  }

  const terrainMeshes = terrains.map((t) => t.mesh);
  const unionBounds: TerrainBounds = terrains.reduce<TerrainBounds>(
    (acc, t) => [
      Math.min(acc[0], t.bounds[0]),
      Math.min(acc[1], t.bounds[1]),
      Math.max(acc[2], t.bounds[2]),
      Math.max(acc[3], t.bounds[3]),
    ],
    [
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ]
  );

  // Per-tile land-cover PNGs + bounds so the minimap can place each correctly.
  const landcoverTiles: { bounds: TerrainBounds; src: string }[] = [];
  if (opts.landcoverSrc) {
    landcoverTiles.push({ src: opts.landcoverSrc, bounds: terrain.bounds });
  }
  (opts.extraTiles ?? []).forEach((t, i) => {
    if (t.landcoverSrc) {
      landcoverTiles.push({
        src: t.landcoverSrc,
        bounds: terrains[i + 1].bounds,
      });
    }
  });

  opts.onProgress?.("Indexing terrain…");
  // BVH for the 10 Hz autofocus ray and for double-tap travel. Building it
  // once costs ~0.2 s per tile; without it every raycast brute-forces ~522k
  // triangles (~50 ms each on desktop) — and the autofocus ray walks the whole
  // 2x2 block, so every tile needs one, not just the primary.
  for (const mesh of terrainMeshes) {
    mesh.geometry.computeBoundsTree();
  }

  world.updateMatrixWorld(true);
  const worldBounds = new Box3().setFromObject(world);
  // Seed the valley height-fog floor from the lowest VALID terrain elevation
  // across all tiles (the Elbe surface). NB: worldBounds.min.y is unusable here
  // — NoData terrain vertices are parked at elevation 0, so it reports ~0, which
  // would push the whole fog band below the real terrain and hide the effect.
  // Exclude all-NoData tiles: fillGrid reports minElevation 0 for them (no valid
  // sample), which would otherwise drag the fog floor down to sea level and hide
  // the valley haze. The primary spawn tile always has real elevation.
  const floors = terrains
    .map((t) => t.minElevation)
    .filter((e) => Number.isFinite(e) && e > 0);
  const valleyFloor = floors.length ? Math.min(...floors) : worldBounds.min.y;
  heightFog.uFogHeightStart.value = valleyFloor + 1;
  const sunRig = createSunRig(
    scene,
    worldBounds,
    tileLatLng(cityData, offset),
    sunDirection
  );

  // One scalar (nightFactor ∈ [0,1]) ignites every lamp at dusk: emissive heads,
  // glow sprites, ground pools and the shared real-light pool, all in lockstep.
  // It also gates the clay dusk-glow — clayNight is a shared uniform ref created
  // here (before styleResources exists) so setSun can drive it by reference.
  const clayNight = { value: 0 };
  /**
   * Forces one shadow-map re-render. The map is otherwise only redrawn when the
   * sun or the frustum moves, so **every new scene object and every material
   * change that alters the depth pass has to call this** — a missing call shows
   * up as a stale shadow (a demolished building still casting, a new one not),
   * never as a crash.
   */
  const invalidateShadows = () => {
    sunRig.invalidateShadow();
  };

  const setSun = (date: Date): SunState => {
    const state = sunRig.update(date);
    for (const lamp of lampControls) {
      lamp.setNightFactor(state.nightFactor);
    }
    lampLights?.setNightFactor(state.nightFactor);
    clayNight.value = state.nightFactor;
    invalidateShadows();
    return state;
  };
  setSun(opts.initialDate);

  opts.onProgress?.("Preparing render styles…");
  const styleResources = createStyleResources(heightFog, clayNight);
  let currentStyle: CityStyleId = DEFAULT_CITY_STYLE;
  // The neighbour tiles are as visible as the primary one — restyle ALL of them
  // together, or a style switch leaves 3/4 of the skyline on the old material.
  const restyleCities = () => {
    applyCityStyle(cityLayer.group, currentStyle, styleResources);
    for (const c of extraCities) {
      applyCityStyle(c.group, currentStyle, styleResources);
    }
  };
  restyleCities();
  const postStack = createPostStack(renderer, scene, camera);

  // Spawn at the recenter point (= world origin), standing on the terrain.
  const groundY = heightAt(offset.cx, offset.cy) ?? worldBounds.min.y;
  camera.position.set(0, groundY + EYE_HEIGHT, 0);
  camera.lookAt(0, groundY + EYE_HEIGHT, -100);

  const controls = new PointerLockControls(camera, renderer.domElement);
  const groundHeight = (x: number, z: number) => {
    const epsg = worldToEpsg(x, z, offset);
    return heightAt(epsg.x, epsg.y);
  };
  // Wall collision against the CURRENT city group (demolish swaps it).
  const collider = createCityCollider(() => cityLayer.group);
  const movement = createFpsMovement(camera, {
    groundHeight,
    eyeHeight: EYE_HEIGHT,
    resolveStep: collider.resolveStep,
  });

  const setMovementMode = (mode: MovementMode) => {
    movement.setMode(mode);
    if (mode === "walk") {
      movement.snapToGround();
    }
    opts.onModeChange?.(mode);
  };

  // Animated "fly to a scenic vantage" tween (the HUD viewpoint buttons). While
  // it owns the camera the loop suspends player input; `pendingMode` is the
  // mode to settle into once the glide lands (applied on the frame it ends).
  const cameraFlight = createCameraFlight(camera);
  let pendingMode: MovementMode | null = null;
  const flyToViewpoint = (viewpoint: Viewpoint) => {
    const ground = heightAt(viewpoint.epsg.x, viewpoint.epsg.y);
    const w = epsgToWorld(viewpoint.epsg.x, viewpoint.epsg.y, offset);
    // Fly during the glide so the ground clamp can't fight the vertical arc;
    // pendingMode restores walk (and snaps to the ground) once it settles.
    setMovementMode("fly");
    cameraFlight.start({
      pos: {
        x: w.x,
        y: (ground ?? worldBounds.min.y) + viewpoint.aboveGround,
        z: w.z,
      },
      headingDeg: viewpoint.headingDeg,
      pitchDeg: viewpoint.pitchDeg,
      fov: viewpoint.fov,
    });
    pendingMode = viewpoint.mode;
  };
  const cancelFlight = () => {
    cameraFlight.cancel();
    pendingMode = null;
  };

  const heading = new Vector3();
  const getPose = (): PlayerPose => {
    camera.getWorldDirection(heading);
    const epsg = worldToEpsg(camera.position.x, camera.position.z, offset);
    return {
      epsgX: epsg.x,
      epsgY: epsg.y,
      // world: north = -Z, east = +X -> compass heading clockwise from north
      heading: Math.atan2(heading.x, -heading.z),
    };
  };

  const RAD2DEG = 180 / Math.PI;
  const DEG2RAD = Math.PI / 180;
  const getCameraState = (): CameraState => {
    camera.getWorldDirection(heading);
    const epsg = worldToEpsg(camera.position.x, camera.position.z, offset);
    return {
      mode: movement.getMode(),
      pos: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
      epsg: { x: epsg.x, y: epsg.y },
      headingDeg: Math.atan2(heading.x, -heading.z) * RAD2DEG,
      pitchDeg: Math.asin(Math.min(Math.max(heading.y, -1), 1)) * RAD2DEG,
      fov: camera.fov,
    };
  };

  const applyCameraState = (s: CameraState) => {
    // Fly first so the ground clamp doesn't yank an aerial pose down to eye
    // height before the frame even renders.
    setMovementMode(s.mode);
    camera.position.set(s.pos.x, s.pos.y, s.pos.z);
    const h = s.headingDeg * DEG2RAD;
    const p = s.pitchDeg * DEG2RAD;
    // heading 0 = north = -Z, clockwise; pitch tilts towards +Y.
    const cp = Math.cos(p);
    camera.lookAt(
      camera.position.x + Math.sin(h) * cp,
      camera.position.y + Math.sin(p),
      camera.position.z - Math.cos(h) * cp
    );
    if (s.fov > 0) {
      camera.fov = s.fov;
      camera.updateProjectionMatrix();
    }
    camera.updateMatrixWorld(true);
    opts.onPose?.(getPose());
  };

  const teleportTo = (epsgX: number, epsgY: number) => {
    const pos = epsgToWorld(epsgX, epsgY, offset);
    const ground = heightAt(epsgX, epsgY);
    camera.position.set(
      pos.x,
      (ground ?? worldBounds.min.y) + EYE_HEIGHT,
      pos.z
    );
    // Level the view (keep the compass heading, drop pitch/roll) — after
    // an aerial pose the player would otherwise stare at the ground.
    const level = new Euler(0, 0, 0, "YXZ");
    level.setFromQuaternion(camera.quaternion);
    level.x = 0;
    level.z = 0;
    camera.quaternion.setFromEuler(level);
    camera.updateMatrixWorld(true);
    opts.onPose?.(getPose());
  };

  // --- street-view-style touch controls (mobile) ------------------------
  const lookEuler = new Euler(0, 0, 0, "YXZ");
  let pinchStartFov = camera.fov;
  const tapRaycaster = new Raycaster();
  tapRaycaster.firstHitOnly = true;
  const detachTouch = attachTouchControls(renderer.domElement, {
    onLook: (dx, dy) => {
      lookEuler.setFromQuaternion(camera.quaternion);
      // "Grab the world": dragging right rotates the view left.
      lookEuler.y += dx * TOUCH_LOOK_SPEED;
      lookEuler.x = clampPitch(lookEuler.x + dy * TOUCH_LOOK_SPEED);
      lookEuler.z = 0;
      camera.quaternion.setFromEuler(lookEuler);
    },
    onPinchStart: () => {
      pinchStartFov = camera.fov;
    },
    onPinch: (ratio) => {
      camera.fov = nextFov(pinchStartFov, ratio);
      camera.updateProjectionMatrix();
    },
    onDoubleTap: (ndcX, ndcY) => {
      // Travel to the tapped spot on the terrain.
      tapRaycaster.setFromCamera(new Vector2(ndcX, ndcY), camera);
      const hit = tapRaycaster.intersectObjects(terrainMeshes, false)[0];
      if (hit) {
        const epsg = worldToEpsg(hit.point.x, hit.point.z, offset);
        teleportTo(epsg.x, epsg.y);
      }
    },
  });

  let fps = 0;
  const emitStats = () => {
    opts.onStats?.({
      buildingCount: countBuildings(cityLayer.data),
      terrainVertexCount: terrain.vertexCount,
      shadowsEnabled: renderer.shadowMap.enabled,
    });
  };

  const demolishAtCrosshair = () => {
    const objectId = pickCityObjectId(camera, cityLayer);
    if (!objectId) {
      return;
    }
    cityLayer = demolishObject(cityLayer, world, objectId);
    // The reload produces bare loader meshes — re-dress them.
    applyCityStyle(cityLayer.group, currentStyle, styleResources);
    invalidateShadows();
    emitStats();
  };

  let inserted: Object3D | null = null;
  const insertBuilding = async () => {
    const at = opts.insertAt ?? DEFAULT_INSERT_AT;
    const obj = await createInsertedBuilding(opts.insertedModelUrl);
    if (disposed) {
      return;
    }
    if (inserted) {
      scene.remove(inserted);
      disposeObject3D(inserted);
    }
    const ground = heightAt(at.x, at.y) ?? worldBounds.min.y;
    // Data frame (x, y, z-up) -> scene frame (x, z, -y), recentered.
    const w = epsgToWorld(at.x, at.y, offset);
    obj.position.set(w.x, ground, w.z);
    scene.add(obj);
    invalidateShadows();
    inserted = obj;
  };

  const insertBuildingNow = () => {
    insertBuilding().catch(() => {
      // glTF load failure is non-fatal for the POC; the box fallback can't fail
    });
  };

  const onKeyDown = (e: KeyboardEvent) => {
    movement.press(e.code);
    // Any movement/mode key is the player taking the wheel back — abandon any
    // scenic flight in progress so it doesn't fight or override their control.
    if (MOVEMENT_KEYS.has(e.code)) {
      cancelFlight();
    }
    if (e.code === "KeyR") {
      demolishAtCrosshair();
    }
    if (e.code === "KeyB") {
      insertBuildingNow();
    }
    if (e.code === "KeyF") {
      setMovementMode(movement.getMode() === "walk" ? "fly" : "walk");
    }
  };
  const onKeyUp = (e: KeyboardEvent) => movement.release(e.code);
  // Mouse wheel zooms like pinch (FOV); immersive pointer lock is opt-in
  // via the handle, so plain clicks/drags stay free for grab-look.
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    camera.fov = nextFov(camera.fov, e.deltaY < 0 ? 1.05 : 1 / 1.05);
    camera.updateProjectionMatrix();
  };
  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("keyup", onKeyUp);
  renderer.domElement.addEventListener("wheel", onWheel, { passive: false });

  const resizeObserver = new ResizeObserver(() => {
    camera.aspect = container.clientWidth / Math.max(container.clientHeight, 1);
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
    postStack.setSize(container.clientWidth, container.clientHeight);
  });
  resizeObserver.observe(container);

  // Crosshair autofocus for the photographic DoF (throttled like the pose).
  const focusRaycaster = new Raycaster();
  focusRaycaster.firstHitOnly = true;
  focusRaycaster.far = 6000;
  // Stable focus-raycast context: neighbour-tile buildings + every tile's
  // terrain. WITHOUT the neighbour buildings, the crosshair on a distant
  // (neighbour-tile) silhouette hits nothing and autofocus falls back — so the
  // far city blurred. The primary cityLayer.group is prepended fresh each call
  // because demolish swaps it.
  const focusContext = [...extraCities.map((c) => c.group), ...terrainMeshes];
  const focusCrosshair = new Vector2(0, 0);
  let lastFocusHit: { dist: number; name: string } | null = null;
  const updateFocus = () => {
    focusRaycaster.setFromCamera(focusCrosshair, camera);
    const hit = focusRaycaster.intersectObjects(
      [cityLayer.group, ...focusContext],
      true
    )[0];
    lastFocusHit = hit
      ? {
          dist: camera.position.distanceTo(hit.point),
          name: hit.object.name || hit.object.type,
        }
      : null;
    postStack.setFocusTarget(hit?.point ?? null);
  };

  // A scenic flight, while active, owns the camera — suspend player movement so
  // input can't tug against the tween; settle into its mode when it lands.
  const stepMovement = (dt: number) => {
    if (cameraFlight.update(dt)) {
      return;
    }
    if (pendingMode) {
      setMovementMode(pendingMode);
      pendingMode = null;
    }
    movement.update(dt);
  };

  const timer = new Timer();
  let tickDue = 0;
  let fpsDue = 0;
  renderer.setAnimationLoop((time) => {
    timer.update(time);
    const dt = Math.min(timer.getDelta(), 0.05);
    const elapsed = timer.getElapsed();
    if (dt > 0) {
      fps = fps === 0 ? 1 / dt : fps * 0.9 + (1 / dt) * 0.1;
    }
    stepMovement(dt);
    // Advance every tile's water ripple/glitter and feed it the current
    // palette sky colour (Fresnel sky-tint stays in lockstep with the sun).
    if (scene.fog instanceof Fog) {
      for (const t of terrains) {
        t.water?.update(elapsed, scene.fog.color);
      }
    }
    // Keep the (small, sharp) shadow frustum centered on the player.
    sunRig.follow(camera.position);
    // Drift the sky dome's clouds (one uniform write/frame).
    sunRig.setTime(elapsed);
    // Repoint the shared real lamp lights at the nearest heads.
    lampLights?.updateNearest(camera.position);
    // Swap each vegetation chunk between the rich and cheap crown by distance,
    // and advance the wind sway (same clock as the water ripple).
    for (const veg of vegControls) {
      veg.updateLod(camera.position);
      veg.setTime(elapsed);
    }
    if (timer.getElapsed() >= tickDue) {
      tickDue = timer.getElapsed() + 0.1;
      opts.onPose?.(getPose());
      updateFocus();
    }
    // FPS at ~2 Hz on its own channel — must NOT churn the heavier stats
    // emit (which refreshes footprints and would re-flash the minimap).
    if (timer.getElapsed() >= fpsDue) {
      fpsDue = timer.getElapsed() + 0.5;
      opts.onFps?.(fps);
    }
    postStack.render(dt);
    tickPocFrame();
  });

  emitStats();

  return {
    setSun,
    setStyle: (style) => {
      currentStyle = style;
      restyleCities();
      invalidateShadows();
    },
    setDepthOfField: (enabled) => postStack.setDepthOfField(enabled),
    setFocusMode: (mode) => postStack.setFocusMode(mode),
    setFocusDistance: (meters) => postStack.setFocusDistance(meters),
    setDepthGrading: (intensity) => postStack.setDepthGrading(intensity),
    setContactShadows: (strength) => postStack.setContactShadows(strength),
    setPaperGrain: (intensity) => postStack.setPaperGrain(intensity),
    setBuildingGroundShade: (strength) => {
      styleResources.clayDetail.uAO.value = strength;
    },
    setBuildingBands: (strength) => {
      styleResources.clayDetail.uBands.value = strength;
    },
    setBuildingRim: (strength) => {
      styleResources.clayDetail.uRim.value = strength;
    },
    setBuildingTint: (strength) => {
      styleResources.clayDetail.uTint.value = strength;
    },
    setBuildingRoofTint: (strength) => {
      styleResources.clayDetail.uRoofTint.value = strength;
    },
    setBuildingRoofVibrance: (strength) => {
      styleResources.clayDetail.uRoofVibrance.value = strength;
    },
    setMeadowNdvi: (strength) => {
      meadowNdvi.value = strength;
    },
    setBuildingEave: (strength) => {
      styleResources.clayDetail.uEave.value = strength;
    },
    setBuildingDuskGlow: (strength) => {
      styleResources.clayDetail.uDuskGlow.value = strength;
    },
    setBuildingRoughness: (strength) => {
      styleResources.clayDetail.uRough.value = strength;
    },
    setTreeShimmer: (strength) => {
      for (const veg of vegControls) {
        veg.setShimmer(strength);
      }
    },
    setTreeTranslucency: (strength) => {
      for (const veg of vegControls) {
        veg.setTranslucency(strength);
      }
    },
    setTreeLeafFlutter: (strength) => {
      for (const veg of vegControls) {
        veg.setLeafFlutter(strength);
      }
    },
    setTreeLeafBright: (strength) => {
      for (const veg of vegControls) {
        veg.setLeafBright(strength);
      }
    },
    setTreeMultiTuft: (enabled) => {
      for (const veg of vegControls) {
        veg.setMultiTuft(enabled);
      }
    },
    setHeightFog: (strength) => {
      heightFog.uFogHeightStrength.value = Math.min(Math.max(strength, 0), 1);
    },
    setWaterMist: (strength) => {
      for (const t of terrains) {
        t.water?.setMist(strength);
      }
    },
    setBuildingTransparency: (transparency) => {
      setCityTransparency(styleResources, currentStyle, transparency);
      // Clay's alpha-hash cutout changes what the depth pass writes.
      invalidateShadows();
    },
    setAtmosphere: (amount) => {
      if (scene.fog instanceof Fog) {
        const range = fogRangeFor(amount);
        scene.fog.near = range.near;
        scene.fog.far = range.far;
      }
    },
    insertBuilding,
    demolishAtCrosshair,
    enterImmersive: () => controls.lock(),
    flyTo: (position, lookAt) => {
      setMovementMode("fly");
      camera.position.set(position.x, position.y, position.z);
      camera.lookAt(lookAt.x, lookAt.y, lookAt.z);
      // Refresh matrixWorld now: callers may raycast (demolish) before the
      // next rendered frame would otherwise update it.
      camera.updateMatrixWorld(true);
    },
    flyToViewpoint,
    teleportTo,
    getPose,
    getCameraState,
    applyCameraState,
    getRenderInfo: () => ({
      calls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      programs: renderer.info.programs?.length ?? 0,
    }),
    getFocusDebug: () => ({
      ...postStack.getFocusInfo(),
      hitDist: lastFocusHit?.dist ?? null,
      hitName: lastFocusHit?.name ?? null,
    }),
    getMovementMode: () => movement.getMode(),
    setMovementMode,
    setMoveInput: (x, y) => {
      // Joystick/analog input is the player taking over — drop any scenic glide.
      if (x !== 0 || y !== 0) {
        cancelFlight();
      }
      movement.setAnalog(x, y);
    },
    getFootprints: () => [
      ...buildingFootprintPolys(cityLayer.data),
      ...extraCities.flatMap((c) => buildingFootprintPolys(c.data)),
    ],
    landcoverTiles,
    terrainBounds: unionBounds,
    offset,
    dispose: () => {
      disposed = true;
      renderer.setAnimationLoop(null);
      resizeObserver.disconnect();
      detachTouch();
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
      renderer.domElement.removeEventListener("wheel", onWheel);
      controls.dispose();
      postStack.dispose();
      disposeObject3D(scene);
      for (const lamp of lampControls) {
        lamp.dispose();
      }
      for (const rail of railControls) {
        rail.dispose();
      }
      for (const wall of wallControls) {
        wall.dispose();
      }
      lampLights?.dispose();
      styleResources.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
