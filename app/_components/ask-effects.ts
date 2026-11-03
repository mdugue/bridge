/**
 * What the card of *Frag die Stadt* (ADR 0056) does with an answer as it
 * streams in. Its view changes: the server acknowledges `zeige`,
 * `setze_zeit`, `setze_stil` and `datenschicht` at once
 * (lib/city/ask-shown.ts), and the card does
 * each when its result arrives — once per call, in the answer's order,
 * only where the server said ok — so the model never waits on the
 * browser for them. And its text, once finished, for reading aloud.
 */
import type { UIMessage } from "@tanstack/ai-react";
import { useEffect, useRef } from "react";
import { SHOWN_TOOLS } from "@/lib/city/ask-tools";
import type { DataLayerKey } from "@/lib/city/data-layers";
import type { RenderStyle } from "@/lib/city/render-style";
import { type AskPlace, type AskScene, showPlaces } from "./ask-scene-tools";

const SHOWN = new Set<string>(SHOWN_TOOLS.map((t) => t.name));

/** A shown call the server answered ok, as the card reads it. */
export interface ShownCall {
  id: string;
  input: Record<string, unknown>;
  name: string;
  /** the server's answer to it */
  output: Record<string, unknown>;
}

/** The shown calls of `messages` the server has answered ok, in order. */
export function shownCalls(messages: readonly UIMessage[]): ShownCall[] {
  const out: ShownCall[] = [];
  for (const m of messages) {
    if (m.role !== "assistant") {
      continue;
    }
    for (const p of m.parts) {
      const output = (p as { output?: Record<string, unknown> }).output;
      if (p.type === "tool-call" && SHOWN.has(p.name) && output?.ok === true) {
        out.push({
          id: p.id,
          input: (p.input ?? {}) as Record<string, unknown>,
          name: p.name,
          output,
        });
      }
    }
  }
  return out;
}

/** Carries one shown call out on the scene. */
export function runShown(scene: AskScene, call: ShownCall): void {
  const a = call.input;
  switch (call.name) {
    case "zeige":
      if (Array.isArray(a.ziele) && a.ziele.length > 0) {
        showPlaces(
          scene,
          {
            ziele: a.ziele as AskPlace[],
            alle: a.alle as boolean | undefined,
            aus_der_luft: a.aus_der_luft as boolean | undefined,
          },
          Array.isArray(call.output.gezeigt)
            ? (call.output.gezeigt as string[])
            : undefined
        );
      }
      return;
    case "setze_zeit":
      if (typeof a.stunde === "number") {
        scene.setTime(
          a.stunde,
          typeof a.datum === "string" ? a.datum : undefined
        );
      }
      return;
    case "setze_stil":
      scene.setStyle(a.stil as RenderStyle);
      return;
    case "datenschicht":
      scene.setLayer(a.schicht as DataLayerKey, a.an === true);
      return;
    default:
      return;
  }
}

/** Carries out every shown call of the conversation once, as it arrives. */
export function useShownEffects(
  messages: readonly UIMessage[],
  scene: AskScene
): void {
  const done = useRef(new Set<string>());
  useEffect(() => {
    for (const call of shownCalls(messages)) {
      if (!done.current.has(call.id)) {
        done.current.add(call.id);
        runShown(scene, call);
      }
    }
  }, [messages, scene]);
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
