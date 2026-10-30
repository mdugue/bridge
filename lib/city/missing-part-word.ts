/**
 * The HUD's word about a part of the city that is missing (ADR 0048): a
 * layer that failed for good, or tiles the network let down and that are
 * asked for again (tile-retry.ts). The network's word replaces a layer
 * word, which waits behind it and shows again once the network's clears;
 * the first layer word stays (later failures add nothing the HUD shows).
 * The page's fatal failure freezes the word on the HUD's side
 * (scene-status.ts), not here.
 */
export interface MissingPartWord {
  /** a part that no retry heals failed: its word, unless one is held */
  layerFailed: (message: string) => void;
  /** the network failed a tile: its word, over a layer word */
  networkFailed: (message: string) => void;
  /** nothing the network failed is outstanding: its word goes, and a
   *  layer word it covered shows again */
  networkCleared: () => void;
}

export function createMissingPartWord(opts: {
  /** shows a word (replacing the one shown) */
  say: (message: string) => void;
  /** takes the word off */
  clear: () => void;
  /** the page is gone: nothing is said any more */
  gone: () => boolean;
}): MissingPartWord {
  let shown: "none" | "network" | "layer" = "none";
  let layer: string | null = null;
  return {
    layerFailed: (message) => {
      if (opts.gone() || layer !== null) {
        return;
      }
      layer = message;
      if (shown === "none") {
        shown = "layer";
        opts.say(message);
      }
    },
    networkFailed: (message) => {
      if (!opts.gone() && shown !== "network") {
        shown = "network";
        opts.say(message);
      }
    },
    networkCleared: () => {
      if (shown !== "network" || opts.gone()) {
        return;
      }
      if (layer !== null) {
        shown = "layer";
        opts.say(layer);
        return;
      }
      shown = "none";
      opts.clear();
    },
  };
}
