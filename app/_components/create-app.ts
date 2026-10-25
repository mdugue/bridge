import {
  Box3,
  type BufferAttribute,
  type Camera,
  Color,
  Group,
  type Object3D,
  PCFShadowMap,
  PerspectiveCamera,
  Raycaster,
  Scene,
  Timer,
  Vector2,
  Vector3,
  WebGPURenderer,
} from "three/webgpu";
import { uniform } from "three/tsl";
import { fogRangeFor, streamFarFor } from "@/lib/city/atmosphere";
import { utmToLatLng } from "@/lib/city/crs";
import { WALL_CLEARANCE } from "@/lib/city/clearance";
import { createBootPhases } from "@/lib/city/boot-phases";
import { createCoalescer } from "@/lib/city/coalesce";
import { createRecount } from "@/lib/city/recount";
import {
  createMemoryGovernor,
  memoryFloorFor,
  memoryLimitsFor,
  type MemoryStep,
} from "@/lib/city/memory-governor";
import type { FramePace } from "@/lib/city/frame-pace";
import { isAllocationFailure } from "@/lib/city/gpu-allocation";
import {
  type GpuLoss,
  type SafetyLevel,
  shadowTilesStream,
} from "@/lib/city/gpu-safety";
import { bootingPose, startOf } from "@/lib/city/boot-start";
import { createGround } from "@/lib/city/ground";
import {
  createPageLifecycle,
  type LifecycleEffect,
  type LifecycleSignal,
} from "@/lib/city/page-lifecycle";
import type { Landmark } from "@/lib/city/landmarks";
import type { LoadStageId, LoadStageUpdate } from "@/lib/city/load-stages";
import type { LookKey, LookValues } from "@/lib/city/look-controls";
import type { LookState } from "@/lib/city/look-state";
import type { BikeCounter } from "@/lib/city/bike-counts";
import { activeDataLayers } from "@/lib/city/data-layers";
import {
  nextRenderStyle,
  RENDER_STYLE_BY_ID,
  type RenderStyle,
} from "@/lib/city/render-style";
import { footprintPolys } from "@/lib/city/city-mesh";
import type { FootprintPoly, MapTile } from "@/lib/city/minimap";
import {
  footprintCircle,
  MODEL_PRESET_BY_ID,
  MODEL_SCALE_MAX,
  MODEL_SCALE_MAX_PHONE,
  MODEL_SHADOW_MAX,
  type ModelPresetId,
  modelFootprint,
} from "@/lib/city/model-view";
import {
  SHADOW_MAX_RADIUS,
  shadowStreamResolution,
} from "@/lib/city/shadow-fit";
import { cutOutFromView } from "@/lib/city/section";
import {
  type ExportTile,
  exportScale,
  exportTiles,
} from "@/lib/city/image-export";
import { epsgToWorld, worldToEpsg } from "@/lib/city/ground-clamp";
import type { CameraState, PlayerPose, Xyz } from "@/lib/city/pose";
import { createRegressionState, stepRegression } from "@/lib/city/regression";
import {
  type Site,
  spawnViewpoint,
  type ViewpointGeometry,
} from "@/lib/city/site";
import type { TerrainBounds } from "@/lib/city/terrain-geometry";
import {
  parseTilesetExtras,
  type TilesetExtras,
  tileTopsOf,
} from "@/lib/city/tileset";
import type { Inquiry, InquiryAlong } from "@/lib/city/inquiry";
import { valleyFalloff } from "@/lib/city/valley-fog";
import {
  createLodSchedule,
  PHONE_RICH_TREE_BUDGET,
  RICH_TREE_BUDGET,
} from "@/lib/city/vegetation-lod";
import { createCameraPose, type FollowAim } from "./camera-pose";
import {
  createModelRig,
  type ModelHud,
  type ModelRig,
  type ViewMode,
} from "./model-rig";
import type { ModelCamera } from "./model-camera";
import { setViewDirection } from "./view-direction";
import { createViewLens } from "./view-lens";
import { setPickRay } from "./view-ray";
import {
  type CityLayer,
  countBuildings,
  ensureCityBvh,
  nearestCityHit,
  nearestWithoutBvh,
  pickCityObject,
} from "./city-layer";
import { createInquiryProbe, type OutlineSubject } from "./inquiry-probe";
import {
  bridgeShape,
  buildingShape,
  solidShape,
  standInDepth,
  trafficTriangles,
} from "./selection-shape";
import type { OutlineSelection } from "./selection-outline";
import { trafficMesh } from "./traffic-flow";
import { createCityCollider } from "./collision";
import type { CrashTrail } from "./crash-trail";
import { createSeasonClock } from "./crown-season";
import { climateDay, seasonShiftFor } from "@/lib/city/tree-season";
import {
  fetchOptionalJson,
  fetchRequiredJson,
  isAbortError,
} from "./fetch-optional";
import type { MovementMode } from "./fps-movement";
import { NO_GPU_MESSAGE } from "./gpu-support";
import { raiseSafety } from "./gpu-safety";
import { pageLeaving } from "./net-gate";
import { createSceneFog, installSceneFog, VALLEY_HAZE } from "./height-fog";
import { attachKeyboardControls } from "./keyboard-controls";
import { createLampLights, LAMP_LIGHTS } from "./lamp-layer";
import { createLantern, invalidateLanternShadow } from "./lantern";
import {
  setFountainNight,
  setFountainSeason,
  setFountainTime,
} from "./monument-layer";
import { setClockTime, setFurnitureNight } from "./furniture-layer";
import { setMapAltitude } from "./map-overlay";
import type { TramCarsStatus } from "./tram-cars";
import type { TrafficHourStatus } from "@/lib/city/traffic-hours";
import { pocFramesHeld, tickPocFrame, updatePocDebug } from "./poc-debug";
import { createPostStack, type PostStack } from "./post-stack";
import { type SceneCensus, sceneCensus } from "./scene-census";
import { retainOpenSkyTexture } from "./sky-light";
import {
  aoSamplesFor,
  postProfileFor,
  pixelRatioFor,
  type SceneBudget,
  shadowMapSizeFor,
  tileCacheBytesFor,
} from "./scene-profile";
import { createSunRig, type SunState } from "./sun-rig";
import type { GroundUniforms, TerrainLayer } from "./terrain-layer";
import {
  type AnyAttribute,
  bufferBytes,
  bufferOf,
  disposeObject3D,
  estimateGeometryBytes,
  retainSceneMaterials,
  trackedTextureBytes,
} from "./three-utils";
import {
  asksOf,
  type CpuBytes,
  cpuBytesOf,
  createTileStream,
  DRESSING_PART_NAMES,
  DRESSING_PARTS,
  type DressingPartName,
  showDataLayers,
  type TileDressing,
  withinCompileWait,
} from "./tile-stream";
import { createNetworkWatch } from "./tile-retry";
import { installMainYield, whenIdle } from "./main-yield";
import {
  bootFrames,
  printTrace,
  startTrace,
  streamTimings,
  traceRequested,
} from "./stream-timing";
import { attachTouchControls } from "./touch-controls";
import {
  createVegetationLod,
  type VegetationControl,
} from "./vegetation-layer";
import { createStyleResources, setClaySection } from "./visual-style";
import { createModelCuts } from "./model-cuts";
import * as dataLayersModule from "./data-layers-feature";
import {
  createHook,
  createWatch,
  lazyFeature,
  type SceneClock,
  type SpineHooks,
  wantOnSwitchOn,
} from "./feature-seam";

/**
 * Vertical FOV. 55° (~85° horizontal at 16:9) reads like a natural human
 * walking perspective; wider than ~60° starts to feel fisheye/distorted.
 */
const DEFAULT_FOV = 55;
/** Fog far plane (m) until the first streaming pass has landed: half a tile
 *  plus a margin, so tiles still loading read as haze, not as an edge. */
const PARTIAL_WORLD_FOG_FAR = 1100;
const SKY_COLOR = 0x9f_b6_cc;
/** How often the crash trail takes a heartbeat (crash-trail.ts). */
const TRAIL_BEAT_MS = 2000;
/** How long a memory emergency keeps the shadow camera from streaming. */
const EMERGENCY_SHADOW_HOLD_MS = 120_000;
/** Allocation failures closer together than this are one emergency. */
const EMERGENCY_GAP_MS = 5000;
/** How long a reload waits for the old device to be destroyed. */
const RELEASE_WAIT_MS = 300;
/**
 * How long a reload to a heavier page waits for the whole app to be gone
 * (`disposeForReload`): the device reports itself destroyed well within it.
 */
const TEARDOWN_WAIT_MS = 2000;
/** How often the memory governor looks at the GPU memory held. */
const GOVERN_MS = 1000;
/** How near the camera (m, in plan, to the tile's box) a building tile
 *  gets its BVH before any ray needs it, and how long that build waits
 *  for an idle main thread at most. */
const BVH_NEAR_M = 400;
const BVH_IDLE_MS = 1000;

/** Modell's sheet: the picture style's paper (its first swatch). */
const paperOf = (style: RenderStyle): Color =>
  new Color(RENDER_STYLE_BY_ID[style].swatch[0]);

/** The HUD census's layers: the content's own, and a dressing's parts
 *  (tile-stream.ts DRESSING_PARTS). */
export type LayerName =
  | "bikes"
  | "trams"
  | "city"
  | "fences"
  | "kerbs"
  | "stairs"
  | "terrain"
  | "walls"
  | "water"
  | DressingPartName;

/** The census of every dressing part, over the visible dressings. */
function dressingCensus(
  dressings: TileDressing[],
  census: (roots: (Object3D | undefined)[]) => SceneCensus
): Record<DressingPartName, SceneCensus> {
  return Object.fromEntries(
    DRESSING_PART_NAMES.map((name) => [
      name,
      census(dressings.map(DRESSING_PARTS[name])),
    ])
  ) as Record<DressingPartName, SceneCensus>;
}

export interface CityWalkStats {
  buildingCount: number;
  /** estimated GPU footprint of geometry + textures + shadow map (MB) */
  gpuMegabytes: number;
  /** what each layer actually built — the e2e suite asserts on these */
  layerStats: Record<LayerName, SceneCensus>;
  shadowsEnabled: boolean;
  terrainVertexCount: number;
}

/** `CityWalkHandle.getGpuDebug`'s report. */
export interface GpuDebug {
  drawables: number;
  /** distinct index / vertex buffers under the scene, and their bytes */
  sceneIndices: number;
  sceneIndexBytes: number;
  sceneBuffers: number;
  sceneBufferBytes: number;
  /** three's `info.memory` */
  held: Readonly<Record<string, number>>;
  /** what the loaded tiles keep on the page's process, by kind, MB
   *  (tile-stream.ts `CpuBytes`): three's count above never sees it */
  cpuMB: Readonly<Record<keyof CpuBytes, number>>;
  /** pipeline anchors holding scene-wide pipelines (pipeline-anchors.ts) */
  anchors: number;
  /** the tile cache: bytes it counts against its budget, tiles in it, in use */
  tileCache: {
    bytes: number;
    maxBytes: number;
    items: number;
    used: number;
    loaded: number;
    /** each tile's MB as the cache counts it, "u" when in use */
    sizes: string[];
  };
}

/** Counts the distinct buffers under a scene (shared ones once). */
function sceneBuffers(
  scene: Object3D
): Omit<GpuDebug, "held" | "tileCache" | "anchors" | "cpuMB"> {
  const indices = new Map<object, number>();
  const buffers = new Map<object, number>();
  let drawables = 0;
  scene.traverse((object) => {
    const geometry = (
      object as Object3D & {
        geometry?: {
          attributes: Record<string, AnyAttribute>;
          index: BufferAttribute | null;
        };
      }
    ).geometry;
    if (!geometry) {
      return;
    }
    drawables++;
    // by count, not by the array: a tile drops the CPU copies it uploaded
    if (geometry.index) {
      indices.set(geometry.index, bufferBytes(geometry.index));
    }
    for (const attribute of Object.values(geometry.attributes)) {
      const owner = bufferOf(attribute);
      buffers.set(owner, bufferBytes(owner));
    }
  });
  const sum = (m: Map<object, number>) =>
    [...m.values()].reduce((a, b) => a + b, 0);
  return {
    drawables,
    sceneIndices: indices.size,
    sceneIndexBytes: sum(indices),
    sceneBuffers: buffers.size,
    sceneBufferBytes: sum(buffers),
  };
}

/** What the HUD knows of the site from the tileset alone (`onSiteInfo`). */
export type SiteInfo = Pick<
  CityWalkHandle,
  "landcoverTiles" | "landmarks" | "latLng" | "provenanceUrl" | "terrainBounds"
>;

export interface CityWalkOptions {
  /**
   * The render budget (profile, device tier, whether the neighbour tiles
   * load), resolved once by the client — see scene-profile.ts. Everything
   * here takes its numbers from it instead of reading the window.
   */
  budget: SceneBudget;
  container: HTMLElement;
  /**
   * Where a recovered page's player stood (gpu-recovery.ts, the snapshot's
   * camera): the boot places the camera there before the stream's first
   * update and waits for the tile under it, so the page loads that place
   * and not the spawn first. Off every tile the boot starts at the spawn.
   * Modell's part is the caller's to put back after the first frame.
   */
  initialCamera?: CameraState;
  /**
   * A place picked in the HUD before the first frame (a vantage, a
   * landmark, a spot on the minimap): the boot starts there, as it does a
   * recovered page's camera, instead of at the spawn. `initialCamera`
   * wins when both are given.
   */
  initialView?: ViewpointGeometry;
  initialDate: Date;
  /**
   * The look store (HUD-owned; lib/city/look-state.ts): the scene applies its
   * current values at boot, on every change, and to each tile that lands
   * later. It outlives the scene, so dispose() unsubscribes.
   */
  look: LookState;
  /**
   * Something that streams in after the first frame failed to load. The
   * scene keeps running; the HUD shows the message.
   */
  onError?: (message: string) => void;
  /** The tile behind `onError` came back after all (it had failed on the
   *  network, tile-retry.ts): the HUD's message goes. */
  onErrorCleared?: () => void;
  /**
   * The GPU is gone for good, or a frame threw and left three's renderer
   * in a state no later frame draws right (the render stopped) — `how`:
   * lost in use, reclaimed by iOS while the page was in the background,
   * or failed — a frame that threw on a GPU still working, a bug
   * (lib/city/gpu-safety.ts). The reload to run when the page recovers by
   * itself (gpu-recovery.ts, a reload where the player stood): the scene
   * runs it once the old device is freed, and once the page is in view.
   * Null: the HUD says the graphics failed (`onFatal`).
   */
  onGpuLost?: (how: GpuLoss) => (() => void) | null;
  /**
   * The render stopped after the first frame and the page did not recover
   * by itself: the graphics failed as a whole, not one layer. `message` is
   * the browser's own (WebKit's, three's), for the failure card's details.
   */
  onFatal?: (message: string) => void;
  /** throttled (~2 Hz) smoothed FPS, decoupled from the heavier stats emit */
  onFps?: (fps: number) => void;
  /**
   * The page's crash trail (crash-trail.ts): the scene notes its boot
   * stages, style switches and GPU trouble there and beats every couple of
   * seconds, so a page the browser kills leaves a trace.
   */
  trail?: CrashTrail;
  /**
   * The loop's pace while the HUD covers the scene (lib/city/frame-pace.ts):
   * the HUD sets it, the loop asks it before every frame. Without one every
   * frame draws.
   */
  pace?: FramePace;
  /** Every layer has streamed in (the scene is complete). */
  onLoaded?: () => void;
  /**
   * The site as the tileset describes it, as soon as the tileset is read —
   * long before the first frame: the HUD's places, minimap and sun readout
   * work while the scene is still loading.
   */
  onSiteInfo?: (info: SiteInfo) => void;
  /**
   * After `onLoaded`: whether tiles or their details are loading right now
   * (a flight streams new tiles in). Fires on changes only.
   */
  onBusy?: (busy: boolean) => void;
  /** a manual look or move ended live mode (camera-pose.ts) */
  onFollowEnd?: () => void;
  /**
   * What was asked last ("Befragen", ADR 0042): a click, a long press or
   * `I` under the pointer, or a candidate chosen from the strip; null when
   * nothing stands there. `along`: everything the question's ray met.
   */
  onInquiry?: (inquiry: Inquiry | null, along: InquiryAlong | null) => void;
  /** walk, fly or Modell (plan 055): at the start of a switch */
  onModeChange?: (mode: ViewMode) => void;
  /**
   * Modell's view for the HUD (the scale bar, the north arrow, the
   * projection cards, the minimap's footprint), throttled like the pose;
   * null once Modell is left.
   */
  onModelView?: (view: ModelHud | null) => void;
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
  /**
   * The live bicycle counts while their data layer is on (data-overlays.ts),
   * for the HUD's list; [] when it is switched off.
   */
  onBikeCounts?: (counters: BikeCounter[]) => void;
  /**
   * The timetable trams' day and count while their data layer is on
   * (about once a second); null when it is switched off.
   */
  onTramStatus?: (status: TramCarsStatus | null) => void;
  /**
   * The traffic's hour (how busy the scene's instant is on the typical
   * daily curve) while its data layer is on, about once a second; null
   * when it is switched off.
   */
  onTrafficHour?: (status: TrafficHourStatus | null) => void;
  /**
   * Aborts startup mid-load (React StrictMode mounts effects twice in dev;
   * without this the doomed first instance would finish loading 19 MB of
   * tile data and leave a second canvas around until then).
   */
  signal?: AbortSignal;
  /** the site the route renders: its spawn, viewpoints and fallback place */
  site: Site;
  /** the 3D Tiles tileset to stream (lib/city/tileset.ts), a served URL */
  tilesetUrl: string;
}

