/**
 * What the card of *Frag die Stadt* (ADR 0056) does with an answer as it
 * streams in. Its view changes: the server acknowledges `zeige`,
 * `setze_zeit`, `setze_stil`, `datenschicht`, `zeige_hochwasser` and
 * `plane_baukoerper` at once (lib/city/ask-shown.ts), and the card does
 * each when its result arrives — once per call, in the answer's order,
 * only where the server said ok — so the model never waits on the
 * browser for them. And its text, once finished, for reading aloud.
 */
import type { UIMessage } from "@tanstack/ai-react";
import { useEffect, useRef } from "react";
import { floodShown, volumeShown } from "@/lib/city/ask-shown";
import { SHOWN_TOOLS } from "@/lib/city/ask-tools";
import type { DataLayerKey } from "@/lib/city/data-layers";
import type { RenderStyle } from "@/lib/city/render-style";
import type { PlannedVolume } from "@/lib/city/scenario";
import { type AskPlace, type AskScene, showPlaces } from "./ask-scene-tools";

const SHOWN = new Set<string>(SHOWN_TOOLS.map((t) => t.name));

/** How long a planned volume waits for its ground to load (ms), and how
 *  often it tries. */
const VOLUME_WAIT_MS = 8000;
const VOLUME_TRY_MS = 400;

/** A shown call the server answered ok, as the card reads it. */
export interface ShownCall {
  id: string;
  input: Record<string, unknown>;
  name: string;
}

/** The shown calls of `messages` the server has answered ok, in order. */
export function shownCalls(messages: readonly UIMessage[]): ShownCall[] {
  const out: ShownCall[] = [];
  for (const m of messages) {
    if (m.role !== "assistant") {
      continue;
    }
    for (const p of m.parts) {
      const ok = (p as { output?: { ok?: unknown } }).output?.ok === true;
      if (p.type === "tool-call" && SHOWN.has(p.name) && ok) {
        out.push({
          id: p.id,
          input: (p.input ?? {}) as Record<string, unknown>,
          name: p.name,
        });
      }
    }
  }
  return out;
}

/** Places a volume, trying again while its ground loads (a `zeige` in
 *  the same answer flies there first); the returned call stops it. */
function placeWhenLoaded(scene: AskScene, volume: PlannedVolume): () => void {
  const until = Date.now() + VOLUME_WAIT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const attempt = () => {
    if (!scene.setVolume(volume) && Date.now() < until) {
      timer = setTimeout(attempt, VOLUME_TRY_MS);
    }
  };
  attempt();
  return () => clearTimeout(timer);
}

/** Carries one shown call out on the scene; a call that keeps trying
 *  returns its stop. */
export function runShown(
  scene: AskScene,
  call: ShownCall
): (() => void) | undefined {
  const a = call.input;
  switch (call.name) {
    case "zeige":
      if (Array.isArray(a.ziele) && a.ziele.length > 0) {
        showPlaces(scene, {
          ziele: a.ziele as AskPlace[],
          alle: a.alle as boolean | undefined,
          aus_der_luft: a.aus_der_luft as boolean | undefined,
        });
      }
      return undefined;
    case "setze_zeit":
      if (typeof a.stunde === "number") {
        scene.setTime(
          a.stunde,
          typeof a.datum === "string" ? a.datum : undefined
        );
      }
      return undefined;
    case "setze_stil":
      scene.setStyle(a.stil as RenderStyle);
      return undefined;
    case "datenschicht":
      scene.setLayer(a.schicht as DataLayerKey, a.an === true);
      return undefined;
    case "zeige_hochwasser": {
      const { cm } = floodShown(scene.river, a);
      if (cm !== undefined) {
        scene.setFlood(cm);
      }
      return undefined;
    }
    case "plane_baukoerper": {
      const { volume } = volumeShown(a);
      if (volume === null) {
        scene.setVolume(null);
        return undefined;
      }
      return volume ? placeWhenLoaded(scene, volume) : undefined;
    }
    default:
      return undefined;
  }
}

/** Carries out every shown call of the conversation once, as it arrives. */
export function useShownEffects(
  messages: readonly UIMessage[],
  scene: AskScene
): void {
  const done = useRef(new Set<string>());
  const stops = useRef<(() => void)[]>([]);
  useEffect(() => {
    for (const call of shownCalls(messages)) {
      if (!done.current.has(call.id)) {
        done.current.add(call.id);
        const stop = runShown(scene, call);
        if (stop) {
          stops.current.push(stop);
        }
      }
    }
  }, [messages, scene]);
  useEffect(() => {
    const pending = stops.current;
    return () => {
      for (const stop of pending) {
        stop();
      }
    };
  }, []);
}

/**
 * The text of a finished answer: its assistant messages since the last
 * question — empty while a tool call of it still has no result (the
 * browser's `was_ist_da` ends the run at an interrupt, and the answer
 * comes after it). A call that closes the answer — the follow-ups, a
 * flight — stands after its text and does not hold it back.
 */
export function lastAnswer(messages: readonly UIMessage[]): string {
  if (messages.at(-1)?.role !== "assistant") {
    return "";
  }
  const texts: string[] = [];
  for (
    let i = messages.length - 1;
    i >= 0 && messages[i].role !== "user";
    i--
  ) {
    const parts = messages[i].parts;
    if (parts.some((p) => p.type === "tool-call" && p.output === undefined)) {
      return "";
    }
    texts.unshift(
      parts.map((p) => (p.type === "text" ? p.content : "")).join(" ")
    );
  }
  return texts.join(" ").trim();
}
