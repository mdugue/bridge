/**
 * The chips under an answer of *Frag die Stadt* (ADR 0056): the places
 * it showed (each a click away, all of them together), the reach it took
 * for "nearby" with a narrower and a wider one, and the follow-up
 * questions it offered (`vorschlaege`). Read from the answer's tool
 * calls, so nothing is kept beside the conversation.
 */
import type { UIMessage } from "@tanstack/ai-react";
import { MapPinIcon } from "lucide-react";
import { nearReach } from "@/lib/city/ask-knowledge";
import { ASK_LIMITS } from "@/lib/city/ask-city";
import { NEAR_RADIUS } from "@/lib/city/ask-tools";
import { type AskPlace, type AskScene, showPlaces } from "./ask-scene-tools";

/** What an answer's chips offer. */
export interface AnswerChips {
  /** the follow-up questions, as the model wrote them */
  questions: string[];
  /** the places the last `zeige` named, the most important first */
  places: AskPlace[];
  /** that `zeige` stood on the street: so do the chips */
  onFoot: boolean;
  /** the last neighbourhood asked: its centre and reach (m) */
  near: { reach: number; x: number; y: number } | null;
}

interface ToolCallPart {
  input?: unknown;
  name: string;
  type: "tool-call";
}

/** A place as a tool call's input holds it, checked. */
function placeOf(value: unknown): AskPlace | null {
  const v = value as Partial<AskPlace> | null;
  if (
    typeof v?.name !== "string" ||
    typeof v.x !== "number" ||
    typeof v.y !== "number"
  ) {
    return null;
  }
  const num = (n: unknown) => (typeof n === "number" ? n : undefined);
  return {
    name: v.name,
    x: v.x,
    y: v.y,
    z: num(v.z),
    h: num(v.h),
    r: num(v.r),
  };
}

/** The tool calls of the answer that ends at `end`: its assistant
 *  messages back to the question. */
function callsOf(messages: readonly UIMessage[], end: number): ToolCallPart[] {
  const calls: ToolCallPart[] = [];
  for (let i = end; i >= 0 && messages[i].role !== "user"; i--) {
    for (const p of messages[i].parts) {
      if (p.type === "tool-call") {
        calls.unshift(p);
      }
    }
  }
  return calls;
}

/** The chips of the answer whose last message is `messages[end]`. */
export function answerChips(
  messages: readonly UIMessage[],
  end: number
): AnswerChips {
  const out: AnswerChips = {
    questions: [],
    places: [],
    onFoot: false,
    near: null,
  };
  for (const call of callsOf(messages, end)) {
    const input = (call.input ?? {}) as Record<string, unknown>;
    if (call.name === "zeige" && Array.isArray(input.ziele)) {
      out.places = input.ziele
        .map(placeOf)
        .filter((p): p is AskPlace => p !== null);
      out.onFoot = input.aus_der_luft === false;
    } else if (
      call.name === "in_der_naehe" &&
      typeof input.x === "number" &&
      typeof input.y === "number"
    ) {
      const radius =
        typeof input.radius === "number" ? input.radius : NEAR_RADIUS;
      out.near = {
        reach: nearReach(radius).buildings,
        x: Math.round(input.x),
        y: Math.round(input.y),
      };
    } else if (call.name === "vorschlaege" && Array.isArray(input.fragen)) {
      out.questions = input.fragen
        .filter((q): q is string => typeof q === "string" && q.trim() !== "")
        .filter((q, i, all) => all.indexOf(q) === i)
        .slice(0, 3);
    }
  }
  return out;
}

/** The narrower and the wider reach than `reach`, where there is one. */
export function reachSteps(reach: number): {
  narrower: number | null;
  wider: number | null;
} {
  const narrower = Math.round(reach / 2);
  const wider = Math.min(reach * 2, ASK_LIMITS.radius);
  return {
    narrower: narrower >= 10 && narrower < reach ? narrower : null,
    wider: wider > reach ? wider : null,
  };
}

/** The question a reach chip asks: the same, round the same centre —
 *  the camera has flown on since, so "here" would be elsewhere. */
export function reachQuestion(
  near: NonNullable<AnswerChips["near"]>,
  reach: number
): string {
  return `Dasselbe noch einmal um denselben Punkt (x ${near.x}, y ${near.y}), im Umkreis von ${reach} m.`;
}

const CHIP =
  "rounded-full border px-2.5 py-0.5 text-left text-[11px] hover:bg-accent disabled:opacity-50";

function PlaceRow({
  busy,
  chips,
  scene,
}: {
  busy: boolean;
  chips: AnswerChips;
  scene: AskScene;
}) {
  const { places } = chips;
  // on foot when the answer stood on the street; not while an answer's
  // own glide may still be on its way
  const air = !chips.onFoot;
  return (
    <fieldset aria-label="Orte" className="flex flex-wrap gap-1">
      {places.map((p, i) => (
        <button
          className={`${CHIP} flex items-center gap-1`}
          disabled={busy}
          // reason: the places never reorder within an answer
          key={`${i}:${p.name}`}
          onClick={() => showPlaces(scene, { ziele: [p], aus_der_luft: air })}
          title={`Zu ${p.name}`}
          type="button"
        >
          <MapPinIcon aria-hidden className="size-3" />
          {i + 1} {p.name}
        </button>
      ))}
      {places.length > 1 && (
        <button
          className={CHIP}
          disabled={busy}
          onClick={() => showPlaces(scene, { ziele: places, alle: true })}
          title="Alle Orte in einer Ansicht (zu weit verstreut: den ersten)"
          type="button"
        >
          Alle zeigen
        </button>
      )}
    </fieldset>
  );
}

function ReachRow({
  ask,
  busy,
  near,
}: {
  ask: (question: string) => void;
  busy: boolean;
  near: NonNullable<AnswerChips["near"]>;
}) {
  const steps = reachSteps(near.reach);
  const step = (reach: number | null, label: string) =>
    reach === null ? null : (
      <button
        className={CHIP}
        disabled={busy}
        onClick={() => ask(reachQuestion(near, reach))}
        type="button"
      >
        {label} ({reach} m)
      </button>
    );
  return (
    <fieldset
      aria-label="Umkreis"
      className="flex flex-wrap items-center gap-1"
    >
      <span className="text-[11px] text-muted-foreground">
        Umkreis {near.reach} m
      </span>
      {step(steps.narrower, "enger")}
      {step(steps.wider, "weiter")}
    </fieldset>
  );
}

export function AnswerChipRows({
  ask,
  busy,
  chips,
  scene,
}: {
  ask: (question: string) => void;
  /** an answer is on its way: no new question, no glide */
  busy: boolean;
  chips: AnswerChips;
  scene: AskScene;
}) {
  const { near, places, questions } = chips;
  if (places.length === 0 && questions.length === 0 && near === null) {
    return null;
  }
  return (
    <div className="flex flex-col gap-1.5 pt-1" data-testid="ask-chips">
      {places.length > 0 && (
        <PlaceRow busy={busy} chips={chips} scene={scene} />
      )}
      {near && <ReachRow ask={ask} busy={busy} near={near} />}
      {questions.length > 0 && (
        <fieldset aria-label="Weiterfragen" className="flex flex-wrap gap-1">
          {questions.map((q) => (
            <button
              className={CHIP}
              disabled={busy}
              key={q}
              onClick={() => ask(q)}
              type="button"
            >
              {q}
            </button>
          ))}
        </fieldset>
      )}
    </div>
  );
}
