import {
  ACESFilmicToneMapping,
  Box3,
  Color,
  Fog,
  Group,
  type Mesh,
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
import { fogRangeFor } from "@/lib/city/atmosphere";
import { FALLBACK_LAT_LNG, utmToLatLng } from "@/lib/city/crs";
import { epsgToWorld, worldToEpsg } from "@/lib/city/ground-clamp";
import { parseHeightfieldHeader } from "@/lib/city/heightfield";
import type { LoadStageId, LoadStageUpdate } from "@/lib/city/load-stages";
import {
  LOOK_DEFAULTS,
  type LookValues,
  type SceneLookKey,
} from "@/lib/city/look-controls";
import type { LookState } from "@/lib/city/look-state";
import type {
  AreaFeature,
  BridgeFeature,
  CanopyExtraFeature,
  CanopyFeature,
  LampFeature,
  LowVegFeature,
  RailFeature,
  TreeFeature,
  VegRowFeature,
  WallFeature,
} from "@/lib/city/features";
import type { FootprintPoly } from "@/lib/city/minimap";
import type { CameraState, PlayerPose, Xyz } from "@/lib/city/pose";
import { createRegressionState, stepRegression } from "@/lib/city/regression";
import { SKIRT_DEPTH, type TerrainBounds } from "@/lib/city/terrain-geometry";
import type { TileUrls } from "@/lib/city/tile";
import { createCameraPose } from "./camera-pose";
import {
  type CityLayer,
  cityFootprints,
  countBuildings,
  createCityLayer,
  demolishObject,
  fetchCityMesh,
  pickCityObjectIndex,
} from "./city-layer";
import { createCityCollider } from "./collision";
import {
  fetchFeatures,
  fetchFeaturesFrom,
  fetchRequiredJson,
  isAbortError,
} from "./fetch-optional";
import type { MovementMode } from "./fps-movement";
import { createHeightFogUniforms } from "./height-fog";
import { createInsertedBuilding } from "./inserted-building";
import { attachKeyboardControls } from "./keyboard-controls";
import {
  buildLamps,
  createLampLights,
  type LampControl,
  type LampLights,
} from "./lamp-layer";
import { tickPocFrame, updatePocDebug } from "./poc-debug";
import { createPostStack } from "./post-stack";
import { buildLowVegetation } from "./low-vegetation-layer";
import { buildRail, type RailFeatures } from "./rail-layer";
import { type SceneCensus, sceneCensus } from "./scene-census";
import {
  aoQualityFor,
  type DeviceTier,
  pixelRatioFor,
  type SceneBudget,
  type SceneProfile,
  shadowMapSizeFor,
} from "./scene-profile";
import { createSunRig, type SunState } from "./sun-rig";
import { loadTerrain, type TerrainLayer, wallLinesFrom } from "./terrain-layer";
import {
  disposeObject3D,
  estimateGeometryBytes,
  trackedTextureBytes,
} from "./three-utils";
import { attachTouchControls } from "./touch-controls";
import { buildTreeInventory } from "./tree-inventory-layer";
import {
  buildVegetation,
  loadNdviSampler,
  type VegetationControl,
} from "./vegetation-layer";
import type { ViewpointGeometry } from "./viewpoints";
import {
  applyCityLook,
  applyCityStyle,
  createStyleResources,
} from "./visual-style";
import { buildWalls } from "./wall-layer";

/**
 * Vertical FOV. 55° (~85° horizontal at 16:9) reads like a natural human
 * walking perspective; wider than ~60° starts to feel fisheye/distorted.
 */
const DEFAULT_FOV = 55;
/** EPSG:25833 spot for the inserted building (mid-tile of 33412_5656). */
const DEFAULT_INSERT_AT = { x: 413_000, y: 5_657_000 };
/** Fog far plane (m) while only the primary tile exists: its half-size plus
 *  a margin, so the missing neighbours read as haze, not as an edge. */
const PARTIAL_WORLD_FOG_FAR = 1100;
const SKY_COLOR = 0x9f_b6_cc;

export type LayerName =
  | "city"
  | "lamps"
  | "lowVegetation"
  | "rail"
  | "terrain"
  | "vegetation"
  | "walls"
  | "water";

export interface CityWalkStats {
  buildingCount: number;
  /** estimated GPU footprint of geometry + textures + shadow map (MB) */
  gpuMegabytes: number;
  /** what each layer actually built — the e2e suite asserts on these */
  layerStats: Record<LayerName, SceneCensus>;
  shadowsEnabled: boolean;
  terrainVertexCount: number;
}

export interface CityWalkOptions {
  /**
   * The render budget (profile, device tier, whether the neighbour tiles
   * load), resolved once by the client — see scene-profile.ts. Everything
   * here takes its numbers from it instead of reading the window.
   */
  budget: SceneBudget;
  container: HTMLElement;
  /** neighbouring tiles rendered around the primary one for context */
  extraTiles?: TileUrls[];
  initialDate: Date;
  insertAt?: { x: number; y: number };
  insertedModelUrl?: string;
  /**
   * The look store (HUD-owned; lib/city/look-state.ts): the scene applies its
   * current values at boot, on every change, and to each tile that lands
   * later. It outlives the scene, so dispose() unsubscribes.
   */
  look: LookState;
  /**
   * A layer that streams in after the first frame (neighbour tiles,
   * vegetation, rails, walls) failed to load. The primary scene keeps
   * running; the HUD shows the message.
   */
  onError?: (message: string) => void;
  /** throttled (~2 Hz) smoothed FPS, decoupled from the heavier stats emit */
  onFps?: (fps: number) => void;
  /** Every layer has streamed in (the scene is complete). */
  onLoaded?: () => void;
  onModeChange?: (mode: MovementMode) => void;
  /** throttled (~10 Hz) player pose updates for the minimap */
  onPose?: (pose: PlayerPose) => void;
  /**
   * Load progress, stage by stage (lib/city/load-stages.ts). Fractions are
   * real where the pipeline can measure them — the compressed byte stream of
   * the two big downloads, the tile count of the neighbour block — and a plain
   * started/finished elsewhere. The HUD turns them into the loading screen,
   * the handover and the streaming pill.
   */
  onStage?: (update: LoadStageUpdate) => void;
  onStats?: (stats: CityWalkStats) => void;
  /** the spawn tile: walked on, collided with, demolished from (lib/city/tile.ts) */
  primary: TileUrls;
  /**
   * Aborts startup mid-load (React StrictMode mounts effects twice in dev;
   * without this the doomed first instance would finish loading 19 MB of
   * tile data and leave a second canvas around until then).
   */
  signal?: AbortSignal;
}

/**
 * The imperative surface the HUD (and, in dev/test builds, `window.__poc`)
 * drives. The look values are NOT here: they live in the look store passed in
 * through CityWalkOptions, which the scene subscribes to.
 */
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
  flyToViewpoint: (viewpoint: ViewpointGeometry) => void;
  /**
   * The current pose as a vantage — what the HUD stores when you save a view,
   * so restoring it is the same animated glide as any curated one.
   */
  captureViewpoint: () => ViewpointGeometry;
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
  getPose: () => PlayerPose;
  /**
   * GPU counters for perf work. `programs` is the live shader-program count;
   * `calls`/`triangles` reflect only the LAST render() pass, so with the
   * post-processing composer active they report the final fullscreen pass, not
   * the scene total (disable post-processing to read true scene counts).
   */
  getRenderInfo: () => {
    calls: number;
    /** estimated GPU bytes of geometry + textures + shadow map */
    gpuBytes: number;
    programs: number;
    triangles: number;
  };
  insertBuilding: () => Promise<void>;
  /** per-tile land-cover class PNGs + their EPSG bounds, for the minimap */
  landcoverTiles: { bounds: TerrainBounds; src: string }[];
  /** the scene's geographic position — the HUD's sunrise/sunset times */
  latLng: { lat: number; lng: number };
  /** recenter offset, lets callers map EPSG coords -> world coords */
  offset: { cx: number; cy: number };
  /** analog joystick input: x = strafe right, y = forward, both [-1, 1] */
  setMoveInput: (x: number, y: number) => void;
  setMovementMode: (mode: MovementMode) => void;
  setSun: (date: Date) => SunState;
  /**
   * Begins everything after the first frame — the neighbour tiles, the
   * vegetation, the rails, the terrain BVH. Held back so its synchronous
   * chunks cannot stutter the frames the city arrives in; idempotent, and a
   * no-op once the scene is disposed.
   */
  startStreaming: () => void;
  /** Drops the player at EPSG coordinates, standing on the terrain. */
  teleportTo: (epsgX: number, epsgY: number) => void;
  /** DGM extent in EPSG coordinates — the minimap frame */
  terrainBounds: TerrainBounds;
}

