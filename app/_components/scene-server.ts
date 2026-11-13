/**
 * The scene's end of the channel (ADR 0061): boots the scene
 * (create-app.ts) from the page's init message, runs the page's calls on
 * it, and sends back what it reports, its mirror (the HUD's sync reads)
 * and its replies. The same in the scene's worker (scene-worker.ts) and
 * on the page (scene-client.ts's in-thread mode, over a MessageChannel).
 */
import { createLookState } from "@/lib/city/look-state";
import type { GlideOptions } from "./camera-flight";
import type { BootAhead } from "./boot-ahead";
import { createCityWalkApp } from "./create-app";
import type { CityWalkOptions, SceneApp, SceneTrail } from "./create-app";
import type { PlateRaster } from "./nameplate-glyphs";
import { feedPageView } from "./page-view";
import { pocCounts, setPocProbe } from "./poc-scene";
import { errorMessage } from "./scene-protocol";
import type {
  GlideMessage,
  ReportName,
  SceneInit,
  SceneMirror,
  ScenePort,
  ToPage,
  ToScene,
} from "./scene-protocol";

/** The reports the scene's options carry (each becomes a message). */
const REPORTS: readonly ReportName[] = [
  "onBikeCounts",
  "onBusy",
  "onDesign",
  "onError",
  "onErrorCleared",
  "onFatal",
  "onFollowEnd",
  "onFps",
  "onInquiry",
  "onLoaded",
  "onModeChange",
  "onModelView",
  "onPose",
  "onRaiseSafety",
  "onReload",
  "onSiteInfo",
  "onStage",
  "onStats",
  "onTrafficHour",
  "onTramStatus",
];

/** Every bitmap in a reply goes over, not across a copy. */
function transfersOf(value: unknown): Transferable[] {
  const image = (value as { image?: unknown } | null)?.image;
  return typeof ImageBitmap !== "undefined" && image instanceof ImageBitmap
    ? [image]
    : [];
}

/** The scene's mirror now (scene-protocol.ts `SceneMirror`). */
function mirrorOf(app: SceneApp): SceneMirror {
  return {
    camera: app.getCameraState(),
    pose: app.getPose(),
    viewMode: app.getViewMode(),
    modelHud: app.getModelHud(),
    focusNdc: app.focusNdc(),
    viewMoving: app.viewMoving(),
    streamBusy: app.streamBusy(),
    shadowBusy: app.shadowBusy(),
    nameplate: app.nameplateShown(),
    glideTarget: app.getGlideTarget(),
    poc: pocCounts(),
  };
}

/** A turn of the scene's own: its next animation frame, or a short
 *  timer where there is none. */
const nextTurn = (then: () => void): void => {
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(then);
  } else {
    setTimeout(then, 16);
  }
};

/** How often the mirror is looked at while no frame comes (a hidden page,
 *  a held loop): what changes then is the stream's and the calls'. */
const MIRROR_IDLE_MS = 250;

/**
 * Serves the scene over `port`: boots it from `init` on `canvas` and
 * answers the page until it is disposed. `ahead`: the head start made in
 * this thread (boot-ahead.ts; it is no message); `early`: what the page
 * said while the scene's chunk was loading.
 */
