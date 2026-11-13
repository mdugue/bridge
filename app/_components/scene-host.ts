/**
 * The page's side of the scene's input and surroundings (ADR 0061): what
 * only the page has — the canvas element and its layout, pointer, key and
 * pointer-lock events, the document's visibility, the HUD's panels — read
 * here and handed to the scene as calls and messages (scene-client.ts),
 * wherever the scene runs.
 */
import { nextRenderStyle } from "@/lib/city/render-style";
import type { LookState } from "@/lib/city/look-state";
import { canvasSizeFor } from "./canvas-size";
import type { CanvasSize, CoverBox, SceneKeys } from "./create-app";
import { attachKeyboardControls } from "./keyboard-controls";
import { pageState } from "./page-view";
import type { PageEventType, PageState } from "./page-view";
import type { PageEventMessage } from "./scene-protocol";
import { attachTouchControls } from "./touch-controls";
import type { TouchControls, TouchControlsCallbacks } from "./touch-controls";

/** The canvas the scene draws into, made by the page and styled here. */
export function sceneCanvas(container: HTMLElement): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.style.display = "block";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  // Touch gestures (look/pinch/double-tap) need the browser to keep its
  // hands off scrolling and double-tap zoom on the canvas.
  canvas.style.touchAction = "none";
  container.append(canvas);
  return canvas;
}

/** The container's size and the device's pixel ratio; null without area
 *  (canvas-size.ts). */
export function canvasSizeOf(container: HTMLElement): CanvasSize | null {
  const size = canvasSizeFor(container);
  return size ? { ...size, dpr: window.devicePixelRatio } : null;
}

/** Follows the container's size; returns the stop. */
export function watchCanvasSize(
  container: HTMLElement,
  onSize: (size: CanvasSize) => void
): () => void {
  const observer = new ResizeObserver(() => {
    // a container without area keeps the last size (canvas-size.ts)
    const size = canvasSizeOf(container);
    if (size) {
      onSize(size);
    }
  });
  observer.observe(container);
  return () => observer.disconnect();
}

/** What the input adapters drive on the scene (scene-client.ts's calls). */
export interface SceneInputSink {
  touch: TouchControlsCallbacks;
  keys: SceneKeys;
}

/**
 * The pointer's gestures on the canvas and the keys on the page, to the
 * scene. `I` and `R` act on what is under the pointer, as a hover shortcut
 * does — there is no dot in the middle to aim with. Without a pointer
 * there (a touch screen, the pointer off the canvas or locked in immersive
 * mode) they act at the centre. Kept in client pixels and turned into NDC
 * when a key asks, so a canvas resized or locked since the last move is
 * read as it is now. `V`'s style change is the look store's.
 */
export function attachSceneInput(
  canvas: HTMLCanvasElement,
  sink: SceneInputSink,
  look: LookState
): { detach: () => void; lockPointer: TouchControls["lockPointer"] } {
  let hover: { x: number; y: number } | undefined;
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
  const touch = attachTouchControls(canvas, sink.touch);
  const { keys } = sink;
  const stopKeys = attachKeyboardControls(
    { document, window },
    {
      press: keys.press,
      release: keys.release,
      releaseAll: keys.releaseAll,
      toggleMode: keys.toggleMode,
      toggleModel: keys.toggleModel,
      viewpoint: keys.viewpoint,
      demolish: () => keys.demolish(aim()),
      // I asks under the pointer, or at the centre in pointer lock, where
      // there is no pointer to click with.
      inquire: () => keys.inquire(aim()),
      cycleStyle: () => look.set({ style: nextRenderStyle(look.get().style) }),
    }
  );
  return {
    detach: () => {
      canvas.removeEventListener("pointermove", onHover);
      canvas.removeEventListener("pointerleave", onLeave);
      touch.detach();
      stopKeys();
    },
    lockPointer: touch.lockPointer,
  };
}

const PAGE_EVENTS: readonly PageEventType[] = [
  "online",
  "offline",
  "pagehide",
  "pageshow",
  "visibilitychange",
];

/** The page's comings and goings, for a scene in a worker (page-view.ts
 *  there); returns the stop. */
export function watchPage(
  onPage: (state: PageState, event: PageEventMessage) => void
): () => void {
  const on = (event: Event) =>
    onPage(pageState(), {
      type: event.type as PageEventType,
      persisted: (event as PageTransitionEvent).persisted,
    });
  for (const type of PAGE_EVENTS) {
    (type === "visibilitychange" ? document : window).addEventListener(
      type,
      on
    );
  }
  return () => {
    for (const type of PAGE_EVENTS) {
      (type === "visibilitychange" ? document : window).removeEventListener(
        type,
        on
      );
    }
  };
}

/**
 * The HUD's panels over the canvas: those marked `data-scene-cover`, and
 * the phone's sidebar sheet, which the vendored sidebar renders without
 * our props (components/ui stays as `shadcn add` wrote it).
 */
const COVER_SELECTOR =
  "[data-scene-cover], [data-slot='sidebar'][data-mobile='true']";

/** The HUD's panels over the canvas as NDC boxes [x0, y0, x1, y1]. */
export function coverBoxes(canvas: HTMLElement): CoverBox[] {
  const c = canvas.getBoundingClientRect();
  if (c.width <= 0 || c.height <= 0) {
    return [];
  }
  const out: CoverBox[] = [];
  for (const el of document.querySelectorAll(COVER_SELECTOR)) {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) {
      continue;
    }
    const nx = (x: number) => ((x - c.left) / c.width) * 2 - 1;
    const ny = (y: number) => 1 - ((y - c.top) / c.height) * 2;
    out.push([nx(r.left), ny(r.bottom), nx(r.right), ny(r.top)]);
  }
  return out;
}