function createRenderer(
  container: HTMLElement,
  profile: SceneProfile,
  tier: DeviceTier
): WebGLRenderer {
  // No MSAA: everything renders through the EffectComposer and SMAA carries
  // the AA (see post-stack.ts); a multisampled default framebuffer would only
  // be resolved for a full-screen quad.
  const renderer = new WebGLRenderer({
    antialias: false,
    powerPreference: "high-performance",
  });
  // The `lite` profile renders at half linear resolution (a quarter of the
  // pixels) and lets the browser upscale. The canvas fills the viewport and
  // the HUD needs a desktop-width window to lay out, so this — not the
  // Playwright viewport — is the only honest way to cut fill-rate in the
  // headless suite, where every pixel is shaded on the CPU. Fill-rate is what
  // the post stack costs, and the post stack is most of a frame.
  renderer.setPixelRatio(pixelRatioFor(profile, tier, window.devicePixelRatio));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.shadowMap.enabled = true;
  // three r182 deprecated PCFSoftShadowMap (silently falls back to hard PCF),
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

/**
 * Lets React commit and paint the progress message before a long synchronous
 * stretch (parse, BVH, shader setup). Without this yield the overlay shows the
 * PREVIOUS message throughout — the state update is queued, but the main
 * thread never gets to render it until the stretch is over.
 */
function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => setTimeout(resolve, 0));
  });
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
  epsg: number,
  offset: { cx: number; cy: number }
): { lat: number; lng: number } {
  return utmToLatLng(epsg, offset.cx, offset.cy) ?? FALLBACK_LAT_LNG;
}

export async function createCityWalkApp(
  opts: CityWalkOptions
): Promise<CityWalkHandle> {
  const { profile, tier } = opts.budget;
  const renderer = createRenderer(opts.container, profile, tier);
  const scene = new Scene();
  scene.background = new Color(SKY_COLOR);
  const fogRange = fogRangeFor(opts.look.get().fogAmount);
  scene.fog = new Fog(SKY_COLOR, fogRange.near, fogRange.far);

  // Everything bootApp creates registers its teardown here, so a boot that
  // throws halfway (a real load failure, or the StrictMode remount aborting
  // one) frees exactly what a clean dispose would. Without it the post stack's
  // half-float targets, the style materials, the listeners and the per-tile
  // layer controls survived a failed boot.
  const cleanups: Array<() => void> = [];
  try {
    return await bootApp(opts, renderer, scene, cleanups);
  } catch (err) {
    // Centralized teardown: covers both abort (StrictMode remount) and real
    // load failures — otherwise the dead canvas would linger in the DOM.
    runCleanups(cleanups);
    disposeObject3D(scene);
    renderer.dispose();
    renderer.domElement.remove();
    throw err;
  }
}

/** Unwinds registered teardowns in reverse creation order. */
function runCleanups(cleanups: Array<() => void>): void {
  for (const cleanup of [...cleanups].reverse()) {
    cleanup();
  }
}

