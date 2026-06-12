import {
  ACESFilmicToneMapping,
  Box3,
  Color,
  Euler,
  Fog,
  Group,
  type Object3D,
  PCFSoftShadowMap,
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
import {
  epsgCodeFromReferenceSystem,
  FALLBACK_LAT_LNG,
  utmToLatLng,
} from "@/lib/city/crs";
import { epsgToWorld, worldToEpsg } from "@/lib/city/ground-clamp";
import { buildingFootprints, type FootprintRect } from "@/lib/city/minimap";
import { recenterOffset } from "@/lib/city/recenter";
import type { TerrainBounds } from "@/lib/city/terrain-geometry";
import { clampPitch, nextFov } from "@/lib/city/touch";
import type { CityJsonDocument } from "@/lib/city/types";
import {
  type CityLayer,
  countBuildings,
  createCityLayer,
  demolishObject,
  pickCityObjectId,
} from "./city-layer";
import { createCityCollider } from "./collision";
import { createFpsMovement, type MovementMode } from "./fps-movement";
import { createInsertedBuilding } from "./inserted-building";
import { createPostStack } from "./post-stack";
import { createSunRig, type SunState } from "./sun-rig";
import { loadTerrain, type TerrainLayer } from "./terrain-layer";
import { disposeObject3D } from "./three-utils";
import { attachTouchControls } from "./touch-controls";
import { loadVegetation } from "./vegetation-layer";
import {
  applyCityStyle,
  type CityStyleId,
  createStyleResources,
  setCityTransparency,
  setEdgeOpacity,
  setEdgeResolution,
} from "./visual-style";

const EYE_HEIGHT = 1.7;
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
export const DEFAULT_CITY_STYLE: CityStyleId = "ghost";
/** Default fog amount (0..1); ~the look the POC always had. */
export const DEFAULT_ATMOSPHERE = 0.35;

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

export interface CityWalkOptions {
  citySrc: string;
  container: HTMLElement;
  demSrc: string;
  demTfwSrc?: string;
  initialDate: Date;
  insertAt?: { x: number; y: number };
  insertedModelUrl?: string;
  /** optional ATKIS land-cover splatmap (PNG) for per-surface terrain tinting */
  landcoverSrc?: string;
  /** throttled (~2 Hz) smoothed FPS, decoupled from the heavier stats emit */
  onFps?: (fps: number) => void;
  onModeChange?: (mode: MovementMode) => void;
  /** throttled (~10 Hz) player pose updates for the minimap */
  onPose?: (pose: PlayerPose) => void;
  onProgress?: (message: string) => void;
  onStats?: (stats: CityWalkStats) => void;
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
  demolishAtCrosshair: () => void;
  dispose: () => void;
  /** Opt-in pointer-lock mouse-look (desktop); Esc exits natively. */
  enterImmersive: () => void;
  /**
   * Teleports the camera (world/Y-up coords) — used by tests and QA.
   * Switches to fly mode so the ground clamp doesn't drag the camera down.
   */
  flyTo: (position: Xyz, lookAt: Xyz) => void;
  /** current Building footprints (EPSG) — shrinks when demolishing */
  getFootprints: () => FootprintRect[];
  getMovementMode: () => MovementMode;
  getPose: () => PlayerPose;
  insertBuilding: () => Promise<void>;
  /** recenter offset, lets callers map EPSG coords -> world coords */
  offset: { cx: number; cy: number };
  /** fog amount 0..1 (0 = clear day, 1 = thick painterly haze) */
  setAtmosphere: (amount: number) => void;
  /** transparency 0..1 of the ACTIVE style (ghost: frosted, clay: alpha) */
  setBuildingTransparency: (transparency: number) => void;
  /** soft contact-shadow (SSAO) strength 0..1; 0 disables the pass */
  setContactShadows: (strength: number) => void;
  /** warm-near/cool-far color grading intensity 0..1 */
  setDepthGrading: (intensity: number) => void;
  /** photographic depth of field with crosshair autofocus */
  setDepthOfField: (enabled: boolean) => void;
  /** ink edge opacity 0..1; 0 hides the edge overlay */
  setEdges: (opacity: number) => void;
  /** analog joystick input: x = strafe right, y = forward, both [-1, 1] */
  setMoveInput: (x: number, y: number) => void;
  setMovementMode: (mode: MovementMode) => void;
  /** paper-grain overlay intensity 0..1 */
  setPaperGrain: (intensity: number) => void;
  setStyle: (style: CityStyleId) => void;
  setSun: (date: Date) => SunState;
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
  const renderer = new WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;
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
  ensureAlive();

  opts.onProgress?.("Parsing buildings…");
  let cityLayer: CityLayer = createCityLayer(cityData, world);
  const offset = recenterOffset(cityLayer.matrix);

  opts.onProgress?.("Loading DGM terrain…");
  const terrain = await loadTerrain({
    url: opts.demSrc,
    tfwUrl: opts.demTfwSrc,
    landcoverUrl: opts.landcoverSrc,
    offset,
    signal: opts.signal,
  });
  ensureAlive();
  assertCityOnTerrain(offset, terrain);
  world.add(terrain.mesh);
  if (terrain.water) {
    world.add(terrain.water.mesh);
  }

  if (opts.vegetationSrc) {
    opts.onProgress?.("Planting hedges & tree rows…");
    const vegetation = await loadVegetation(opts.vegetationSrc, {
      offset,
      heightAt: terrain.heightAt,
      signal: opts.signal,
    });
    // Y-up scene frame (like the inserted building), NOT the Z-up `world`
    // group: the placements already use world coords (x, elevation, -north).
    scene.add(vegetation);
  }

  world.updateMatrixWorld(true);
  const worldBounds = new Box3().setFromObject(world);
  const sunRig = createSunRig(scene, worldBounds, tileLatLng(cityData, offset));
  sunRig.update(opts.initialDate);

  opts.onProgress?.("Preparing render styles…");
  const styleResources = createStyleResources();
  const drawingBuffer = renderer.getDrawingBufferSize(new Vector2());
  setEdgeResolution(styleResources, drawingBuffer.x, drawingBuffer.y);
  let currentStyle: CityStyleId = DEFAULT_CITY_STYLE;
  applyCityStyle(cityLayer.group, currentStyle, styleResources);
  const postStack = createPostStack(renderer, scene, camera);

  // Spawn at the recenter point (= world origin), standing on the terrain.
  const groundY = terrain.heightAt(offset.cx, offset.cy) ?? worldBounds.min.y;
  camera.position.set(0, groundY + EYE_HEIGHT, 0);
  camera.lookAt(0, groundY + EYE_HEIGHT, -100);

  const controls = new PointerLockControls(camera, renderer.domElement);
  const groundHeight = (x: number, z: number) => {
    const epsg = worldToEpsg(x, z, offset);
    return terrain.heightAt(epsg.x, epsg.y);
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

  const teleportTo = (epsgX: number, epsgY: number) => {
    const pos = epsgToWorld(epsgX, epsgY, offset);
    const ground = terrain.heightAt(epsgX, epsgY);
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
      if (!terrain.mesh.geometry.boundsTree) {
        // Lazy: ~500k triangles, only pay the BVH build when actually used.
        terrain.mesh.geometry.computeBoundsTree();
      }
      tapRaycaster.setFromCamera(new Vector2(ndcX, ndcY), camera);
      const hit = tapRaycaster.intersectObject(terrain.mesh, false)[0];
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
    const ground = terrain.heightAt(at.x, at.y) ?? worldBounds.min.y;
    // Data frame (x, y, z-up) -> scene frame (x, z, -y), recentered.
    obj.position.set(at.x - offset.cx, ground, -(at.y - offset.cy));
    scene.add(obj);
    inserted = obj;
  };

  const insertBuildingNow = () => {
    insertBuilding().catch(() => {
      // glTF load failure is non-fatal for the POC; the box fallback can't fail
    });
  };

  const onKeyDown = (e: KeyboardEvent) => {
    movement.press(e.code);
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
    const buf = renderer.getDrawingBufferSize(new Vector2());
    setEdgeResolution(styleResources, buf.x, buf.y);
  });
  resizeObserver.observe(container);

  // Crosshair autofocus for the photographic DoF (throttled like the pose).
  const focusRaycaster = new Raycaster();
  focusRaycaster.firstHitOnly = true;
  focusRaycaster.far = 4000;
  const updateFocus = () => {
    focusRaycaster.setFromCamera(new Vector2(0, 0), camera);
    const hit = focusRaycaster.intersectObjects(
      [cityLayer.group, terrain.mesh],
      true
    )[0];
    postStack.setFocusTarget(hit?.point ?? null);
  };

  const timer = new Timer();
  let tickDue = 0;
  let fpsDue = 0;
  renderer.setAnimationLoop((time) => {
    timer.update(time);
    const dt = Math.min(timer.getDelta(), 0.05);
    if (dt > 0) {
      fps = fps === 0 ? 1 / dt : fps * 0.9 + (1 / dt) * 0.1;
    }
    movement.update(dt);
    terrain.water?.setTime(timer.getElapsed());
    // Keep the (small, sharp) shadow frustum centered on the player.
    sunRig.follow(camera.position);
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
  });

  emitStats();

  return {
    setSun: (date) => sunRig.update(date),
    setStyle: (style) => {
      currentStyle = style;
      applyCityStyle(cityLayer.group, style, styleResources);
    },
    setDepthOfField: (enabled) => postStack.setDepthOfField(enabled),
    setDepthGrading: (intensity) => postStack.setDepthGrading(intensity),
    setContactShadows: (strength) => postStack.setContactShadows(strength),
    setPaperGrain: (intensity) => postStack.setPaperGrain(intensity),
    setBuildingTransparency: (transparency) =>
      setCityTransparency(styleResources, currentStyle, transparency),
    setEdges: (opacity) => {
      setEdgeOpacity(styleResources, opacity);
      // Visibility of the (lazily built) edge overlays follows the flag.
      applyCityStyle(cityLayer.group, currentStyle, styleResources);
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
    teleportTo,
    getPose,
    getMovementMode: () => movement.getMode(),
    setMovementMode,
    setMoveInput: movement.setAnalog,
    getFootprints: () => buildingFootprints(cityLayer.data),
    terrainBounds: terrain.bounds,
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
      styleResources.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
