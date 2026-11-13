/**
 * The page's end of the scene (ADR 0061): starts it — in its own worker;
 * on the page only for debugging (`?thread=main`, `?inspect=1`), and a
 * browser whose worker cannot draw is told so — and hands the HUD
 * `CityWalkHandle`, the one surface it
 * drives the scene through. Reads the HUD makes at once (where the camera
 * stands, what the stream is busy with) answer from the scene's mirror,
 * as of its last turn; calls that return a value return a promise; the
 * rest are told and ordered with everything else on the channel.
 */
import { NETWORK_PREFIX } from "@/lib/city/fetch-retry";
import type { GpuLoss } from "@/lib/city/gpu-safety";
import type { LookState } from "@/lib/city/look-state";
import type { MapFootprints } from "@/lib/city/minimap";
import { NO_FOOTPRINTS } from "@/lib/city/minimap";
import type { CameraState, PlayerPose } from "@/lib/city/pose";
import type { Site, ViewpointGeometry } from "@/lib/city/site";
import { sunStateAt } from "@/lib/city/sun";
import type { SunState } from "@/lib/city/sun";
import { bootAhead } from "./boot-ahead";
import type { GlideOptions } from "./camera-flight";
import type { CrashTrail } from "./crash-trail";
import type {
  CanvasSize,
  DesignControls,
  SceneApp,
  SceneKeys,
} from "./create-app";
import { NO_GPU_MESSAGE } from "./gpu-support";
import type { ModelHud, ViewMode } from "./model-rig";
import { plateLetters } from "./nameplate-glyphs";
import { pageState } from "./page-view";
import { connectPocScene } from "./poc-debug";
import type { PocProbe } from "./poc-scene";
import { errorFrom } from "./scene-protocol";
import type {
  GlideMessage,
  SceneInit,
  SceneMirror,
  ScenePort,
  SceneReports,
  SceneStatic,
  ToPage,
  ToScene,
  WorkerFirstWord,
  WorkerHello,
} from "./scene-protocol";
import { inspectRequested } from "./scene-profile";
import type { SceneBudget } from "./scene-profile";
import {
  attachSceneInput,
  canvasSizeOf,
  coverBoxes,
  sceneCanvas,
  watchCanvasSize,
  watchPage,
} from "./scene-host";
import type { TouchControlsCallbacks } from "./touch-controls";

/** A scene call the HUD does not wait on: a failure is reported as an
 *  uncaught one would be (crash trail, Sentry). */
export function settle(call: Promise<unknown> | undefined): void {
  const settled = async () => {
    try {
      await call;
    } catch (error) {
      reportError(error);
    }
  };
  void settled();
}

/** Where the scene runs. */
export type SceneThread = "main" | "worker";

/** The calls the HUD tells the scene and does not wait on. */
const TOLD = [
  "applyCameraState",
  "clearInquiry",
  "demolishAtCrosshair",
  "flyTo",
  "glideToSpot",
  "placeAt",
  "previewCandidate",
  "setClimbInput",
  "setCutOut",
  "setFollowAim",
  "setFollowPosition",
  "setModelPreset",
  "setModelScale",
  "setModelShear",
  "setModelTilt",
  "setMoveInput",
  "setMovementMode",
  "setViewMode",
  "startStreaming",
  "stopGlide",
  "teleportTo",
  "toggleModel",
  "turnModel",
  "turnModelTo",
  "veilDropped",
] as const satisfies readonly (keyof SceneApp)[];
type Told = (typeof TOLD)[number];

/** The calls that answer: the HUD waits on a promise. */
const ASKED = [
  "captureImage",
  "captureViewpoint",
  "disposeForReload",
  "getFocusDebug",
  "getGpuDebug",
  "getRenderInfo",
  "inquireAt",
  "releaseGpu",
  "selectCandidate",
] as const satisfies readonly (keyof SceneApp)[];
type Asked = (typeof ASKED)[number];

type Async<F> = F extends (...a: infer A) => infer R
  ? (...a: A) => Promise<Awaited<R>>
  : never;
type Tell<F> = F extends (...a: infer A) => unknown ? (...a: A) => void : never;

