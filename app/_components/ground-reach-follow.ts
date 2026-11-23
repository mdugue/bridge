/**
 * Keeps each fine ground level on the rasters its distance asks for
 * (lib/city/ground-reach.ts): a few times a second it measures how finely
 * the view draws every loaded level and has the nearest one that reads the
 * wrong set swap it (terrain-layer.ts `GroundDetail`). One swap at a time:
 * a level's full set is four 2048² uploads, and a flight that lands among
 * four tiles spreads them over as many ticks.
 */
import { metresPerPixel, readsFar } from "@/lib/city/ground-reach";
import type { ReachBox, ReachView } from "@/lib/city/ground-reach";
import { exportScale } from "@/lib/city/image-export";
import type { EXPORT_DENSITY } from "@/lib/city/image-export";
import { Vector2 } from "three/webgpu";
import type {
  Camera,
  OrthographicCamera,
  PerspectiveCamera,
  WebGPURenderer,
} from "three/webgpu";
import type { GroundDetail } from "./terrain-layer";

const cssSize = new Vector2();

/**
 * The drawing camera as the reach reads it, at the size a picture of it is
 * saved at (scene-capture.ts): the tier's pixel ratio whatever the frame
 * rate took, and a parallel view (Modell) at its export's scale — so an
 * export finds the rasters its pixels ask for, and the frame meter's
 * steps swap nothing.
 */
export function reachViewOf(
  camera: Camera,
  renderer: WebGPURenderer,
  basePixelRatio: number,
  tier: keyof typeof EXPORT_DENSITY
): ReachView {
  const css = renderer.getSize(cssSize);
  const heightPx = Math.max(css.y, 1) * basePixelRatio;
  // reason: three's cameras tell their kind by flag
  const parallel = camera as Partial<OrthographicCamera>;
  if (parallel.isOrthographicCamera === true) {
    const scale = exportScale(
      basePixelRatio,
      tier,
      true,
      Math.max(css.x, 1) * basePixelRatio * heightPx
    );
    const top = parallel.top ?? 1;
    const bottom = parallel.bottom ?? -1;
    return {
      kind: "parallel",
      worldHeight: (top - bottom) / (parallel.zoom ?? 1),
      heightPx: heightPx * scale,
    };
  }
  const e = camera.matrixWorld.elements;
  return {
    kind: "perspective",
    eye: [e[12], e[13], e[14]],
    fovDeg: (camera as PerspectiveCamera).fov,
    heightPx,
  };
}

export interface GroundReachFollow {
  /** whether a level whose ground lies in `box` starts on its twins */
  startsFar: (box: ReachBox) => boolean;
  /** measures the loaded levels and starts the most urgent swap */
  tick: () => void;
}

export function createGroundReachFollow(ctx: {
  /** the loaded levels' close-range rasters */
  details: () => Iterable<GroundDetail>;
  /** a level draws other rasters now */
  onSwap: () => void;
  /** the view as the reach reads it, at the size a picture is saved at */
  view: () => ReachView;
}): GroundReachFollow {
  let swapping = false;
  return {
    startsFar: (box) => readsFar(metresPerPixel(ctx.view(), box), undefined),
    tick: () => {
      if (swapping) {
        return;
      }
      const view = ctx.view();
      let due: GroundDetail | null = null;
      let dueMetres = Number.POSITIVE_INFINITY;
      for (const detail of ctx.details()) {
        const metres = metresPerPixel(view, detail.box);
        const wrong = readsFar(metres, detail.far()) !== detail.far();
        // the nearest first: a level coming into reach before one leaving it
        if (wrong && metres < dueMetres) {
          due = detail;
          dueMetres = metres;
        }
      }
      if (!due) {
        return;
      }
      swapping = true;
      const swap = async (detail: GroundDetail) => {
        try {
          if (await detail.setFar(!detail.far())) {
            ctx.onSwap();
          }
        } finally {
          swapping = false;
        }
      };
      void swap(due);
    },
  };
}
