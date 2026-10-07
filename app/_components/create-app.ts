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
import { fogRangeFor } from "@/lib/city/atmosphere";
import { utmToLatLng } from "@/lib/city/crs";
import { WALL_CLEARANCE } from "@/lib/city/clearance";
import { createBootPhases } from "@/lib/city/boot-phases";
import {
  createMemoryGovernor,
  memoryFloorFor,
  memoryLimitsFor,
  type MemoryStep,
} from "@/lib/city/memory-governor";
import { isAllocationFailure } from "@/lib/city/gpu-allocation";
import {
  type GpuLoss,
  type SafetyLevel,
  shadowTilesStream,
  startTileOf,
} from "@/lib/city/gpu-safety";
import { createGround } from "@/lib/city/ground";
import {
  createPageLifecycle,
  type LifecycleEffect,
  type LifecycleSignal,
} from "@/lib/city/page-lifecycle";
import type { Landmark } from "@/lib/city/landmarks";
import type { LoadStageId, LoadStageUpdate } from "@/lib/city/load-stages";
import {
  LOOK_DEFAULTS,
  type LookValues,
  type SceneLookKey,
} from "@/lib/city/look-controls";
import type { LookState } from "@/lib/city/look-state";
import type { BikeCounter } from "@/lib/city/bike-counts";
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
import { parseTilesetExtras, type TilesetExtras } from "@/lib/city/tileset";
import type { Inquiry } from "@/lib/city/inquiry";
import { valleyFalloff } from "@/lib/city/valley-fog";
import { createCameraPose, type FollowAim } from "./camera-pose";
import {
  createModelRig,
  type ModelHud,
  type ModelRig,
  type ViewMode,
} from "./model-rig";
import type { ModelCamera } from "./model-camera";
import { createViewLens } from "./view-lens";
import { setPickRay } from "./view-ray";
import { countBuildings, pickCityObject } from "./city-layer";
import { createInquiryProbe, type OutlineSubject } from "./inquiry-probe";
import {
  bridgeShape,
  buildingShape,
  solidShape,
  standInDepth,
  trafficTriangles,
} from "./selection-shape";
import type { OutlineSelection } from "./selection-outline";
import { trafficMesh } from "./traffic-ask";
import { createCityCollider } from "./collision";
import type { CrashTrail } from "./crash-trail";
import { createSeasonClock } from "./crown-season";
import {
  fetchOptionalJson,
  fetchRequiredJson,
  isAbortError,
} from "./fetch-optional";
import type { MovementMode } from "./fps-movement";
import { NO_GPU_MESSAGE } from "./gpu-support";
import { raiseSafety } from "./gpu-safety";
import { pageLeaving } from "./net-gate";
import { createSceneFog, installSceneFog } from "./height-fog";
import { attachKeyboardControls } from "./keyboard-controls";
import { createLampLights } from "./lamp-layer";
import { setFountainNight, setFountainTime } from "./monument-layer";
import { setClockTime, setFurnitureNight } from "./furniture-layer";
import { setMapAltitude } from "./map-overlay";
import { setDataTime } from "./glass";
import { createDataOverlays } from "./data-overlays";
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
  createTileStream,
  DRESSING_PART_NAMES,
  DRESSING_PARTS,
  type DressingPartName,
  showDataLayers,
  type TileDressing,
} from "./tile-stream";
import { createNetworkWatch } from "./tile-retry";
import { attachTouchControls } from "./touch-controls";
import {
  treesWithin,
  updateVegetationLod,
  type VegetationControl,
} from "./vegetation-layer";
import {
  type Listening,
  type SoundTile,
  soundTileOf,
} from "@/lib/city/sound-entry";
import {
  applyCityLook,
  createStyleResources,
  setClaySection,
} from "./visual-style";
import { createModelCuts } from "./model-cuts";

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
/** How often the memory governor looks at the GPU memory held. */
const GOVERN_MS = 1000;

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
): Omit<GpuDebug, "held" | "tileCache" | "anchors"> {
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
  /** Every layer has streamed in (the scene is complete). */
  onLoaded?: () => void;
  /**
   * After `onLoaded`: whether tiles or their details are loading right now
   * (a flight streams new tiles in). Fires on changes only.
   */
  onBusy?: (busy: boolean) => void;
  /** a manual look or move ended live mode (camera-pose.ts) */
  onFollowEnd?: () => void;
  /**
   * What was asked last ("Befragen", ADR 0042): a click, a long press or
   * `I` at the crosshair; null when nothing stands there.
   */
  onInquiry?: (inquiry: Inquiry | null) => void;
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
   * Asks what stands at a screen point (NDC; the crosshair when omitted),
   * marks it and reports it through `onInquiry`; tests and QA call it.
   */
  inquireAt: (ndc?: { x: number; y: number }) => Inquiry | null;
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
    /** estimated GPU bytes of geometry + textures + shadow map */
    gpuBytes: number;
    /**
     * What the renderer itself holds on the GPU (three's `info.memory`):
     * counts and bytes of attributes, textures, programs, uniform buffers
     * and render targets — the counters to watch for a leak.
     */
    memory: Readonly<Record<string, number>>;
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
  setSun: (date: Date) => SunState;
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
  /**
   * The hidden soundscape's ear (plan 035): the camera's height above the
   * ground, the movement mode, the trees within `treeRadius` m and the
   * clock the crowns sway with. Read at the pose rate while sound plays.
   */
  listen: (treeRadius: number) => Listening;
  /** per tile, the files the soundscape fetches while it plays (URLs) */
  soundTiles: SoundTile[];
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
  try {
    return await bootApp(opts, renderer, scene, cleanups);
  } catch (err) {
    // Centralized teardown: covers both abort (StrictMode remount) and real
    // load failures — otherwise the dead canvas would linger in the DOM.
    teardown(cleanups, scene, renderer);
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
): void {
  runCleanups(cleanups);
  disposeObject3D(scene);
  // Async: it destroys the device (or loses the context) at the end.
  renderer.dispose().catch(() => undefined);
  renderer.domElement.remove();
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

  const camera = new PerspectiveCamera(
    DEFAULT_FOV,
    container.clientWidth / Math.max(container.clientHeight, 1),
    0.3,
    6000
  );
  scene.add(camera);
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

  /** One stage report for the HUD (lib/city/load-stages.ts). */
  const stagesDone = new Set<LoadStageId>();
  const stage = (id: LoadStageId, fraction: number, skipped?: boolean) => {
    if ((fraction >= 1 || skipped) && !stagesDone.has(id)) {
      stagesDone.add(id);
      opts.trail?.note(`stage ${id}`, skipped ? "skipped" : undefined);
    }
    opts.onStage?.({ id, fraction, skipped });
  };

  stage("buildings", 0);
  // What the viewer needs before any content: the frame and the tile list.
  const tilesetUrl = new URL(opts.tilesetUrl, window.location.href).href;
  const extras = parseTilesetExtras(
    await fetchRequiredJson(tilesetUrl, opts.signal)
  );
  ensureAlive();
  const { offset } = extras;
  // The tile the boot starts on and waits for: the spawn tile, or the one
  // a recovered page's camera stands on (lib/city/gpu-safety.ts).
  const spawn =
    startTileOf(extras.tiles, opts.initialCamera?.epsg) ?? extras.tiles[0];
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
  // The ground's look strengths and the sun: uniform nodes every tile's
  // materials share, so a slider is one uniform write.
  const ground: GroundUniforms = {
    groundDetail: uniform(LOOK_DEFAULTS.groundDetail),
    meadowNdvi: uniform(LOOK_DEFAULTS.meadowNdvi),
    urbanGreen: uniform(LOOK_DEFAULTS.urbanGreen),
    skyView: uniform(LOOK_DEFAULTS.skyView),
    horizonShade: uniform(LOOK_DEFAULTS.horizonShade),
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
  const sunRig = createSunRig(
    scene,
    worldBounds,
    latLng,
    shadowMapSizeFor(budget.profile, budget.tier, budget.safety),
    sunDirection,
    sceneFog.color
  );
  cleanups.push(sunRig.dispose);
  // The horizon's near band hands over to the shadow map inside the frustum.
  ground.shadowReach.value = sunRig.shadowReach;

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
  };

  // One scalar (nightFactor ∈ [0,1]) ignites every lamp at dusk; clayNight
  // gates the clay dusk glow by reference.
  const clayNight = uniform(0);
  let currentNight = 0;
  // The picture styles follow the sun too (Film noir's dusk exposure); the
  // post stack is built after the first setSun, so it catches up there.
  let sunAltitude = 90;
  let sunToStyles: ((altitudeDeg: number) => void) | null = null;
  // The data layers' clock (the timetable trams) follows the HUD's instant;
  // they are created with the post stack, after the first setSun.
  let clockToOverlays: ((date: Date) => void) | null = null;
  // Single fixed pool of real point lights for the nearest lamps across ALL
  // tiles, built before the first render so the light count is part of
  // every lit node build once (ADR 0020); each tile's lamps retarget it.
  const lampLights = createLampLights();
  for (const light of lampLights.lights) {
    scene.add(light);
  }
  cleanups.push(() => lampLights.dispose());

  // The facades share the ground's Himmelslicht strength (the same node).
  const styleResources = createStyleResources(clayNight, ground.skyView);

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
  // Shader compiles go through the post stack (it knows the target the
  // scene renders into). It is created a few lines below, before the render
  // loop runs the stream's first update, so no tile lands without it.
  let compileWith: PostStack["compile"] | null = null;
  // The trees follow the scene's calendar day (crown-season.ts): colour and
  // leaf cover are rewritten on a change of day, never per frame, and a
  // crown that changed redraws the shadow map.
  const seasonClock = createSeasonClock(opts.initialDate, (day) => {
    let changed = false;
    for (const d of stream.dressings) {
      changed = (d.vegetation?.setSeason(day) ?? false) || changed;
    }
    if (changed) {
      invalidateShadows();
    }
  });
  cleanups.push(() => seasonClock.dispose());
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
      dressingGate,
      fogColor: sceneFog.color,
      heightAt,
      look: opts.look,
      lowRasters: budget.lowRasters,
      cacheBytes: tileCacheBytesFor(budget.tier, budget.safety),
      ground,
      night: () => currentNight,
      season: () => seasonClock.day(),
      offset,
      onChange: () => onChange(),
      renderer,
      styleResources,
      sunDirection,
      tier: budget.tier,
      tileBounds: (id) => extras.tiles.find((t) => t.id === id)?.bounds,
      tilesetUrl,
    },
    world,
    [
      {
        camera,
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
    onChange();
  });
  stream.tiles.addEventListener("tiles-load-end", () => {
    tilesIdle = true;
    onChange();
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
  // From safety level 2 (lib/city/gpu-safety.ts) it streams nothing, nor
  // for a while after a memory emergency (memoryEmergency, below).
  let shadowHeldUntil = shadowTilesStream(budget.safety)
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
  const setSun = (date: Date): SunState => {
    const state = sunRig.update(date);
    streamShadowTiles(state.aboveHorizon);
    currentNight = state.nightFactor;
    sunAltitude = state.altitudeDeg;
    sunToStyles?.(state.altitudeDeg);
    for (const d of stream.dressings) {
      d.lamps?.setNightFactor(state.nightFactor);
    }
    lampLights.setNightFactor(state.nightFactor);
    setFountainNight(state.nightFactor);
    setFurnitureNight(state.nightFactor);
    setClockTime(date);
    clayNight.value = state.nightFactor;
    seasonClock.set(date);
    clockToOverlays?.(date);
    invalidateShadows();
    return state;
  };
  setSun(opts.initialDate);

  // Fog: until the first streaming pass has landed, the world may end at the
  // spawn tile's edge; a tighter fog turns that edge into haze. The slider
  // value is kept and re-applied once the stream has settled.
  let fogAmount = opts.look.get().fogAmount;
  let heightFogAmount = opts.look.get().heightFog;
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
    sceneFog.heightStrength.value = heightFogAmount * (1 - blend);
    if (rig?.parallel()) {
      sceneFog.siteRect.value.set(-1e9, -1e9, 1e9, 1e9);
    } else {
      sceneFog.siteRect.value.copy(siteRect);
    }
  };
  applyFog();

  stage("light", 0);
  const postStack = createPostStack(
    renderer,
    scene,
    camera,
    activeCamera,
    lens,
    aoSamplesFor(budget.profile),
    sceneFog,
    postProfileFor(budget.tier)
  );
  cleanups.push(() => postStack.dispose());
  compileWith = postStack.compile;
  sunToStyles = postStack.setSunAltitude;
  // The site-wide data layers (the live bicycle counters): built, fetched
  // and polled only once switched on (lib/city/data-layers.ts).
  const overlays = createDataOverlays({
    bikeFeed: opts.site.dataLayers?.bikes?.feed,
    bounds: unionBounds(extras),
    bridgeUrls: extras.tiles.flatMap((t) =>
      t.bridges ? [new URL(t.bridges, tilesetUrl).href] : []
    ),
    compile: (object) => postStack.compile(object).catch(() => undefined),
    epsg: extras.epsg,
    ground: { offset, heightAt },
    initialDate: opts.initialDate,
    onBikeCounts: opts.onBikeCounts,
    onChange: () => scheduleStats(),
    onTramStatus: opts.onTramStatus,
    onTrafficHour: opts.onTrafficHour,
    parent: scene,
    tramTimetableUrl: extras.trams
      ? new URL(extras.trams, tilesetUrl).href
      : undefined,
  });
  clockToOverlays = overlays.setClock;
  cleanups.push(() => overlays.dispose());
  postStack.setSunAltitude(sunAltitude);

  // The look store is the one source of every slider value: applied now, on
  // every change, and (in tile-stream.ts) to each tile that lands later. The
  // store outlives this instance — unsubscribe on dispose.
  const sceneRows: Record<SceneLookKey, (value: number) => void> = {
    fogAmount: (amount) => {
      fogAmount = amount;
      applyFog();
    },
    heightFog: (strength) => {
      heightFogAmount = strength;
      applyFog();
    },
    groundDetail: (strength) => {
      ground.groundDetail.value = strength;
    },
    meadowNdvi: (strength) => {
      ground.meadowNdvi.value = strength;
    },
    urbanGreen: (strength) => {
      ground.urbanGreen.value = strength;
    },
    skyView: (strength) => {
      ground.skyView.value = strength;
    },
    horizonShade: (strength) => {
      ground.horizonShade.value = strength;
    },
    waterMist: (strength) => {
      for (const t of stream.terrains) {
        t.water?.setMist(strength);
      }
    },
  };
  let lastTransparency = Number.NaN;
  let lastStyle = opts.look.get().style;
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
    for (const d of stream.dressings) {
      d.vegetation?.applyLook(look);
      showDataLayers(d, look);
    }
    overlays.apply(look);
  };
  applyLook(opts.look.get());
  cleanups.push(opts.look.subscribe(applyLook));

  // Wall collision against the buildings of every visible tile, and the
  // vertical rays that keep the camera out of them.
  const collider = createCityCollider(() =>
    stream.visibleCities().map((c) => c.mesh)
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
      stream.tiles.deleteCamera(camera);
    } else {
      stream.tiles.setCamera(camera);
      stream.tiles.setResolution(camera, width, height);
      stream.tiles.deleteCamera(model);
    }
    postStack.setModel(parallel);
    sunRig.setParallel(parallel, paperOf(opts.look.get().style));
    if (!parallel && cuts.cutOut()) {
      // the Ausschnitt is a Modell thing: a walk sees the whole city
      setCutOut(false);
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
  // to put back): its first update streams that place, not the spawn. It
  // boots looking straight down (clamped to the pitch limit) onto that
  // tile: a pose that looks at the sky, or out past the site's edge, from
  // the air sees no tile — nothing would load, and by night or from safety
  // level 2 no shadow camera streams one either, so the boot would wait
  // for ever. Its own aim goes back once the tile has landed (below, and
  // the HUD's after the first frame).
  const spawnView = spawnViewpoint(opts.site);
  const restored = startTileOf(extras.tiles, opts.initialCamera?.epsg)
    ? opts.initialCamera
    : undefined;
  const placeStart = (booting = false) => {
    if (!restored) {
      pose.placeAt(spawnView);
      return;
    }
    pose.applyCameraState(booting ? { ...restored, pitchDeg: -90 } : restored);
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
  // and I at the crosshair — there is no mode to switch on first.
  // What the outline goes around (selection-shape.ts): a building's own
  // triangles, a bridge's out of its tile's bridge meshes, a tree's or a
  // monument's shape after its data.
  const outline = (subject: OutlineSubject | null) => {
    postStack.setSelection(outlineShape(subject));
  };
  const outlineShape = (
    subject: OutlineSubject | null
  ): OutlineSelection | null => {
    if (!subject) {
      return null;
    }
    if ("building" in subject) {
      const positions = buildingShape(
        subject.building.layer,
        subject.building.objects
      );
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
      positions: solidShape(solids, target.kind === "tree" && target.conifer),
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
    things: () => [
      ...stream.visibleDressings().flatMap((d) => d.asks ?? []),
      ...overlays.asks(),
    ],
    viewport: () => ({
      width: renderer.domElement.clientWidth || 1,
      height: renderer.domElement.clientHeight || 1,
    }),
  });
  // A tree's card fetches what the register says about it (ADR 0042).
  const treeFactsUrl = (tile: string) => {
    const file = extras.tiles.find((t) => t.id === tile)?.ask?.treeFacts;
    return file ? new URL(file, tilesetUrl).href : undefined;
  };
  // What the card needs beyond what was met: a tree's facts file, a data
  // layer's credit (the site's) and, for a counted section, the hour.
  const layerSources = opts.site.dataLayers;
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
          hour: overlays.trafficHour(),
        };
      case "bikes":
        return { ...asked, credit: layerSources?.bikes?.credit };
      case "building":
      case "bridge":
      case "monument":
        return asked;
      case undefined:
        return null;
    }
  };
  const inquireAt = (ndc?: { x: number; y: number }): Inquiry | null => {
    const inquiry = answered(probe.ask(ndc));
    opts.onInquiry?.(inquiry);
    return inquiry;
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
        pose.pinchTo(ratio);
      }
    },
    onWheelDolly: (amount, ndcX, ndcY) =>
      modelRig.owns()
        ? modelRig.zoomAt({ x: ndcX, y: ndcY }, Math.exp(amount))
        : pose.dolly(amount),
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
      tapRaycaster.far = 6000;
      const building = tapRaycaster.intersectObjects(
        stream.visibleCities().map((c) => c.mesh),
        false
      )[0];
      const t = groundAlong(tapRaycaster, building?.distance ?? 6000);
      const hit =
        t === null
          ? (building?.point.clone().add(towardsCamera(building.point)) ?? null)
          : tapRaycaster.ray.at(t, new Vector3());
      if (hit) {
        pose.travelTo(hit);
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
        bikes: census([overlays.parts().bikes]),
        trams: census([overlays.parts().trams]),
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
    overlays.streamChanged();
    postStack.sceneChanged();
    invalidateShadows();
    scheduleStats();
    checkLoaded();
  };

  const demolishAtCrosshair = () => {
    const picked = pickCityObject(activeCamera(), stream.visibleCities());
    if (!picked?.layer.demolish(picked.objectIndex)) {
      return;
    }
    const kept = stream.demolished.get(picked.layer.tile) ?? new Set();
    picked.layer.alive.forEach((alive, i) => {
      if (!alive) {
        kept.add(i);
      }
    });
    stream.demolished.set(picked.layer.tile, kept);
    flattened = null;
    invalidateShadows();
    scheduleStats();
  };

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
        demolish: demolishAtCrosshair,
        // I asks at the crosshair: in pointer lock there is no pointer
        // to click with.
        inquire: () => {
          inquireAt();
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
      modelRig.parallel() ? modelRig.camera : camera,
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
  const updateFocus = () => {
    focusRaycaster.setFromCamera(focusCrosshair, camera);
    const targets: Object3D[] = stream.visibleCities().map((c) => c.mesh);
    const hit = focusRaycaster.intersectObjects(targets, false)[0];
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
  // Pick every vegetation chunk's crown tier (rich / mid / far) over all
  // loaded tiles at once — the rich crowns share one site-wide budget —,
  // swap the cadastre's own silhouettes by distance, and advance the wind
  // sway (same clock as the water ripple). A tier change changes what casts
  // shadows, so it invalidates the map.
  const vegetationControls: VegetationControl[] = [];
  /** `eye`: where the tiers are measured from (Modell: above the pivot). */
  const stepVegetation = (elapsed: number, eye: Vector3) => {
    vegetationControls.length = 0;
    let lodChanged = false;
    for (const d of stream.dressings) {
      if (d.vegetation) {
        vegetationControls.push(d.vegetation);
        d.vegetation.setTime(elapsed);
        if (d.vegetation.updateLod(eye)) {
          lodChanged = true;
        }
      }
    }
    if (updateVegetationLod(vegetationControls, eye)) {
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
   * that equivalent distance in Modell, else null.
   */
  const eye = new Vector3();
  const followView = (elapsed: number): number | null => {
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
      stepVegetation(elapsed, camera.position);
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
    stepVegetation(elapsed, eye);
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
        // switch no longer "building…" for ever) and said.
        if (request !== cutRequest || disposed) {
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        opts.trail?.note("cut-out failed", message);
        setCutOut(false);
        if (isAllocationFailure(error)) {
          memoryEmergency("allocation cut-out");
        }
        sayLayerFailed(`Ausschnitt (${message})`);
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
  // One frame: the scene steps, streams and renders.
  const frame = (time: number) => {
    timer.update(time);
    const dt = Math.min(timer.getDelta(), 0.05);
    const elapsed = timer.getElapsed();
    if (dt > 0) {
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
    stream.tiles.update();
    // Advance every tile's water ripple and glitter (its sky tint is the
    // fog colour's node, in lockstep with the sun by construction).
    for (const t of terrains) {
      t.water?.update(elapsed);
    }
    const equivalent = followView(elapsed);
    lastEquivalent = equivalent ?? 600;
    updateCuts();
    aimCaptureTile();
    // What the post passes know of the camera drawing this frame.
    lens.update(view, lastEquivalent);
    // The fountains' jets and water shimmer (one shared uniform).
    setFountainTime(elapsed);
    // The data layers' light (one shared uniform; drawn only when on).
    setDataTime(elapsed);
    // The timetable trams move on (only while their layer is on).
    overlays.step(performance.now());
    if (timer.getElapsed() >= tickDue) {
      tickDue = timer.getElapsed() + 0.1;
      if (modelRig.owns()) {
        tickModel();
      } else {
        tickModelOff();
        opts.onPose?.(pose.getPose());
        updateFocus();
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
    postStack.render();
    takeCaptureTile();
    frames++;
    tickPocFrame(shadowRendered);
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
        gpuMB: gpuBytes() / 1_048_576,
        rasterMB: trackedTextureBytes() / 1_048_576,
        heldMB: renderer.info.memory.total / 1_048_576,
        held: heldByKind(renderer.info.memory),
        calls: renderer.info.render.drawCalls,
        triangles: renderer.info.render.triangles,
        heapMB: heap ? heap.usedJSHeapSize / 1_048_576 : undefined,
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
    tile === spawn.id || (restored !== undefined && tilesIdle);
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
  // the first visible frame.
  await postStack.compile(scene).catch(() => undefined);
  // On the spawn vantage (or where a recovered page stood) now that its
  // ground exists (the pose was placed before any terrain had landed,
  // over the fallback floor).
  placeStart();
  // The sun rig, the shadow map and the clay materials are up: this is the
  // first renderable frame, and the point the HUD hands over to the pill.
  stage("light", 1);

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

  return {
    setSun,
    clearInquiry: probe.clear,
    demolishAtCrosshair,
    inquireAt,
    provenanceUrl: extras.provenance
      ? new URL(extras.provenance, tilesetUrl).href
      : null,
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
      triangles: renderer.info.render.triangles,
      gpuBytes: gpuBytes(),
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
      return {
        ...sceneBuffers(scene),
        held: { ...renderer.info.memory },
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
    landmarks: extras.landmarks ?? [],
    landcoverTiles: extras.tiles.map((t) => ({
      src: new URL(t.minimap, tilesetUrl).href,
      bounds: t.bounds,
      bridges: t.bridges ? new URL(t.bridges, tilesetUrl).href : undefined,
    })),
    latLng,
    terrainBounds: siteBounds,
    offset,
    // In Modell the ear hangs over the pivot, as high as the picture is
    // equivalent to: a model on a table hears the city from above.
    listen: (treeRadius) => {
      const target = modelRig.owns() ? modelRig.targetView() : null;
      const at = target?.pivot ?? camera.position;
      return {
        clock: timer.getElapsed(),
        heightAboveGround: target
          ? (modelRig.equivalentDistance() ?? 600)
          : camera.position.y - groundUnderCamera(),
        mode: target ? "fly" : pose.getMode(),
        trees: treesWithin(
          [...stream.dressings].flatMap((d) => d.vegetation?.chunks ?? []),
          at.x,
          at.z,
          treeRadius
        ),
      };
    },
    soundTiles: extras.tiles.map((t) => soundTileOf(t, tilesetUrl)),
    dispose: () => {
      if (disposed) {
        return;
      }
      disposed = true;
      lifecycle.dispatch({ kind: "dispose" });
      // Same list, same order as a failed boot unwinds: animation loop ->
      // resize observer -> listeners -> touch -> post stack -> stream ->
      // lights -> sun rig.
      teardown(cleanups, scene, renderer);
    },
  };
}