/** The surface the HUD (and, in dev/test builds, `window.__poc`) drives. */
export type CityWalkHandle = SceneStatic & {
  [K in Told]: Tell<SceneApp[K]>;
} & {
  [K in Asked]: Async<SceneApp[K]>;
} & {
  /** where the scene runs */
  thread: SceneThread;
  /** The design layer's calls (design-layer.ts, ADR 0054). */
  design: { [K in keyof DesignControls]: Async<DesignControls[K]> };
  /** Where the camera stands, as of the scene's last turn. */
  getCameraState: () => CameraState;
  getPose: () => PlayerPose;
  getViewMode: () => ViewMode;
  getModelHud: () => ModelHud | null;
  /** Where the view's subject stands (NDC) in Modell, or the centre. */
  focusNdc: () => { x: number; y: number } | undefined;
  /** A glide (the pose's or Modell's) or a dolly zoom is under way. */
  viewMoving: () => boolean;
  /** Tiles or their dressing are still streaming in for the view. */
  streamBusy: () => boolean;
  /** A ring of the sun's shadow map still waits for its redraw. */
  shadowBusy: () => boolean;
  nameplateShown: SceneApp["nameplateShown"];
  getGlideTarget: SceneApp["getGlideTarget"];
  /** current Building footprint polygons (EPSG), as last sent */
  getFootprints: () => MapFootprints;
  /**
   * Moves the sun to an instant (`preview`: a step of a drag through the
   * day, see SceneApp). Where the sun stands then, for the HUD: worked
   * out here, by the same direction the scene's sun rig takes.
   */
  setSun: (date: Date, preview?: boolean) => SunState;
  /** Glides to a vantage (SceneApp's); its progress comes back through
   *  `glide.onProgress`. */
  flyToViewpoint: (view: ViewpointGeometry, glide?: GlideOptions) => void;
  /** Opt-in pointer-lock mouse-look (desktop); Esc exits natively. */
  enterImmersive: () => void;
  /** Settles once the scene has taken every call made before it and
   *  sent its mirror after them: a read after a write. */
  sync: () => Promise<void>;
  /** Ends the scene; settles once its teardown is through (a worker's
   *  device gone with it, `WORKER_TEARDOWN_MS` at most). Never rejects. */
  dispose: () => Promise<void>;
};

/**
 * The HUD's wishes for the loop's pace (lib/city/frame-pace.ts): whether
 * its sheet covers the scene, whether the visitor only listens. Kept for
 * the page, applied to each scene that boots.
 */
export interface ScenePace {
  covered: boolean;
  listening: boolean;
  setCovered: (covered: boolean) => void;
  setListening: (listening: boolean) => void;
  /** a scene follows the wishes from now on; returns the stop */
  follow: (scene: Pick<SceneApp, "setCovered" | "setListening">) => () => void;
}

export function createScenePace(): ScenePace {
  let scene: Pick<SceneApp, "setCovered" | "setListening"> | null = null;
  const pace: ScenePace = {
    covered: false,
    listening: false,
    setCovered: (covered) => {
      pace.covered = covered;
      scene?.setCovered(covered);
    },
    setListening: (listening) => {
      pace.listening = listening;
      scene?.setListening(listening);
    },
    follow: (next) => {
      scene = next;
      return () => {
        if (scene === next) {
          scene = null;
        }
      };
    },
  };
  return pace;
}

export interface StartSceneOptions extends SceneReports {
  container: HTMLElement;
  budget: SceneBudget;
  site: Site;
  /** the 3D Tiles tileset to stream, a served URL */
  tilesetUrl: string;
  initialCamera?: CameraState;
  initialView?: ViewpointGeometry;
  initialDate: Date;
  /** the HUD's look store: the scene follows it */
  look: LookState;
  pace: ScenePace;
  trail?: CrashTrail;
  /** the stops the page recovers from by a reload now (gpu-recovery.ts
   *  `recoverable`): asked at the boot, and again as the records age */
  reloadable: () => GpuLoss[];
  /** aborts the boot (a StrictMode remount, a place picked meanwhile) */
  signal: AbortSignal;
}

/**
 * Where the scene runs: in a worker (ADR 0061), or on the page when asked
 * for debugging — `?thread=main` (the QA's A/B) or three's Inspector
 * (`?inspect=1`, which hangs its panel on the page).
 */