/**
 * The imperative surface the HUD (and, in dev/test builds, `window.__poc`)
 * drives. The look values are NOT here: they live in the look store passed in
 * through CityWalkOptions, which the scene subscribes to.
 */
/** A captured frame and how many of its pixels make a CSS pixel. */
export interface CapturedImage {
  canvas: HTMLCanvasElement;
  imagePxPerCssPx: number;
}

export interface CityWalkHandle {
  /** Restores a camera pose captured by getCameraState (snapshot replay). */
  applyCameraState: (state: CameraState) => void;
  /** Removes the inquiry mark (the card was closed). */
  clearInquiry: () => void;
  demolishAtCrosshair: () => void;
  dispose: () => void;
  /**
   * Asks what stands at a screen point (NDC; the centre when omitted),
   * marks it and reports it through `onInquiry`; tests and QA call it.
   */
  inquireAt: (ndc?: { x: number; y: number }) => Inquiry | null;
  /** Shows another candidate of the last question (the strip's click):
   *  marks it and reports it through `onInquiry`. */
  selectCandidate: (index: number) => Inquiry | null;
  /** Outlines a candidate of the last question while the pointer is on
   *  it in the strip; null outlines the chosen one again. */
  previewCandidate: (index: number | null) => void;
  /** The provenance manifest (lib/city/provenance.ts), when the tileset
   *  names one: the inquiry card's source lines. */
  provenanceUrl: string | null;
  /** Opt-in pointer-lock mouse-look (desktop); Esc exits natively. */
  enterImmersive: () => void;
  /**
   * The page is about to reload after the render stopped (the failure
   * card's buttons): frees the GPU — three's renderer and its device —
   * and settles within RELEASE_WAIT_MS. Nothing draws after it.
   */
  releaseGpu: () => Promise<void>;
  /**
   * The page is about to reload to a heavier budget (*Qualität*'s full
   * detail) on a GPU that works: the whole app torn down — every tile,
   * buffer and texture destroyed one by one, then the renderer and its
   * device — settling once the device reports itself destroyed, within
   * TEARDOWN_WAIT_MS. A reload after `releaseGpu` alone left the old
   * page's GPU memory to WebKit, which frees it only once the old document
   * is collected: the new page, booting in the same process, died at a
   * third of what a fresh one holds. Nothing draws after it.
   */
  disposeForReload: () => Promise<void>;
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
  /**
   * What the scene still holds against what the renderer keeps on the GPU
   * (QA/diagnostics): buffers the renderer holds beyond the scene's own
   * are a leak.
   */
  getGpuDebug: () => GpuDebug;
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
   * GPU counters for perf work: the draw calls and triangles of the last
   * frame (every pass: shadow map, scene, post).
   */
  getRenderInfo: () => {
    calls: number;
    /**
     * Node builds made while a frame drew, since the boot: a compile
     * builds between frames, so these were built by the frame that first
     * drew them — `shadow` the shadow pass's (no compile reaches it: three
     * skips the shadow map while it precompiles), `other` the rest (the
     * post passes' first frames, anything a compile missed).
     */
    framedBuilds: { other: number; shadow: number };
    /** estimated GPU bytes of geometry + textures + shadow map */
    gpuBytes: number;
    /**
     * What the renderer itself holds on the GPU (three's `info.memory`):
     * counts and bytes of attributes, textures, programs, uniform buffers
     * and render targets — the counters to watch for a leak.
     */
    memory: Readonly<Record<string, number>>;
    /** the last frame's render passes (three's `frameCalls`: every pass) */
    passes: number;
    triangles: number;
  };
  /** the site's most notable landmarks (Wikidata), for the HUD's list */
  landmarks: Landmark[];
  /** per-tile land-cover class PNGs + their EPSG bounds, for the minimap */
  landcoverTiles: MapTile[];
  /** the scene's geographic position — the HUD's sunrise/sunset times */
  latLng: { lat: number; lng: number };
  /** recenter offset, lets callers map EPSG coords -> world coords */
  offset: { cx: number; cy: number };
  /** analog altitude-stick input (fly mode): +1 climbs, −1 sinks */
  setClimbInput: (v: number) => void;
  /** analog joystick input: x = strafe right, y = forward, both [-1, 1] */
  setMoveInput: (x: number, y: number) => void;
  setMovementMode: (mode: MovementMode) => void;
  /** walk, fly or Modell — a switch into or out of Modell is a dolly zoom */
  setViewMode: (mode: ViewMode) => void;
  getViewMode: () => ViewMode;
  /**
   * Bild speichern (plan 055): the next frame as a canvas — a parallel
   * view rendered larger than the canvas in tiles (lib/city/image-export.ts)
   */
  captureImage: () => Promise<CapturedImage>;
  /** M: into Modell, or back to where it was entered from */
  toggleModel: () => void;
  /** Modell's Ausschnitt: the middle of the view as a model, or the whole city */
  setCutOut: (on: boolean) => void;
  /** Modell's view (plan 055): its projection, scale, turn and tilt */
  setModelPreset: (preset: ModelPresetId) => void;
  /** a scale denominator at 96 dpi (1 : n) */
  setModelScale: (denominator: number) => void;
  /** turns Modell's view by `deg` (the rotate buttons) */
  turnModel: (deg: number) => void;
  /** turns Modell's view to a compass heading (the north arrow: 0) */
  turnModelTo: (deg: number) => void;
  /** Vogelschau's tilt, degrees below the horizon */
  setModelTilt: (deg: number) => void;
  /** the Militärperspektive's heights: 1 = full, ⅔ … */
  setModelShear: (k: number) => void;
  getModelHud: () => ModelHud | null;
  /**
   * The aim (grid heading + pitch, degrees) the view eases towards while it
   * follows the phone; null stops following (camera-pose.ts).
   */
  setFollowAim: (aim: FollowAim | null) => void;
  /** live mode's GPS ground point (EPSG), null stops (camera-pose.ts) */
  setFollowPosition: (epsg: { x: number; y: number } | null) => void;
  /**
   * Moves the sun to an instant. `preview` marks a step of a drag through
   * the day: what is dear and not needed at every step (the sky's
   * reflection) follows a few times a second; the call without it, which
   * ends the drag, brings everything up to date at once.
   */
  setSun: (date: Date, preview?: boolean) => SunState;
  /**
   * Lets the heavy dressing start — vegetation, lamps, rails — and
   * the terrain BVHs. Held back so its synchronous chunks cannot stutter the
   * frames the city arrives in; idempotent, and a no-op once the scene is
   * disposed.
   */
  startStreaming: () => void;
  /**
   * Puts the camera on a vantage at once, no glide (the spawn, "locate
   * me"), landing in the vantage's movement mode.
   */
  placeAt: (viewpoint: ViewpointGeometry) => void;
  /** Drops the player at EPSG coordinates, standing on the terrain. */
  teleportTo: (epsgX: number, epsgY: number) => void;
  /** Glides to EPSG coordinates (the minimap click; camera-pose.ts). */
  glideToSpot: (epsgX: number, epsgY: number) => void;
  /** Where the glide in progress lands (EPSG), or null. */
  getGlideTarget: () => { epsgX: number; epsgY: number } | null;
  /** the site's extent in EPSG coordinates — the minimap frame */
  terrainBounds: TerrainBounds;
}

/**
 * three's WebGPURenderer: WebGPU where the browser has it, its WebGL2
 * backend otherwise (or on `?gpu=webgl2`, scene-profile.ts). One renderer,
 * one set of node materials either way (ADR 0027).
 */
async function createRenderer(
  container: HTMLElement,
  budget: SceneBudget
): Promise<WebGPURenderer> {
  // No MSAA: the scene renders into the post stack's own target and SMAA
  // carries the AA (post-stack.ts); a multisampled canvas would only be
  // resolved for a full-screen quad.
  const renderer = new WebGPURenderer({
    antialias: false,
    powerPreference: "high-performance",
    forceWebGL: budget.forceWebGL,
  });
  try {
    await renderer.init();
  } catch (error) {
    // No adapter and no WebGL2 either (the preflight only sees that
    // `navigator.gpu` exists): free what init made, and say why in the
    // HUD's words rather than three's raw backend error (kept as `cause`).
    renderer.dispose().catch(() => undefined);
    throw new Error(NO_GPU_MESSAGE, { cause: error });
  }
  // The `lite` profile renders at half linear resolution (a quarter of the
  // pixels) and lets the browser upscale. The canvas fills the viewport and
  // the HUD needs a desktop-width window to lay out, so this — not the
  // Playwright viewport — is the only honest way to cut fill-rate in the
  // headless suite, where every pixel is shaded on the CPU. Fill-rate is what
  // the post stack costs, and the post stack is most of a frame.
  renderer.setPixelRatio(
    pixelRatioFor(
      budget.profile,
      budget.tier,
      window.devicePixelRatio,
      budget.safety
    )
  );
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.shadowMap.enabled = true;
  // getRenderInfo reads the last rendered frame: the loop resets the
  // counters itself, right before it draws (a held frame keeps them).
  renderer.info.autoReset = false;
  // PCFShadowMap with a raised `shadow.radius` is soft (a Vogel disk, see
  // sun-rig.ts), and VSM paints a grid on lit faces here: tight contact +
  // artefact-free surfaces. Its only weakness is the texel staircase on
  // shadow edges at a grazing sun, which a fine-texel camera-following
  // frustum keeps small.
  renderer.shadowMap.type = PCFShadowMap;
  // The on-demand shadow gate lives on the LIGHT (`sun.shadow.autoUpdate` in
  // sun-rig.ts): the sun is the only shadow caster (lamp lights are
  // castShadow:false) and the rig re-renders the map from inside the render
  // loop whenever its camera-following frustum moves. The ~640k-triangle
  // depth pass is what gets skipped.
  renderer.domElement.style.display = "block";
  // Touch gestures (look/pinch/double-tap) need the browser to keep its
  // hands off scrolling and double-tap zoom on the canvas.
  renderer.domElement.style.touchAction = "none";
  container.appendChild(renderer.domElement);
  return renderer;
}

/**
 * Counts the node builds (TSL → WGSL, on the main thread) made while a
 * frame draws, through three's public debug hook: the in-frame builds
 * `getRenderInfo` reports. A compile builds between frames, so nothing it
 * builds is counted.
 */
function framedBuildCounter(renderer: WebGPURenderer) {
  const counts = { other: 0, shadow: 0 };
  let drawing = false;
  renderer.debug.onNodeBuilderCreated = (_builder, renderObject) => {
    if (!drawing) {
      return;
    }
    // The render object's material, not the builder's: three calls the
    // hook before it hands the builder the material it builds (the shadow
    // pass's own, for a caster), and the builder holds the object's.
    // reason: the hook types its render object `unknown`, and the shadow
    // pass's material flag is not in the @types.
    const { material } = renderObject as {
      material?: { isShadowPassMaterial?: boolean };
    };
    if (material?.isShadowPassMaterial === true) {
      counts.shadow++;
    } else {
      counts.other++;
    }
  };
  return {
    counts,
    draw: (render: () => void) => {
      drawing = true;
      try {
        render();
      } finally {
        drawing = false;
      }
    },
  };
}

/**
 * Tells the crash trail what the renderer runs on, and chains its public
 * device-lost and GPU-error callbacks through it (three's own handlers
 * still run: they log and stop the renderer).
 */
function traceRenderer(
  renderer: WebGPURenderer,
  trail: CrashTrail,
  safety: SafetyLevel
): void {
  const backend = renderer.backend as { isWebGPUBackend?: boolean };
  trail.set({
    backend: backend.isWebGPUBackend ? "WebGPU" : "WebGL2",
    pixelRatio: renderer.getPixelRatio(),
    safety,
  });
  if (safety > 0) {
    // A lighter page (lib/city/gpu-safety.ts): what the device went through.
    trail.note("safety", `level ${safety}`);
  }
  const onLost = renderer.onDeviceLost.bind(renderer);
  renderer.onDeviceLost = (info) => {
    trail.note("device-lost", `${info.reason ?? ""} ${info.message}`);
    onLost(info);
  };
  const onError = renderer.onError.bind(renderer);
  // reason: typed as a string; the WebGPU backend passes { type, message }.
  renderer.onError = (info: string | { type?: string; message?: string }) => {
    trail.note(
      "gpu-error",
      typeof info === "string"
        ? info
        : `${info.type ?? ""} ${info.message ?? ""}`
    );
    onError(info as string);
  };
}

/** The part of a WebGPU device the resume guard probes with. */
interface ProbedDevice {
  createCommandEncoder: () => { finish: () => unknown };
  queue: { submit: (commandBuffers: unknown[]) => void };
}

/**
 * Settles once the renderer's WebGPU device is lost — after its destroy,
 * when the GPU process has taken it — or at once on the WebGL2 backend,
 * which has none. three ignores a loss for `destroyed` (no recovery runs).
 */
function deviceGone(renderer: WebGPURenderer): Promise<void> {
  const backend = renderer.backend as {
    isWebGPUBackend?: boolean;
    device?: { lost: Promise<unknown> } | null;
  };
  const device = backend.isWebGPUBackend ? backend.device : null;
  return device ? device.lost.then(() => undefined) : Promise.resolve();
}

/**
 * Whether the GPU still answers: an empty command buffer, encoded and
 * submitted. When iOS has taken Safari's GPU process, WebKit throws right
 * here ("Unable to make command encoder", "Unable to finish") — before
 * any device-lost arrives, and before a frame throws the same way. The
 * error's message, or null; the WebGL2 backend has nothing to probe.
 */
