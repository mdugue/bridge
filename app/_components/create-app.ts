import {
  ACESFilmicToneMapping,
  Box3,
  Color,
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
import { fogRangeFor } from "@/lib/city/atmosphere";
import { utmToLatLng } from "@/lib/city/crs";
import { worldToEpsg } from "@/lib/city/ground-clamp";
import { groundRayDistance } from "@/lib/city/ground-ray";
import type { LoadStageId, LoadStageUpdate } from "@/lib/city/load-stages";
import {
  LOOK_DEFAULTS,
  type LookValues,
  type SceneLookKey,
} from "@/lib/city/look-controls";
import type { LookState } from "@/lib/city/look-state";
import { footprintPolys } from "@/lib/city/city-mesh";
import type { FootprintPoly } from "@/lib/city/minimap";
import type { CameraState, PlayerPose, Xyz } from "@/lib/city/pose";
import { createRegressionState, stepRegression } from "@/lib/city/regression";
import { spawnViewpoint, type ViewpointGeometry } from "@/lib/city/site";
import type { TerrainBounds } from "@/lib/city/terrain-geometry";
import { parseTilesetExtras, type TilesetExtras } from "@/lib/city/tileset";
import { currentSite } from "@/sites";
import { createCameraPose } from "./camera-pose";
import { countBuildings, pickCityObject } from "./city-layer";
import { createCityCollider } from "./collision";
import { fetchOptionalJson, fetchRequiredJson } from "./fetch-optional";
import type { MovementMode } from "./fps-movement";
import { createHeightFogUniforms } from "./height-fog";
import { attachKeyboardControls } from "./keyboard-controls";
import { createLampLights } from "./lamp-layer";
import { setFountainNight, setFountainTime } from "./monument-layer";
import { tickPocFrame, updatePocDebug } from "./poc-debug";
import { createPostStack } from "./post-stack";
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
import type { GroundUniforms, TerrainLayer } from "./terrain-layer";
import {
  disposeObject3D,
  estimateGeometryBytes,
  trackedTextureBytes,
} from "./three-utils";
import { createTileStream } from "./tile-stream";
import { attachTouchControls } from "./touch-controls";
import { applyCityLook, createStyleResources } from "./visual-style";

/**
 * Vertical FOV. 55° (~85° horizontal at 16:9) reads like a natural human
 * walking perspective; wider than ~60° starts to feel fisheye/distorted.
 */
const DEFAULT_FOV = 55;
/** Fog far plane (m) until the first streaming pass has landed: half a tile
 *  plus a margin, so tiles still loading read as haze, not as an edge. */
const PARTIAL_WORLD_FOG_FAR = 1100;
const SKY_COLOR = 0x9f_b6_cc;

export type LayerName =
  | "city"
  | "lamps"
  | "monuments"
  | "rail"
  | "stairs"
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
  /** throttled (~2 Hz) smoothed FPS, decoupled from the heavier stats emit */
  onFps?: (fps: number) => void;
  /** Every layer has streamed in (the scene is complete). */
  onLoaded?: () => void;
  /**
   * After `onLoaded`: whether tiles or their details are loading right now
   * (a flight streams new tiles in). Fires on changes only.
   */
  onBusy?: (busy: boolean) => void;
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
  /**
   * Aborts startup mid-load (React StrictMode mounts effects twice in dev;
   * without this the doomed first instance would finish loading 19 MB of
   * tile data and leave a second canvas around until then).
   */
  signal?: AbortSignal;
  /** the 3D Tiles tileset to stream (lib/city/tileset.ts), a served URL */
  tilesetUrl: string;
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
  /** per-tile land-cover class PNGs + their EPSG bounds, for the minimap */
  landcoverTiles: { bounds: TerrainBounds; src: string }[];
  /** the scene's geographic position — the HUD's sunrise/sunset times */
  latLng: { lat: number; lng: number };
  /** recenter offset, lets callers map EPSG coords -> world coords */
  offset: { cx: number; cy: number };
  /** analog altitude-stick input (fly mode): +1 climbs, −1 sinks */
  setClimbInput: (v: number) => void;
  /** analog joystick input: x = strafe right, y = forward, both [-1, 1] */
  setMoveInput: (x: number, y: number) => void;
  setMovementMode: (mode: MovementMode) => void;
  setSun: (date: Date) => SunState;
  /**
   * Lets the heavy dressing start — vegetation, lamps, rails — and
   * the terrain BVHs. Held back so its synchronous chunks cannot stutter the
   * frames the city arrives in; idempotent, and a no-op once the scene is
   * disposed.
   */
  startStreaming: () => void;
  /** Drops the player at EPSG coordinates, standing on the terrain. */
  teleportTo: (epsgX: number, epsgY: number) => void;
  /** the site's extent in EPSG coordinates — the minimap frame */
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

/** Reprojects the recenter point (the spawn tile's centre) for SunCalc. */
function siteLatLng(
  epsg: number,
  offset: { cx: number; cy: number }
): { lat: number; lng: number } {
  return (
    utmToLatLng(epsg, offset.cx, offset.cy) ?? currentSite().fallbackLatLng
  );
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

  // The data is Z-up (EPSG); rotate the parent group -90° about X so data Z
  // (elevation) becomes three.js Y (up) and FPS controls just work. The
  // tileset streams into it (its frame is the data frame).
  const world = new Group();
  world.rotation.x = -Math.PI / 2;
  scene.add(world);

  // Abort checkpoint after each async step (fetches abort via the signal
  // themselves; parsing/meshing in between does not).
  const ensureAlive = () => {
    if (disposed || opts.signal?.aborted) {
      throw new DOMException("CityWalk startup aborted", "AbortError");
    }
  };

  /** One stage report for the HUD (lib/city/load-stages.ts). */
  const stage = (id: LoadStageId, fraction: number, skipped?: boolean) =>
    opts.onStage?.({ id, fraction, skipped });

  stage("buildings", 0);
  // What the viewer needs before any content: the frame and the tile list.
  const tilesetUrl = new URL(opts.tilesetUrl, window.location.href).href;
  const extras = parseTilesetExtras(
    await fetchRequiredJson(tilesetUrl, opts.signal)
  );
  ensureAlive();
  const { offset } = extras;
  const [spawn] = extras.tiles;
  const siteBounds = unionBounds(extras);

  // Shared world sun direction (surface→sun), kept in sync by the sun rig and
  // read by the water glitter and the crown shimmer (by reference).
  const sunDirection = new Vector3(0, 1, 0);
  // Shared valley height-fog uniforms (by reference): folded into every
  // fog-receiving material; the start follows the lowest terrain landed.
  const heightFog = createHeightFogUniforms();
  // The site's world XZ rectangle: EPSG north is world −Z.
  heightFog.uFogSiteRect.value.set(
    siteBounds[0] - offset.cx,
    -(siteBounds[3] - offset.cy),
    siteBounds[2] - offset.cx,
    -(siteBounds[1] - offset.cy)
  );
  // Shared ground look strengths (by reference) for the HUD sliders.
  const ground: GroundUniforms = {
    groundDetail: { value: LOOK_DEFAULTS.groundDetail },
    meadowNdvi: { value: LOOK_DEFAULTS.meadowNdvi },
    urbanGreen: { value: LOOK_DEFAULTS.urbanGreen },
  };
  // The lowest real terrain elevation so far (the Elbe surface): the floor
  // the player stands on off every tile and the valley height-fog's start,
  // lowered as each tile lands (a uniform write, no recompile).
  let groundFloor = Number.POSITIVE_INFINITY;
  const lowerGroundFloor = (minElevation: number) => {
    if (minElevation < groundFloor) {
      groundFloor = minElevation;
      heightFog.uFogHeightStart.value = groundFloor + 1;
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
  const latLng = siteLatLng(extras.epsg, offset);
  const sunRig = createSunRig(
    scene,
    worldBounds,
    latLng,
    shadowMapSizeFor(budget.profile, budget.tier),
    sunDirection
  );
  cleanups.push(sunRig.dispose);

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
  const clayNight = { value: 0 };
  let currentNight = 0;
  // Single fixed pool of real point lights for the nearest lamps across ALL
  // tiles, built before the first render so NUM_POINT_LIGHTS is baked into
  // every lit program once (ADR 0020); each tile's lamps retarget it.
  const lampLights = createLampLights();
  for (const light of lampLights.lights) {
    scene.add(light);
  }
  cleanups.push(() => lampLights.dispose());

  const styleResources = createStyleResources(heightFog, clayNight);

  // The HUD lets the heavy dressing start after the handover (startStreaming).
  let openGate: () => void = () => undefined;
  const dressingGate = new Promise<void>((resolve) => {
    openGate = resolve;
  });

  // First terrain that covers (x, y) wins, fine level first; null only when
  // off every visible tile.
  let terrains: TerrainLayer[] = [];
  const heightAt = (x: number, y: number): number | null => {
    for (const t of terrains) {
      const h = t.heightAt(x, y);
      if (h !== null) {
        return h;
      }
    }
    return null;
  };
  // The same ground in world coordinates, for rays (lib/city/ground-ray.ts).
  const groundAtWorld = (x: number, z: number): number | null => {
    const e = worldToEpsg(x, z, offset);
    return heightAt(e.x, e.y);
  };
  const rayOrigin = new Vector3();
  const rayDirection = new Vector3();
  /** Distance along a camera ray (NDC) to the ground, or null. */
  const groundAlong = (ray: Raycaster, far: number): number | null => {
    rayOrigin.copy(ray.ray.origin);
    rayDirection.copy(ray.ray.direction);
    return groundRayDistance(rayOrigin, rayDirection, groundAtWorld, { far });
  };

  // The stream: what lands and leaves, and everything that follows from it.
  let onChange: () => void = () => undefined;
  // Shader compiles go through the post stack (it knows the target the
  // scene renders into). It is created a few lines below, before the render
  // loop runs the stream's first update, so no tile lands without it.
  let compileWith: ((object: Object3D) => Promise<void>) | null = null;
  const stream = createTileStream(
    {
      compile: (object) =>
        compileWith
          ? compileWith(object).catch(() => undefined)
          : Promise.resolve(),
      dressingGate,
      heightAt,
      heightFog,
      look: opts.look,
      lowRasters: budget.lowRasters,
      ground,
      night: () => currentNight,
      offset,
      onChange: () => onChange(),
      renderer,
      styleResources,
      sunDirection,
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
      {
        camera: sunRig.shadowCamera,
        width: shadowMapSizeFor(budget.profile, budget.tier),
        height: shadowMapSizeFor(budget.profile, budget.tier),
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
  let reportedError = false;
  let firstFrameShown = false;
  let bootFailure: Error | null = null;
  stream.tiles.addEventListener("load-error", (event) => {
    const { error, tile, url } = event as {
      error?: unknown;
      tile?: unknown;
      url?: unknown;
    };
    const failure = error instanceof Error ? error : new Error(String(error));
    if (!firstFrameShown && (tile === null || String(url).includes(spawn.id))) {
      bootFailure ??= failure;
      return;
    }
    if (!(disposed || reportedError)) {
      reportedError = true;
      opts.onError?.(failure.message);
    }
  });

  const setSun = (date: Date): SunState => {
    const state = sunRig.update(date);
    currentNight = state.nightFactor;
    for (const d of stream.dressings) {
      d.lamps?.setNightFactor(state.nightFactor);
    }
    lampLights.setNightFactor(state.nightFactor);
    setFountainNight(state.nightFactor);
    clayNight.value = state.nightFactor;
    invalidateShadows();
    return state;
  };
  setSun(opts.initialDate);

  // Fog: until the first streaming pass has landed, the world may end at the
  // spawn tile's edge; a tighter fog turns that edge into haze. The slider
  // value is kept and re-applied once the stream has settled.
  let fogAmount = opts.look.get().fogAmount;
  let worldPartial = extras.tiles.length > 1;
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
  applyFog();

  stage("light", 0);
  const postStack = createPostStack(
    renderer,
    scene,
    camera,
    aoQualityFor(budget.profile)
  );
  cleanups.push(() => postStack.dispose());
  compileWith = postStack.compile;

  // The look store is the one source of every slider value: applied now, on
  // every change, and (in tile-stream.ts) to each tile that lands later. The
  // store outlives this instance — unsubscribe on dispose.
  const sceneRows: Record<SceneLookKey, (value: number) => void> = {
    fogAmount: (amount) => {
      fogAmount = amount;
      applyFog();
    },
    heightFog: (strength) => {
      heightFog.uFogHeightStrength.value = strength;
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
    waterMist: (strength) => {
      for (const t of stream.terrains) {
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
    for (const d of stream.dressings) {
      d.vegetation?.applyLook(look);
    }
  };
  applyLook(opts.look.get());
  cleanups.push(opts.look.subscribe(applyLook));

  // Wall collision against the buildings of every visible tile.
  const collider = createCityCollider(() =>
    stream.visibleCities().map((c) => c.mesh)
  );
  // Where the player stands and looks, walk/fly, the scenic glides — and the
  // one rule that any player input cancels a glide (camera-pose.ts).
  const pose = createCameraPose(camera, {
    groundFloor: () => (Number.isFinite(groundFloor) ? groundFloor : 0),
    heightAt,
    offset,
    resolveStep: collider.resolveStep,
    onModeChange: opts.onModeChange,
    onPose: opts.onPose,
  });
  // Spawn at the site's start vantage (on the spawn tile, so the boot's
  // wait for that tile holds); placed again once its terrain has landed
  // (below) — the height is above the ground, which is not there yet.
  const spawnView = spawnViewpoint(currentSite());
  pose.placeAt(spawnView);

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
      const t = groundAlong(tapRaycaster, 6000);
      if (t !== null) {
        const hit = tapRaycaster.ray.at(t, new Vector3());
        const epsg = worldToEpsg(hit.x, hit.z, offset);
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
        vegetation: census(dressings.map((d) => d.vegetation?.group)),
        lamps: census(dressings.map((d) => d.lamps?.group)),
        monuments: census(dressings.map((d) => d.monuments?.group)),
        rail: census(dressings.map((d) => d.rail)),
        walls: census(terrains.map((t) => t.walls)),
        stairs: census(terrains.map((t) => t.stairs)),
      },
    });
  };
  // Every tile's building footprints for the minimap, independent of what
  // has streamed in (a few hundred KB for the site): the map shows the whole
  // city from the start, and demolished buildings via `stream.demolished`.
  const footprints = new Map<string, [number, number][][][]>();
  function loadFootprints(): void {
    for (const tile of extras.tiles) {
      fetchOptionalJson<[number, number][][][]>(
        new URL(tile.footprints, tilesetUrl).href,
        opts.signal
      )
        .then((polys) => {
          if (polys && !disposed) {
            footprints.set(tile.id, polys);
            emitStats();
          }
        })
        .catch(() => undefined);
    }
  }

  loadFootprints();

  // Everything that follows from the tile set changing: the ground, the
  // lamp heads, the fog floor, the shadows, the stats.
  onChange = () => {
    if (disposed) {
      return;
    }
    terrains = stream.visibleTerrains();
    for (const t of stream.terrains) {
      lowerGroundFloor(t.minElevation);
    }
    lampLights.setHeads(
      stream.visibleDressings().flatMap((d) => d.lamps?.headPositions ?? [])
    );
    invalidateShadows();
    emitStats();
    checkLoaded();
  };

  const demolishAtCrosshair = () => {
    const picked = pickCityObject(camera, stream.visibleCities());
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
    invalidateShadows();
    emitStats();
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
        viewpoint: (index) => {
          const view = currentSite().viewpoints[index];
          if (view) {
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
    postStack.setSize(container.clientWidth, container.clientHeight);
    stream.tiles.setResolution(
      camera,
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
  const groundUnderCamera = (): number => {
    const epsg = worldToEpsg(camera.position.x, camera.position.z, offset);
    return (
      heightAt(epsg.x, epsg.y) ??
      (Number.isFinite(groundFloor) ? groundFloor : 0)
    );
  };

  const timer = new Timer();
  // Swap each vegetation chunk between the rich and cheap crown by distance,
  // and advance the wind sway (same clock as the water ripple). A swap changes
  // what casts shadows, so it invalidates the map.
  const stepVegetation = (elapsed: number) => {
    let lodChanged = false;
    for (const d of stream.dressings) {
      if (d.vegetation?.updateLod(camera.position)) {
        lodChanged = true;
      }
      d.vegetation?.setTime(elapsed);
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
    // What to stream, from where the cameras look now.
    camera.updateMatrixWorld();
    stream.tiles.update();
    // Advance every tile's water ripple/glitter and feed it the current
    // palette sky colour (Fresnel sky-tint stays in lockstep with the sun).
    if (scene.fog instanceof Fog) {
      for (const t of terrains) {
        t.water?.update(elapsed, scene.fog.color);
      }
    }
    // Re-fit the shadow frustum to the camera (lib/city/shadow-fit.ts).
    camera.getWorldDirection(shadowViewDir);
    sunRig.follow(camera.position, shadowViewDir, groundUnderCamera());
    // Drift the sky dome's clouds (one uniform write/frame).
    sunRig.setTime(elapsed);
    // Repoint the shared real lamp lights at the nearest heads.
    lampLights.updateNearest(camera.position);
    stepVegetation(elapsed);
    // The fountains' jets and water shimmer (one shared uniform).
    setFountainTime(elapsed);
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

  let streamingStarted = false;
  /** Set once, the first time everything in view is loaded and dressed. */
  let loaded = false;
  // Progress after the first frame (reportProgress below): declared before
  // the first await, since tile events call checkLoaded from then on.
  let surroundings = 0;
  let details = 0;
  let busy = false;
  // --- the first frame: the spawn tile's buildings and terrain ------------
  // Landed = shown by the renderer, not merely dressed: a dressed tile can
  // still be waiting on its compile, and the spawn teleport below needs
  // ground that is really there.
  const spawnLanded = () => ({
    city: stream.visibleCities().some((c) => c.tile === spawn.id),
    terrain: stream.visibleTerrains().some((t) => t.tile === spawn.id),
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
  onChange();
  // Tiles compile themselves before they show; this covers the rest of the
  // scene (sky, sun rig, lamp light pool), under the overlay instead of in
  // the first visible frame.
  await postStack.compile(scene).catch(() => undefined);
  // On the spawn vantage now that its ground exists (the pose was placed
  // before any terrain had landed, over the fallback floor).
  pose.placeAt(spawnView);
  // The sun rig, the shadow map and the clay materials are up: this is the
  // first renderable frame, and the point the HUD hands over to the pill.
  stage("light", 1);

  // --- everything after the first frame -------------------------------------
  // The rest of the site keeps streaming (the renderer decides what, from
  // the cameras); the dressing waits for the gate. "Loaded" is the first
  // moment after the gate at which nothing is loading and nothing waits to
  // be dressed.
  // The two stages after the first frame measure what the cameras see:
  // the tile renderer's own load progress, and the details (vegetation,
  // lamps, rails) built per fine tile against those still queued.
  // Both only ever move forward, and both end when everything in view is in.
  function reportProgress(spawnDressed: boolean): void {
    if (extras.tiles.length === 1) {
      stage("surroundings", 1, true);
    } else {
      const progress = tilesIdle
        ? 1
        : Math.min(stream.tiles.loadProgress, 0.99);
      surroundings = Math.max(surroundings, progress);
      stage("surroundings", surroundings);
    }
    if (streamingStarted) {
      const built = stream.dressings.size;
      const queued = stream.pendingDressings();
      const progress =
        queued === 0 && spawnDressed
          ? 1
          : Math.min(built / Math.max(built + queued, 1), 0.99);
      details = Math.max(details, progress);
      stage("details", details);
    }
  }

  function checkLoaded(): void {
    // Tried, not necessarily built: a dressing that failed, or whose tile
    // left before its turn, must not hold the scene short of "loaded".
    const spawnDressed = stream.dressingSettled(spawn.id);
    const idleNow = tilesIdle && stream.pendingDressings() === 0;
    if (!loaded) {
      reportProgress(spawnDressed);
      if (streamingStarted && spawnDressed && idleNow) {
        loaded = true;
        worldPartial = false;
        applyFog();
        stage("surroundings", 1);
        stage("details", 1);
        opts.onLoaded?.();
      }
      return;
    }
    // Later loads (a flight, a turn) no longer move the bar; the HUD shows
    // a small "loading" hint instead.
    if (busy !== !idleNow) {
      busy = !idleNow;
      opts.onBusy?.(busy);
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
    if (streamingStarted || disposed) {
      return;
    }
    streamingStarted = true;
    stage("details", 0);
    openGate();
    checkLoaded();
  };

  return {
    setSun,
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
    setClimbInput: pose.setClimbInput,
    setMoveInput: pose.setMoveInput,
    startStreaming,
    getFootprints: (): FootprintPoly[] =>
      [...footprints].flatMap(([tile, polys]) => {
        const gone = stream.demolished.get(tile);
        return footprintPolys(polys, (i) => !gone?.has(i));
      }),
    landcoverTiles: extras.tiles.map((t) => ({
      src: new URL(t.minimap, tilesetUrl).href,
      bounds: t.bounds,
    })),
    latLng,
    terrainBounds: siteBounds,
    offset,
    dispose: () => {
      if (disposed) {
        return;
      }
      disposed = true;
      // Same list, same order as a failed boot unwinds: animation loop ->
      // resize observer -> listeners -> touch -> post stack -> stream ->
      // lights -> sun rig.
      runCleanups(cleanups);
      disposeObject3D(scene);
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