export function serveScene(
  port: ScenePort,
  init: SceneInit,
  canvas: HTMLCanvasElement | OffscreenCanvas,
  ahead?: BootAhead,
  early: readonly MessageEvent<ToScene>[] = []
): void {
  const send = (message: ToPage, transfer: Transferable[] = []) =>
    port.postMessage(message, transfer);
  const look = createLookState(init.look);
  let { reloadable } = init;
  const aborter = new AbortController();
  setPocProbe(init.probe);
  feedPageView(init.page);

  // The nameplate's letters: asked of the page, answered by number.
  let asked = 0;
  const lettersWaiting = new Map<number, (r: PlateRaster | null) => void>();
  const letters: CityWalkOptions["letters"] = async (text, style, res) =>
    await new Promise((resolve) => {
      asked += 1;
      lettersWaiting.set(asked, resolve);
      send({ t: "letters", id: asked, text, style, res });
    });

  const trail: SceneTrail | undefined = init.trail
    ? {
        note: (...a) => send({ t: "trail", op: "note", a }),
        set: (...a) => send({ t: "trail", op: "set", a }),
        beat: (...a) => send({ t: "trail", op: "beat", a }),
      }
    : undefined;

  let app: SceneApp | null = null;
  let lastFootprints: unknown = null;
  /** The minimap's footprints, when they changed (after a stats pass). */
  const sendFootprints = () => {
    const footprints = app?.getFootprints();
    if (footprints && footprints !== lastFootprints) {
      lastFootprints = footprints;
      send({ t: "footprints", footprints });
    }
  };
  const reports = Object.fromEntries(
    REPORTS.map((name) => [
      name,
      (...a: unknown[]) => {
        // the footprints first: the page's stats handler reads them
        if (name === "onStats") {
          sendFootprints();
        }
        send({ t: "report", name, a });
      },
    ])
  ) as Required<Pick<CityWalkOptions, ReportName>>;

  // The mirror: sent when it changed, at the scene's frame rate at most;
  // `sync` waits for the next one.
  let lastMirror = "";
  const synced: (() => void)[] = [];
  let disposed = false;
  const pushMirror = () => {
    if (!app || disposed) {
      return;
    }
    const mirror = mirrorOf(app);
    const said = JSON.stringify(mirror);
    if (said !== lastMirror) {
      lastMirror = said;
      send({ t: "mirror", mirror });
    }
    for (const done of synced.splice(0)) {
      done();
    }
  };
  const mirrorLoop = () => {
    pushMirror();
    if (!disposed) {
      nextTurn(mirrorLoop);
    }
  };
  const idleMirror = setInterval(pushMirror, MIRROR_IDLE_MS);

  /** A glide's progress, home by its number. */
  const glideOf = (glide?: GlideMessage): GlideOptions | undefined => {
    if (!glide) {
      return undefined;
    }
    const { progress, ...rest } = glide;
    return progress === undefined
      ? rest
      : {
          ...rest,
          onProgress: (t) => send({ t: "glide", id: progress, progress: t }),
        };
  };

  /** The member a call names, bound to the scene. */
  const memberOf = (
    scene: SceneApp,
    m: string
  ): ((...a: unknown[]) => unknown) | null => {
    if (m === "sync") {
      return async () =>
        await new Promise<void>((resolve) => {
          synced.push(resolve);
        });
    }
    if (m === "flyToViewpoint") {
      return (view, glide) =>
        scene.flyToViewpoint(
          view as Parameters<SceneApp["flyToViewpoint"]>[0],
          glideOf(glide as GlideMessage | undefined)
        );
    }
    const [group, name] = m.includes(":") ? m.split(":") : [null, m];
    // reason: the page names members by string; an unknown one is refused
    const holder = (group ? scene[group as keyof SceneApp] : scene) as Record<
      string,
      unknown
    >;
    const member = holder?.[name];
    return typeof member === "function"
      ? (member as (...a: unknown[]) => unknown).bind(holder)
      : null;
  };

  /** Runs a call; one with an id is answered, its value or its error. */
  const reply = async (id: number | undefined, run: () => unknown) => {
    if (id === undefined) {
      run();
      return;
    }
    try {
      const value: unknown = await run();
      send({ t: "reply", id, ok: true, value }, transfersOf(value));
    } catch (error) {
      send({ t: "reply", id, ok: false, error: errorMessage(error) });
    }
  };

  const onMessage = (event: MessageEvent<ToScene>) => {
    const message = event.data;
    switch (message.t) {
      case "page": {
        feedPageView(message.state, message.event);
        break;
      }
      case "look": {
        look.set(message.values);
        break;
      }
      case "probe": {
        setPocProbe(message.probe);
        break;
      }
      case "reloadable": {
        ({ reloadable } = message);
        break;
      }
      case "letters": {
        lettersWaiting.get(message.id)?.(message.raster);
        lettersWaiting.delete(message.id);
        break;
      }
      case "call": {
        if (message.m === "dispose" && !app) {
          // a boot not up yet is aborted, and tears itself down
          aborter.abort();
          break;
        }
        if (!app) {
          // a call before the first frame (a resize, the sheet): made
          // once the scene is up
          beforeBoot.push(event);
          break;
        }
        void reply(message.id, () => {
          const member = app ? memberOf(app, message.m) : null;
          if (!member) {
            throw new Error(`scene: no ${message.m} here`);
          }
          // what the page asks shows, on a still or covered scene too
          app?.wake();
          return member(...message.a);
        });
        if (message.m === "dispose" || message.m === "disposeForReload") {
          disposed = true;
          clearInterval(idleMirror);
        }
        break;
      }
      default: {
        break;
      }
    }
  };
  const beforeBoot: MessageEvent<ToScene>[] = [];
  port.addEventListener("message", onMessage);
  for (const event of early) {
    onMessage(event);
  }

  const boot = async () => {
    let booted: SceneApp;
    try {
      booted = await createCityWalkApp({
        ...reports,
        budget: init.budget,
        canvas,
        size: init.size,
        site: init.site,
        tilesetUrl: init.tilesetUrl,
        initialCamera: init.initialCamera,
        initialView: init.initialView,
        initialDate: init.initialDate,
        look,
        reloadable: (how) => reloadable.includes(how),
        trail,
        letters,
        signal: aborter.signal,
        ahead,
      });
    } catch (error) {
      clearInterval(idleMirror);
      port.removeEventListener("message", onMessage);
      send({ t: "failed", error: errorMessage(error) });
      return;
    }
    app = booted;
    if (init.covered) {
      booted.setCovered(true);
    }
    if (init.listening) {
      booted.setListening(true);
    }
    const { landmarks, latLng, mapPicture, offset, provenanceUrl } = booted;
    const { terrainBounds, walksUrl } = booted;
    lastMirror = JSON.stringify(mirrorOf(booted));
    send({
      t: "ready",
      info: {
        landmarks,
        latLng,
        mapPicture,
        offset,
        provenanceUrl,
        terrainBounds,
        walksUrl,
      },
      mirror: mirrorOf(booted),
    });
    for (const event of beforeBoot.splice(0)) {
      onMessage(event);
    }
    sendFootprints();
    nextTurn(mirrorLoop);
  };
  void boot();
}