async function bootApp(
  opts: CityWalkOptions,
  renderer: WebGLRenderer,
  scene: Scene,
  cleanups: Array<() => void>
): Promise<CityWalkHandle> {
  const { container, budget } = opts;
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
  // Also trips after dispose(): the streaming tail (loadRest) must never add
  // to a scene that has already been torn down.
  const ensureAlive = () => {
    if (disposed || opts.signal?.aborted) {
      throw new DOMException("CityWalk startup aborted", "AbortError");
    }
  };

  // The `lite` profile (?scene=lite, see scene-profile.ts) renders the primary
  // tile alone. Neighbours are passive visual context, but they are three
  // quarters of the geometry AND three quarters of the boot cost — parsing
  // three more CityJSON documents, three more DGM heightfields and three more
  // canopy clouds. Dropping them is what makes the headless e2e suite
  // affordable; nothing it asserts on lives outside the primary tile.
  const neighbourTiles = budget.neighbourTiles ? (opts.extraTiles ?? []) : [];

  const primary = opts.primary;
  /** One stage report for the HUD (lib/city/load-stages.ts). */
  const stage = (id: LoadStageId, fraction: number, skipped?: boolean) =>
    opts.onStage?.({ id, fraction, skipped });

  stage("buildings", 0);
  // The neighbours' heightfield HEADERS (~150 bytes each) come along with the
  // primary mesh: their bounds frame the minimap from the first frame, while
  // the tiles themselves stream in afterwards (see loadRest below).
  const [primaryCity, neighbourBounds] = await Promise.all([
    // The download is the bulk of the stage; the last tenth is the decode and
    // the mesh build below, which report on completion.
    fetchCityMesh(primary, opts.signal, (f) => stage("buildings", f * 0.9)),
    Promise.all(
      neighbourTiles.map(
        async (tile) =>
          parseHeightfieldHeader(
            await fetchRequiredJson(tile.heightfieldHeader, opts.signal)
          ).bounds
      )
    ),
  ]);
  ensureAlive();
  if (utmToLatLng(primaryCity.meta.epsg, 0, 0) === null) {
    throw new Error(
      `Unsupported city CRS EPSG:${primaryCity.meta.epsg} — expected ` +
        "ETRS89/UTM (EPSG:25832 or 25833). Reproject the CityJSON before baking."
    );
  }
  let cityLayer: CityLayer = createCityLayer(
    primaryCity.meta,
    primaryCity.vertices,
    world
  );
  stage("buildings", 1);
  // The recenter offset was captured at bake time from the primary tile and
  // shared with the neighbours, so every layer subtracts the same origin.
  const offset = primaryCity.meta.offset;

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
  const meadowNdvi = { value: LOOK_DEFAULTS.meadowNdvi };
  // The lowest real terrain elevation so far (the Elbe surface): the floor
  // the player stands on off every tile's DGM and the valley height-fog's
  // start, lowered as each tile lands (a uniform write, no recompile). An
  // all-NoData tile reports +Infinity and leaves it alone.
  let groundFloor = Number.POSITIVE_INFINITY;
  const lowerGroundFloor = (minElevation: number) => {
    groundFloor = Math.min(groundFloor, minElevation);
    heightFog.uFogHeightStart.value = groundFloor + 1;
  };

  // What has landed so far, in tile order (primary first) whatever order the
  // concurrent loads finish in: "first covering tile wins" then resolves a
  // seam vertex the same way every run. Each tile joins the scene and this
  // ledger in one synchronous step (loadTileTerrain), so a neighbour that
  // fails to load leaves nothing behind that heightAt, the raycasts, the
  // census or dispose would miss. Collision and demolish stay on the primary
  // tile (neighbours are passive visual context).
  const landedTerrain = new Map<number, TerrainLayer>();
  let terrains: TerrainLayer[] = [];
  const landTerrain = (slot: number, t: TerrainLayer) => {
    landedTerrain.set(slot, t);
    terrains = [...landedTerrain]
      .sort(([a], [b]) => a - b)
      .map(([, landed]) => landed);
  };
  /** every tile's OSM walls, fetched once for conflation AND the ribbons */
  const wallFeatures: WallFeature[] = [];
  const extraCities: CityLayer[] = [];
  // Per-tile vegetation handles, kept so the loop can drive crown LOD and the
  // HUD can retune shimmer / multi-tuft.
  const vegControls: VegetationControl[] = [];
  // OSM hedges (low-vegetation-layer.ts), one group per tile (static: no
  // per-frame work).
  const lowVegGroups: Group[] = [];
  // Per-tile lamp visuals; the real (shared, fixed) point-light pool is built
  // once after all tiles load so NUM_POINT_LIGHTS stays constant.
  const lampControls: LampControl[] = [];
  let lampLights: LampLights | null = null;
  // The block's rail and wall geometry, for the census.
  const railGroups: Group[] = [];
  const wallGroups: Group[] = [];
  // disposeObject3D(scene) frees every geometry and material at teardown;
  // textures are their owner's to free (the shadow map is the sun rig's).
  // The ledgers fill during the abortable load, so this covers however many
  // tiles made it in.
  cleanups.push(() => {
    for (const t of terrains) {
      t.dispose();
    }
    for (const lamp of lampControls) {
      lamp.dispose();
    }
    lampLights?.dispose();
  });

  // Loads one tile's terrain (+ water) in the SHARED frame and lands it in
  // its slot (0 = primary). Vegetation and lamps are a separate step
  // (loadTileDressing) so the first frame can wait on terrain + buildings.
  const loadTileTerrain = async (
    tile: TileUrls,
    slot: number,
    onBytes?: (fraction: number) => void
  ): Promise<TerrainLayer> => {
    // OSM walls feed the ribbon geometry built for the whole block later —
    // and, on a tile meshed from its heightfield, the conflation step.
    const wallsFetch = fetchFeatures<WallFeature>(tile.walls, opts.signal);
    const terrainFrom = (walls: WallFeature[]) =>
      loadTerrain({
        onBytes,
        url: tile.heightfieldHeader,
        // A tile with a TIN (every tile of the block, lib/city/tile.ts) is
        // meshed from it (lib/city/terrain-tin.ts), with nothing burned in;
        // only a tile without one falls back to the heightfield.
        tinUrl: tile.terrainTin,
        landcoverUrl: tile.landcover,
        landcoverRgbUrl: tile.landcoverRgb,
        ndviUrl: tile.ndvi,
        // Grid tiles only: retaining/city walls are burned into the
        // heightfield as steps (ADR 0014). A TIN ignores them — the ribbons
        // snap instead.
        wallLines: wallLinesFrom(walls),
        offset,
        signal: opts.signal,
        sunDirection,
        heightFog,
        meadowNdvi,
      });
    // A TIN burns nothing in, so its terrain need not wait for the walls.
    const [walls, t] = await Promise.all([
      wallsFetch,
      tile.terrainTin ? terrainFrom([]) : wallsFetch.then(terrainFrom),
    ]);
    // Nothing may join the scene once the instance has been torn down
    // (StrictMode remount): a mesh added after dispose() would never be
    // freed, and neither would one built after it — so free it here.
    if (disposed || opts.signal?.aborted) {
      t.dispose();
      for (const mesh of [t.mesh, t.water?.mesh, t.water?.mistMesh]) {
        if (mesh) {
          disposeObject3D(mesh);
        }
      }
    }
    ensureAlive();
    world.add(t.mesh);
    if (t.water) {
      world.add(t.water.mesh);
      // River mist reuses the Z-up terrain geometry, so it lives on `world` too.
      world.add(t.water.mistMesh);
      // Joins the look fan-out here, so seed it here: a slider moved while
      // the tile streamed in must reach its mist too.
      t.water.setMist(opts.look.get().waterMist);
    }
    landTerrain(slot, t);
    wallFeatures.push(...walls);
    lowerGroundFloor(t.minElevation);
    // NB: rails/bridges/ballast are NOT loaded here — they are built ONCE for the
    // whole tile block, on the cross-tile heightAt, so tracks run continuously
    // across tile seams instead of truncating at each tile edge.
    return t;
  };

  /** The night factor of the last setSun, applied to lamps that arrive later. */
  let currentNight = 0;

  // Vegetation + lamps of one tile, dropped onto ITS terrain (heightAt):
  // every input fetched at once (fetch-optional.ts: a 404 is "feature off"),
  // then built.
  const loadTileDressing = async (
    tile: TileUrls,
    t: TerrainLayer,
    onFetched?: () => void
  ): Promise<void> => {
    const [
      rows,
      canopy,
      ndviAt,
      lampFeatures,
      inventoryTrees,
      scanTrees,
      hedges,
    ] = await Promise.all([
      fetchFeatures<VegRowFeature>(tile.vegrows, opts.signal),
      fetchFeatures<CanopyFeature>(tile.canopy, opts.signal),
      loadNdviSampler(tile.ndvi, t.bounds, opts.signal),
      fetchFeatures<LampFeature>(tile.lamps, opts.signal),
      // the street-tree cadastre (tree-inventory-layer.ts)
      fetchFeatures<TreeFeature>(tile.trees, opts.signal),
      // laser-scan crowns outside the canopy mask (primary tile only)
      fetchFeatures<CanopyExtraFeature>(tile.canopyx, opts.signal),
      fetchFeatures<LowVegFeature>(tile.lowveg, opts.signal),
    ]);
    ensureAlive();
    // The features are in; the canopy build is the other half of the wait.
    onFetched?.();
    const ground = { offset, heightAt: t.heightAt };
    const vegCtx = { ...ground, sunDirection, heightFog };
    const inventory =
      inventoryTrees.length > 0
        ? buildTreeInventory(inventoryTrees, vegCtx, ndviAt ?? undefined)
        : null;
    if (inventory) {
      scene.add(inventory.control.group);
      vegControls.push(inventory.control);
      inventory.control.applyLook(opts.look.get());
    }
    const vegetation = buildVegetation(
      {
        rows,
        // The laser-scan crowns outside the canopy mask join the canopy as
        // ordinary trees (they carry the same measured `h`); the bake already
        // dropped the ones a cadastre tree claims.
        canopy: scanTrees.length > 0 ? [...canopy, ...scanTrees] : canopy,
        ndviAt: ndviAt ?? undefined,
        keepTree: inventory?.keepTree,
        // The cadastre's trunks and broadleaf crowns ride in the canopy's
        // chunk meshes (instances, not draw calls).
        extraTrees: inventory?.instances,
      },
      vegCtx
    );
    if (hedges.length > 0) {
      const low = buildLowVegetation(hedges, { ...ground, heightFog });
      scene.add(low);
      lowVegGroups.push(low);
    }
    // Y-up scene frame (like the inserted building), NOT the Z-up `world`.
    scene.add(vegetation.group);
    vegControls.push(vegetation);
    // Born with the current look, not the default: a slider moved while
    // this tile streamed in must reach it too.
    vegetation.applyLook(opts.look.get());
    const lamps = buildLamps(lampFeatures, ground);
    // Lamps are authored Y-up (like vegetation), so they go on `scene`.
    scene.add(lamps.group);
    lamps.setNightFactor(currentNight);
    lampControls.push(lamps);
    lampLights?.setHeads(lampControls.flatMap((l) => l.headPositions));
  };

  stage("terrain", 0);
  // The raster download is nearly all of it; conflation and the geometry
  // build are the last tenth.
  const terrain = await loadTileTerrain(primary, 0, (f) =>
    stage("terrain", f * 0.9)
  );
  stage("terrain", 1);
  assertCityOnTerrain(offset, terrain);

  // Neighbouring tiles stream in AFTER the first frame (loadRest): their
  // buildings share the primary recenter offset so they line up; terrain,
  // water and trees land the same way.
  const footprintCache = new WeakMap<CityLayer, FootprintPoly[]>();
  const neighbourFootprints = (layer: CityLayer): FootprintPoly[] => {
    let polys = footprintCache.get(layer);
    if (!polys) {
      polys = cityFootprints(layer);
      footprintCache.set(layer, polys);
    }
    return polys;
  };

  // Single fixed pool of real point lights for the nearest lamps across ALL
  // tiles. Built ONCE here (before the first render, with no heads yet) so
  // NUM_POINT_LIGHTS is baked into every lit program a single time — no
  // per-tile recompile churn; each tile's lamps retarget it as they arrive.
  lampLights = createLampLights();
  for (const light of lampLights.lights) {
    scene.add(light);
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

  // Rails / bridges / ballast yards / platforms — every tile's baked GeoJSONs
  // merged (missing files yield nothing), fetched while the neighbours load…
  const fetchBlockRailFeatures = async (): Promise<RailFeatures> => {
    const tiles = [primary, ...neighbourTiles];
    const { signal } = opts;
    const [rails, bridges, ballast, platforms] = await Promise.all([
      fetchFeaturesFrom<RailFeature>(
        tiles.map((t) => t.rail),
        signal
      ),
      fetchFeaturesFrom<BridgeFeature>(
        tiles.map((t) => t.bridge),
        signal
      ),
      fetchFeaturesFrom<AreaFeature>(
        tiles.map((t) => t.railarea),
        signal
      ),
      fetchFeaturesFrom<AreaFeature>(
        tiles.map((t) => t.platform),
        signal
      ),
    ]);
    return { rails, bridges, ballast, platforms };
  };
  // …and built ONCE for the whole block on the cross-tile `heightAt` (after
  // every tile has landed), so a track crossing a tile seam samples the
  // neighbour's heightfield instead of being dropped at the edge.
  const addBlockRails = (features: RailFeatures): void => {
    stage("rails", 0.7);
    const rail = buildRail(features, { offset, heightAt, heightFog });
    scene.add(rail);
    railGroups.push(rail);
  };

  // OSM retaining/city walls (e.g. the Brühlsche Terrasse) — the monumental
  // walls the elevation data smooths away. Built ONCE for the block on the
  // cross-tile heightAt, from the features each tile already fetched.
  const addBlockWalls = (): void => {
    if (wallFeatures.length === 0) {
      return;
    }
    stage("rails", 0.85);
    const walls = buildWalls(wallFeatures, {
      offset,
      heightAt,
      heightFog,
      // On TIN ground nothing was burned to the OSM line, so the ribbons
      // follow the measured steps instead (wall-snap.ts). A grid tile (no
      // TIN in its spec) is conflated; then every ribbon keeps the OSM line.
      snapToStep: [primary, ...neighbourTiles].every(
        (tile) => tile.terrainTin !== undefined
      ),
    });
    scene.add(walls);
    wallGroups.push(walls);
  };

  // The whole block's extent, known from the heightfield headers before any
  // neighbour has landed: the minimap frames it from the first frame.
  const unionBounds: TerrainBounds = [
    terrain.bounds,
    ...neighbourBounds,
  ].reduce<TerrainBounds>(
    (acc, b) => [
      Math.min(acc[0], b[0]),
      Math.min(acc[1], b[1]),
      Math.max(acc[2], b[2]),
      Math.max(acc[3], b[3]),
    ],
    [
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ]
  );

  // Per-tile land-cover PNGs + bounds so the minimap can place each correctly.
  const landcoverTiles = [
    { src: primary.landcover, bounds: terrain.bounds },
    ...neighbourTiles.map((t, i) => ({
      src: t.landcover,
      bounds: neighbourBounds[i],
    })),
  ];

  // Terrain BVHs (for the 10 Hz autofocus ray and double-tap travel) are
  // built AFTER the first frame, one tile per idle slot — see indexTerrain
  // below. They cost ~1.5 s of main thread for the block and nothing the
  // first frame needs depends on them.
  const indexedTerrain: Mesh[] = [];

  world.updateMatrixWorld(true);
  // The primary tile's extent: the sun rig only needs a centre to start from
  // (its frustum follows the camera) and a ground fallback.
  const worldBounds = new Box3().setFromObject(world);
  if (!Number.isFinite(groundFloor)) {
    // No valid elevation anywhere: the lowest vertex above the skirt stands
    // in. NB: worldBounds.min.y itself is unusable — the terrain skirt hangs
    // 30 m below every border vertex, so the box bottom sits ~30 m under the
    // river and the whole fog band (start … start + falloff) would end below
    // the water; the Talnebel slider then changes no pixel.
    lowerGroundFloor(worldBounds.min.y + SKIRT_DEPTH);
  }
  // Where the tile sits on the globe: the sun rig needs it, and so does the
  // HUD's sunrise/sunset readout.
  const latLng = tileLatLng(primaryCity.meta.epsg, offset);
  const sunRig = createSunRig(
    scene,
    worldBounds,
    latLng,
    shadowMapSizeFor(budget.profile, budget.tier),
    sunDirection
  );
  cleanups.push(sunRig.dispose);

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
   * never as a crash. The render loop calls it when a crown LOD swap changes
   * the casters; the follow dead zone (sun-rig.ts) means nothing else redraws
   * the map while the player wanders inside it.
   */
  const invalidateShadows = () => {
    sunRig.invalidateShadow();
  };

  const setSun = (date: Date): SunState => {
    const state = sunRig.update(date);
    currentNight = state.nightFactor;
    for (const lamp of lampControls) {
      lamp.setNightFactor(state.nightFactor);
    }
    lampLights?.setNightFactor(state.nightFactor);
    clayNight.value = state.nightFactor;
    invalidateShadows();
    return state;
  };
  setSun(opts.initialDate);

  // Fog: while the neighbour tiles are still streaming in, the world ends at
  // the primary tile's edge; a tighter fog turns that edge into haze instead
  // of a cliff against the sky. The slider value is kept and re-applied once
  // the block is complete.
  let fogAmount = opts.look.get().fogAmount;
  let worldPartial = neighbourTiles.length > 0;
  const applyFog = () => {
    if (!(scene.fog instanceof Fog)) {
      return;
    }
    const range = fogRangeFor(fogAmount);
    const far = worldPartial
      ? Math.min(range.far, PARTIAL_WORLD_FOG_FAR)
      : range.far;
    scene.fog.far = far;
    scene.fog.near = Math.min(range.near, far * 0.6);
  };
  const restoreFog = () => {
    worldPartial = false;
    applyFog();
  };
  applyFog();

  stage("light", 0);
  await nextPaint();
  const styleResources = createStyleResources(heightFog, clayNight);
  cleanups.push(() => styleResources.dispose());
  // The neighbour tiles are dressed the same way as they land (loadRest).
  applyCityStyle(cityLayer.group, styleResources);
  const postStack = createPostStack(
    renderer,
    scene,
    camera,
    aoQualityFor(budget.profile)
  );
  cleanups.push(() => postStack.dispose());

  // The look store is the one source of every slider value: applied now, on
  // every change, and (in loadTileTerrain / loadTileDressing) to each owner
  // that lands later. The store outlives this instance — unsubscribe on
  // dispose or an aborted StrictMode boot keeps receiving writes.
  // One writer per scene-owned row — a Record over the keys, so a row added to
  // the table cannot go unapplied. (A full re-apply is a few dozen uniform
  // writes, cheaper than the bookkeeping to diff.)
  const sceneRows: Record<SceneLookKey, (value: number) => void> = {
    fogAmount: (amount) => {
      fogAmount = amount;
      applyFog();
    },
    heightFog: (strength) => {
      heightFog.uFogHeightStrength.value = strength;
    },
    meadowNdvi: (strength) => {
      meadowNdvi.value = strength;
    },
    waterMist: (strength) => {
      for (const t of terrains) {
        t.water?.setMist(strength);
      }
    },
  };
  let lastTransparency = Number.NaN;
  const applyLook = (look: LookValues) => {
    for (const key of Object.keys(sceneRows) as SceneLookKey[]) {
      sceneRows[key](look[key]);
    }
    applyCityLook(styleResources, look);
    if (look.transparency !== lastTransparency) {
      lastTransparency = look.transparency;
      // Clay's alpha-hash cutout changes what the depth pass writes.
      invalidateShadows();
    }
    postStack.applyLook(look);
    for (const veg of vegControls) {
      veg.applyLook(look);
    }
  };
  applyLook(opts.look.get());
  cleanups.push(opts.look.subscribe(applyLook));

  // Wall collision against the CURRENT city group (demolish swaps it).
  // Declared before the collider so the inserted building can join the
  // collision/focus targets the moment it exists.
  let inserted: Object3D | null = null;
  const collider = createCityCollider(() =>
    inserted ? [cityLayer.group, inserted] : [cityLayer.group]
  );
  // Where the player stands and looks, walk/fly, the scenic glides — and the
  // one rule that any player input cancels a glide (camera-pose.ts).
  const pose = createCameraPose(camera, {
    groundFloor: () => groundFloor,
    heightAt,
    offset,
    resolveStep: collider.resolveStep,
    onModeChange: opts.onModeChange,
    onPose: opts.onPose,
  });
  // Spawn at the recenter point (= world origin), standing on the terrain.
  pose.teleportTo(offset.cx, offset.cy);

  // Street-view-style canvas gestures (touch and mouse, incl. pointer lock).
  const tapRaycaster = new Raycaster();
  tapRaycaster.firstHitOnly = true;
  const canvasControls = attachTouchControls(renderer.domElement, {
    onLook: pose.turn,
    onMouseLook: pose.look,
    onPinchStart: pose.beginZoom,
    onPinch: pose.zoomTo,
    onWheel: pose.zoomBy,
    onDoubleTap: (ndcX, ndcY) => {
      // Travel to the tapped spot on the terrain.
      tapRaycaster.setFromCamera(new Vector2(ndcX, ndcY), camera);
      const hit = tapRaycaster.intersectObjects(
        terrains.map((t) => t.mesh),
        false
      )[0];
      if (hit) {
        const epsg = worldToEpsg(hit.point.x, hit.point.z, offset);
        pose.teleportTo(epsg.x, epsg.y);
      }
    },
  });
  cleanups.push(canvasControls.detach);

  let fps = 0;
  // Geometry + tracked textures + the shadow map; the post stack's screen
  // buffers are excluded (they scale with the canvas, not the world).
  const gpuBytes = () =>
    estimateGeometryBytes(scene) +
    trackedTextureBytes() +
    sunRig.shadowMapBytes;
  const emitStats = () => {
    opts.onStats?.({
      buildingCount: countBuildings(cityLayer),
      terrainVertexCount: terrain.vertexCount,
      shadowsEnabled: renderer.shadowMap.enabled,
      gpuMegabytes: Math.round(gpuBytes() / 1_048_576),
      layerStats: {
        city: sceneCensus([
          cityLayer.group,
          ...extraCities.map((c) => c.group),
        ]),
        terrain: sceneCensus(terrains.map((t) => t.mesh)),
        water: sceneCensus(
          terrains.flatMap((t) =>
            t.water ? [t.water.mesh, t.water.mistMesh] : []
          )
        ),
        vegetation: sceneCensus(vegControls.map((v) => v.group)),
        lowVegetation: sceneCensus(lowVegGroups),
        lamps: sceneCensus(lampControls.map((l) => l.group)),
        rail: sceneCensus(railGroups),
        walls: sceneCensus(wallGroups),
      },
    });
  };

  const demolishAtCrosshair = () => {
    const objectIndex = pickCityObjectIndex(camera, cityLayer);
    if (objectIndex === null) {
      return;
    }
    cityLayer = demolishObject(cityLayer, world, objectIndex);
    // The rebuilt mesh starts with a placeholder material — re-dress it.
    applyCityStyle(cityLayer.group, styleResources);
    invalidateShadows();
    emitStats();
  };

  const insertBuilding = async () => {
    const at = opts.insertAt ?? DEFAULT_INSERT_AT;
    const obj = await createInsertedBuilding(opts.insertedModelUrl);
    if (disposed) {
      // The app was torn down while the glTF was in flight; nothing will ever
      // add this object to a scene, so free it here or it leaks.
      disposeObject3D(obj);
      return;
    }
    if (inserted) {
      scene.remove(inserted);
      disposeObject3D(inserted);
    }
    const ground = heightAt(at.x, at.y) ?? groundFloor;
    // Data frame (x, y, z-up) -> scene frame (x, z, -y), recentered.
    const w = epsgToWorld(at.x, at.y, offset);
    obj.position.set(w.x, ground, w.z);
    // BVHs keep the per-frame collision rays cheap for real glTF models.
    obj.traverse((child) => {
      const mesh = child as Mesh;
      if (mesh.isMesh && !mesh.geometry.boundsTree) {
        mesh.geometry.computeBoundsTree();
      }
    });
    scene.add(obj);
    invalidateShadows();
    inserted = obj;
  };

  cleanups.push(
    attachKeyboardControls(
      { document, window },
      {
        press: pose.press,
        release: pose.release,
        releaseAll: pose.releaseAll,
        toggleMode: pose.toggleMode,
        demolish: demolishAtCrosshair,
      }
    )
  );

  const resizeObserver = new ResizeObserver(() => {
    camera.aspect = container.clientWidth / Math.max(container.clientHeight, 1);
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
    postStack.setSize(container.clientWidth, container.clientHeight);
  });
  resizeObserver.observe(container);
  cleanups.push(() => resizeObserver.disconnect());

  // Crosshair autofocus for the photographic DoF (throttled like the pose).
  const focusRaycaster = new Raycaster();
  focusRaycaster.firstHitOnly = true;
  focusRaycaster.far = 6000;
  // Stable focus-raycast context: neighbour-tile buildings + every tile's
  // terrain. WITHOUT the neighbour buildings, the crosshair on a distant
  // (neighbour-tile) silhouette hits nothing and autofocus falls back — so the
  // far city blurred. The primary cityLayer.group is prepended fresh each call
  // because demolish swaps it.
  // Terrain joins as each tile's BVH lands (indexedTerrain): a brute-force
  // ray through ~2M unindexed triangles ten times a second would freeze the
  // first seconds, and the DoF merely focuses on buildings until then.
  // Neighbour buildings join as they stream in (extraCities is live).
  const focusCrosshair = new Vector2(0, 0);
  let lastFocusHit: { dist: number; name: string } | null = null;
  const updateFocus = () => {
    focusRaycaster.setFromCamera(focusCrosshair, camera);
    const targets: Object3D[] = [cityLayer.group];
    if (inserted) {
      targets.push(inserted);
    }
    for (const c of extraCities) {
      targets.push(c.group);
    }
    targets.push(...indexedTerrain);
    const hit = focusRaycaster.intersectObjects(targets, true)[0];
    lastFocusHit = hit
      ? {
          dist: camera.position.distanceTo(hit.point),
          name: hit.object.name || hit.object.type,
        }
      : null;
    postStack.setFocusTarget(hit?.point ?? null);
  };

  // Motion-keyed quality regression. Derived from the CAMERA, not the input
  // layer: WASD, the joystick, pointer-lock mouse-look, touch look and the
  // scenic flights all move it, and only two of those go through `movement`.
  //
  // Both comparisons need an epsilon, NOT `equals`: the walk-mode eye height
  // approaches the ground exponentially (approachHeight), so after the player
  // stops it keeps changing in the last few ulps for ~220 frames — an exact
  // comparison would hold the regression ~3.5 s past every stop. 1e-8 m² is
  // 0.1 mm of travel, four orders below one frame of walking (0.15 m at 60 Hz).
  const MOVED_DIST_SQ = 1e-8;
  // 1 - |dot| for two unit quaternions ~= theta^2 / 8, so 1e-9 is ~0.005° of
  // turn — far below one pixel of mouse-look, far above numerical noise.
  const MOVED_QUAT_DOT = 1e-9;
  const lastPos = camera.position.clone();
  const lastQuat = camera.quaternion.clone();
  const regression = createRegressionState();
  let regressedNow = false;
  const updateRegression = (dt: number) => {
    const moved =
      camera.position.distanceToSquared(lastPos) > MOVED_DIST_SQ ||
      1 - Math.abs(camera.quaternion.dot(lastQuat)) > MOVED_QUAT_DOT;
    lastPos.copy(camera.position);
    lastQuat.copy(camera.quaternion);
    const regressed = stepRegression(regression, moved, dt * 1000);
    postStack.setRegressed(regressed);
    if (regressed !== regressedNow) {
      regressedNow = regressed;
      updatePocDebug({ regressed });
    }
  };

  // Ground elevation under the camera, for the shadow frustum (sun-rig.ts):
  // both the plane it is anchored to and the altitude its half-size derives
  // from. Off every tile — flying past the block edge — the ground floor
  // stands in, exactly as it does for the walk clamp.
  const shadowViewDir = new Vector3();
  const groundUnderCamera = (): number => {
    const epsg = worldToEpsg(camera.position.x, camera.position.z, offset);
    return heightAt(epsg.x, epsg.y) ?? groundFloor;
  };

  const timer = new Timer();
  // Swap each vegetation chunk between the rich and cheap crown by distance,
  // and advance the wind sway (same clock as the water ripple). A swap changes
  // what casts shadows, so it invalidates the map — with the follow dead zone
  // (sun-rig.ts) nothing else redraws it for us.
  const stepVegetation = (elapsed: number) => {
    let lodChanged = false;
    for (const veg of vegControls) {
      if (veg.updateLod(camera.position)) {
        lodChanged = true;
      }
      veg.setTime(elapsed);
    }
    if (lodChanged) {
      invalidateShadows();
    }
  };

  let tickDue = 0;
  let fpsDue = 0;
  renderer.setAnimationLoop((time) => {
    timer.update(time);
    const dt = Math.min(timer.getDelta(), 0.05);
    const elapsed = timer.getElapsed();
    if (dt > 0) {
      fps = fps === 0 ? 1 / dt : fps * 0.9 + (1 / dt) * 0.1;
    }
    pose.step(dt);
    updateRegression(dt);
    // Advance every tile's water ripple/glitter and feed it the current
    // palette sky colour (Fresnel sky-tint stays in lockstep with the sun).
    if (scene.fog instanceof Fog) {
      for (const t of terrains) {
        t.water?.update(elapsed, scene.fog.color);
      }
    }
    // Re-fit the shadow frustum to the camera: centred on the ground the
    // player is looking at, and widened with altitude so a fly-over is
    // shadowed too (lib/city/shadow-fit.ts). At eye level this is exactly the
    // old tight 110 m frustum.
    camera.getWorldDirection(shadowViewDir);
    sunRig.follow(camera.position, shadowViewDir, groundUnderCamera());
    // Drift the sky dome's clouds (one uniform write/frame).
    sunRig.setTime(elapsed);
    // Repoint the shared real lamp lights at the nearest heads.
    lampLights?.updateNearest(camera.position);
    stepVegetation(elapsed);
    if (timer.getElapsed() >= tickDue) {
      tickDue = timer.getElapsed() + 0.1;
      opts.onPose?.(pose.getPose());
      updateFocus();
    }
    // FPS at ~2 Hz on its own channel — must NOT churn the heavier stats
    // emit (which refreshes footprints and would re-flash the minimap).
    if (timer.getElapsed() >= fpsDue) {
      fpsDue = timer.getElapsed() + 0.5;
      opts.onFps?.(fps);
    }
    // Read the flag BEFORE the render: three clears it once the map is drawn.
    const shadowRendered = sunRig.shadowPending();
    postStack.render(dt);
    tickPocFrame(shadowRendered);
  });
  cleanups.push(() => renderer.setAnimationLoop(null));

  // Build the terrain BVHs off the critical path: one tile per idle slot,
  // primary first, starting once the loop is running. Until a tile is indexed
  // the double-tap ray still hits it (three-mesh-bvh falls back to the plain
  // raycast), only slower; the autofocus ray waits (see updateFocus).
  const idle = (fn: () => void): void => {
    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(fn, { timeout: 1500 });
    } else {
      setTimeout(fn, 50);
    }
  };
  let indexing = false;
  const indexTerrain = () => {
    const t = terrains.find((landed) => !indexedTerrain.includes(landed.mesh));
    if (disposed || !t) {
      indexing = false;
      return;
    }
    t.mesh.geometry.computeBoundsTree();
    indexedTerrain.push(t.mesh);
    idle(indexTerrain);
  };
  // Re-armed whenever a tile lands; a running chain just keeps going.
  const scheduleIndexing = () => {
    if (!indexing) {
      indexing = true;
      idle(indexTerrain);
    }
  };

  // The sun rig, the shadow map and the clay materials are up: this is the
  // first renderable frame, and the point the HUD hands over to the pill.
  stage("light", 1);
  emitStats();

  // --- everything after the first frame ----------------------------------
  // The scene is already visible and walkable (primary terrain + buildings).
  // The rest streams in behind it: the primary's vegetation and lamps, then
  // the three neighbour tiles, then the rails and walls that span the block.
  // Every addition invalidates the shadow map (a missed call shows up as a
  // missing shadow, never as a crash) and re-checks the abort signal, so a
  // StrictMode remount stops adding to a scene that is already disposed.
  const loadNeighbours = async (): Promise<void> => {
    if (neighbourTiles.length === 0) {
      // The lite profile renders the primary tile alone — the stage is not
      // slow, it never runs, and the loading list says so.
      stage("neighbours", 1, true);
      return;
    }
    // Progress in whole units of work: the one batched mesh fetch, then a
    // terrain and a dressing pass per tile.
    const units = 1 + neighbourTiles.length * 2;
    let done = 0;
    const unitDone = () => {
      done += 1;
      stage("neighbours", done / units);
    };
    stage("neighbours", 0);
    // Fetch every neighbour's mesh at once, then build in tile order.
    const meshes = await Promise.all(
      neighbourTiles.map((tile) => fetchCityMesh(tile, opts.signal))
    );
    ensureAlive();
    unitDone();
    for (const { meta, vertices } of meshes) {
      const layer = createCityLayer(meta, vertices, world, false);
      applyCityStyle(layer.group, styleResources);
      extraCities.push(layer);
    }
    invalidateShadows();
    emitStats();
    // Terrain / water per neighbour, concurrently. Promise.all preserves order,
    // which the per-tile dressing below relies on. Neighbours are background —
    // their heightfield is baked at half the primary's resolution (~4 m).
    const neighbourTerrains = await Promise.all(
      neighbourTiles.map(async (tile, i) => {
        const t = await loadTileTerrain(tile, i + 1);
        // Per landing, not once for the block: a tile that lands while a
        // sibling fails still casts shadows, gets its BVH and is counted.
        invalidateShadows();
        scheduleIndexing();
        emitStats();
        unitDone();
        return t;
      })
    );
    ensureAlive();
    // Vegetation + lamps one tile at a time: bounds the peak memory of the
    // canopy build (tens of thousands of instances per tile).
    for (const [i, tile] of neighbourTiles.entries()) {
      await loadTileDressing(tile, neighbourTerrains[i]);
      ensureAlive();
      invalidateShadows();
      unitDone();
    }
  };
  const loadRest = async (): Promise<void> => {
    stage("vegetation", 0);
    await loadTileDressing(primary, terrain, () => stage("vegetation", 0.5));
    ensureAlive();
    invalidateShadows();
    stage("vegetation", 1);
    // The block's rail features are independent I/O: fetched while the
    // neighbours load, built once every tile has landed.
    stage("rails", 0);
    const [, railFeatures] = await Promise.all([
      loadNeighbours(),
      fetchBlockRailFeatures().then((features) => {
        stage("rails", 0.5);
        return features;
      }),
    ]);
    ensureAlive();
    addBlockRails(railFeatures);
    addBlockWalls();
    stage("rails", 1);
    invalidateShadows();
    restoreFog();
    emitStats();
  };
  /**
   * Everything after the first frame, held until the HUD says so.
   *
   * The two heaviest things in the whole boot land right here: the primary
   * tile's canopy build (tens of thousands of instances, one synchronous
   * pass) and the terrain BVH (`computeBoundsTree` on a 1024² mesh). The BVH
   * is scheduled through requestIdleCallback with a 1.5 s timeout, which is a
   * guarantee that it runs — squarely inside the handover if nothing holds it
   * back. Both stall the main thread for long enough to eat a dozen frames,
   * and the handover is where the city appears behind the frosted loading
   * screen and the player takes over.
   *
   * So the scene waits. It is already walkable and already rendering; the
   * only thing the wait costs is a second of streaming, and what it buys is
   * a first impression at frame rate. `startStreaming` is idempotent and the
   * HUD calls it once the veil is gone (city-walk.tsx).
   */
  let streamingStarted = false;
  const startStreaming = (): void => {
    if (streamingStarted || disposed) {
      return;
    }
    streamingStarted = true;
    scheduleIndexing();
    loadRest()
      .then(() => {
        if (!disposed) {
          opts.onLoaded?.();
        }
      })
      .catch((err: unknown) => {
        if (disposed || isAbortError(err)) {
          return;
        }
        opts.onError?.(err instanceof Error ? err.message : String(err));
      });
  };

  return {
    setSun,
    insertBuilding,
    demolishAtCrosshair,
    enterImmersive: canvasControls.lockPointer,
    flyTo: pose.flyTo,
    flyToViewpoint: pose.flyToViewpoint,
    captureViewpoint: pose.captureViewpoint,
    teleportTo: pose.teleportTo,
    getPose: pose.getPose,
    getCameraState: pose.getCameraState,
    applyCameraState: pose.applyCameraState,
    getRenderInfo: () => ({
      calls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      gpuBytes: gpuBytes(),
      programs: renderer.info.programs?.length ?? 0,
    }),
    getFocusDebug: () => ({
      ...postStack.getFocusInfo(),
      hitDist: lastFocusHit?.dist ?? null,
      hitName: lastFocusHit?.name ?? null,
    }),
    setMovementMode: pose.setMovementMode,
    setMoveInput: pose.setMoveInput,
    startStreaming,
    // Neighbours are never demolished, so their footprints are computed once
    // per layer (they stream in after the first frame) and reused thereafter.
    getFootprints: () => [
      ...cityFootprints(cityLayer),
      ...extraCities.flatMap(neighbourFootprints),
    ],
    landcoverTiles,
    latLng,
    terrainBounds: unionBounds,
    offset,
    dispose: () => {
      if (disposed) {
        return;
      }
      disposed = true;
      // Same list, same order as a failed boot unwinds: animation loop ->
      // resize observer -> listeners -> touch -> controls -> post stack ->
      // style materials -> per-tile layer controls. disposeObject3D skips
      // userData.shared materials, so freeing the style ones first is safe.
      runCleanups(cleanups);
      disposeObject3D(scene);
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