function probeGpu(renderer: WebGPURenderer): string | null {
  const backend = renderer.backend as {
    isWebGPUBackend?: boolean;
    device?: ProbedDevice | null;
  };
  const device = backend.isWebGPUBackend ? backend.device : null;
  if (!device) {
    return null;
  }
  try {
    const encoder = device.createCommandEncoder();
    device.queue.submit([encoder.finish()]);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/**
 * Frees the GPU before the page reloads. three's dispose first unhooks
 * every geometry's dispose listener — a geometry freed later (a compile
 * settling, the tile cache) can no longer reach three's destroyAttribute
 * with an attribute whose upload failed, which threw — then destroys the
 * device: WebKit otherwise frees its allocations only once the old
 * document is collected, after the new page started allocating in the
 * same process. Settles within RELEASE_WAIT_MS either way.
 */
function releaseGpu(renderer: WebGPURenderer): Promise<void> {
  let released: Promise<void>;
  try {
    released = renderer.dispose().catch(() => undefined);
  } catch {
    released = Promise.resolve();
  }
  return Promise.race([
    released,
    new Promise<void>((resolve) => {
      setTimeout(resolve, RELEASE_WAIT_MS);
    }),
  ]);
}

/**
 * Runs `then` now, or once the page is in view again: a page reloaded in
 * the background boots hidden, which is where iOS takes GPUs away.
 */
function whenVisible(then: () => void): void {
  if (!document.hidden) {
    then();
    return;
  }
  const onShow = () => {
    if (!document.hidden) {
      document.removeEventListener("visibilitychange", onShow);
      then();
    }
  };
  document.addEventListener("visibilitychange", onShow);
}

/**
 * Unloads every tile the cache holds that is not in use, at once (on a
 * hide, in an emergency): for that call the cache keeps none of them and
 * frees all its excess — it frees 5 % per call otherwise, the rest a frame
 * later, and no frame runs in a hidden page. Both bounds are back as they
 * were after it: what the cache keeps from then on is the caller's (the
 * memory governor's step). Public API of 3DTilesRendererJS's cache.
 */
function shedUnusedTiles(cache: {
  minBytesSize: number;
  unloadPercent: number;
  unloadUnusedContent: () => void;
}): void {
  const { minBytesSize, unloadPercent } = cache;
  cache.minBytesSize = 0;
  cache.unloadPercent = 1;
  try {
    cache.unloadUnusedContent();
  } finally {
    cache.minBytesSize = minBytesSize;
    cache.unloadPercent = unloadPercent;
  }
}

/**
 * What the renderer holds, by kind, for the crash trail's heartbeat: the
 * counts, and the MB of the two kinds that weigh — so a report says
 * whether geometry or rasters ran a phone out of GPU memory.
 */
function heldByKind(m: WebGPURenderer["info"]["memory"]): string {
  const mb = (bytes: number) => Math.round(bytes / 1_048_576);
  return (
    `${m.attributes}a ${mb(m.attributesSize + m.indexAttributesSize)}MB ` +
    `${m.textures}t ${mb(m.texturesSize)}MB ${m.renderTargets}rt ` +
    `${m.programs}p ${m.uniformBuffers}u`
  );
}

/**
 * What the tile stream holds and does, for the crash trail's heartbeat:
 * the terrain levels loaded with their rasters (fine, coarse), the tile
 * cache against its bounds, the tile contents in flight and those that
 * failed — what tells a GPU that ran out from a page killed in the middle
 * of a download burst.
 */
function streamByKind(
  stream: ReturnType<typeof createTileStream>
): Partial<Parameters<CrashTrail["beat"]>[0]> {
  let fine = 0;
  for (const terrain of stream.terrains) {
    fine += terrain.level === 0 ? 1 : 0;
  }
  // (Both are public in 3DTilesRendererJS's code, missing from its types.)
  const cache = stream.tiles.lruCache as typeof stream.tiles.lruCache & {
    cachedBytes: number;
  };
  const { stats } = stream.tiles as unknown as {
    stats: { downloading: number; parsing: number; failed: number };
  };
  return {
    fine,
    coarse: stream.terrains.size - fine,
    cacheMB: cache.cachedBytes / 1_048_576,
    cacheMinMB: cache.minBytesSize / 1_048_576,
    cacheMaxMB: cache.maxBytesSize / 1_048_576,
    downloading: stats.downloading,
    parsing: stats.parsing,
    failed: stats.failed,
  };
}

/** Reprojects the recenter point (the spawn tile's centre) for SunCalc. */
function siteLatLng(
  site: Site,
  epsg: number,
  offset: { cx: number; cy: number }
): { lat: number; lng: number } {
  return utmToLatLng(epsg, offset.cx, offset.cy) ?? site.fallbackLatLng;
}

export async function createCityWalkApp(
  opts: CityWalkOptions
): Promise<CityWalkHandle> {
  // before the first compile: WebKit's compiles otherwise wait a frame
  // per step (main-yield.ts)
  installMainYield();
  const renderer = await createRenderer(opts.container, opts.budget);
  if (opts.trail) {
    traceRenderer(renderer, opts.trail, opts.budget.safety);
  }
  const scene = new Scene();
  scene.background = new Color(SKY_COLOR);

  // Everything bootApp creates registers its teardown here, so a boot that
  // throws halfway (a real load failure, or the StrictMode remount aborting
  // one) frees exactly what a clean dispose would. Without it the post stack's
  // screen targets, the style materials, the listeners and the per-tile
  // layer controls survived a failed boot.
  // The scene-wide shared resources (three-utils.ts `sceneShared`) go with
  // the last app that holds them: first in, so they unwind last.
  const cleanups: Array<() => void> = [
    retainSceneMaterials(),
    retainOpenSkyTexture(),
  ];
  // `?trace=1`: the stream's timings on the browser's timeline, the long
  // tasks counted, the summary printed once loaded (stream-timing.ts).
  const tracing = traceRequested(window.location.search);
  if (tracing) {
    cleanups.push(startTrace());
  }
  try {
    return await bootApp(opts, renderer, scene, cleanups);
  } catch (err) {
    // Centralized teardown: covers both abort (StrictMode remount) and real
    // load failures — otherwise the dead canvas would linger in the DOM.
    void teardown(cleanups, scene, renderer);
    throw err;
  }
}

/**
 * The one teardown of an app, clean or failed: its registered cleanups, the
 * scene's GPU resources, then the renderer with its device (or, on the
 * WebGL2 backend, its context) — the next app (a StrictMode remount, a round
 * trip to /wissen) makes its own canvas, and a browser holds only a handful
 * of contexts; whatever still points at this one draws nothing.
 */
function teardown(
  cleanups: Array<() => void>,
  scene: Scene,
  renderer: WebGPURenderer
): Promise<void> {
  runCleanups(cleanups);
  disposeObject3D(scene);
  return releaseRenderer(renderer);
}

/**
 * The teardown before a reload to a heavier page (`disposeForReload`):
 * the same, but every buffer and texture is destroyed by three one by one
 * while it still listens — the stream's shared rasters (the class raster,
 * its splat, NDVI, sky view: tens of MB on a phone) free in a promise's
 * turn (shared-rasters.ts `clear`), so the renderer goes a task later;
 * after its dispose only the device's own destroy would reach them. Never
 * rejects: a cleanup that throws still lets the renderer and its device go.
 */
async function teardownWhole(
  cleanups: Array<() => void>,
  scene: Scene,
  renderer: WebGPURenderer,
  /** what the renderer still holds once the scene is gone, before it goes */
  onSceneGone: (memory: {
    geometries: number;
    textures: number;
    total: number;
  }) => void
): Promise<void> {
  try {
    runCleanups(cleanups);
    disposeObject3D(scene);
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
    onSceneGone(renderer.info.memory);
  } catch {
    // The renderer and its device go regardless (below).
  }
  await releaseRenderer(renderer);
}

/** The renderer and its device (or its context), and its canvas. */
function releaseRenderer(renderer: WebGPURenderer): Promise<void> {
  // Async: it destroys the device (or loses the context) at the end.
  const released = renderer.dispose().catch(() => undefined);
  renderer.domElement.remove();
  return released;
}

/** Unwinds registered teardowns in reverse creation order. */
function runCleanups(cleanups: Array<() => void>): void {
  for (const cleanup of [...cleanups].reverse()) {
    cleanup();
  }
}

/** The whole site's extent in EPSG coordinates (the minimap frame). */
function unionBounds(extras: TilesetExtras): TerrainBounds {
  return extras.tiles.reduce<TerrainBounds>(
    (acc, { bounds: b }) => [
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
}

async function bootApp(
  opts: CityWalkOptions,
  renderer: WebGPURenderer,
  scene: Scene,
  cleanups: Array<() => void>
): Promise<CityWalkHandle> {
  const { container, budget } = opts;
  let disposed = false;
  const framedBuilds = framedBuildCounter(renderer);

  const camera = new PerspectiveCamera(
    DEFAULT_FOV,
    container.clientWidth / Math.max(container.clientHeight, 1),
    0.3,
    6000
  );
  scene.add(camera);
  // What the tile renderer streams for while walking or flying: the
  // camera's twin with its far plane where the fog ends (`streamFarFor`,
  // synced every frame before the stream's update). The 6 km frustum loaded,
  // compiled, gave a BVH to and drew every building tile out to the site's
  // edge as plain fog colour; the camera itself keeps its far plane for the
  // sky dome. Modell streams for its own camera (`swapCamera`).
  const streamCamera = new PerspectiveCamera(
    camera.fov,
    camera.aspect,
    camera.near,
    camera.far
  );
  // What the post passes know of the camera drawing the frame (view-lens.ts),
  // and that camera: walk/fly's, or Modell's parallel one (model-rig.ts,
  // created with the pose below).
  const lens = createViewLens();
  let rig: ModelRig | null = null;
  const activeCamera = (): Camera => rig?.current() ?? camera;

  // The data is Z-up (EPSG); rotate the parent group -90° about X so data Z
  // (elevation) becomes three.js Y (up) and FPS controls just work. The
  // tileset streams into it (its frame is the data frame).
  const world = new Group();
  world.rotation.x = -Math.PI / 2;
  // Modell's Ausschnitt clips the city's group; the cut's own strips (the
  // Schnitt's ground profile, the plinth) stand outside it (model-cuts.ts).
  const cuts = createModelCuts();
  cuts.group.add(world);
  scene.add(cuts.group, ...cuts.objects);
  // Counts the terrain's changes: the cuts' strips follow the ground.
  let groundVersion = 0;
  cleanups.push(() => cuts.dispose());

  // Abort checkpoint after each async step (fetches abort via the signal
  // themselves; parsing/meshing in between does not).
  const ensureAlive = () => {
    if (disposed || opts.signal?.aborted) {
      throw new DOMException("CityWalk startup aborted", "AbortError");
    }
  };

  /**
   * One stage report for the HUD (lib/city/load-stages.ts), passed on only
   * when it says something new: the spawn wait polls every 50 ms and every
   * tile event re-reports both streaming stages, and each report is a
   * transition that re-renders the whole HUD.
   */
  const stagesDone = new Set<LoadStageId>();
  const stagesSent = new Map<LoadStageId, string>();
  const stage = (id: LoadStageId, fraction: number, skipped?: boolean) => {
    if ((fraction >= 1 || skipped) && !stagesDone.has(id)) {
      stagesDone.add(id);
      opts.trail?.note(`stage ${id}`, skipped ? "skipped" : undefined);
    }
    const said = `${fraction}${skipped ? "s" : ""}`;
    if (stagesSent.get(id) === said) {
      return;
    }
    stagesSent.set(id, said);
    opts.onStage?.({ id, fraction, skipped });
  };

  stage("buildings", 0);
  // What the viewer needs before any content: the frame and the tile list.
  const tilesetUrl = new URL(opts.tilesetUrl, window.location.href).href;
  const tileset = await fetchRequiredJson<unknown>(tilesetUrl, opts.signal);
  const extras = parseTilesetExtras(tileset);
  ensureAlive();
  const { offset } = extras;
  // The tile the boot starts on and waits for: the spawn tile, or the one
  // a recovered page's camera, or a place picked in the HUD while the page
  // was loading, stands on (lib/city/boot-start.ts).
  const { picked, restored, spawn } = startOf(opts, extras.tiles);
  const siteBounds = unionBounds(extras);

  // Shared world sun direction (surface→sun), kept in sync by the sun rig and
  // read by the water glitter, the kerb shadow and the crown shimmer (by
  // reference: the uniform nodes hold this very vector).
  const sunDirection = new Vector3(0, 1, 0);
  // The scene's fog, one node for every material (height-fog.ts): the range
  // follows the look, the colour the sun rig, the valley pool's start the
  // lowest terrain landed.
  const sceneFog = createSceneFog(
    SKY_COLOR,
    fogRangeFor(opts.look.get().fogAmount)
  );
  installSceneFog(scene, sceneFog);
  // How deep the valley haze pools: a share of the site's own relief.
  sceneFog.heightFalloff.value = valleyFalloff(extras.ground);
  // The site's world XZ rectangle: EPSG north is world −Z.
  sceneFog.siteRect.value.set(
    siteBounds[0] - offset.cx,
    -(siteBounds[3] - offset.cy),
    siteBounds[2] - offset.cx,
    -(siteBounds[1] - offset.cy)
  );
  // The ground's shadow reach and the sun: uniform nodes every tile's
  // materials share, kept by the sun rig.
  const ground: GroundUniforms = {
    // the sun rig's own vector once it exists (below)
    shadowReach: uniform(new Vector3()),
    sunDirection: uniform(sunDirection),
  };
  // The site's ground (lib/city/ground.ts): the visible terrains' heights,
  // fine level first, and the lowest real terrain elevation so far (the Elbe
  // surface) — the floor the player stands on off every tile and the valley
  // height-fog's start, lowered as each tile lands (a uniform write, no
  // recompile).
  const siteGround = createGround(offset);
  const lowerGroundFloor = (minElevation: number) => {
    if (siteGround.lowerFloor(minElevation)) {
      sceneFog.heightStart.value = minElevation + 1;
    }
  };

  // The sun rig only needs a centre to start from (its frustum follows the
  // camera): the spawn tile's, at street level.
  const [sx0, sy0, sx1, sy1] = spawn.bounds;
  const worldBounds = new Box3(
    new Vector3(sx0 - offset.cx, 0, -(sy1 - offset.cy)),
    new Vector3(sx1 - offset.cx, 200, -(sy0 - offset.cy))
  );
  // Where the site sits on the globe: the sun rig needs it, and so does the
  // HUD's sunrise/sunset readout.
  const latLng = siteLatLng(opts.site, extras.epsg, offset);
  const siteInfo: SiteInfo = {
    landmarks: extras.landmarks ?? [],
    landcoverTiles: extras.tiles.map((t) => ({
      src: new URL(t.minimap, tilesetUrl).href,
      bounds: t.bounds,
      bridges: t.bridges ? new URL(t.bridges, tilesetUrl).href : undefined,
    })),
    latLng,
    provenanceUrl: extras.provenance
      ? new URL(extras.provenance, tilesetUrl).href
      : null,
    terrainBounds: siteBounds,
  };
  opts.onSiteInfo?.(siteInfo);
  const sunRig = createSunRig(
    scene,
    worldBounds,
    latLng,
    shadowMapSizeFor(budget.profile, budget.tier, budget.safety),
    sunDirection,
    sceneFog.color,
    renderer
  );
  cleanups.push(sunRig.dispose);
  // The horizon's near band hands over to the shadow map inside the frustum.
  ground.shadowReach.value = sunRig.shadowReach;

  // The walker's lantern (lantern.ts): one more light, built before the
  // first render as the lamps' pool below is; carried with the camera after
  // dark.
  const lantern = createLantern(budget.tier);
  scene.add(lantern.light);
  cleanups.push(() => lantern.dispose());
  /**
   * Forces one shadow-map re-render. The map is otherwise only redrawn when the
   * sun or the frustum moves, so **every new scene object and every material
   * change that alters the depth pass has to call this** — a missing call shows
   * up as a stale shadow (a demolished building still casting, a new one not),
   * never as a crash. Tiles landing, leaving or changing level call it through
   * the stream's change hook.
   */
  const invalidateShadows = () => {
    sunRig.invalidateShadow();
    invalidateLanternShadow(lantern);
  };

  // One scalar (nightFactor ∈ [0,1]) ignites every lamp at dusk; clayNight
  // gates the clay dusk glow by reference.
  const clayNight = uniform(0);
  let currentNight = 0;
  // The picture styles follow the sun too (Film noir's dusk exposure); the
  // post stack is built after the first setSun, so it catches up there.
  let sunAltitude = 90;
  let sunToStyles: ((altitudeDeg: number) => void) | null = null;
  // The scene's instant as the HUD set it last: the data layers' clock
  // (the timetable trams, the traffic's hour) runs on from it — read when
  // they start, which may be long after (feature-seam.ts).
  const sceneClock = createWatch<SceneClock>({
    date: opts.initialDate,
    atMs: performance.now(),
  });
  // Single fixed pool of real point lights for the nearest lamps across ALL
  // tiles, built before the first render so the light count is part of
  // every lit node build once (ADR 0020): three on a desktop, one on a
  // phone (`LAMP_LIGHTS`); each tile's lamps retarget it.
  const lampLights = createLampLights(LAMP_LIGHTS[budget.tier]);
  for (const light of lampLights.lights) {
    scene.add(light);
  }
  cleanups.push(() => lampLights.dispose());

  // The facades share the ground's sun (the same node).
  const styleResources = createStyleResources(clayNight, ground.sunDirection);

  // The HUD lets the heavy dressing start after the handover (startStreaming).
  let openGate: () => void = () => undefined;
  const dressingGate = new Promise<void>((resolve) => {
    openGate = resolve;
  });

  // The visible terrains, fine level first (the ground reads them in order).
  let terrains: TerrainLayer[] = [];
  const { heightAt } = siteGround;
  /** Distance along a camera ray (NDC) to the ground, or null. */
  const groundAlong = (ray: Raycaster, far: number): number | null =>
    siteGround.along(ray.ray.origin, ray.ray.direction, far);

  // The stream: what lands and leaves, and everything that follows from it.
  let onChange: () => void = () => undefined;
  // One pass for every change of a task: an update of the tile renderer
  // reports each tile that came into or left view on its own, and each
  // report walked the lamps, the ground's sources and the styles' gathering
  // again and redrew the shadow map. The frame flushes it right after the
  // update (`frame`), so what the update showed renders with its shadows
  // and lamps in that same frame, not one late.
  const streamChange = createCoalescer(() => onChange());
  const queueChange = streamChange.queue;
  // Shader compiles go through the post stack (it knows the target the
  // scene renders into). It is created a few lines below, before the render
  // loop runs the stream's first update, so no tile lands without it.
  let compileWith: PostStack["compile"] | null = null;
  // The trees follow the scene's calendar day (crown-season.ts): colour and
  // leaf cover are rewritten on a change of day, never per frame, and a
  // crown that changed redraws the shadow map. The day is the one of
  // Dresden's year (the phenology table's) that looks like it in this
  // city's climate (tree-season.ts SITE_SEASON).
  const climate = seasonShiftFor(opts.site.id);
  const seasonClock = createSeasonClock(opts.initialDate, (calendar) => {
    const day = climateDay(calendar, climate);
    let changed = false;
    for (const d of stream.dressings) {
      changed = (d.vegetation?.setSeason(day) ?? false) || changed;
    }
    if (changed) {
      invalidateShadows();
    }
  });
  cleanups.push(() => seasonClock.dispose());
  // The two walks of the whole scene that the stats and the crash trail's
  // heartbeat report — every geometry under it, and the tiles' CPU arrays
  // — are taken again only once what they count may have changed
  // (lib/city/recount.ts; the heartbeat walked both every 2 s): the stream
  // (a tile, a level or a dressing came or went, traffic bodies were
  // built: `onChange`), a demolish and the data layers (all three through
  // `scheduleStats`), a question (its rays build the BVHs of what they
  // reach, its outline a mesh: `inquireAt`, `selectCandidate`), the CPU
  // copies a compile let go of after its tile showed
  // (`onCopiesDropped`), and — in the key, a count over the loaded
  // building tiles — their BVHs, built as rays reach them. What comes and
  // goes besides (a Schnitt's profile, a style's crowns) is kilobytes,
  // counted with the next change.
  const geometryCount = createRecount(() => estimateGeometryBytes(scene));
  const cpuCount = createRecount(() => cpuBytesOf(stream).total);
  const cityBvhs = () => {
    let built = 0;
    for (const city of stream.cities) {
      built += city.hasBvh() ? 1 : 0;
    }
    return built;
  };
  const sceneCounted = () => {
    geometryCount.changed();
    cpuCount.changed();
  };
  // What a feature that starts on its first use (feature-seam.ts: the
  // data layers) hooks into: the frame, the stream's changes, the look
  // store and the scene's clock.
  const frameHook = createHook<[elapsed: number, nowMs: number]>();
  const streamHook = createHook<[]>();
  const hooks: SpineHooks = {
    frame: frameHook,
    streamChange: streamHook,
    look: opts.look,
    clock: sceneClock,
  };
  const stream = createTileStream(
    {
      // whether it compiled (a tile drops the CPU copies of what it
      // uploaded); what a compile throws the stream sorts out
      compile: (object) =>
        compileWith
          ? compileWith(object).then(() => true)
          : Promise.resolve(false),
      // a compile the GPU had no room for (the dressing stays off): shed
      // memory before a frame's own allocation fails; the half-made
      // attribute such a failure left, met again at a tile's release, is
      // only noted (memoryEmergency is defined further down: the stream
      // calls this from its loads, which start with the first frame). The
      // trail gets the part, never the tile: a tile's id names where the
      // player was, and the trail goes into reports.
      onAllocationFailure: (error, where) => {
        const message = error instanceof Error ? error.message : String(error);
        const part = where.split(" ")[0] ?? where;
        opts.trail?.note("alloc-failed", `${part} ${message}`);
        if (part !== "dispose") {
          memoryEmergency(`allocation ${part}`);
        }
      },
      // A dressing that threw leaves its tile bare: noted, reported, and
      // said in the HUD as a layer's hole (no retry heals it).
      onDressingFailed: (error, tile) => {
        const message = error instanceof Error ? error.message : String(error);
        opts.trail?.note("dressing failed", `${tile} ${message}`);
        sayLayerFailed(`${message} (Kachel ${tile})`);
      },
      onCopiesDropped: () => cpuCount.changed(),
      dressingGate,
      fogColor: sceneFog.color,
      heightAt,
      look: opts.look,
      lowRasters: budget.lowRasters,
      cacheBytes: tileCacheBytesFor(budget.tier, budget.safety),
      ground,
      night: () => currentNight,
      season: () => climateDay(seasonClock.day(), climate),
      offset,
      onChange: queueChange,
      renderer,
      styleResources,
      sunDirection,
      tier: budget.tier,
      tileBounds: (id) => extras.tiles.find((t) => t.id === id)?.bounds,
      tilesetUrl,
      // the data layers' traffic builder (they are set up with the post
      // stack below; a slot asks only once the look has a layer on and
      // its tile has landed)
      trafficBuilder: () =>
        dataLayers.want().then((layers) => layers?.traffic ?? null),
    },
    world,
    [
      {
        camera: streamCamera,
        width: container.clientWidth,
        height: container.clientHeight,
      },
      // at a resolution for streaming, not the map's: it loads what casts
      // into the view, never a finer terrain level (shadow-fit.ts)
      {
        camera: sunRig.shadowCamera,
        ...shadowStreamResolution(budget.tier),
      },
    ]
  );
  cleanups.push(() => stream.dispose());
  // Between the renderer's tiles-load-start and tiles-load-end: registered
  // before the first update, so no transition is missed.
  let tilesIdle = false;
  stream.tiles.addEventListener("tiles-load-start", () => {
    tilesIdle = false;
    queueChange();
  });
  stream.tiles.addEventListener("tiles-load-end", () => {
    tilesIdle = true;
    queueChange();
  });
  // A tile that fails to load (or to dress) leaves a hole, not a dead scene:
  // the HUD says so once, the rest keeps streaming. Before the first frame
  // the spawn tile (or the tileset itself) failing is fatal instead: the
  // boot below rejects rather than waiting for content that never comes.
  // Unless the network let it down (its fetch retried and gave up): such a
  // tile is asked for again (tile-retry.ts), its hole closes, and the boot
  // waits for it — failing only after a minute of a usable page without
  // it. A page on its way out (pagehide) decides and reports nothing.
  // The HUD's word about a missing part, latched per cause: a network
  // word (the healer clears it once its tiles are back) or a layer word (a
  // part gone for good, which no landing clears). A network failure
  // replaces a layer word, which waits behind it (`layerWord`) and comes
  // back when the network's clears; a second failure of a shown cause
  // stays silent.
  let shownWord: "none" | "network" | "layer" = "none";
  let layerWord: string | null = null;
  let firstFrameShown = false;
  let bootFailure: Error | null = null;
  // A part of the city that failed for good (no retry heals it): the
  // HUD's layer word, once.
  const sayLayerFailed = (message: string) => {
    if (disposed || layerWord !== null) {
      return;
    }
    layerWord = message;
    if (shownWord === "none") {
      shownWord = "layer";
      opts.onError?.(message);
    }
  };
  // A tile the network let down: asked for again (tile-retry.ts).
  const sayNetworkFailed = (message: string) => {
    if (!disposed && shownWord !== "network") {
      shownWord = "network";
      opts.onError?.(message);
    }
  };
  // The HUD's word about the network goes once nothing it failed is
  // outstanding (tile-retry.ts): at a landing, or found after a heal. A
  // layer word it covered shows again.
  const clearNetworkWord = () => {
    if (shownWord !== "network" || disposed) {
      return;
    }
    if (layerWord !== null) {
      shownWord = "layer";
      opts.onError?.(layerWord);
      return;
    }
    shownWord = "none";
    opts.onErrorCleared?.();
  };
  const network = createNetworkWatch({
    tiles: stream.tiles,
    trail: opts.trail,
    bootOver: () => firstFrameShown || disposed,
    onBootGiveUp: (error) => {
      bootFailure ??= error;
    },
    onClear: clearNetworkWord,
  });
  cleanups.push(() => network.dispose());
  stream.tiles.addEventListener("load-error", (event) => {
    const { error, tile, url } = event as {
      error?: unknown;
      tile?: object | null;
      url?: unknown;
    };
    if (isAbortError(error)) {
      return;
    }
    const failure = error instanceof Error ? error : new Error(String(error));
    const atBoot =
      !firstFrameShown && (tile === null || String(url).includes(spawn.id));
    const lost = network.failed(tile ?? null, error, String(url), atBoot);
    if (pageLeaving()) {
      return;
    }
    if (!lost) {
      opts.trail?.note("load-error", `${String(url)} ${failure.message}`);
    }
    if (atBoot) {
      if (!lost) {
        bootFailure ??= failure;
      }
      return;
    }
    if (lost) {
      sayNetworkFailed(failure.message);
    } else {
      sayLayerFailed(failure.message);
    }
  });
  // The last tile the network failed is back, or no longer wanted: the
  // HUD's word about it goes (a later failure says so again). Every landing
  // is told: the boot's network wait learns from it that its tiles came.
  stream.tiles.addEventListener("load-model", (event) => {
    if (network.landed(event.tile)) {
      clearNetworkWord();
    }
  });

  // The sun's shadow camera streams tiles (tile-stream.ts) only while the
  // sun is up: by night it draws no shadow, and the tiles it kept loaded
  // around the player were memory nothing showed — on a phone, memory the
  // governor cannot free (a tile in use is never evicted). By day it
  // streams at a resolution of its own (lib/city/shadow-fit.ts
  // `shadowStreamResolution`): an orthographic camera's error ignores the
  // distance, and at the map's resolution it pinned the fine terrain level
  // under its whole frustum, beyond any error target the governor set.
  let shadowStreams = true;
  // On a phone, and on a desktop from safety level 2 (lib/city/gpu-safety.ts)
  // it streams nothing, nor for a while after a memory emergency
  // (memoryEmergency, below).
  let shadowHeldUntil = shadowTilesStream(budget.safety, budget.tier)
    ? 0
    : Number.POSITIVE_INFINITY;
  // what the sun last asked for
  let sunUp = true;
  const streamShadowTiles = (sunAbove: boolean) => {
    sunUp = sunAbove;
    const on = sunAbove && performance.now() >= shadowHeldUntil;
    if (on === shadowStreams) {
      return;
    }
    shadowStreams = on;
    const shadow = sunRig.shadowCamera;
    if (on) {
      const { width, height } = shadowStreamResolution(budget.tier);
      stream.tiles.setCamera(shadow);
      stream.tiles.setResolution(shadow, width, height);
    } else {
      stream.tiles.deleteCamera(shadow);
    }
  };
  const setSun = (date: Date, preview = false): SunState => {
    const state = sunRig.update(date, preview);
    streamShadowTiles(state.aboveHorizon);
    currentNight = state.nightFactor;
    sunAltitude = state.altitudeDeg;
    sunToStyles?.(state.altitudeDeg);
    for (const d of stream.dressings) {
      d.lamps?.setNightFactor(state.nightFactor);
    }
    lampLights.setNightFactor(state.nightFactor);
    lantern.setNight(state.nightFactor);
    setFountainNight(state.nightFactor);
    setFountainSeason(date);
    setFurnitureNight(state.nightFactor);
    setClockTime(date);
    clayNight.value = state.nightFactor;
    seasonClock.set(date);
    sceneClock.set({ date, atMs: performance.now() });
    // The sun's move has asked for the map already; a drag's step leaves
    // it to the rig's pace.
    if (!preview) {
      invalidateShadows();
    }
    return state;
  };
  setSun(opts.initialDate);

  // Fog: until the first streaming pass has landed, the world may end at the
  // spawn tile's edge; a tighter fog turns that edge into haze. The slider
  // value is kept and re-applied once the stream has settled.
  let fogAmount = opts.look.get().fogAmount;
  let worldPartial = extras.tiles.length > 1;
  // The site's edge haze, kept to restore after Modell (which shows the
  // site's edge as an edge).
  const siteRect = sceneFog.siteRect.value.clone();
  /**
   * Modell's dolly zoom opens the haze as it backs away (the range grows
   * faster than the distance), and the parallel view has none: far there
   * means higher up the sheet, not further off (plan 055).
   */
  const applyFog = () => {
    const range = fogRangeFor(fogAmount);
    const far = worldPartial
      ? Math.min(range.far, PARTIAL_WORLD_FOG_FAR)
      : range.far;
    const blend = rig?.blend() ?? 0;
    const open = 1 / Math.max(1 - blend, 0.002) ** 2;
    sceneFog.far.value = far * open;
    sceneFog.near.value = Math.min(range.near, far * 0.6) * open;
    sceneFog.heightStrength.value = VALLEY_HAZE * (1 - blend);
    if (rig?.parallel()) {
      sceneFog.siteRect.value.set(-1e9, -1e9, 1e9, 1e9);
    } else {
      sceneFog.siteRect.value.copy(siteRect);
    }
  };
  applyFog();
  /** The stream camera onto the walk/fly camera, its far at the fog's end
   *  (through Modell's dolly zooms, which move that camera kilometres
   *  back, at the opened fog's, uncapped on a phone too). */
  const syncStreamCamera = () => {
    camera.matrixWorld.decompose(
      streamCamera.position,
      streamCamera.quaternion,
      streamCamera.scale
    );
    const far = streamFarFor(
      Math.max(sceneFog.far.value, fogRangeFor(fogAmount).far),
      camera.far,
      budget.tier,
      rig?.owns() ?? false
    );
    if (
      streamCamera.far !== far ||
      streamCamera.fov !== camera.fov ||
      streamCamera.aspect !== camera.aspect ||
      streamCamera.zoom !== camera.zoom
    ) {
      streamCamera.far = far;
      streamCamera.fov = camera.fov;
      streamCamera.aspect = camera.aspect;
      streamCamera.zoom = camera.zoom;
      streamCamera.updateProjectionMatrix();
    }
    streamCamera.updateMatrixWorld();
  };
  syncStreamCamera();

  stage("light", 0);
  const postStack = createPostStack(
    renderer,
    scene,
    camera,
    activeCamera,
    lens,
    aoSamplesFor(budget.profile, budget.tier),
    sceneFog,
    postProfileFor(budget.tier)
  );
  cleanups.push(() => postStack.dispose());
  compileWith = postStack.compile;
  sunToStyles = postStack.setSunAltitude;
  // The data layers (lib/city/data-layers.ts, data-layers-feature.ts):
  // started with the first switch-on of any of them — the tiles' traffic
  // slots wait on the same start — and from then on driven by the spine's
  // hooks (feature-seam.ts). They start only after this synchronous setup
  // has run (the module's promise resolves later), so what they read below
  // is all there. (Their code ships with the scene: as a chunk of its own
  // it cost more first-load JS than it moved — feature-seam.ts.)
  const dataLayers = lazyFeature(
    () => Promise.resolve(dataLayersModule),
    ({ startDataLayers }) =>
      startDataLayers(hooks, {
        bikeFeed: opts.site.dataLayers?.bikes?.feed,
        bounds: unionBounds(extras),
        bridgeUrls: extras.tiles.flatMap((t) =>
          t.bridges ? [new URL(t.bridges, tilesetUrl).href] : []
        ),
        compile: (object) => postStack.compile(object).catch(() => undefined),
        epsg: extras.epsg,
        ground: { offset, heightAt },
        onBikeCounts: opts.onBikeCounts,
        onChange: () => scheduleStats(),
        onTramStatus: opts.onTramStatus,
        onTrafficHour: opts.onTrafficHour,
        parent: scene,
        tramTimetableUrl: extras.trams
          ? new URL(extras.trams, tilesetUrl).href
          : undefined,
      })
  );
  cleanups.push(() => dataLayers.dispose());
  // The first switch-on starts them. One that did not start them is noted,
  // said once like a layer's hole, and the next switch-on asks again (a
  // module that did not load is loaded again; a start that threw, a bug,
  // stays failed).
  const wantDataLayers = wantOnSwitchOn(dataLayers, (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    opts.trail?.note("feature failed", `data layers ${message}`);
    sayLayerFailed(`Datenebenen: ${message}`);
  });
  postStack.setSunAltitude(sunAltitude);

  // The look store is the one source of every look value: applied now, on
  // every change, and (in tile-stream.ts) to each tile that lands later. The
  // store outlives this instance — unsubscribe on dispose. One writer per
  // slider — a Record over the keys, so a row added to the table cannot go
  // unapplied; the look's other strengths are constants of their terms.
  const sceneRows: Record<LookKey, (value: number) => void> = {
    fogAmount: (amount) => {
      fogAmount = amount;
      applyFog();
    },
  };
  let lastStyle = opts.look.get().style;
  // When the trees' crown tiers are picked (stepVegetation, below): on the
  // pose tick, and in the next frame when the crown switch or the tiles in
  // view change.
  const crownTiers = createLodSchedule();
  const applyLook = (look: LookValues) => {
    if (look.style !== lastStyle) {
      lastStyle = look.style;
      opts.trail?.note("style", look.style);
      // Modell's paper is the style's sheet
      if (rig?.parallel()) {
        sunRig.setParallel(true, paperOf(look.style));
      }
      // A picture style may draw its own crowns (style-dressing.ts), and the
      // crowns cast: the shadow map is redrawn with the new ones.
      invalidateShadows();
    }
    for (const key of Object.keys(sceneRows) as LookKey[]) {
      sceneRows[key](look[key]);
    }
    postStack.applyLook(look);
    for (const d of stream.dressings) {
      d.vegetation?.applyLook(look);
      showDataLayers(d, look);
    }
    // the crown switch: the tiers in the next frame, not the next tick
    crownTiers.force();
    wantDataLayers(activeDataLayers(look).length > 0);
  };
  applyLook(opts.look.get());
  cleanups.push(opts.look.subscribe(applyLook));

  // Wall collision against the buildings of every visible tile, and the
  // vertical rays that keep the camera out of them — through each tile's
  // BVH, built when a ray first reaches the tile (city-layer.ts
  // `ensureCityBvh`). Not before the boot places the player on the spawn
  // tile's ground (`bvhOnDemand`): until then the pose stands over a floor
  // that is not there, and the spawn tile's build would come in the frame
  // its buildings land, beside the terrain still parsing — on a phone the
  // page's process ran out there. The frames before see no building, and
  // the placing asks again.
  let bvhOnDemand = false;
  const collider = createCityCollider(
    () => stream.visibleCities().map((c) => c.mesh),
    (mesh) => {
      if (bvhOnDemand) {
        ensureCityBvh(mesh);
      }
    }
  );
  // Where the player stands and looks, walk/fly, the scenic glides — and the
  // one rule that any player input cancels a glide (camera-pose.ts).
  let viewMode: ViewMode = "walk";
  const modeChanged = (mode: ViewMode) => {
    viewMode = mode;
    opts.onModeChange?.(mode);
  };
  const pose = createCameraPose(camera, {
    groundFloor: () => siteGround.floor() ?? 0,
    heightAt,
    offset,
    resolveStep: collider.resolveStep,
    solids: collider,
    onFollowEnd: opts.onFollowEnd,
    onModeChange: modeChanged,
    onPose: (p) => {
      if (!rig?.owns()) {
        opts.onPose?.(p);
      }
    },
  });
  // Modell (plan 055): the parallel camera and the dolly zooms in and out.
  const viewportCss = () => ({
    width: container.clientWidth,
    height: container.clientHeight,
  });
  /** Which camera the tile renderer streams for, and what the frame looks like. */
  const swapCamera = (parallel: boolean) => {
    const { width, height } = viewportCss();
    const model = (rig as ModelRig).camera;
    if (parallel) {
      stream.tiles.setCamera(model);
      stream.tiles.setResolution(model, width, height);
      stream.tiles.deleteCamera(streamCamera);
    } else {
      syncStreamCamera();
      stream.tiles.setCamera(streamCamera);
      stream.tiles.setResolution(streamCamera, width, height);
      stream.tiles.deleteCamera(model);
    }
    postStack.setModel(parallel);
    sunRig.setParallel(parallel, paperOf(opts.look.get().style));
    if (!parallel && cuts.cutOut()) {
      // the Ausschnitt is a Modell thing: a walk sees the whole city
      setCutOut(false);
    }
    if (!parallel) {
      cutOutFailed = false; // ...and so is its word
    }
    applyFog();
    invalidateShadows();
    opts.trail?.note("camera", parallel ? "parallel" : "perspective");
  };
  rig = createModelRig({
    camera,
    pose,
    groundAt: (x, z) => siteGround.underWorld(x, z),
    groundAlong: (origin, direction, far) =>
      siteGround.along(origin, direction, far),
    viewport: viewportCss,
    bounds: [
      siteBounds[0] - offset.cx,
      -(siteBounds[3] - offset.cy),
      siteBounds[2] - offset.cx,
      -(siteBounds[1] - offset.cy),
    ],
    maxScale:
      budget.tier === "mobile" ? MODEL_SCALE_MAX_PHONE : MODEL_SCALE_MAX,
    onSwap: swapCamera,
    onModeChange: modeChanged,
  });
  const modelRig: ModelRig = rig;
  /** world point of EPSG (x, y) on the ground */
  const groundPoint = (epsgX: number, epsgY: number): Xyz => {
    const w = epsgToWorld(epsgX, epsgY, offset);
    return { x: w.x, y: siteGround.underWorld(w.x, w.z), z: w.z };
  };
  /** Where a vantage looks: its axis on the ground, else its own spot. */
  const vantageTarget = (view: ViewpointGeometry): Xyz => {
    const at = groundPoint(view.epsg.x, view.epsg.y);
    const from = { x: at.x, y: at.y + view.aboveGround, z: at.z };
    const h = (view.headingDeg * Math.PI) / 180;
    const p = (view.pitchDeg * Math.PI) / 180;
    const dir = {
      x: Math.sin(h) * Math.cos(p),
      y: Math.sin(p),
      z: -Math.cos(h) * Math.cos(p),
    };
    const t = siteGround.along(from, dir, 3000);
    return t === null
      ? at
      : { x: from.x + dir.x * t, y: from.y + dir.y * t, z: from.z + dir.z * t };
  };
  // Spawn at the site's start vantage (on the spawn tile, so the boot's
  // wait for that tile holds); placed again once its terrain has landed
  // (below) — the height is above the ground, which is not there yet. A
  // recovered page starts where its player stood instead, on the tile the
  // boot waits for (`spawn`), on foot or in the air (Modell is the HUD's
  // to put back): its first update streams that place, not the spawn; a
  // place picked in the HUD while the page was loading (`initialView`)
  // likewise. Both boot looking straight down onto that tile, the picked
  // place from above the tile's top (lib/city/boot-start.ts): a pose that
  // sees no tile loads none, and by night, on a phone or from safety
  // level 2 no shadow camera streams one either, so the boot would wait
  // for ever — as it would from higher above the tile than its stream
  // reaches, so neither boots higher than half that reach above its top.
  // Their own pose goes back once the tile has landed (below, and the
  // HUD's after the first frame).
  const spawnView = picked ?? spawnViewpoint(opts.site);
  /** the boot does not start on the spawn vantage, which looks at its tile */
  const startsElsewhere = restored !== undefined || picked !== undefined;
  const booting = bootingPose(
    { picked, restored },
    spawnView,
    tileTopsOf(tileset)[extras.tiles.indexOf(spawn)],
    offset,
    // the boot's stream far (`syncStreamCamera`), at the least
    streamFarFor(fogRangeFor(fogAmount).far, camera.far, budget.tier)
  );
  const placeStart = (boot = false) => {
    const camera = boot ? "camera" in booting && booting.camera : restored;
    if (camera) {
      pose.applyCameraState(camera);
      return;
    }
    pose.placeAt(spawnView);
  };
  placeStart(true);

  // Street-view-style canvas gestures (touch and mouse, incl. pointer lock).
  /** A step of the wall clearance from `point` towards the camera, level. */
  const towardsCamera = (point: Vector3): Vector3 => {
    const back = new Vector3(
      camera.position.x - point.x,
      0,
      camera.position.z - point.z
    );
    return back.lengthSq() > 0
      ? back.normalize().multiplyScalar(WALL_CLEARANCE)
      : back;
  };
  const tapRaycaster = new Raycaster();
  tapRaycaster.firstHitOnly = true;
  // Befragen (ADR 0042): a click asks, a long press on a touch screen,
  // and I under the pointer — there is no mode to switch on first.
  // What the outline goes around (selection-shape.ts): a building's own
  // triangles, a bridge's out of its tile's bridge meshes, a tree's or a
  // monument's shape after its data.
  const outline = (subject: OutlineSubject | null, flash = true) => {
    postStack.setSelection(outlineShape(subject), flash);
  };
  const outlineShape = (
    subject: OutlineSubject | null
  ): OutlineSelection | null => {
    if (!subject) {
      return null;
    }
    if ("building" in subject) {
      // an ensemble a tile edge cuts in two: both tiles' triangles
      const shapes = subject.building.map((p) =>
        buildingShape(p.layer, p.objects)
      );
      const positions = new Float32Array(
        shapes.reduce((n, s) => n + s.length, 0)
      );
      let at = 0;
      for (const s of shapes) {
        positions.set(s, at);
        at += s.length;
      }
      return { positions, reach: 0 };
    }
    const { target, solids } = subject.thing;
    const first = solids[0];
    if (target.kind === "bridge" && first && "slab" in first) {
      // on the level that answered: a tile's fine and coarse terrain each
      // carry its bridges, and the hidden one hangs outside the scene
      const rail = stream
        .visibleDressings()
        .find((d) => d.tile === target.tile && d.rail)?.rail;
      return { positions: bridgeShape(rail, first.slab), reach: 0 };
    }
    if (target.kind === "traffic") {
      // the section as the layer draws it, grown with the hour — on the
      // level that answered: a tile's fine and coarse terrain each carry
      // the flows, and the hidden one hangs outside the scene
      const flow = trafficMesh(
        stream
          .visibleDressings()
          .find((d) => d.tile === target.tile && d.traffic?.group)?.traffic
          ?.group ?? undefined
      );
      return flow
        ? { flow, triangles: trafficTriangles(flow, target.index) }
        : null;
    }
    // a stand-in: the scene's surface anywhere inside it is the thing; the
    // counters' columns are glass, which writes no depth
    return {
      // a tree drawn as the cone outlined as one (not a pine or a yew)
      positions: solidShape(
        solids,
        (target.kind === "tree" || target.kind === "canopy") &&
          target.cone === true
      ),
      reach:
        target.kind === "bikes"
          ? Number.POSITIVE_INFINITY
          : standInDepth(solids),
    };
  };
  const probe = createInquiryProbe({
    camera: activeCamera,
    cities: () => stream.visibleCities(),
    isLoaded: (layer) => stream.cities.has(layer),
    groundAlong,
    outline,
    // (a tile's ask sets come in idle time; a question before builds them)
    things: () => [
      ...stream.visibleDressings().flatMap(asksOf),
      ...(dataLayers.current()?.asks() ?? []),
    ],
    viewport: () => ({
      width: renderer.domElement.clientWidth || 1,
      height: renderer.domElement.clientHeight || 1,
    }),
    toSite: (p) => [p.x + offset.cx, offset.cy - p.z],
  });
  // A tree's card fetches what the register says about it (ADR 0042).
  const treeFactsUrl = (tile: string) => {
    const file = extras.tiles.find((t) => t.id === tile)?.ask?.treeFacts;
    return file ? new URL(file, tilesetUrl).href : undefined;
  };
  // What the card needs beyond what was met: a tree's facts file, a data
  // layer's credit (the site's) and, for a counted section, the hour.
  const layerSources = opts.site.dataLayers;
  // (a section is asked only on bodies the data layers built: they are here)
  const trafficHour = () => dataLayers.current()?.trafficHour();
  const answered = (asked: Inquiry | null): Inquiry | null => {
    switch (asked?.kind) {
      case "tree": {
        const factsUrl = treeFactsUrl(asked.tile);
        return factsUrl ? { ...asked, factsUrl } : asked;
      }
      case "traffic":
        return {
          ...asked,
          credit: layerSources?.traffic?.credit,
          hour: trafficHour(),
        };
      case "bikes":
        return { ...asked, credit: layerSources?.bikes?.credit };
      case undefined:
        return null;
      case "building":
      case "bridge":
      case "monument":
      case "canopy":
      case "furniture":
      case "hedge":
      case "lamp":
      case "landing":
      case "stop":
        return asked;
    }
  };
  // the last question's candidates, with what the card needs of each
  let along: InquiryAlong | null = null;
  const inquireAt = (ndc?: { x: number; y: number }): Inquiry | null => {
    const asked = probe.ask(ndc);
    // its rays built the BVHs of what they reached, its outline a mesh
    sceneCounted();
    along = asked
      ? {
          at: ndc ?? null,
          candidates: asked.candidates.map((c) => ({
            ...c,
            inquiry: answered(c.inquiry) ?? c.inquiry,
          })),
          selected: asked.selected,
        }
      : null;
    const inquiry = along?.candidates[along.selected]?.inquiry ?? null;
    opts.onInquiry?.(inquiry, along);
    return inquiry;
  };
  const selectCandidate = (index: number): Inquiry | null => {
    const chosen = along?.candidates[index];
    if (!(along && chosen && probe.select(index))) {
      return null;
    }
    sceneCounted();
    along = { ...along, selected: index };
    opts.onInquiry?.(chosen.inquiry, along);
    return chosen.inquiry;
  };
  /** Modell: centres the picture on the ground under a screen point. */
  const centreAt = (ndcX: number, ndcY: number) => {
    const reach = setPickRay(
      tapRaycaster,
      { x: ndcX, y: ndcY },
      modelRig.current()
    );
    const t = groundAlong(tapRaycaster, reach);
    if (t !== null) {
      const p = tapRaycaster.ray.at(t, new Vector3());
      modelRig.centreOn({ x: p.x, y: p.y, z: p.z });
    }
  };
  // Modell's pinch zooms by the change since the last event.
  let lastPinch = 1;
  const canvasControls = attachTouchControls(renderer.domElement, {
    // A click asks (a drag looks, a double click glides there); a finger's
    // tap does not — on glass a tap is too easily a missed drag.
    onTap: (ndcX, ndcY, pointerType) => {
      if (pointerType === "mouse") {
        inquireAt({ x: ndcX, y: ndcY });
      }
    },
    // A finger or a pen asks by holding still (the phone's way, ADR 0042).
    onLongPress: (ndcX, ndcY) => {
      inquireAt({ x: ndcX, y: ndcY });
    },
    // In Modell a drag grabs the ground; on foot and in the air it looks.
    onLook: (dx, dy) =>
      modelRig.owns() ? modelRig.pan(dx, dy) : pose.turn(dx, dy),
    onAltDrag: (dx, dy, shift) =>
      modelRig.owns() ? modelRig.rotateDrag(dx, dy, shift) : pose.turn(dx, dy),
    onDragEnd: () => modelRig.endDrag(),
    onTwist: (radians) => {
      if (modelRig.owns()) {
        modelRig.twist(radians);
      }
    },
    onTwoFingerPan: (dx, dy) => {
      if (modelRig.owns()) {
        modelRig.pan(dx, dy);
      }
    },
    onMouseLook: (dx, dy) => {
      if (!modelRig.owns()) {
        pose.look(dx, dy);
      }
    },
    onPinchStart: () => {
      lastPinch = 1;
      pose.beginPinch();
    },
    onPinch: (ratio, midX, midY) => {
      if (modelRig.owns()) {
        modelRig.zoomAt({ x: midX, y: midY }, ratio / lastPinch);
        lastPinch = ratio;
      } else {
        pose.pinchTo(ratio, { x: midX, y: midY });
      }
    },
    onWheelDolly: (amount, ndcX, ndcY) =>
      modelRig.owns()
        ? modelRig.zoomAt({ x: ndcX, y: ndcY }, Math.exp(amount))
        : pose.dolly(amount, { x: ndcX, y: ndcY }),
    onWheelZoom: (ratio) => {
      if (!modelRig.owns()) {
        pose.zoomBy(ratio);
      }
    },
    onDoubleTap: (ndcX, ndcY) => {
      if (modelRig.owns()) {
        centreAt(ndcX, ndcY);
        return;
      }
      // Glide to the tapped spot on the terrain — or, when a building is
      // in front of it, to the foot of the building on this side (the
      // pose sets a spot inside one out beside it). In the air the glide
      // goes part of the way along the line of sight (camera-pose.ts).
      tapRaycaster.setFromCamera(new Vector2(ndcX, ndcY), camera);
      // The ground first: no building tile past it needs its BVH for this
      // (`nearestCityHit` builds the ones the ray reaches before).
      const ground = groundAlong(tapRaycaster, 6000);
      tapRaycaster.far = ground ?? 6000;
      const building = nearestCityHit(
        tapRaycaster,
        stream.visibleCities(),
        true
      )?.hit;
      const hit = building
        ? building.point.clone().add(towardsCamera(building.point))
        : ground === null
          ? null
          : tapRaycaster.ray.at(ground, new Vector3());
      if (hit) {
        pose.travelTo(hit);
      }
    },
  });
  cleanups.push(canvasControls.detach);

  let fps = 0;
  // Geometry + tracked textures + the shadow map; the post stack's screen
  // buffers are excluded (they scale with the canvas, not the world). The
  // geometry as last counted (`geometryCount`); the textures come and go
  // with the rasters' decode turns, and are a sum over a map.
  const gpuBytesWith = (geometryBytes: number) =>
    geometryBytes + trackedTextureBytes() + sunRig.shadowMapBytes;
  const gpuBytes = () => gpuBytesWith(geometryCount.get());
  const census = (roots: (Object3D | undefined)[]): SceneCensus =>
    sceneCensus(roots.filter((r): r is Object3D => r !== undefined));
  const emitStats = () => {
    const cities = stream.visibleCities();
    const dressings = stream.visibleDressings();
    opts.onStats?.({
      buildingCount: cities.reduce((n, c) => n + countBuildings(c), 0),
      terrainVertexCount: terrains.reduce((n, t) => n + t.vertexCount, 0),
      shadowsEnabled: renderer.shadowMap.enabled,
      gpuMegabytes: Math.round(gpuBytes() / 1_048_576),
      layerStats: {
        city: census(cities.map((c) => c.mesh)),
        terrain: census(terrains.map((t) => t.mesh)),
        water: census(
          terrains.flatMap((t) => [t.water?.mesh, t.water?.mistMesh])
        ),
        ...dressingCensus(dressings, census),
        walls: census(terrains.map((t) => t.walls)),
        stairs: census(terrains.map((t) => t.stairs)),
        kerbs: census(terrains.map((t) => t.kerbs)),
        fences: census(terrains.map((t) => t.fences)),
        bikes: census([dataLayers.current()?.parts().bikes]),
        trams: census([dataLayers.current()?.parts().trams]),
      },
    });
  };
  // A full stats pass walks the whole scene (geometry bytes and the layer
  // census) and the HUD re-renders on it: the stream's bursts of events —
  // about four per tile while the site streams — coalesce into one pass at
  // most every 250 ms. A timer, not the render loop, so stats still arrive
  // while the e2e holds the frames (`__poc.hold`).
  let statsTimer: ReturnType<typeof setTimeout> | null = null;
  const scheduleStats = () => {
    // what changes the stats changes what the scene's walks count
    sceneCounted();
    if (statsTimer !== null || disposed) {
      return;
    }
    statsTimer = setTimeout(() => {
      statsTimer = null;
      if (!disposed) {
        emitStats();
      }
    }, 250);
  };
  /** The stats now, for the moments that promise them (first frame, loaded). */
  const flushStats = () => {
    if (statsTimer !== null) {
      clearTimeout(statsTimer);
      statsTimer = null;
    }
    emitStats();
  };
  cleanups.push(() => {
    if (statsTimer !== null) {
      clearTimeout(statsTimer);
    }
  });
  // Every tile's building footprints for the minimap, independent of what
  // has streamed in (a few hundred KB for the site): the map shows the whole
  // city once the player has it (they load after the handover, not against
  // the spawn tile's glTF), and demolished buildings via `stream.demolished`.
  const footprints = new Map<string, [number, number][][][]>();
  // The flattened list the minimap draws, rebuilt only when a file lands or
  // a building goes (either drops it): the same array otherwise, so React
  // bails out and the minimap does not repaint its static layer on every
  // tile event.
  let flattened: FootprintPoly[] | null = null;
  const currentFootprints = (): FootprintPoly[] => {
    flattened ??= [...footprints].flatMap(([tile, polys]) => {
      const gone = stream.demolished.get(tile);
      return footprintPolys(polys, (i) => !gone?.has(i));
    });
    return flattened;
  };
  function loadFootprints(): void {
    for (const tile of extras.tiles) {
      fetchOptionalJson<[number, number][][][]>(
        new URL(tile.footprints, tilesetUrl).href,
        opts.signal
      )
        .then((polys) => {
          if (polys && !disposed) {
            footprints.set(tile.id, polys);
            flattened = null;
            scheduleStats();
          }
        })
        .catch(() => undefined);
    }
  }

  // Everything that follows from the tile set changing: the ground, the
  // lamp heads, the fog floor, the shadows, the stats.
  let dressingsNoted = 0;
  onChange = () => {
    if (disposed) {
      return;
    }
    // The crash trail: each dressing as it lands (the heaviest builds).
    if (stream.dressings.size !== dressingsNoted) {
      dressingsNoted = stream.dressings.size;
      opts.trail?.note(
        "dressings",
        `${dressingsNoted} built, ${stream.pendingDressings()} pending`
      );
    }
    terrains = stream.visibleTerrains();
    siteGround.setSources(terrains);
    groundVersion++;
    const cut = cuts.cutOut();
    if (cut) {
      cuts.setCutOut(cut, siteGround.atWorld, groundVersion);
    }
    for (const t of stream.terrains) {
      lowerGroundFloor(t.minElevation);
    }
    lampLights.setHeads(
      stream.visibleDressings().flatMap((d) => d.lamps?.headPositions ?? [])
    );
    // a tile that lands is born on its mid crowns: its tiers in this frame
    crownTiers.force();
    streamHook.emit();
    postStack.sceneChanged();
    invalidateShadows();
    scheduleStats();
    checkLoaded();
  };

  /** Demolishes the building at a screen point (NDC; the centre without). */
  const demolishAt = (ndc?: { x: number; y: number }) => {
    const picked = pickCityObject(activeCamera(), stream.visibleCities(), ndc);
    if (!picked?.layer.demolish(picked.objectIndex)) {
      return;
    }
    const keep = (layer: CityLayer) => {
      const kept = stream.demolished.get(layer.tile) ?? new Set();
      layer.alive.forEach((alive, i) => {
        if (!alive) {
          kept.add(i);
        }
      });
      stream.demolished.set(layer.tile, kept);
    };
    keep(picked.layer);
    // the rest of its ensemble in the tiles across an edge: those loaded
    // now, and (the group kept) those that load later
    const group = picked.layer.table.group[picked.objectIndex];
    if (group) {
      stream.demolishedGroups.add(group);
    }
    for (const layer of group ? stream.cities : []) {
      const first = layer.table.group.indexOf(group);
      if (layer !== picked.layer && first >= 0 && layer.demolish(first)) {
        keep(layer);
      }
    }
    flattened = null;
    invalidateShadows();
    scheduleStats();
  };
  const demolishAtCrosshair = () => demolishAt();

  // Where the mouse rests over the scene: `I` and `R` act on what is
  // under the pointer, as a hover shortcut does — there is no dot in the
  // middle to aim with. Without a pointer there (a touch screen, the
  // pointer off the canvas or locked in immersive mode) they act at the
  // centre. Kept in client pixels and turned into NDC when a key asks, so
  // a canvas resized or locked since the last move is read as it is now.
  let hover: { x: number; y: number } | undefined;
  const canvas = renderer.domElement;
  const onHover = (e: PointerEvent) => {
    hover =
      e.pointerType === "mouse" ? { x: e.clientX, y: e.clientY } : undefined;
  };
  const onLeave = () => {
    hover = undefined;
  };
  const aim = (): { x: number; y: number } | undefined => {
    if (!hover || document.pointerLockElement === canvas) {
      return undefined;
    }
    const r = canvas.getBoundingClientRect();
    return {
      x: ((hover.x - r.left) / r.width) * 2 - 1,
      y: -(((hover.y - r.top) / r.height) * 2 - 1),
    };
  };
  canvas.addEventListener("pointermove", onHover);
  canvas.addEventListener("pointerleave", onLeave);
  cleanups.push(() => {
    canvas.removeEventListener("pointermove", onHover);
    canvas.removeEventListener("pointerleave", onLeave);
  });

  cleanups.push(
    attachKeyboardControls(
      { document, window },
      {
        // Modell takes the keys while it owns the frame (pan, turn, scale)
        press: (code) =>
          modelRig.owns() ? modelRig.press(code) : pose.press(code),
        release: (code) => {
          pose.release(code);
          modelRig.release(code);
        },
        releaseAll: () => {
          pose.releaseAll();
          modelRig.releaseAll();
        },
        toggleMode: () =>
          modelRig.owns() ? modelRig.leave("fly") : pose.toggleMode(),
        toggleModel: () =>
          modelRig.owns() ? modelRig.leave() : modelRig.enter(),
        demolish: () => demolishAt(aim()),
        // I asks under the pointer, or at the centre in pointer lock,
        // where there is no pointer to click with.
        inquire: () => {
          inquireAt(aim());
        },
        cycleStyle: () =>
          opts.look.set({ style: nextRenderStyle(opts.look.get().style) }),
        viewpoint: (index) => {
          const view = opts.site.viewpoints[index];
          if (!view) {
            return;
          }
          if (modelRig.owns()) {
            modelRig.centreOn(vantageTarget(view));
          } else {
            pose.flyToViewpoint(view);
          }
        },
      }
    )
  );

  const resizeObserver = new ResizeObserver(() => {
    camera.aspect = container.clientWidth / Math.max(container.clientHeight, 1);
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
    postStack.setSize();
    modelRig.resize();
    stream.tiles.setResolution(
      modelRig.parallel() ? modelRig.camera : streamCamera,
      container.clientWidth,
      container.clientHeight
    );
  });
  resizeObserver.observe(container);
  cleanups.push(() => resizeObserver.disconnect());

  // Crosshair autofocus for the photographic DoF (throttled like the pose):
  // every visible tile's buildings (their BVHs), and the ground by marching
  // its height grid — the nearer hit wins.
  const focusRaycaster = new Raycaster();
  focusRaycaster.firstHitOnly = true;
  focusRaycaster.far = 6000;
  const focusCrosshair = new Vector2(0, 0);
  let lastFocusHit: { dist: number; name: string } | null = null;
  const lensBlur = postProfileFor(budget.tier).dof;
  const updateFocus = () => {
    focusRaycaster.setFromCamera(focusCrosshair, camera);
    // Only the tiles whose BVH is built: the focus never builds one (ten
    // times a second), and a far tile without one lies past the lens's
    // depth anyway.
    const hit = nearestCityHit(
      focusRaycaster,
      stream.visibleCities(),
      false
    )?.hit;
    const ground = groundAlong(
      focusRaycaster,
      hit?.distance ?? focusRaycaster.far
    );
    if (ground !== null && (!hit || ground < hit.distance)) {
      const point = focusRaycaster.ray.at(ground, new Vector3());
      lastFocusHit = {
        dist: camera.position.distanceTo(point),
        name: "terrain",
      };
      postStack.setFocusTarget(point);
      return;
    }
    lastFocusHit = hit
      ? {
          dist: camera.position.distanceTo(hit.point),
          name: hit.object.name || hit.object.type,
        }
      : null;
    postStack.setFocusTarget(hit?.point ?? null);
  };

  // The building tiles near the camera get their BVH in idle time, one at
  // a time (city-layer.ts `ensureCityBvh`): a walk into the next tile, a
  // pick or a landing there finds it built instead of building it in the
  // frame that needs it. The farther ones wait for a ray, or never get one.
  let bvhPending = false;
  const prepareBvhNear = () => {
    if (!bvhOnDemand || bvhPending) {
      return;
    }
    const at = activeCamera().position;
    const next = nearestWithoutBvh(
      stream.visibleCities(),
      at.x,
      at.z,
      BVH_NEAR_M
    );
    if (!next) {
      return;
    }
    bvhPending = true;
    whenIdle(() => {
      bvhPending = false;
      if (!disposed && stream.cities.has(next)) {
        next.ensureBvh();
      }
    }, BVH_IDLE_MS);
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
  // from. Off every tile the ground floor stands in, as for the walk clamp.
  const shadowViewDir = new Vector3();
  const groundUnderCamera = (): number =>
    siteGround.underWorld(camera.position.x, camera.position.z);

  const timer = new Timer();
  // Advance the wind sway every frame (same clock as the water ripple); on
  // the pose tick — and in the frame the tiles in view or the crown switch
  // change, or the eye jumps (`crownTiers`, lib/city/vegetation-lod.ts) —
  // pick every vegetation chunk's crown tier (rich / mid / far) over all
  // loaded tiles at once (the rich crowns share one site-wide budget) and
  // swap the cadastre's own silhouettes by distance. (Per frame it cost a
  // pass over ~1 000 chunks and their plan states 60 times a second; a
  // tick's walk or flight, 18 m at the fastest, is well inside the tiers'
  // 80–100 m hysteresis bands.) A tier change changes what casts shadows,
  // so it invalidates the map.
  const vegetationControls: VegetationControl[] = [];
  const vegetationLod = createVegetationLod();
  const richTrees =
    budget.tier === "mobile" ? PHONE_RICH_TREE_BUDGET : RICH_TREE_BUDGET;
  /** `eye`: where the tiers are measured from (Modell: above the pivot);
   *  `tick`: the frame's pose tick is due. */
  const stepVegetation = (elapsed: number, eye: Vector3, tick: boolean) => {
    // The shown tiles only: a cached tile or the hidden level of a shown
    // one would spend the rich-crown budget the view needs, and its tier
    // flips redrew the shadow map for trees nobody sees.
    const shown = stream.visibleDressings();
    for (const d of shown) {
      d.vegetation?.setTime(elapsed);
    }
    if (!crownTiers.due(tick, eye)) {
      return;
    }
    vegetationControls.length = 0;
    let lodChanged = false;
    for (const d of shown) {
      if (d.vegetation) {
        vegetationControls.push(d.vegetation);
        if (d.vegetation.updateLod(eye)) {
          lodChanged = true;
        }
      }
    }
    if (vegetationLod(vegetationControls, eye, richTrees)) {
      lodChanged = true;
    }
    if (lodChanged) {
      invalidateShadows();
    }
  };

  /**
   * Everything that follows where the frame looks: the shadow frustum, the
   * map's marks, the lamp lights and the tree tiers — from the camera on
   * foot and in the air; in Modell from the ground the picture shows and
   * from above its pivot, as far up as the picture is equivalent to (so a
   * tree at the top of the sheet is drawn as one at the bottom). Returns
   * that equivalent distance in Modell, else null. `tick`: the frame's
   * pose tick is due (the tree tiers').
   */
  const eye = new Vector3();
  const followView = (elapsed: number, tick: boolean): number | null => {
    const target = modelRig.owns() ? modelRig.targetView() : null;
    if (!target) {
      // Re-fit the shadow frustum to the camera (lib/city/shadow-fit.ts).
      camera.getWorldDirection(shadowViewDir);
      const ground = groundUnderCamera();
      sunRig.follow(camera.position, shadowViewDir, ground);
      // The map's own marks (the ferry lines) show from the air.
      setMapAltitude(camera.position.y - ground);
      // Repoint the shared real lamp lights at the nearest heads.
      lampLights.updateNearest(camera.position);
      lantern.follow(
        camera.position,
        shadowViewDir,
        camera.position.y - ground
      );
      stepVegetation(elapsed, camera.position, tick);
      return null;
    }
    const foot = footprintCircle(modelFootprint(target, viewportCss()));
    sunRig.followFootprint(
      foot.x,
      siteGround.underWorld(foot.x, foot.z),
      foot.z,
      foot.radius,
      budget.tier === "mobile" ? SHADOW_MAX_RADIUS : MODEL_SHADOW_MAX
    );
    const equivalent = modelRig.equivalentDistance() ?? 600;
    const { pivot } = target;
    eye.set(pivot.x, pivot.y + equivalent, pivot.z);
    setMapAltitude(equivalent);
    lampLights.updateNearest(eye);
    lantern.off();
    stepVegetation(elapsed, eye, tick);
    return equivalent;
  };
  /**
   * Modell's cuts per frame: a Schnitt fills the buildings it opens
   * (the clay's poché) and draws the ground's profile along the cut; off
   * Modell, or in another view, neither.
   */
  const updateCuts = () => {
    const v = modelRig.view();
    const section = v !== null && MODEL_PRESET_BY_ID[v.preset].poche;
    setClaySection(styleResources, section);
    if (section) {
      cuts.showSection(
        v,
        (v.metresPerPixel * viewportCss().width) / 2,
        siteGround.atWorld,
        groundVersion
      );
    } else {
      cuts.hideSection();
    }
  };
  /** counts the Ausschnitt's requests: a hold that ends late is stale */
  let cutRequest = 0;
  /** the last Ausschnitt could not be built: Modell's panel says so (not
   *  the HUD's layer word — no part of the city is missing) */
  let cutOutFailed = false;
  /**
   * Sets the Ausschnitt to the middle of the view, or lifts it. A new one
   * shows once its programs are built and held off the frames
   * (post-stack.ts `holdCut`): switching the city's clipping builds every
   * material anew, both ways. Lifted, they go after the frame that no
   * longer needs them.
   */
  const setCutOut = (on: boolean) => {
    // where a glide (a preset switch, a turn) is heading: mid-way a view
    // near level shows no ground to fit a square into
    const v = modelRig.settledView();
    const cut = on && v ? cutOutFromView(v, viewportCss()) : null;
    const request = ++cutRequest;
    cutOutFailed = false;
    cuts.setCutOut(cut, siteGround.atWorld, groundVersion);
    invalidateShadows();
    if (!cut) {
      postStack.releaseCut();
      return;
    }
    if (cuts.revealed()) {
      return;
    }
    postStack
      .holdCut(cuts.group, [cuts.group])
      .then(() => {
        if (request === cutRequest && !disposed) {
          cuts.reveal();
          invalidateShadows();
          opts.trail?.note("cut-out", "shown");
        }
      })
      .catch((error: unknown) => {
        // A program that failed to build: the Ausschnitt is lifted (its
        // switch no longer "building…" for ever) and said in Modell's
        // panel, beside its switch.
        if (request !== cutRequest || disposed) {
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        opts.trail?.note("cut-out failed", message);
        setCutOut(false);
        cutOutFailed = true;
        if (isAllocationFailure(error)) {
          memoryEmergency("allocation cut-out");
        }
      });
  };
  /** Modell's view for the HUD, with the scene's half: the Ausschnitt. */
  const modelHud = (): ModelHud | null => {
    const hud = modelRig.hud();
    return (
      hud && {
        ...hud,
        cutOut: cuts.cutOut() !== null,
        cutOutPending: cuts.cutOut() !== null && !cuts.revealed(),
        cutOutFailed,
      }
    );
  };
  /** Modell's pose for the minimap (the pivot, the turn) and its HUD. */
  let modelHudShown = false;
  const tickModel = () => {
    const hud = modelHud();
    if (!hud) {
      return;
    }
    modelHudShown = true;
    opts.onModelView?.(hud);
    const epsg = worldToEpsg(hud.pivot.x, hud.pivot.z, offset);
    opts.onPose?.({
      epsgX: epsg.x,
      epsgY: epsg.y,
      heading: (hud.turnDeg * Math.PI) / 180,
      footprint: hud.footprint.map((p) => {
        const e = worldToEpsg(p.x, p.z, offset);
        return [e.x, e.y] as const;
      }),
    });
  };
  const tickModelOff = () => {
    if (modelHudShown) {
      modelHudShown = false;
      opts.onModelView?.(null);
    }
  };

  let tickDue = 0;
  let fpsDue = 0;
  let frames = 0;
  // The page's GPU-loss, memory-emergency and resume decisions are one
  // pure machine (lib/city/page-lifecycle.ts, ADR 0046): the renderer,
  // the stream and the document feed it signals, and `runLifecycle`
  // carries out the effects it answers with, in the trail's order.
  // `onGpuLost` is asked once per stop; its reload waits for the effect.
  // One that throws is no reload: the machine catches it, so the render
  // still stops and the page says the GPU failed ("recovery failed").
  let reloadNow: (() => void) | null = null;
  // the governor's forced step, for the emergency's applyStep that follows
  let forcedStep: MemoryStep | null = null;
  let shadowResume: ReturnType<typeof setTimeout> | undefined;
  cleanups.push(() => clearTimeout(shadowResume));
  const lifecycle = createPageLifecycle({
    emergencyGapMs: EMERGENCY_GAP_MS,
    shadowHoldMs: EMERGENCY_SHADOW_HOLD_MS,
    mayReload: (how) => {
      reloadNow = opts.onGpuLost?.(how) ?? null;
      return reloadNow !== null;
    },
    hiddenAt: document.hidden ? Date.now() : null,
  });
  type Effects = {
    [K in LifecycleEffect["kind"]]: (
      effect: Extract<LifecycleEffect, { kind: K }>
    ) => void;
  };
  const effects: Effects = {
    note: (e) => opts.trail?.note(e.event, e.detail),
    stopRender: () => void renderer.setAnimationLoop(null),
    reload: () => {
      const reload = reloadNow;
      if (reload) {
        void releaseGpu(renderer).then(() => whenVisible(reload));
      }
    },
    fatal: (e) => {
      if (!e.beforeFirstFrame) {
        opts.onFatal?.(e.message);
        return;
      }
      const failed = `Die Grafik ist ausgefallen (${e.message}). Bitte neu laden.`;
      bootFailure ??= new Error(failed);
    },
    shed: () => shedUnusedTiles(stream.tiles.lruCache),
    governorForce: (e) => {
      forcedStep = governor.force(3, renderer.info.memory.total, e.now);
    },
    applyStep: () => {
      applyStep(forcedStep ?? governor.step());
      forcedStep = null;
    },
    holdShadows: (e) => {
      shadowHeldUntil = Math.max(shadowHeldUntil, e.untilNow);
      streamShadowTiles(sunUp);
      clearTimeout(shadowResume);
      shadowResume = setTimeout(
        () => streamShadowTiles(sunUp),
        EMERGENCY_SHADOW_HOLD_MS + GOVERN_MS
      );
    },
    raiseSafety: () =>
      raiseSafety(budget.safety, { by: opts.trail?.startedAt }),
  };
  const runLifecycle = (signal: LifecycleSignal): void => {
    for (const effect of lifecycle.dispatch(signal)) {
      // reason: the map's key and the effect's kind are the same union member
      (effects[effect.kind] as (e: LifecycleEffect) => void)(effect);
    }
  };
  /** Now, as the machine's signals carry it. */
  const at = () => ({ now: performance.now(), hidden: document.hidden });
  // The GPU ran out of memory (an uncaptured GPUOutOfMemoryError, a failed
  // upload or compile the stream reports): the one entry for them all.
  const memoryEmergency = (reason: string): void =>
    runLifecycle({ kind: "allocationFailed", reason, ...at() });
  // A device the browser reports lost: three only stops drawing (silently,
  // every frame after it returns early), so the loop stops here too.
  const onDeviceLost = renderer.onDeviceLost.bind(renderer);
  renderer.onDeviceLost = (info) => {
    onDeviceLost(info);
    runLifecycle({ kind: "deviceLost", message: info.message, ...at() });
  };
  // WebKit's failed allocation also arrives, after the fact, as an
  // uncaptured GPUOutOfMemoryError (three passes its class name as the
  // type): the earliest word there is of a GPU running out.
  const onGpuError = renderer.onError.bind(renderer);
  // reason: typed as a string; the WebGPU backend passes { type, message }.
  renderer.onError = (info: string | { type?: string; message?: string }) => {
    onGpuError(info as string);
    if (typeof info === "object" && info.type === "GPUOutOfMemoryError") {
      memoryEmergency(info.message ?? "GPUOutOfMemoryError");
    }
  };
  // A frame that throws stops the render: a lost GPU (WebKit throws
  // InvalidStateError before any device-lost arrives) fails every frame
  // after it, and anything else thrown inside three's render leaves it
  // unwound. Carrying on is never a recovery; how it went (reclaimed, lost
  // or a bug) is the machine's frameLoss, the probe asked only if needed.
  const onFrameFailed = (error: unknown) => {
    runLifecycle({
      kind: "frameFailed",
      message: error instanceof Error ? error.message : String(error),
      where:
        error instanceof Error
          ? (error.stack ?? "").split("\n").slice(0, 4).join(" | ")
          : "",
      allocation: isAllocationFailure(error),
      gpuAnswers: () => probeGpu(renderer) === null,
      ...at(),
    });
  };
  // Bild speichern: one tile per frame, read in the frame's own task right
  // after its render (the canvas's picture is only readable until the task
  // ends). One per frame because three's screen passes (SMAA, GTAO) render
  // once per animation frame: a second render in the same frame would reuse
  // the first one's antialiased picture.
  let lastEquivalent = 600;
  type CaptureRequest = {
    resolve: (image: CapturedImage) => void;
    reject: (error: unknown) => void;
  };
  const captureQueue: CaptureRequest[] = [];
  let capture: {
    request: CaptureRequest;
    view: ModelCamera | PerspectiveCamera;
    tiles: ExportTile[];
    next: number;
    fullW: number;
    fullH: number;
    w: number;
    h: number;
    out: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
    imagePxPerCssPx: number;
  } | null = null;
  const beginCapture = (request: CaptureRequest) => {
    const view = activeCamera() as ModelCamera | PerspectiveCamera;
    const { width: w, height: h } = renderer.domElement;
    const scale = exportScale(
      renderer.getPixelRatio(),
      budget.tier,
      modelRig.parallel(),
      w * h
    );
    const fullW = Math.round(w * scale);
    const fullH = Math.round(h * scale);
    const out = document.createElement("canvas");
    out.width = fullW;
    out.height = fullH;
    const ctx = out.getContext("2d");
    if (!ctx) {
      request.reject(new Error("2D canvas unsupported"));
      return;
    }
    capture = {
      request,
      view,
      tiles: exportTiles(fullW, fullH, w, h),
      next: 0,
      fullW,
      fullH,
      w,
      h,
      out,
      ctx,
      imagePxPerCssPx: renderer.getPixelRatio() * scale,
    };
  };
  /** Before the render: the frustum slides over the larger picture. */
  const aimCaptureTile = () => {
    if (!capture && captureQueue.length > 0) {
      beginCapture(captureQueue.shift() as CaptureRequest);
    }
    const c = capture;
    if (!c || c.tiles.length < 2) {
      return;
    }
    const t = c.tiles[c.next];
    c.view.setViewOffset(c.fullW, c.fullH, t.offsetX, t.offsetY, c.w, c.h);
  };
  /** After the render: the tile's middle into the picture. */
  const takeCaptureTile = () => {
    const c = capture;
    if (!c) {
      return;
    }
    const t = c.tiles[c.next];
    try {
      c.ctx.drawImage(
        renderer.domElement,
        t.srcX,
        t.srcY,
        t.w,
        t.h,
        t.dstX,
        t.dstY,
        t.w,
        t.h
      );
    } catch (error) {
      c.next = c.tiles.length;
      c.request.reject(error);
    }
    c.next++;
    if (c.tiles.length > 1) {
      c.view.clearViewOffset();
    }
    if (c.next >= c.tiles.length) {
      capture = null;
      c.request.resolve({ canvas: c.out, imagePxPerCssPx: c.imagePxPerCssPx });
    }
  };
  /**
   * The boot's wait for the start pose's first shadow map (the light
   * stage, below): ended by the frame that draws it — three builds the
   * shadow pass's pipelines for its casters inside that frame — or by the
   * second frame in a row with none to draw (by night the sun rig asks for
   * none).
   */
  let shadowFrameSeen: ((drawn: boolean) => void) | null = null;
  const firstShadowFrame = () =>
    new Promise<void>((resolve) => {
      let quiet = 0;
      shadowFrameSeen = (drawn) => {
        quiet = drawn || sunRig.shadowPending() ? 0 : quiet + 1;
        if (drawn || quiet >= 2) {
          shadowFrameSeen = null;
          resolve();
        }
      };
    });
  // One frame: the scene steps, streams and renders.
  const timeBootFrame = bootFrames(streamTimings);
  const frame = (time: number) => {
    const frameStart = streamTimings.now();
    timer.update(time);
    const dt = Math.min(timer.getDelta(), 0.05);
    const elapsed = timer.getElapsed();
    // The 10 Hz tick (the minimap's pose, the BVHs near, the focus, the
    // tree tiers): read here, as the trees step before it is spent.
    const poseTick = elapsed >= tickDue;
    // (not over a gap the pace held: the HUD's readout, in the very sheet
    // that paces the loop, would read the pace)
    if (dt > 0 && opts.pace?.heldBefore() !== true) {
      fps = fps === 0 ? 1 / dt : fps * 0.9 + (1 / dt) * 0.1;
    }
    // Modell owns the frame while it is on (and through its dolly zooms);
    // an export in progress holds the view still.
    const exporting = capture !== null || captureQueue.length > 0;
    if (!(modelRig.owns() || exporting)) {
      pose.step(dt);
    }
    if (!exporting) {
      modelRig.step(dt);
    }
    if (modelRig.owns()) {
      applyFog();
    }
    updateRegression(dt);
    // What to stream, from where the cameras look now.
    const view = activeCamera();
    view.updateMatrixWorld();
    syncStreamCamera();
    stream.tiles.update();
    // what the update brought into view or took out, before this frame
    // draws it (the shadow map, the lamp pool, the styles' gathering)
    streamChange.flush();
    // Advance every tile's water ripple and glitter (its sky tint is the
    // fog colour's node, in lockstep with the sun by construction).
    for (const t of terrains) {
      t.water?.update(elapsed);
    }
    const equivalent = followView(elapsed, poseTick);
    lastEquivalent = equivalent ?? 600;
    updateCuts();
    aimCaptureTile();
    // What the post passes and the scene's materials know of the camera
    // drawing this frame.
    lens.update(view, lastEquivalent);
    setViewDirection(view);
    // The fountains' jets and water shimmer (one shared uniform).
    setFountainTime(elapsed);
    // The features that hook the frame (the data layers' light, the
    // timetable trams), once they are here.
    frameHook.emit(elapsed, performance.now());
    if (poseTick) {
      tickDue = elapsed + 0.1;
      prepareBvhNear();
      if (modelRig.owns()) {
        tickModel();
      } else {
        tickModelOff();
        opts.onPose?.(pose.getPose());
        // a ray through the buildings and a march over the ground: only
        // where there is a lens blur to focus (not on a phone)
        if (lensBlur) {
          updateFocus();
        }
      }
    }
    // FPS at ~2 Hz on its own channel — must NOT churn the heavier stats
    // emit (a whole-scene walk; it also hands the HUD the footprints).
    if (timer.getElapsed() >= fpsDue) {
      fpsDue = timer.getElapsed() + 0.5;
      opts.onFps?.(fps);
    }
    // Read the flag BEFORE the render: three clears it once the map is drawn.
    const shadowRendered = sunRig.shadowPending();
    // The counters cover this frame's passes only (autoReset is off: the
    // loop's own reset also ran on held frames, which read back as zero).
    renderer.info.reset();
    framedBuilds.draw(postStack.render);
    takeCaptureTile();
    frames++;
    tickPocFrame(shadowRendered);
    timeBootFrame(frameStart, shadowRendered);
    shadowFrameSeen?.(shadowRendered);
  };
  // (It resolves once the loop is installed: nothing to wait for.) The
  // whole frame is guarded, not the render alone: three asks for the next
  // frame before it runs this one, so a throw out of the pose, the stream
  // or an overlay would come again every frame — into the trail's storage
  // and the reports' count, behind a frozen picture — and never reach
  // onFrameFailed, which stops the loop and decides the reload.
  void renderer.setAnimationLoop((time) => {
    // Paused by the e2e specs around HUD-only steps (poc-debug.ts); on resume
    // the clamp in the frame keeps the skipped time from jumping the scene.
    if (pocFramesHeld()) {
      return;
    }
    // Held back while the phone's sidebar covers the scene, still while it
    // scrolls (lib/city/frame-pace.ts); the same clamp covers the gap.
    if (opts.pace && !opts.pace.draws(time)) {
      return;
    }
    try {
      frame(time);
    } catch (error) {
      onFrameFailed(error);
    }
  });
  cleanups.push(() => void renderer.setAnimationLoop(null));
  // The crash trail's heartbeat: what a killed page was doing last.
  const trail = opts.trail;
  if (trail) {
    // The rate is counted between beats: the loop's own `fps` is smoothed
    // over a clamped frame time (≥ 20 fps by construction), which hid a
    // phone's real 7 fps.
    let beatFrames = 0;
    let beatAt = performance.now();
    const beat = setInterval(() => {
      const heap = (
        performance as Performance & {
          memory?: { usedJSHeapSize: number };
        }
      ).memory;
      const now = performance.now();
      const rate = ((frames - beatFrames) * 1000) / Math.max(now - beatAt, 1);
      beatFrames = frames;
      beatAt = now;
      trail.beat({
        frames,
        fps: rate,
        // a rate the pace held down is not the device's
        paced: opts.pace?.takePaced() === true ? true : undefined,
        gpuMB: gpuBytes() / 1_048_576,
        rasterMB: trackedTextureBytes() / 1_048_576,
        heldMB: renderer.info.memory.total / 1_048_576,
        held: heldByKind(renderer.info.memory),
        calls: renderer.info.render.drawCalls,
        triangles: renderer.info.render.triangles,
        heapMB: heap ? heap.usedJSHeapSize / 1_048_576 : undefined,
        cpuMB: cpuCount.get(cityBvhs()) / 1_048_576,
        cities: stream.visibleCities().length,
        dressings: stream.dressings.size,
        ...streamByKind(stream),
        online: navigator.onLine,
        style: lastStyle,
        mode: pose.getMode(),
        heightM: camera.position.y - groundUnderCamera(),
        stopped: lifecycle.stopped,
      });
    }, TRAIL_BEAT_MS);
    cleanups.push(() => clearInterval(beat));
  }
  // Coarser tiles in view before the browser takes the GPU away
  // (lib/city/memory-governor.ts): the error target and the cache's lower
  // bound follow what the renderer holds. A page at a raised safety level
  // (lib/city/gpu-safety.ts) has lower lines and starts further down, at
  // its floor — already for the stream's first update, in the next frame.
  const governor = createMemoryGovernor(
    memoryLimitsFor(budget.tier, budget.safety),
    memoryFloorFor(budget.tier, budget.safety)
  );
  const baseError = stream.tiles.errorTarget;
  const baseMin = stream.tiles.lruCache.minBytesSize;
  // A phone's page in the background keeps no tile it does not use (the
  // resume guard, below): its lower bound is 0 until it is shown again,
  // whatever step the governor takes meanwhile.
  const shedding = () => budget.tier === "mobile" && document.hidden;
  const applyStep = (step: MemoryStep) => {
    stream.tiles.errorTarget = baseError * step.errorScale;
    stream.tiles.lruCache.minBytesSize = shedding()
      ? 0
      : baseMin * step.minScale;
  };
  applyStep(governor.step());
  const govern = setInterval(() => {
    const held = renderer.info.memory.total;
    const step = governor.update(held, performance.now());
    if (!step) {
      return;
    }
    applyStep(step);
    opts.trail?.note(
      "memory",
      `level ${step.level} at ${Math.round(held / 1_048_576)} MB`
    );
  }, GOVERN_MS);
  cleanups.push(() => clearInterval(govern));

  // --- the resume guard -------------------------------------------------
  // Hidden, a phone's page lets go of every tile not in use; shown again,
  // it gets its cache back and probes the GPU before the next frame draws
  // (page-lifecycle.ts). The time away is the wall clock's: iOS stops
  // `performance.now()` while the device sleeps.
  const onVisibility = () =>
    runLifecycle(
      document.hidden
        ? { kind: "hidden", wall: Date.now(), phone: budget.tier === "mobile" }
        : {
            kind: "shown",
            wall: Date.now(),
            now: performance.now(),
            gpuFailure: () => probeGpu(renderer),
          }
    );
  document.addEventListener("visibilitychange", onVisibility);
  cleanups.push(() =>
    document.removeEventListener("visibilitychange", onVisibility)
  );

  // The load after the first frame (lib/city/boot-phases.ts): declared
  // before the first await, since tile events call checkLoaded from then on.
  const boot = createBootPhases();
  // --- the first frame: the spawn tile's buildings and terrain ------------
  // Landed = shown by the renderer, not merely dressed: a dressed tile can
  // still be waiting on its compile, and the spawn teleport below needs
  // ground that is really there.
  // A recovered page's camera may look away from the tile it stands on:
  // once the renderer is idle without that tile, any tile it shows will do.
  const startsOn = (tile: string) =>
    tile === spawn.id || (startsElsewhere && tilesIdle);
  const spawnLanded = () => ({
    city: stream.visibleCities().some((c) => startsOn(c.tile)),
    terrain: stream.visibleTerrains().some((t) => startsOn(t.tile)),
  });
  await new Promise<void>((resolve, reject) => {
    const poll = () => {
      if (disposed || opts.signal?.aborted) {
        reject(new DOMException("CityWalk startup aborted", "AbortError"));
        return;
      }
      if (bootFailure) {
        reject(bootFailure);
        return;
      }
      const landed = spawnLanded();
      stage("buildings", landed.city ? 1 : 0.5);
      stage("terrain", landed.terrain ? 1 : 0);
      if (landed.city && landed.terrain) {
        resolve();
      } else {
        setTimeout(poll, 50);
      }
    };
    poll();
  });
  firstFrameShown = true;
  lifecycle.dispatch({ kind: "firstFrame" });
  onChange();
  flushStats();
  // Tiles compile themselves before they show; this covers the rest of the
  // scene (sky, sun rig, lamp light pool), under the overlay instead of in
  // the first visible frame. Bounded like a tile's compile: it resolves
  // only once every compile in flight has (compile-lanes.ts), neighbours'
  // included, and a frame skips what is not ready rather than stall.
  await streamTimings.timed("boot:scene-compile", () =>
    withinCompileWait(postStack.compile(scene).catch(() => undefined))
  );
  // On the spawn vantage (or where a recovered page stood) now that its
  // ground exists (the pose was placed before any terrain had landed,
  // over the fallback floor). Its buildings' BVH is built here, as the
  // placing's rays reach them (ADR 0032: never inside a building) — after
  // the tile's ground has landed, not inside the parse that landed them.
  bvhOnDemand = true;
  streamTimings.timedSync("boot:place", () => placeStart());
  streamTimings.markOnce("boot:placed");
  // The light stage ends once a frame at the start pose has drawn its
  // shadow map (or found none to draw): the shadow pass's pipelines build
  // inside that frame, synchronously, and before they did so with the bar
  // already at 52 % and the veil's timer held up behind them — a load that
  // looked frozen. Bounded like a compile: a stalled frame never holds the
  // boot.
  await streamTimings.timed("boot:light-wait", () =>
    withinCompileWait(firstShadowFrame())
  );
  // The sun rig, the shadow map and the clay materials are up: this is the
  // first renderable frame, and the point the HUD hands over to the pill.
  stage("light", 1);
  streamTimings.markOnce("boot:light-done");

  // --- everything after the first frame -------------------------------------
  // The rest of the site keeps streaming (the renderer decides what, from
  // the cameras); the dressing waits for the gate. "Loaded" is the first
  // moment after the gate at which nothing is loading and nothing waits to
  // be dressed.

  // The picture styles' programs compile once the scene has loaded and the
  // browser is idle, so the first switch to a style does not hitch — at no
  // cost to the boot, which never draws a style the viewer did not pick.
  let stylesWarming = false;
  function warmStylesWhenIdle(): void {
    if (stylesWarming) {
      return;
    }
    stylesWarming = true;
    const warm = () => {
      if (!disposed) {
        opts.trail?.note("styles warming");
        void postStack.warmStyles().then(() => opts.trail?.note("styles warm"));
      }
    };
    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(warm, { timeout: 4000 });
    } else {
      setTimeout(warm, 1000);
    }
  }

  /** "Loaded" on the trace: the time since the veil dropped, and the
   *  summary printed now and 20 s on (`?trace=1`). */
  function traceLoaded(): void {
    const veil = streamTimings.markedAt("boot:veil-drop");
    if (
      veil !== undefined &&
      streamTimings.markedAt("boot:loaded") === undefined
    ) {
      streamTimings.since("boot:veil-to-loaded", veil);
    }
    streamTimings.markOnce("boot:loaded");
    if (!traceRequested(window.location.search)) {
      return;
    }
    printTrace("loaded");
    const later = setTimeout(() => printTrace("loaded + 20 s"), 20_000);
    cleanups.push(() => clearTimeout(later));
  }

  // The two stages after the first frame measure what the cameras see:
  // the tile renderer's own load progress, and the details (vegetation,
  // lamps, rails) built per fine tile against those still queued.
  // Both only ever move forward, and both end when everything in view is in.
  function checkLoaded(): void {
    const step = boot.update({
      siteTiles: extras.tiles.length,
      tilesIdle,
      loadProgress: stream.tiles.loadProgress,
      dressingsBuilt: stream.dressings.size,
      dressingsQueued: stream.pendingDressings(),
      // Tried, not necessarily built: a dressing that failed, or whose tile
      // left before its turn, must not hold the scene short of "loaded".
      spawnDressingTried: stream.dressingSettled(spawn.id),
      // With the renderer idle, a fine level not loaded is one it does not
      // want: tiles-load-end fires only at the end of an update() whose
      // traversal requested nothing new (TilesRendererBase.update), so there
      // is no idle gap between the coarse level landing and the fine one
      // being asked for.
      spawnFineLoaded: [...stream.terrains].some(
        (t) => t.level === 0 && t.tile === spawn.id
      ),
    });
    for (const { id, fraction, skipped } of step.stages) {
      stage(id, fraction, skipped);
    }
    if (step.loaded) {
      flushStats();
      opts.trail?.note("loaded");
      worldPartial = false;
      applyFog();
      opts.onLoaded?.();
      warmStylesWhenIdle();
      traceLoaded();
    }
    if (step.busy !== undefined) {
      opts.onBusy?.(step.busy);
    }
  }

  /**
   * Lets the dressing through, held until the HUD says so: the canopy build
   * (tens of thousands of instances, one synchronous pass) and the terrain
   * BVHs each stall the main thread for a dozen frames, and the handover is
   * where the city appears and the player takes over. `startStreaming` is
   * idempotent; the HUD calls it once the veil is gone (city-walk.tsx).
   */
  const startStreaming = (): void => {
    if (disposed || !boot.startStreaming()) {
      return;
    }
    stage("details", 0);
    // Marks the trail: a page that dies from here on dies building the
    // dressing, not in the frames before it.
    opts.trail?.note("dressing gate");
    openGate();
    loadFootprints();
    checkLoaded();
  };

  /** Marks the app gone, once: false when it already was. */
  const leave = (): boolean => {
    if (disposed) {
      return false;
    }
    disposed = true;
    lifecycle.dispatch({ kind: "dispose" });
    return true;
  };

  return {
    setSun,
    clearInquiry: () => {
      along = null;
      probe.clear();
    },
    selectCandidate,
    previewCandidate: probe.preview,
    demolishAtCrosshair,
    inquireAt,
    enterImmersive: canvasControls.lockPointer,
    releaseGpu: () => releaseGpu(renderer),
    flyTo: (position, lookAt) => {
      modelRig.exitNow();
      pose.flyTo(position, lookAt);
    },
    // In Modell a place is where the picture is centred (plan 055).
    flyToViewpoint: (view) =>
      modelRig.owns()
        ? modelRig.centreOn(vantageTarget(view))
        : pose.flyToViewpoint(view),
    captureViewpoint: pose.captureViewpoint,
    placeAt: (view) =>
      modelRig.owns()
        ? modelRig.centreOn(groundPoint(view.epsg.x, view.epsg.y))
        : pose.placeAt(view),
    teleportTo: (x, y) =>
      modelRig.owns()
        ? modelRig.centreOn(groundPoint(x, y))
        : pose.teleportTo(x, y),
    glideToSpot: (x, y) =>
      modelRig.owns()
        ? modelRig.centreOn(groundPoint(x, y))
        : pose.glideToSpot(x, y),
    getGlideTarget: pose.getGlideTarget,
    getPose: () => {
      const hud = modelRig.hud();
      if (!hud) {
        return pose.getPose();
      }
      const epsg = worldToEpsg(hud.pivot.x, hud.pivot.z, offset);
      return {
        epsgX: epsg.x,
        epsgY: epsg.y,
        heading: (hud.turnDeg * Math.PI) / 180,
      };
    },
    // In Modell: the perspective pose it would leave to (what a reader
    // without Modell shows), and the parallel view itself.
    getCameraState: () => {
      const model = modelRig.state();
      const perspective = model ? modelRig.perspectiveState() : null;
      if (!(model && perspective)) {
        return pose.getCameraState();
      }
      const epsg = worldToEpsg(perspective.pos.x, perspective.pos.z, offset);
      return { ...perspective, epsg: { x: epsg.x, y: epsg.y }, model };
    },
    applyCameraState: (state) => {
      const { model, ...perspective } = state;
      if (!model) {
        modelRig.exitNow();
      }
      pose.applyCameraState(perspective);
      if (model) {
        modelRig.applyState(model);
      }
    },
    getRenderInfo: () => ({
      calls: renderer.info.render.drawCalls,
      passes: renderer.info.render.frameCalls,
      triangles: renderer.info.render.triangles,
      framedBuilds: { ...framedBuilds.counts },
      // counted now: a debug read, on demand
      gpuBytes: gpuBytesWith(estimateGeometryBytes(scene)),
      memory: { ...renderer.info.memory },
    }),
    getGpuDebug: () => {
      const cache = stream.tiles.lruCache as unknown as {
        cachedBytes: number;
        maxBytesSize: number;
        itemSet: Map<unknown, unknown>;
        usedSet: Set<unknown>;
        loadedSet: Set<unknown>;
        bytesMap: Map<unknown, number>;
      };
      const cpu = cpuBytesOf(stream);
      return {
        ...sceneBuffers(scene),
        held: { ...renderer.info.memory },
        cpuMB: Object.fromEntries(
          Object.entries(cpu).map(([kind, bytes]) => [
            kind,
            Math.round(bytes / 104_857.6) / 10,
          ])
        ) as Record<keyof CpuBytes, number>,
        anchors: postStack.anchorCount(),
        tileCache: {
          bytes: cache.cachedBytes,
          maxBytes: cache.maxBytesSize,
          items: cache.itemSet.size,
          used: cache.usedSet.size,
          loaded: cache.loadedSet.size,
          sizes: [...cache.itemSet.keys()].map(
            (item) =>
              `${Math.round((cache.bytesMap.get(item) ?? 0) / 1_048_576)}${cache.usedSet.has(item) ? "u" : ""}`
          ),
        },
      };
    },
    getFocusDebug: () => ({
      ...postStack.getFocusInfo(),
      hitDist: lastFocusHit?.dist ?? null,
      hitName: lastFocusHit?.name ?? null,
    }),
    setMovementMode: (mode) =>
      modelRig.owns() ? modelRig.leave(mode) : pose.setMovementMode(mode),
    setViewMode: (mode) => {
      if (mode === "model") {
        modelRig.enter();
      } else if (modelRig.owns()) {
        modelRig.leave(mode);
      } else {
        pose.setMovementMode(mode);
      }
    },
    getViewMode: () => viewMode,
    setCutOut,
    captureImage: () =>
      new Promise<CapturedImage>((resolve, reject) => {
        captureQueue.push({ resolve, reject });
      }),
    toggleModel: () => (modelRig.owns() ? modelRig.leave() : modelRig.enter()),
    setModelPreset: (preset) =>
      modelRig.owns() ? modelRig.setPreset(preset) : modelRig.enter(preset),
    setModelScale: modelRig.setScale,
    turnModel: modelRig.turnBy,
    turnModelTo: modelRig.turnTo,
    setModelTilt: modelRig.setTilt,
    setModelShear: modelRig.setShear,
    getModelHud: modelHud,
    setFollowAim: pose.setFollowAim,
    setFollowPosition: pose.setFollowPosition,
    setClimbInput: pose.setClimbInput,
    setMoveInput: pose.setMoveInput,
    startStreaming,
    getFootprints: currentFootprints,
    ...siteInfo,
    offset,
    dispose: () => {
      if (leave()) {
        // Same list, same order as a failed boot unwinds: animation loop ->
        // resize observer -> listeners -> touch -> post stack -> stream ->
        // lights -> sun rig.
        void teardown(cleanups, scene, renderer);
      }
    },
    disposeForReload: () => {
      if (!leave()) {
        return Promise.resolve();
      }
      const started = performance.now();
      let gone = false;
      const lost = deviceGone(renderer).then(() => {
        gone = true;
      });
      const released = teardownWhole(cleanups, scene, renderer, (left) =>
        opts.trail?.note(
          "teardown",
          `${left.geometries} geometries, ${left.textures} textures left, ${Math.round(left.total / 1_048_576)} MB`
        )
      );
      return Promise.race([
        Promise.all([released, lost]),
        new Promise<void>((resolve) => {
          setTimeout(resolve, TEARDOWN_WAIT_MS);
        }),
      ]).then(() => {
        opts.trail?.note(
          "teardown done",
          `${Math.round(performance.now() - started)} ms, device ${gone ? "gone" : "not confirmed"}`
        );
      });
    },
  };
}
