/**
 * The scene's worker (ADR 0061): says what it can draw with, takes the
 * page's canvas and init, and serves the scene from there
 * (scene-server.ts). This module is small on purpose: the tileset and the
 * boot tile's first contents are asked for (boot-ahead.ts) while the
 * scene's own chunk, three and all, is still on its way.
 */
import { bootAhead } from "./boot-ahead";
import { feedPageView } from "./page-view";
import type {
  SceneInit,
  ScenePort,
  ToScene,
  WorkerHello,
} from "./scene-protocol";
import { errorMessage } from "./scene-protocol";

/** The worker's global, as far as it is used here. */
const scope = self as unknown as ScenePort & {
  navigator: { gpu?: { requestAdapter: () => Promise<unknown> } };
};

interface InitMessage {
  t: "init";
  init: SceneInit;
  canvas: OffscreenCanvas;
}

/** Whether WebGPU here gives an adapter: the only backend the scene
 *  draws with (ADR 0027). */
async function hasAdapter(): Promise<boolean> {
  try {
    return (await scope.navigator.gpu?.requestAdapter()) != null;
  } catch {
    return false;
  }
}

const onInit = (event: MessageEvent<InitMessage>) => {
  if (event.data?.t !== "init") {
    return;
  }
  scope.removeEventListener("message", onInit);
  const { init, canvas } = event.data;
  // the page's address before anything resolves a URL against it
  feedPageView(init.page);
  const ahead = bootAhead(new URL(init.tilesetUrl, init.page.href).href, {
    initialCamera: init.initialCamera,
    initialView: init.initialView,
  });
  // the scene's chunk: the page's later calls wait in the port until it
  // listens (a worker queues none: they are taken from here on)
  const early: MessageEvent<ToScene>[] = [];
  const hold = (e: MessageEvent<ToScene>) => {
    early.push(e);
  };
  scope.addEventListener("message", hold);
  const serve = async () => {
    try {
      const { serveScene } = await import("./scene-server");
      scope.removeEventListener("message", hold);
      serveScene(scope, init, canvas, ahead, early);
    } catch (error) {
      ahead.release();
      scope.postMessage({ t: "failed", error: errorMessage(error) }, []);
    }
  };
  void serve();
};
// a rejection nobody caught stays in the worker unless it is sent
globalThis.addEventListener(
  "unhandledrejection",
  (event: PromiseRejectionEvent) => {
    scope.postMessage({ t: "rejected", error: errorMessage(event.reason) }, []);
  }
);
scope.addEventListener("message", onInit);
const sayHello = async () => {
  const hello: WorkerHello = {
    t: "hello",
    gpu: await hasAdapter(),
    offscreen: typeof OffscreenCanvas !== "undefined",
    raf: typeof requestAnimationFrame === "function",
  };
  scope.postMessage(hello, []);
};
void sayHello();
