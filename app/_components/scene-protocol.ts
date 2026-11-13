/**
 * What the page and the scene say to each other (ADR 0061). The scene runs
 * in a worker where the browser draws there as it would on the page, and
 * on the page otherwise — over the same messages either way, so nothing
 * the HUD does depends on where it runs (scene-client.ts is the page's
 * end, scene-server.ts the scene's). Every message is plain data the
 * structured clone carries; the ones that hand bytes over say so.
 */
import type { GpuLoss } from "@/lib/city/gpu-safety";
import type { LookValues } from "@/lib/city/look-controls";
import type { NameplateText } from "@/lib/city/nameplate";
import type { CameraState, PlayerPose } from "@/lib/city/pose";
import type { RenderStyle } from "@/lib/city/render-style";
import type { Site, ViewpointGeometry } from "@/lib/city/site";
import type { GlideOptions } from "./camera-flight";
import type { CanvasSize, CityWalkOptions, SceneApp } from "./create-app";
import type { ModelHud, ViewMode } from "./model-rig";
import type { PlateRaster, PlateResolution } from "./nameplate-glyphs";
import type { PageEventType, PageState } from "./page-view";
import type { PocCounts, PocProbe } from "./poc-scene";
import type { SceneBudget } from "./scene-profile";

/** What the scene's options report to the page, by name. */
export type ReportName = {
  [K in keyof CityWalkOptions]-?: K extends `on${string}` ? K : never;
}[keyof CityWalkOptions];

/** The reports' callbacks. */
export type SceneReports = Pick<CityWalkOptions, ReportName>;

/** What the page starts the scene with (the rest of CityWalkOptions is
 *  callbacks, which become messages). */
export interface SceneInit {
  budget: SceneBudget;
  size: CanvasSize;
  site: Site;
  tilesetUrl: string;
  initialCamera?: CameraState;
  initialView?: ViewpointGeometry;
  initialDate: Date;
  look: LookValues;
  /** the stops the page recovers from by a reload (gpu-recovery.ts) */
  reloadable: GpuLoss[];
  page: PageState;
  /** the page keeps a crash trail: the scene notes into it */
  trail: boolean;
  /** the specs' probes set before the boot (poc-debug.ts) */
  probe: PocProbe;
  covered: boolean;
  listening: boolean;
}

/**
 * What the HUD reads at once, as of the scene's last turn: the camera and
 * what it does, Modell's view, what the stream and the shadow map are
 * busy with. The scene sends it when any of it changed.
 */
export interface SceneMirror {
  camera: CameraState;
  pose: PlayerPose;
  viewMode: ViewMode;
  modelHud: ModelHud | null;
  focusNdc: { x: number; y: number } | undefined;
  viewMoving: boolean;
  streamBusy: boolean;
  shadowBusy: boolean;
  nameplate: ReturnType<SceneApp["nameplateShown"]>;
  glideTarget: ReturnType<SceneApp["getGlideTarget"]>;
  /** the debug hook's counters (poc-scene.ts); null in production */
  poc: PocCounts | null;
}

/** What the page knows of the scene once it is up, and that never changes. */
export type SceneStatic = Pick<
  SceneApp,
  | "landmarks"
  | "latLng"
  | "mapPicture"
  | "offset"
  | "provenanceUrl"
  | "terrainBounds"
  | "walksUrl"
>;

/** A glide as it crosses: its progress comes back by its number. */
export type GlideMessage = Omit<GlideOptions, "onProgress"> & {
  progress?: number;
};

/** An error as it crosses (an Error's class does not). */
export interface ErrorMessage {
  message: string;
  name: string;
}

/** The page to the scene. */
export type ToScene =
  /** a call on the scene (SceneApp's member, `design:…`, `touch:…`,
   *  `keys:…`); `id` asks for a reply */
  | { t: "call"; id?: number; m: string; a: unknown[] }
  | { t: "page"; state: PageState; event?: PageEventMessage }
  | { t: "look"; values: LookValues }
  | { t: "probe"; probe: PocProbe }
  /** the page's letters for a scene's request */
  | { t: "letters"; id: number; raster: PlateRaster | null };

/** A page event as it crosses. */
export interface PageEventMessage {
  persisted?: boolean;
  type: PageEventType;
}

/** The scene to the page. */
export type ToPage =
  /** the first frame drew: the scene is up */
  | { t: "ready"; info: SceneStatic; mirror: SceneMirror }
  /** the boot failed or was aborted */
  | { t: "failed"; error: ErrorMessage }
  | { t: "reply"; id: number; ok: true; value: unknown }
  | { t: "reply"; id: number; ok: false; error: ErrorMessage }
  | { t: "report"; name: ReportName; a: unknown[] }
  | { t: "mirror"; mirror: SceneMirror }
  | { t: "footprints"; footprints: ReturnType<SceneApp["getFootprints"]> }
  | { t: "glide"; id: number; progress: number }
  | { t: "trail"; op: "beat" | "note" | "set"; a: unknown[] }
  /** a promise the worker let fall (a thrown error reaches the Worker's
   *  own error event) */
  | { t: "rejected"; error: ErrorMessage }
  /** the nameplate asks for letters (nameplate-glyphs.ts `plateLetters`) */
  | {
      t: "letters";
      id: number;
      text: NameplateText;
      style: RenderStyle;
      res: PlateResolution;
    };

/** The worker's first word, before the page hands it the canvas. */
export interface WorkerHello {
  t: "hello";
  /** what the worker can draw with (scene-client.ts compares it with the
   *  page's own) */
  gpu: boolean;
  /** an offscreen WebGL2 context, for a page without WebGPU */
  webgl2: boolean;
  /** GLTFLoader decodes with createImageBitmap here; where it would not
   *  (no createImageBitmap, Safari before 17) it reaches for an <img>,
   *  which a worker has none of */
  bitmaps: boolean;
  offscreen: boolean;
  raf: boolean;
}

/** One end of the channel: a worker, its global, or a MessagePort. */
export interface ScenePort {
  postMessage: (message: unknown, transfer: Transferable[]) => void;
  addEventListener: (
    type: "message",
    listener: (event: MessageEvent) => void
  ) => void;
  removeEventListener: (
    type: "message",
    listener: (event: MessageEvent) => void
  ) => void;
}

/** An error as it crosses. */
export function errorMessage(error: unknown): ErrorMessage {
  return error instanceof Error
    ? { name: error.name, message: error.message }
    : { name: "Error", message: String(error) };
}

/** The error again on the other side: an abort stays one. */
export function errorFrom({ name, message }: ErrorMessage): Error {
  if (name === "AbortError") {
    return new DOMException(message, "AbortError");
  }
  const error = new Error(message);
  error.name = name;
  return error;
}
