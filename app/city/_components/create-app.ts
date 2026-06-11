import {
  ACESFilmicToneMapping,
  Box3,
  Color,
  Fog,
  Group,
  type Object3D,
  PCFShadowMap,
  PerspectiveCamera,
  Scene,
  Timer,
  Vector3,
  WebGLRenderer,
} from "three";
import { PointerLockControls } from "three/examples/jsm/controls/PointerLockControls.js";
import {
  epsgCodeFromReferenceSystem,
  FALLBACK_LAT_LNG,
  utmToLatLng,
} from "@/lib/city/crs";
import { epsgToWorld, worldToEpsg } from "@/lib/city/ground-clamp";
import { recenterOffset } from "@/lib/city/recenter";
import type { CityJsonDocument } from "@/lib/city/types";
import {
  type CityLayer,
  countBuildings,
  createCityLayer,
  demolishObject,
  pickCityObjectId,
} from "./city-layer";
import { createFpsMovement, type MovementMode } from "./fps-movement";
import { createInsertedBuilding } from "./inserted-building";
import { createSunRig, type SunState } from "./sun-rig";
import { loadTerrain, type TerrainLayer } from "./terrain-layer";
import { disposeObject3D } from "./three-utils";

const EYE_HEIGHT = 1.7;
/** EPSG:25833 spot for the inserted building (mid-tile of 33412_5656). */
const DEFAULT_INSERT_AT = { x: 413_000, y: 5_657_000 };
const SKY_COLOR = 0x9f_b6_cc;

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
}

export interface CityWalkHandle {
  demolishAtCrosshair: () => void;
  dispose: () => void;
  /**
   * Teleports the camera (world/Y-up coords) — used by tests and QA.
   * Switches to fly mode so the ground clamp doesn't drag the camera down.
   */
  flyTo: (position: Xyz, lookAt: Xyz) => void;
  getMovementMode: () => MovementMode;
  getPose: () => PlayerPose;
  insertBuilding: () => Promise<void>;
  /** recenter offset, lets callers map EPSG coords -> world coords */
  offset: { cx: number; cy: number };
  setMovementMode: (mode: MovementMode) => void;
  setSun: (date: Date) => SunState;
  /** Drops the player at EPSG coordinates, standing on the terrain. */
  teleportTo: (epsgX: number, epsgY: number) => void;
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
  renderer.shadowMap.type = PCFShadowMap;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.domElement.style.display = "block";
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
  scene.fog = new Fog(SKY_COLOR, 600, 2600);

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
    70,
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
    offset,
    signal: opts.signal,
  });
  ensureAlive();
  assertCityOnTerrain(offset, terrain);
  world.add(terrain.mesh);

  world.updateMatrixWorld(true);
  const worldBounds = new Box3().setFromObject(world);
  const sunRig = createSunRig(scene, worldBounds, tileLatLng(cityData, offset));
  sunRig.update(opts.initialDate);

  // Spawn at the recenter point (= world origin), standing on the terrain.
  const groundY = terrain.heightAt(offset.cx, offset.cy) ?? worldBounds.min.y;
  camera.position.set(0, groundY + EYE_HEIGHT, 0);
  camera.lookAt(0, groundY + EYE_HEIGHT, -100);

  const controls = new PointerLockControls(camera, renderer.domElement);
  const groundHeight = (x: number, z: number) => {
    const epsg = worldToEpsg(x, z, offset);
    return terrain.heightAt(epsg.x, epsg.y);
  };
  const movement = createFpsMovement(camera, {
    groundHeight,
    eyeHeight: EYE_HEIGHT,
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
  const onClick = () => controls.lock();
  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("keyup", onKeyUp);
  renderer.domElement.addEventListener("click", onClick);

  const resizeObserver = new ResizeObserver(() => {
    camera.aspect = container.clientWidth / Math.max(container.clientHeight, 1);
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
  });
  resizeObserver.observe(container);

  const timer = new Timer();
  let poseDue = 0;
  renderer.setAnimationLoop((time) => {
    timer.update(time);
    movement.update(Math.min(timer.getDelta(), 0.05));
    if (opts.onPose && timer.getElapsed() >= poseDue) {
      poseDue = timer.getElapsed() + 0.1;
      opts.onPose(getPose());
    }
    renderer.render(scene, camera);
  });

  emitStats();

  return {
    setSun: (date) => sunRig.update(date),
    insertBuilding,
    demolishAtCrosshair,
    flyTo: (position, lookAt) => {
      setMovementMode("fly");
      camera.position.set(position.x, position.y, position.z);
      camera.lookAt(lookAt.x, lookAt.y, lookAt.z);
      // Refresh matrixWorld now: callers may raycast (demolish) before the
      // next rendered frame would otherwise update it.
      camera.updateMatrixWorld(true);
    },
    teleportTo: (epsgX, epsgY) => {
      const pos = epsgToWorld(epsgX, epsgY, offset);
      const ground = terrain.heightAt(epsgX, epsgY);
      camera.position.set(
        pos.x,
        (ground ?? worldBounds.min.y) + EYE_HEIGHT,
        pos.z
      );
      camera.updateMatrixWorld(true);
      opts.onPose?.(getPose());
    },
    getPose,
    getMovementMode: () => movement.getMode(),
    setMovementMode,
    offset,
    dispose: () => {
      disposed = true;
      renderer.setAnimationLoop(null);
      resizeObserver.disconnect();
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
      renderer.domElement.removeEventListener("click", onClick);
      controls.dispose();
      disposeObject3D(scene);
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