export function sceneThreadOf(search: string): SceneThread {
  const asked = new URLSearchParams(search).get("thread");
  return asked === "main" || inspectRequested(search) ? "main" : "worker";
}

/** How long a new scene worker's script has to arrive and run (ms): its
 *  chunk on a slow line. */
const LOAD_MS = 60_000;
/** How long a running scene worker has to say what it can draw with (ms):
 *  the WebGPU adapter it asks for. */
const HELLO_MS = 10_000;

/** One end of the channel and how to close it. */
interface Channel {
  port: ScenePort;
  end: () => void;
  thread: SceneThread;
}

/** What the worker said first; or why it did not: its script never ran
 *  (not loaded — the network's), it threw, or it kept silent. */
type HelloOutcome =
  | { said: WorkerHello }
  | { failed: "unloaded" | "threw" | "silent" };

/** A failed chunk fetch in the worker's bootstrap: the bundler emits a
 *  classic script that pulls the scene's chunks with `importScripts`, and
 *  one that does not arrive throws a NetworkError before `alive`. */
const UNLOADED_RE = /importScripts|NetworkError|failed to load/iu;

/** Why a worker's error event ended its hello: before `alive`, a bare
 *  event (the script itself did not load) or a chunk fetch that failed is
 *  the network's; anything else, or anything after `alive`, threw. */
export function errorOutcome(
  running: boolean,
  message: string | undefined
): "unloaded" | "threw" {
  if (running) {
    return "threw";
  }
  return !message || UNLOADED_RE.test(message) ? "unloaded" : "threw";
}

/** The boot's own abort, as the rest of the boot rejects with. */
function bootAborted(): DOMException {
  return new DOMException("CityWalk startup aborted", "AbortError");
}

/** What the worker said first, or why it said nothing. The wait is
 *  `LOAD_MS` until its script runs (its first word, `alive`), then
 *  `HELLO_MS`; an abort of the boot (`signal`) rejects at once. */
