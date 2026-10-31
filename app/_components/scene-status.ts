/**
 * The scene's status as the HUD shows it: one store of slices
 * (lib/city/slice-store.ts) that the scene's reports write and each widget
 * reads its own slice of — the loading screen and the pill the stages, the
 * Erweitert tab's counters the stats and the frame rate, Modell's panel and
 * instruments its view, the data layers' lines their status. A report
 * re-renders the widgets that show it, not the whole HUD (plan 074, part D).
 *
 * The scene's side is unchanged: `sceneReports` turns the store into the
 * `CityWalkOptions` callbacks create-app.ts already calls. The HUD's store
 * hears a burst once, in the task after it (`afterTask`): a report from
 * inside a frame (the frame rate, Modell's view, the pose) re-renders its
 * widget after the frame, as the transitions it replaces did.
 */
import {
  createContext,
  useCallback,
  useContext,
  useSyncExternalStore,
} from "react";
import type { BikeCounter } from "@/lib/city/bike-counts";
import type { Inquiry, InquiryAlong } from "@/lib/city/inquiry";
import type {
  LoadStageUpdate,
  SkippedStages,
  StageFractions,
} from "@/lib/city/load-stages";
import type { FootprintPoly } from "@/lib/city/minimap";
import type { PlayerPose } from "@/lib/city/pose";
import {
  createSliceStore,
  dataEqual,
  type SliceStore,
} from "@/lib/city/slice-store";
import type { TrafficHourStatus } from "@/lib/city/traffic-hours";
import { layerErrorText } from "./boot-error";
import type { CityWalkOptions, CityWalkStats, SiteInfo } from "./create-app";
import type { ModelHud, ViewMode } from "./model-rig";
import { updatePocDebug } from "./poc-debug";
import type { TramCarsStatus } from "./tram-cars";

/** What the scene has reported per load stage (lib/city/load-stages.ts). */
export interface StageProgress {
  fractions: StageFractions;
  skipped: SkippedStages;
}

/** The counters the Erweitert tab shows of the scene's stats. */
export type HudStats = Pick<
  CityWalkStats,
  "buildingCount" | "gpuMegabytes" | "terrainVertexCount"
>;

/** What was asked last (ADR 0042), while its card is open. */
export interface AskedInquiry {
  inquiry: Inquiry;
  /** everything the question's ray met (the strip beside the tap) */
  along: InquiryAlong | null;
  /** everything picked (Shift+click, *Mehrere*, *Frag die Stadt*'s
   *  places), `inquiry` among them at `active`; `adding`: the card's
   *  *Mehrere* is on */
  picked: { active: number; adding: boolean; picks: Inquiry[] };
}

export interface SceneStatusSlices {
  /** the loading screen, the handover and the pill read this */
  progress: StageProgress;
  /** after the first full load: tiles or their details streaming in */
  busy: boolean;
  /** a tile (or its dressing) that failed after the first frame, in words */
  streamError: string | null;
  /** the render stopped and the page did not recover: the browser's words */
  gpuFailure: string | null;
  stats: HudStats | null;
  /** every loaded tile's building footprints, for the minimap */
  footprints: FootprintPoly[];
  /** smoothed, whole frames per second */
  fps: number | null;
  /** the site as the tileset describes it (`onSiteInfo`) */
  site: SiteInfo | null;
  mode: ViewMode;
  /** Modell's view while it is shown (plan 055) */
  modelView: ModelHud | null;
  inquiry: AskedInquiry | null;
  /** the live bicycle counts while their data layer is on */
  bikeCounters: BikeCounter[];
  /** the timetable trams' day and count while their layer is on */
  tramStatus: TramCarsStatus | null;
  /** the traffic's hour while its layer is on */
  trafficHour: TrafficHourStatus | null;
  /** the player's pose (~10 Hz), for the minimap's dot */
  pose: PlayerPose | null;
}

export type SceneStatus = SliceStore<SceneStatusSlices>;

export const NO_PROGRESS: StageProgress = { fractions: {}, skipped: {} };

const INITIAL: SceneStatusSlices = {
  progress: NO_PROGRESS,
  busy: false,
  streamError: null,
  gpuFailure: null,
  stats: null,
  footprints: [],
  fps: null,
  site: null,
  mode: "walk",
  modelView: null,
  inquiry: null,
  bikeCounters: [],
  tramStatus: null,
  trafficHour: null,
  pose: null,
};

/**
 * The HUD's schedule: the task after the write. A whole burst (a stats
 * pass, the stages of one tile event) is one render of its widgets, and a
 * report from inside a frame is heard after the frame. Those renders are
 * urgent (an external store's update is never a transition) but small:
 * the stages, many a second while a tile streams, re-render the loading
 * screen and the pill. As urgent renders of the whole HUD they once
 * starved the handover by ten seconds, which is why they had been
 * transitions.
 */
export const afterTask = (flush: () => void): void => {
  setTimeout(flush, 0);
};

/**
 * A new store. The reports that are rebuilt on every tick (the counters,
 * Modell's view, the data layers' lines) count as unchanged when their
 * numbers are: a scene standing still re-renders nothing.
 */
