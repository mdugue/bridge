import { expect, test } from "bun:test";
import type { UIMessage } from "@tanstack/ai-react";
import { ASK_LIMITS } from "@/lib/city/ask-city";
import { answerChips, reachQuestion, reachSteps } from "./ask-chips";

const call = (name: string, input: unknown) => ({
  type: "tool-call" as const,
  id: name,
  name,
  arguments: JSON.stringify(input),
  input,
  state: "input-complete" as const,
});

const answer = [
  { id: "q", role: "user", parts: [{ type: "text", content: "Alt?" }] },
  {
    id: "a1",
    role: "assistant",
    parts: [
      call("in_der_naehe", { x: 1, y: 2, radius: 300 }),
      call("zeige", {
        ziele: [
          { name: "Kreuzkirche", x: 10, y: 20, h: 90, r: 30 },
          { name: "kaputt", x: "1" },
          { name: "Frauenkirche", x: 30, y: 40 },
        ],
        alle: false,
      }),
    ],
  },
  {
    id: "a2",
    role: "assistant",
    parts: [
      { type: "text", content: "Die Kreuzkirche." },
      call("vorschlaege", {
        fragen: ["Wer baute sie?", " ", 3, "Wer baute sie?"],
      }),
    ],
  },
] as unknown as UIMessage[];

test("an answer's chips come from its own tool calls, across its messages", () => {
  const chips = answerChips(answer, 2);
  expect(chips.places.map((p) => p.name)).toEqual([
    "Kreuzkirche",
    "Frauenkirche",
  ]);
  expect(chips.places[0]).toMatchObject({ h: 90, r: 30 });
  expect(chips.near).toEqual({ reach: 300, x: 1, y: 2 });
  expect(reachQuestion(chips.near!, 150)).toContain("(x 1, y 2)");
  expect(chips.questions).toEqual(["Wer baute sie?"]);
  // a question has none
  expect(answerChips(answer, 0)).toEqual({
    places: [],
    questions: [],
    onFoot: false,
    near: null,
  });
});

test("the reach steps halve and double within the tool's limits", () => {
  expect(reachSteps(120)).toEqual({ narrower: 60, wider: 240 });
  expect(reachSteps(ASK_LIMITS.radius).wider).toBeNull();
  expect(reachSteps(15).narrower).toBeNull();
});

test("a search round the visitor takes its centre from the result", () => {
  const round = [
    answer[0],
    {
      id: "a",
      role: "assistant",
      parts: [
        {
          ...call("in_der_naehe", { radius: 120 }),
          output: { mitte: { x: 411_790, y: 5_656_340 }, treffer: [] },
        },
      ],
    },
  ] as unknown as UIMessage[];
  expect(answerChips(round, 1).near).toEqual({
    reach: 120,
    x: 411_790,
    y: 5_656_340,
  });
});
