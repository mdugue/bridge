/**
 * The render loop's pace.
 *
 * On a phone the sidebar opens as a sheet over nearly the whole screen,
 * its backdrop 80 % black. The scene behind it would render every frame —
 * shadows, contact shadows, the post pipeline — on the GPU the system's
 * compositor draws the sheet's scrolling with. The scene's script runs in
 * a worker (ADR 0061), so the sheet's scroll no longer waits on it; its
 * GPU work it still shares. While covered the loop therefore draws only
 * what is asked of it: a call from the HUD (a sun, a style, a slider)
 * wakes it for COVERED_TAIL_MS at COVERED_FPS — enough for the change and
 * the shadow map's redraw to show through the backdrop — and keeps that
 * rate while the scene moves (a glide a call started, a stream landing:
 * the pose steps only in drawn frames). A still scene draws nothing
 * otherwise, a scroll included: it asks the scene nothing.
 *
 * A scene that stands still — the camera has not moved for STILL_AFTER_MS,
 * nothing streams in, no data layer runs, no input came — draws at
 * STILL_FPS: its water and fountains still move, and a phone's GPU and
 * battery get half their frames back (a 120 Hz display three quarters).
 * Any input wakes it for the very next frame (`setStill(false)`).
 *
 * While the visitor only listens (*Frag die Stadt*'s Hörmodus, ADR 0057)
 * the scene draws at LISTENING_FPS while it stands still: the city shows
 * through a soft vignette, but nothing in it needs more, and the pose, the live mode and the questions about
 * the view still see a current scene. While it moves — a glide the answer
 * started, the live mode following the walker — it draws at
 * about LISTENING_MOVING_FPS, but it holds a frame back only when the
 * next one, a frame's time later, still comes within LISTENING_MOVING_GAP_MS:
 * so at any display rate no two kept frames lie further apart than the
 * loop's largest time step (0.05 s), and a glide arrives when it would on
 * screen (a fixed rate would not: 20 fps at 30 Hz keeps every second
 * frame, 67 ms apart, and the clamp loses a quarter).
 *
 * Otherwise every frame draws.
 */

/** frames per second the covered scene draws at most, once asked */
export const COVERED_FPS = 12;
/** how long the covered scene draws after it was asked (ms) */
export const COVERED_TAIL_MS = 500;
/** frames per second a still scene draws at most */
export const STILL_FPS = 30;
/** how long the scene must stand still before it is (ms) */
export const STILL_AFTER_MS = 1000;
/** frames per second the scene draws while the visitor only listens */
export const LISTENING_FPS = 2;
/** ...and while it moves, listened to, at most */
export const LISTENING_MOVING_FPS = 30;
/** ...and never two kept frames further apart (ms; the loop clamps a
 *  frame's time step to 50) */
export const LISTENING_MOVING_GAP_MS = 48;

export interface FramePace {
  /** the HUD covers the scene (on a phone: the sidebar's sheet is open) */
  setCovered: (covered: boolean) => void;
  /** something asked the scene to draw (a call, an input, a look) */
  request: () => void;
  /** the scene stands still (`createStillness`), or input woke it */
  setStill: (still: boolean) => void;
  /** the visitor only listens (the Hörmodus): the scene barely draws */
  setListening: (listening: boolean) => void;
  /** whether the animation frame at `now` (ms) draws the scene */
  draws: (now: number) => boolean;
  /**
   * Whether the pace held back a frame since the last call (and resets):
   * a frame rate measured over that span is the pace's, not the device's.
   */
  takePaced: () => boolean;
  /**
   * Whether the pace held back the frame(s) just before the last one it
   * drew: that frame's time step is the pace's, not the device's.
   */
  heldBefore: () => boolean;
}

export function createFramePace(): FramePace {
  let covered = false;
  /** a covered scene draws until then (the loop's clock), once asked */
  let askedUntil = Number.NEGATIVE_INFINITY;
  let asked = false;
  let lastDrawn = Number.NEGATIVE_INFINITY;
  let paced = false;
  let held = false;
  let heldBefore = false;
  let still = false;
  let listening = false;
  // the last animation frame, drawn or not: the display's own interval
  let lastFrame = Number.NaN;
  // A frame arrives a little before or after its slot (vsync jitter): half
  // a 60 Hz frame of slack keeps 12 fps from falling to every sixth frame.
  const interval = 1000 / COVERED_FPS - 8;
  // and 4 ms keeps 30 fps every second frame at 60 Hz, every fourth at 120
  const stillInterval = 1000 / STILL_FPS - 4;
  const listeningInterval = 1000 / LISTENING_FPS - 8;
  const listeningMovingInterval = 1000 / LISTENING_MOVING_FPS - 4;
  return {
    setCovered: (on) => {
      covered = on;
    },
    request: () => {
      asked = true;
    },
    setStill: (on) => {
      still = on;
    },
    setListening: (on) => {
      listening = on;
    },
    draws: (now) => {
      const frame = now - lastFrame || 0;
      lastFrame = now;
      const since = now - lastDrawn;
      if (asked) {
        // (on the loop's clock: the ask's own time is the caller's)
        asked = false;
        askedUntil = now + COVERED_TAIL_MS;
      }
      // covered: at its rate while asked, or while the scene moves (a
      // glide a call started, a stream landing): the pose steps only in
      // drawn frames
      const coveredDraws =
        !covered || ((now < askedUntil || !still) && since >= interval);
      // moving and listened to: at its rate, or now if skipping this frame
      // would leave the next one past the loop's time step
      const listenedDraws = still
        ? since >= listeningInterval
        : since >= listeningMovingInterval ||
          since + frame > LISTENING_MOVING_GAP_MS;
      const draw =
        coveredDraws &&
        (!still || since >= stillInterval) &&
        (!listening || listenedDraws);
      if (draw) {
        lastDrawn = now;
        heldBefore = held;
        held = false;
      } else {
        paced = true;
        held = true;
      }
      return draw;
    },
    takePaced: () => {
      const was = paced;
      paced = false;
      return was;
    },
    heldBefore: () => heldBefore,
  };
}

export interface Stillness {
  /** a drawn frame at `now` (ms): whether anything moved or streamed */
  frame: (now: number, busy: boolean) => boolean;
  /** input at `now`: not still, from this frame on */
  wake: (now: number) => void;
}

/** Whether the scene has stood still for STILL_AFTER_MS. */
export function createStillness(afterMs = STILL_AFTER_MS): Stillness {
  let lastBusy = Number.NEGATIVE_INFINITY;
  let started = false;
  return {
    frame: (now, busy) => {
      if (busy || !started) {
        started = true;
        lastBusy = now;
      }
      return now - lastBusy >= afterMs;
    },
    wake: (now) => {
      lastBusy = Math.max(lastBusy, now);
    },
  };
}
