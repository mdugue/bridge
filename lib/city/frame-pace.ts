/**
 * The render loop's pace while the HUD covers the scene.
 *
 * On a phone the sidebar opens as a sheet over nearly the whole screen,
 * its backdrop 80 % black. The scene behind it still rendered every
 * frame — shadows, contact shadows, the post pipeline — on the GPU the
 * system's compositor draws the sheet's scrolling with, and the scroll
 * lagged behind the finger. While covered the loop therefore draws at
 * COVERED_FPS (enough for a sun or style change to show through the
 * backdrop), and not at all while the sheet scrolls and SCROLL_QUIET_MS
 * after its last scroll event (a momentum scroll keeps firing them).
 *
 * Uncovered, every frame draws: the pace never touches the open scene.
 */

/** frames per second the covered scene draws at most */
export const COVERED_FPS = 12;
/** how long after the last scroll event the covered scene stays still */
export const SCROLL_QUIET_MS = 250;

export interface FramePace {
  /** the HUD covers the scene (on a phone: the sidebar's sheet is open) */
  setCovered: (covered: boolean) => void;
  /** the covering HUD scrolled at `now` (ms, the loop's clock) */
  noteScroll: (now: number) => void;
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
  let quietUntil = Number.NEGATIVE_INFINITY;
  let lastDrawn = Number.NEGATIVE_INFINITY;
  let paced = false;
  let held = false;
  let heldBefore = false;
  // A frame arrives a little before or after its slot (vsync jitter): half
  // a 60 Hz frame of slack keeps 12 fps from falling to every sixth frame.
  const interval = 1000 / COVERED_FPS - 8;
  return {
    setCovered: (on) => {
      covered = on;
      if (!on) {
        quietUntil = Number.NEGATIVE_INFINITY;
      }
    },
    noteScroll: (now) => {
      if (covered) {
        quietUntil = now + SCROLL_QUIET_MS;
      }
    },
    draws: (now) => {
      const draw =
        !covered || (now >= quietUntil && now - lastDrawn >= interval);
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
