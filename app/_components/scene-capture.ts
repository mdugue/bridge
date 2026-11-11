/** Bild speichern: the picture of the view, taken tile by tile in the frame loop. */
import type { Camera, PerspectiveCamera, WebGPURenderer } from "three/webgpu";
import { exportScale, exportTiles } from "@/lib/city/image-export";
import type { ExportTile } from "@/lib/city/image-export";
import type { ModelCamera } from "./model-camera";

/** How long a capture waits for the shadow rings at most (ms): the view stands
 *  still meanwhile. */
const CAPTURE_HOLD_MS = 1500;

/** A captured frame and how many of its pixels make a CSS pixel. */
export interface CapturedImage {
  canvas: HTMLCanvasElement;
  imagePxPerCssPx: number;
}

interface CaptureRequest {
  resolve: (image: CapturedImage) => void;
  reject: (error: unknown) => void;
}

interface Capture {
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
}

export interface SceneCaptureContext {
  renderer: WebGPURenderer;
  tier: "desktop" | "mobile";
  /** the camera drawing the frame */
  camera: () => Camera;
  /** whether that camera is Modell's parallel one */
  parallel: () => boolean;
  /** whether the picture is still coming together (the shadow rings
   *  redrawing, the lens growing in or focusing): a capture waits for it,
   *  `CAPTURE_HOLD_MS` at most */
  unsettled: () => boolean;
  /** the renderer's pixel ratio changed: the screen targets follow */
  resized: () => void;
}

/**
 * The scene's picture export, one owner of the frame loop's (create-app.ts
 * `frame`): `request` queues a picture, `aim` before a frame's render and
 * `take` after it draw it — one tile per frame, read in the frame's own
 * task right after its render (the canvas's picture is only readable until
 * the task ends). One per frame because three's screen passes (SMAA, GTAO)
 * render once per animation frame: a second render in the same frame would
 * reuse the first one's antialiased picture.
 */
export interface SceneCapture {
  /** the view's picture, drawn over the coming frames */
  request: () => Promise<CapturedImage>;
  /** whether a picture is asked for or in the making (the view holds still) */
  exporting: () => boolean;
  /** whether a picture is in the making (its tiles share one focus) */
  drawing: () => boolean;
  /** the pixel ratio the picture is saved at: the tier's, whatever the
   *  frame rate took since */
  basePixelRatio: number;
  /** before the render: the frustum slides over the larger picture */
  aim: () => void;
  /** after the render: the tile's middle into the picture */
  take: () => void;
  /** no frame will draw them: the pictures asked for, the one in the
   *  making and every later one settle as failed, so an export's veil
   *  comes down (city-walk.tsx) */
  drop: () => void;
}

/** What a picture that no frame will draw fails with. */
const gone = () => new Error("Die Ansicht wurde beendet.");

export function createSceneCapture(ctx: SceneCaptureContext): SceneCapture {
  const { renderer } = ctx;
  const queue: CaptureRequest[] = [];
  let capture: Capture | null = null;
  let dropped = false;
  // since when a capture waits for the rings
  let heldFrom: number | null = null;
  const basePixelRatio = renderer.getPixelRatio();

  // The picture is saved at the tier's resolution, not at the one the
  // frame rate took (the frame meter takes it back after the export).
  const fullResolution = () => {
    if (renderer.getPixelRatio() !== basePixelRatio) {
      renderer.setPixelRatio(basePixelRatio);
      ctx.resized();
    }
  };

  const begin = (request: CaptureRequest) => {
    const view = ctx.camera() as ModelCamera | PerspectiveCamera;
    const { width: w, height: h } = renderer.domElement;
    const scale = exportScale(
      renderer.getPixelRatio(),
      ctx.tier,
      ctx.parallel(),
      w * h
    );
    const fullW = Math.round(w * scale);
    const fullH = Math.round(h * scale);
    const out = document.createElement("canvas");
    out.width = fullW;
    out.height = fullH;
    const ctx2d = out.getContext("2d");
    if (!ctx2d) {
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
      ctx: ctx2d,
      imagePxPerCssPx: renderer.getPixelRatio() * scale,
    };
  };

  /** A capture starts once the rings have drawn what they were asked (a
   *  study's new sun: one a frame), or after a bounded wait: a stream of
   *  landing tiles never holds it for good. */
  const aim = () => {
    const waiting = !capture && queue.length > 0 && ctx.unsettled();
    heldFrom = waiting ? (heldFrom ?? performance.now()) : null;
    if (heldFrom !== null && performance.now() - heldFrom < CAPTURE_HOLD_MS) {
      return;
    }
    heldFrom = null;
    const next = capture ? undefined : queue.shift();
    if (next) {
      fullResolution();
      begin(next);
    }
    const c = capture;
    if (!c || c.tiles.length < 2) {
      return;
    }
    const t = c.tiles[c.next];
    c.view.setViewOffset(c.fullW, c.fullH, t.offsetX, t.offsetY, c.w, c.h);
  };

  const take = () => {
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
    c.next += 1;
    if (c.tiles.length > 1) {
      c.view.clearViewOffset();
    }
    if (c.next >= c.tiles.length) {
      capture = null;
      c.request.resolve({ canvas: c.out, imagePxPerCssPx: c.imagePxPerCssPx });
    }
  };

  return {
    request: async () =>
      await new Promise<CapturedImage>((resolve, reject) => {
        if (dropped) {
          reject(gone());
          return;
        }
        queue.push({ resolve, reject });
      }),
    exporting: () => capture !== null || queue.length > 0,
    drawing: () => capture !== null,
    basePixelRatio,
    aim,
    take,
    drop: () => {
      dropped = true;
      for (const request of queue.splice(0)) {
        request.reject(gone());
      }
      const c = capture;
      capture = null;
      c?.request.reject(gone());
    },
  };
}
