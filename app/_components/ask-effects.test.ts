import { expect, test } from "bun:test";
import type { UIMessage } from "@tanstack/ai-react";
import type { PlannedVolume } from "@/lib/city/scenario";
import { lastAnswer, runShown, shownCalls } from "./ask-effects";
import type { AskScene } from "./ask-scene-tools";

const call = (id: string, name: string, input: unknown, output?: unknown) => ({
  type: "tool-call" as const,
  id,
  name,
  arguments: JSON.stringify(input),
  input,
  state: "input-complete" as const,
  ...(output === undefined ? {} : { output }),
});

const text = (content: string) => ({ type: "text" as const, content });

const question = {
  id: "q",
  role: "user",
  parts: [text("Wo ist die Frauenkirche?")],
} as UIMessage;

test("the card carries out what the server said ok to, once each, in order", () => {
  const messages = [
    question,
    {
      id: "a",
      role: "assistant",
      parts: [
        call("1", "suche_stadt", { anfrage: "x" }, { treffer: [] }),
        call("2", "setze_zeit", { stunde: 20 }, { ok: true }),
        call("3", "datenschicht", { schicht: "nope", an: true }, { ok: false }),
        call("4", "zeige", { ziele: [{ name: "A", x: 1, y: 2 }] }),
        call("5", "setze_stil", { stil: "comic" }, { ok: true }),
      ],
    },
  ] as UIMessage[];
  // a lookup is no view change, a refused one is not done, one not yet
  // answered waits
  expect(shownCalls(messages).map((c) => c.id)).toEqual(["2", "5"]);
});

test("a planned box waits for its ground", async () => {
  const tries: (PlannedVolume | null)[] = [];
  const scene = {
    setVolume: (v: PlannedVolume | null) => {
      tries.push(v);
      return tries.length >= 2;
    },
  } as unknown as AskScene;
  const stop = runShown(scene, {
    id: "b",
    name: "plane_baukoerper",
    input: { x: 1, y: 2, breite: 10, tiefe: 10, hoehe: 20 },
  });
  expect(stop).toBeDefined();
  await new Promise((r) => setTimeout(r, 500));
  stop?.();
  expect(tries).toHaveLength(2);
  runShown(scene, { id: "c", name: "plane_baukoerper", input: { aus: true } });
  expect(tries.at(-1)).toBeNull();
});

test("an answer is read once its calls have results, chips after the text included", () => {
  const done = [
    question,
    {
      id: "a",
      role: "assistant",
      parts: [
        call("1", "suche_stadt", { anfrage: "x" }, { treffer: [] }),
        text("Sie steht am Neumarkt."),
        call("2", "vorschlaege", { fragen: ["Wer?"] }, { ok: true }),
      ],
    },
  ] as UIMessage[];
  expect(lastAnswer(done)).toBe("Sie steht am Neumarkt.");
  const waiting = [
    question,
    {
      id: "a",
      role: "assistant",
      parts: [text("Moment."), call("1", "was_ist_da", {})],
    },
  ] as UIMessage[];
  expect(lastAnswer(waiting)).toBe("");
  expect(lastAnswer([question])).toBe("");
});