export function createSceneStatus(
  schedule?: (flush: () => void) => void
): SceneStatus {
  return createSliceStore(INITIAL, {
    equals: {
      stats: dataEqual,
      modelView: dataEqual,
      tramStatus: dataEqual,
      trafficHour: dataEqual,
    },
    schedule,
  });
}

/** One stage's report merged into what the stages have reported. */
export function withStage(
  prev: StageProgress,
  { id, fraction, skipped }: LoadStageUpdate
): StageProgress {
  return {
    fractions: { ...prev.fractions, [id]: fraction },
    skipped: skipped ? { ...prev.skipped, [id]: true } : prev.skipped,
  };
}

/** The scene's callbacks that only report: each writes its slice. */
export type SceneReports = Required<
  Pick<
    CityWalkOptions,
    | "onBikeCounts"
    | "onBusy"
    | "onError"
    | "onErrorCleared"
    | "onFatal"
    | "onFps"
    | "onInquiry"
    | "onLoaded"
    | "onModeChange"
    | "onModelView"
    | "onPose"
    | "onSiteInfo"
    | "onStage"
    | "onStats"
    | "onTrafficHour"
    | "onTramStatus"
  >
>;

/** Runs `report` only while the boot it belongs to is the page's. */
function whileLive<A extends unknown[]>(
  live: () => boolean,
  report: (...args: A) => void
): (...args: A) => void {
  return (...args) => {
    if (live()) {
      report(...args);
    }
  };
}

/**
 * One boot's reports, written to the store. `live` is false once the boot
 * was dropped (a remount, a place picked while loading): its late reports
 * change nothing. `footprints` reads the booted scene's, once there is one.
 */
export function sceneReports(
  status: SceneStatus,
  {
    footprints,
    live,
  }: { footprints: () => FootprintPoly[] | undefined; live: () => boolean }
): SceneReports {
  // The render stopped for good (onFatal): its message stays, and a tile
  // still in flight failing must not add a layer's hole under its card.
  let fatal = false;
  const on = <A extends unknown[]>(report: (...args: A) => void) =>
    whileLive(live, report);
  return {
    onSiteInfo: on((info) => status.set("site", info)),
    onStage: on((update) =>
      status.update("progress", (p) => withStage(p, update))
    ),
    onLoaded: on(() => updatePocDebug({ ready: true })),
    onBusy: on((busy) => status.set("busy", busy)),
    // One tile (or one tile's dressing) failed after the first frame: it
    // leaves a hole, and the rest keeps streaming — the stages still finish
    // on their own (a failed tile counts as done). A failure before the
    // first frame rejects the boot instead.
    onError: on((message) => {
      if (!fatal) {
        status.set("streamError", layerErrorText(message));
      }
    }),
    // the tile it named came back (a fatal message stays)
    onErrorCleared: on(() => {
      if (!fatal) {
        status.set("streamError", null);
      }
    }),
    onFatal: on((message) => {
      fatal = true;
      status.set("gpuFailure", message);
    }),
    onStats: on((stats) => {
      updatePocDebug({ stats });
      status.set("stats", {
        buildingCount: stats.buildingCount,
        gpuMegabytes: stats.gpuMegabytes,
        terrainVertexCount: stats.terrainVertexCount,
      });
      const polys = footprints();
      if (polys) {
        status.set("footprints", polys);
      }
    }),
    // (shown as whole frames: a report that rounds the same is no change)
    onFps: on((fps) => status.set("fps", Math.round(fps))),
    onTramStatus: on((tram) => status.set("tramStatus", tram)),
    onTrafficHour: on((hour) => status.set("trafficHour", hour)),
    onBikeCounts: on((counters) => status.set("bikeCounters", counters)),
    onModeChange: on((mode) => status.set("mode", mode)),
    onModelView: on((view) => status.set("modelView", view)),
    onInquiry: on((inquiry, along, picked) =>
      status.set(
        "inquiry",
        inquiry
          ? {
              inquiry,
              along,
              picked: picked ?? { active: 0, adding: false, picks: [inquiry] },
            }
          : null
      )
    ),
    onPose: on((pose) => status.set("pose", pose)),
  };
}

export const SceneStatusContext = createContext<SceneStatus | null>(null);

/** The HUD's scene-status store (CityWalk provides it). */
export function useSceneStatusStore(): SceneStatus {
  const store = useContext(SceneStatusContext);
  if (!store) {
    throw new Error("scene status read outside CityWalk");
  }
  return store;
}

/** One slice of the given store; the caller re-renders when it changes. */
export function useSlice<K extends keyof SceneStatusSlices>(
  store: SceneStatus,
  key: K
): SceneStatusSlices[K] {
  const subscribe = useCallback(
    (onChange: () => void) => store.subscribe(key, onChange),
    [store, key]
  );
  const get = useCallback(() => store.get(key), [store, key]);
  return useSyncExternalStore(subscribe, get, get);
}

/** One slice of the HUD's scene status (`useSlice` on CityWalk's store). */
export function useSceneStatus<K extends keyof SceneStatusSlices>(
  key: K
): SceneStatusSlices[K] {
  return useSlice(useSceneStatusStore(), key);
}