async function helloOf(
  worker: Worker,
  signal: AbortSignal
): Promise<HelloOutcome> {
  return await new Promise<HelloOutcome>((resolve, reject) => {
    let running = false;
    const stop = () => {
      clearTimeout(timer);
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onError);
      signal.removeEventListener("abort", onAbort);
    };
    const done = (outcome: HelloOutcome) => {
      stop();
      resolve(outcome);
    };
    const onAbort = () => {
      stop();
      reject(bootAborted());
    };
    const onMessage = (event: MessageEvent<WorkerFirstWord>) => {
      if (event.data?.t === "alive") {
        running = true;
        clearTimeout(timer);
        timer = setTimeout(() => done({ failed: "silent" }), HELLO_MS);
      } else if (event.data?.t === "hello") {
        done({ said: event.data });
      }
    };
    const onError = (event: Event) =>
      done({
        failed: errorOutcome(
          running,
          event instanceof ErrorEvent ? event.message : undefined
        ),
      });
    let timer = setTimeout(
      () => done({ failed: running ? "silent" : "unloaded" }),
      LOAD_MS
    );
    if (signal.aborted) {
      onAbort();
      return;
    }
    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onError);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** The boot's message for a worker that never said hello: a script that
 *  did not arrive is the network's (BootError says so in plain words). */
function noHelloMessage(failed: "unloaded" | "threw" | "silent"): string {
  return failed === "unloaded"
    ? `${NETWORK_PREFIX}the scene's worker did not load`
    : "Die Ansicht startet nicht.";
}

/**
 * The scene's worker, once it said it draws: a WebGPU adapter, an
 * offscreen canvas, an animation frame. Rejects where it cannot.
 */
async function workerChannel(signal: AbortSignal): Promise<Channel> {
  const worker = new Worker(new URL("./scene-worker.ts", import.meta.url), {
    type: "module",
    name: "scene",
  });
  let outcome: HelloOutcome;
  try {
    outcome = await helloOf(worker, signal);
  } catch (error) {
    worker.terminate();
    throw error;
  }
  if ("failed" in outcome) {
    worker.terminate();
    throw new Error(noHelloMessage(outcome.failed));
  }
  const hello = outcome.said;
  if (!hello.raf || !hello.offscreen || !hello.gpu) {
    worker.terminate();
    throw new Error(NO_GPU_MESSAGE);
  }
  forwardErrors(worker);
  return { port: worker, thread: "worker", end: () => worker.terminate() };
}

/** The scene on the page: the same server behind a MessageChannel. */
async function mainChannel(
  init: SceneInit,
  canvas: HTMLCanvasElement,
  signal: AbortSignal
): Promise<Channel> {
  // the page's own head start, beside the scene's chunk
  const ahead = bootAhead(
    new URL(init.tilesetUrl, location.href).href,
    { initialCamera: init.initialCamera, initialView: init.initialView },
    signal
  );
  const { serveScene } = await import("./scene-server").catch(
    (error: unknown) => {
      ahead.release();
      throw error;
    }
  );
  const { port1, port2 } = new MessageChannel();
  serveScene(port2, init, canvas, ahead);
  port2.start();
  port1.start();
  return {
    port: port1,
    thread: "main",
    end: () => {
      port1.close();
      port2.close();
    },
  };
}

/** A worker's errors reach the page's (the crash trail hears them). */
function forwardErrors(worker: Worker): void {
  worker.addEventListener("error", (event) => {
    event.preventDefault();
    dispatchEvent(
      new ErrorEvent("error", {
        message: `scene worker: ${event.message}`,
        filename: event.filename,
        lineno: event.lineno,
      })
    );
  });
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

/** The channel's page end: calls, replies, reports, the mirror. */
function clientOf(
  channel: Channel,
  opts: StartSceneOptions,
  canvas: HTMLCanvasElement
) {
  const { port } = channel;
  let nextId = 0;
  const pending = new Map<number, Pending>();
  const glides = new Map<number, GlideOptions["onProgress"]>();
  let mirror: SceneMirror | null = null;
  let footprints: MapFootprints = NO_FOOTPRINTS;
  let ended = false;
  const post = (message: ToScene, transfer: Transferable[] = []) => {
    if (!ended) {
      port.postMessage(message, transfer);
    }
  };
  const tell = (m: string, a: unknown[]) => post({ t: "call", m, a });
  const ask = async (m: string, a: unknown[]): Promise<unknown> =>
    await new Promise((resolve, reject) => {
      if (ended) {
        reject(new Error("Die Ansicht wurde beendet."));
        return;
      }
      nextId += 1;
      pending.set(nextId, { resolve, reject });
      post({ t: "call", id: nextId, m, a });
    });
  const endAll = () => {
    ended = true;
    for (const { reject } of pending.values()) {
      reject(new Error("Die Ansicht wurde beendet."));
    }
    pending.clear();
  };
  const handlers: {
    [K in ToPage["t"]]?: (message: Extract<ToPage, { t: K }>) => void;
  } = {
    reply: (message) => {
      const waiting = pending.get(message.id);
      pending.delete(message.id);
      if (message.ok) {
        waiting?.resolve(message.value);
      } else {
        waiting?.reject(errorFrom(message.error));
      }
    },
    report: ({ name, a }) => {
      // reason: each report's arguments are its callback's, by its name
      const report = opts[name] as ((...args: unknown[]) => void) | undefined;
      report?.(...a);
    },
    mirror: (message) => {
      ({ mirror } = message);
    },
    footprints: (message) => {
      ({ footprints } = message);
    },
    glide: ({ id, progress }) => {
      glides.get(id)?.(progress);
      if (progress >= 1) {
        glides.delete(id);
      }
    },
    trail: ({ op, a }) => {
      // reason: the trail's members by name, their arguments as sent
      const write = opts.trail?.[op] as
        | ((...args: unknown[]) => void)
        | undefined;
      write?.(...a);
    },
    rejected: ({ error }) => {
      // as the page's own unhandled ones are heard (crash trail, Sentry)
      const reason = errorFrom(error);
      dispatchEvent(
        new ErrorEvent("error", {
          error: reason,
          message: `scene worker: unhandled rejection: ${reason.message}`,
        })
      );
    },
    letters: ({ id, text, style, res }) => {
      void plateLetters(text, style, res, opts.container)
        .catch(() => null)
        .then((raster) => {
          post(
            { t: "letters", id, raster },
            raster ? [raster.atlas.data.buffer] : []
          );
          return null;
        });
    },
  };
  const onMessage = (event: MessageEvent<ToPage>) => {
    const message = event.data;
    // reason: the handler of a message's own kind
    const handle = handlers[message.t] as ((m: ToPage) => void) | undefined;
    handle?.(message);
  };
  port.addEventListener("message", onMessage);
  return {
    tell,
    ask,
    post,
    glides,
    mirror: () => mirror,
    setMirror: (m: SceneMirror) => {
      mirror = m;
    },
    footprints: () => footprints,
    nextGlide: () => {
      nextId += 1;
      return nextId;
    },
    endAll,
    stop: () => port.removeEventListener("message", onMessage),
    canvas,
  };
}

type Client = ReturnType<typeof clientOf>;

/** Every input callback, by name: the record keeps the lists whole. */
const TOUCH_CALLS: Record<keyof TouchControlsCallbacks, true> = {
  onAltDrag: true,
  onDoubleTap: true,
  onDragEnd: true,
  onLongPress: true,
  onLook: true,
  onMouseLook: true,
  onPinch: true,
  onPinchStart: true,
  onTap: true,
  onTwist: true,
  onTwoFingerPan: true,
  onWheelDolly: true,
  onWheelZoom: true,
};
const KEY_CALLS: Record<keyof SceneKeys, true> = {
  demolish: true,
  inquire: true,
  press: true,
  release: true,
  releaseAll: true,
  toggleMode: true,
  toggleModel: true,
  viewpoint: true,
};

/** The calls the input adapters make, as told calls. */
function inputSink(client: Client): {
  touch: TouchControlsCallbacks;
  keys: SceneKeys;
} {
  const group = (name: string, members: object) =>
    Object.fromEntries(
      Object.keys(members).map((m) => [
        m,
        (...a: unknown[]) => client.tell(`${name}:${m}`, a),
      ])
    );
  return {
    // reason: one told call per member, each taking that member's arguments
    touch: group("touch", TOUCH_CALLS) as unknown as TouchControlsCallbacks,
    keys: group("keys", KEY_CALLS) as unknown as SceneKeys,
  };
}

/** How often the HUD's panels are measured (ms). */
const COVERS_MS = 250;

/** How long the page waits at most for a disposed worker's answer, or an
 *  aborted boot's end, before it ends the worker (ms): its GPU device goes
 *  with it either way. */
const WORKER_TEARDOWN_MS = 3000;

/**
 * Starts the scene and settles with its handle once its first frame drew;
 * rejects when the boot fails or is aborted (`signal`), and everything it
 * made is gone then.
 */
export async function startScene(
  opts: StartSceneOptions
): Promise<CityWalkHandle> {
  const { container, signal } = opts;
  const size = canvasSizeOf(container) ?? {
    width: Math.max(container.clientWidth, 1),
    height: Math.max(container.clientHeight, 1),
    dpr: window.devicePixelRatio,
  };
  const init: SceneInit = {
    budget: opts.budget,
    size,
    site: opts.site,
    tilesetUrl: opts.tilesetUrl,
    initialCamera: opts.initialCamera,
    initialView: opts.initialView,
    initialDate: opts.initialDate,
    look: opts.look.get(),
    reloadable: opts.reloadable(),
    page: pageState(),
    pageOrigin: performance.timeOrigin,
    trail: opts.trail !== undefined,
    probe: pocProbeNow(),
    covered: opts.pace.covered,
    listening: opts.pace.listening,
  };
  const canvas = sceneCanvas(container);
  try {
    let channel: Channel;
    if (sceneThreadOf(location.search) === "worker") {
      channel = await workerChannel(signal);
      if (signal.aborted) {
        channel.end();
        throw bootAborted();
      }
      const offscreen = canvas.transferControlToOffscreen();
      channel.port.postMessage({ t: "init", init, canvas: offscreen }, [
        offscreen,
      ]);
    } else {
      channel = await mainChannel(init, canvas, signal);
    }
    return await bootOver(channel, opts, canvas, init.reloadable);
  } catch (error) {
    canvas.remove();
    throw error;
  }
}

/** The specs' probes as set before the boot (poc-debug.ts). */
function pocProbeNow(): PocProbe {
  const poc = typeof window === "undefined" ? undefined : window.__poc;
  return poc
    ? { hold: poc.hold, step: poc.step, frameMs: poc.frameMs, veil: poc.veil }
    : {};
}

/** Waits for the scene's first frame over `channel`, then makes the handle;
 *  `initReloadable`: the recoverable stops the init carried. */
async function bootOver(
  channel: Channel,
  opts: StartSceneOptions,
  canvas: HTMLCanvasElement,
  initReloadable: GpuLoss[]
): Promise<CityWalkHandle> {
  const client = clientOf(channel, opts, canvas);
  const stops: (() => void)[] = [];
  const end = () => {
    for (const stop of stops.splice(0)) {
      stop();
    }
    client.endAll();
    client.stop();
  };
  const sink = inputSink(client);
  // what the page tells the scene from the start: its size, its look, its
  // comings and goings, the specs' probes
  stops.push(
    watchCanvasSize(opts.container, (size: CanvasSize) =>
      client.tell("resize", [size])
    ),
    opts.look.subscribe((values) => client.post({ t: "look", values }))
  );
  // and the look as it stands now: one set while the worker said hello
  // had no one to hear it
  client.post({ t: "look", values: opts.look.get() });
  if (channel.thread === "worker") {
    stops.push(
      watchPage((state, event) => client.post({ t: "page", state, event }))
    );
    // and the page as it stands now: the init's was read before the
    // worker said hello, and a change since reached no one
    client.post({ t: "page", state: pageState() });
  }
  let info: SceneStatic;
  try {
    info = await new Promise<SceneStatic>((resolve, reject) => {
      // an abort: the boot aborts itself, and its "failed" follows; a
      // worker that does not end it in time is ended all the same
      let grace: ReturnType<typeof setTimeout> | undefined;
      const onAbort = () => {
        client.tell("dispose", []);
        if (channel.thread === "worker") {
          grace = setTimeout(() => {
            done();
            reject(bootAborted());
          }, WORKER_TEARDOWN_MS);
        }
      };
      if (opts.signal.aborted) {
        onAbort();
      } else {
        opts.signal.addEventListener("abort", onAbort, { once: true });
      }
      const onMessage = (event: MessageEvent<ToPage>) => {
        const message = event.data;
        if (message.t === "ready") {
          done();
          client.setMirror(message.mirror);
          resolve(message.info);
        } else if (message.t === "failed") {
          done();
          reject(errorFrom(message.error));
        }
      };
      // (an uncaught error in the worker is reported, not fatal: the boot
      // fails by its own "failed")
      const done = () => {
        clearTimeout(grace);
        opts.signal.removeEventListener("abort", onAbort);
        channel.port.removeEventListener("message", onMessage);
      };
      channel.port.addEventListener("message", onMessage);
    });
  } catch (error) {
    end();
    channel.end();
    throw error;
  }
  // three tags the canvas it draws into; an OffscreenCanvas has no
  // attribute to tag, so the page does it for the worker's
  canvas.dataset.engine ??= `three.js (${channel.thread})`;
  // the input, now that there is a scene to drive
  const input = attachSceneInput(canvas, sink, opts.look);
  stops.push(input.detach);
  const scenePace = {
    setCovered: (covered: boolean) => client.tell("setCovered", [covered]),
    setListening: (listening: boolean) =>
      client.tell("setListening", [listening]),
  };
  // the sheet and the listening as they stand now: a change during the
  // boot reached no scene
  scenePace.setCovered(opts.pace.covered);
  scenePace.setListening(opts.pace.listening);
  stops.push(opts.pace.follow(scenePace));
  // the HUD's panels (a nameplate keeps clear of them): measured from the
  // start, so a plate's first placement knows them; sent when they moved
  let lastCovers = "";
  const measureCovers = () => {
    const boxes = coverBoxes(canvas);
    const said = JSON.stringify(boxes);
    if (said !== lastCovers) {
      lastCovers = said;
      client.tell("setCovers", [boxes]);
    }
  };
  measureCovers();
  const covers = setInterval(measureCovers, COVERS_MS);
  stops.push(() => clearInterval(covers));
  // the stops recoverable now: the records age, and the scene decides at
  // the stop, where it cannot ask (a message, not a call: it wakes nothing);
  // the scene holds the init's list, so one that aged during the boot is
  // sent at the first tick
  let lastReloadable = JSON.stringify(initReloadable);
  const reloadable = setInterval(() => {
    const now = opts.reloadable();
    const said = JSON.stringify(now);
    if (said !== lastReloadable) {
      lastReloadable = said;
      client.post({ t: "reloadable", reloadable: now });
    }
  }, RELOADABLE_MS);
  stops.push(() => clearInterval(reloadable));
  connectPocScene({
    counts: () => client.mirror()?.poc ?? null,
    probe: (probe) => client.post({ t: "probe", probe }),
  });
  stops.push(() => connectPocScene(null));
  return handleOf(
    client,
    channel,
    info,
    { end, stopInput: input.detach },
    input.lockPointer
  );
}

/** How often the page asks again which stops it recovers from (ms). */
const RELOADABLE_MS = 30_000;

function handleOf(
  client: Client,
  channel: Channel,
  info: SceneStatic,
  { end, stopInput }: { end: () => void; stopInput: () => void },
  lockPointer: () => void
): CityWalkHandle {
  const mirrored = (): SceneMirror => {
    const m = client.mirror();
    if (!m) {
      throw new Error("scene: no mirror yet");
    }
    return m;
  };
  const told = Object.fromEntries(
    TOLD.map((m) => [m, (...a: unknown[]) => client.tell(m, a)])
  ) as { [K in Told]: Tell<SceneApp[K]> };
  const asked = Object.fromEntries(
    ASKED.map((m) => [m, async (...a: unknown[]) => await client.ask(m, a)])
  ) as { [K in Asked]: Async<SceneApp[K]> };
  const designCall =
    (m: keyof DesignControls) =>
    async (...a: unknown[]) =>
      await client.ask(`design:${m}`, a);
  const design = {
    applyPlacementFile: designCall("applyPlacementFile"),
    load: designCall("load"),
    placeHere: designCall("placeHere"),
    placementText: designCall("placementText"),
    remove: designCall("remove"),
    setFileColours: designCall("setFileColours"),
    setOnGround: designCall("setOnGround"),
    setPlacement: designCall("setPlacement"),
    setReplaceExisting: designCall("setReplaceExisting"),
    setScale: designCall("setScale"),
    status: designCall("status"),
  } as CityWalkHandle["design"];
  /** The page's part of an ending, once the scene's is done: the input
   *  first, then the channel, the worker and the canvas. */
  const finish = async (gone: Promise<unknown>): Promise<void> => {
    stopInput();
    await gone.catch(() => null);
    end();
    channel.end();
    client.canvas.remove();
  };
  return {
    ...info,
    ...told,
    ...asked,
    thread: channel.thread,
    design,
    getCameraState: () => mirrored().camera,
    getPose: () => mirrored().pose,
    getViewMode: () => mirrored().viewMode,
    getModelHud: () => mirrored().modelHud,
    focusNdc: () => mirrored().focusNdc,
    viewMoving: () => mirrored().viewMoving,
    streamBusy: () => mirrored().streamBusy,
    shadowBusy: () => mirrored().shadowBusy,
    nameplateShown: () => mirrored().nameplate,
    getGlideTarget: () => mirrored().glideTarget,
    getFootprints: client.footprints,
    setSun: (date, preview) => {
      client.tell("setSun", [date, preview]);
      return sunStateAt(date, info.latLng);
    },
    flyToViewpoint: (view, glide) => {
      let message: GlideMessage | undefined;
      if (glide) {
        const { onProgress, ...rest } = glide;
        message = rest;
        if (onProgress) {
          const id = client.nextGlide();
          client.glides.set(id, onProgress);
          message.progress = id;
        }
      }
      client.tell("flyToViewpoint", [view, message]);
    },
    enterImmersive: lockPointer,
    sync: async () => {
      await client.ask("sync", []);
    },
    releaseGpu: async () => {
      await client.ask("releaseGpu", []);
    },
    disposeForReload: async () => {
      await finish(client.ask("disposeForReload", []));
    },
    dispose: async () => {
      // the scene tears itself down and answers; a worker that does not
      // answer in time is ended all the same (its device goes with it)
      const answered = client.ask("dispose", []);
      const gone =
        channel.thread === "worker"
          ? Promise.race([
              answered,
              new Promise((resolve) => {
                setTimeout(resolve, WORKER_TEARDOWN_MS);
              }),
            ])
          : answered;
      await finish(gone);
    },
  };
}
