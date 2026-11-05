import { expect, test } from "bun:test";
import { chat, maxIterations } from "@tanstack/ai";
import { fakeText } from "@tanstack/ai/testing";
import { ChatClient, stream } from "@tanstack/ai-client";
import { lookTool, SCENE_TOOLS } from "@/lib/city/ask-tools";
import { sceneTools } from "./ask-scene-tools";
import type { AskScene } from "./ask-scene-tools";

const STUB: AskScene = {
  from: () => null,
  haltAnswerGlide: () => {},
  look: async () => ({}),
  setLayer: () => true,
  setListening: () => {},
  setStyle: () => ({}),
  setTime: () => ({ zeit: "" }),
  show: () => true,
  within: () => true,
  where: () => ({}),
};

test("the card runs every scene tool the server hands the browser", () => {
  // one it does not bind leaves the run waiting for ever
  const bound = sceneTools(STUB).map((t) => t.name);
  expect(bound.sort((a, b) => a.localeCompare(b))).toEqual(
    SCENE_TOOLS.map((t) => t.name).sort((a, b) => a.localeCompare(b))
  );
});

test("setze_zeit refuses a time no clock or calendar has, and sets none", async () => {
  const set: unknown[] = [];
  const scene = {
    ...STUB,
    setTime: (change: unknown) => {
      set.push(change);
      return { zeit: "" };
    },
  };
  const tool = sceneTools(scene).find((t) => t.name === "setze_zeit");
  const ok = async (input: { datum?: string; uhrzeit?: string }) => {
    const result = await tool?.execute?.(input, {} as never);
    return (result as { ok: boolean }).ok;
  };
  expect(await ok({ uhrzeit: "25:00" })).toBe(false);
  expect(await ok({ datum: "2026-02-31" })).toBe(false);
  // `Date` would read the first century as 19xx
  expect(await ok({ datum: "0050-06-21" })).toBe(false);
  expect(await ok({ datum: "0100-01-01" })).toBe(false);
  expect(await ok({})).toBe(false);
  expect(set).toEqual([]);
  expect(await ok({ uhrzeit: "24:00" })).toBe(true);
  expect(await ok({ datum: "0929-06-21" })).toBe(true);
  expect(set).toHaveLength(2);
});

/** A real chat client against a real `chat()` whose model asks `was_ist_da`
 *  and answers once it has the result; counts the requests it sends. */
function conversation(look: AskScene["look"]) {
  const model = fakeText();
  model.setResponses([
    { toolCalls: [{ name: lookTool.name, input: {} }] },
    { text: "Die Frauenkirche." },
  ]);
  const requests = { count: 0 };
  const client = new ChatClient({
    threadId: "t",
    tools: sceneTools({ ...STUB, look }),
    connection: stream((messages, _data, abortSignal, input) => {
      requests.count += 1;
      return chat({
        adapter: model,
        messages,
        threadId: input.threadId,
        runId: input.runId,
        ...(input.resume ? { resume: input.resume } : {}),
        ...(input.parentRunId ? { parentRunId: input.parentRunId } : {}),
        tools: [lookTool],
        agentLoopStrategy: maxIterations(4),
        ...(abortSignal ? { abortController: linked(abortSignal) } : {}),
      });
    }),
  });
  return { client, requests };
}

function linked(signal: AbortSignal): AbortController {
  const controller = new AbortController();
  signal.addEventListener("abort", () => controller.abort(), { once: true });
  return controller;
}

test("a finished was_ist_da resumes the run", async () => {
  const { client, requests } = conversation(async () => ({ gefunden: false }));
  await client.sendMessage("Was ist das?");
  expect(requests.count).toBe(2);
  expect(JSON.stringify(client.getMessages())).toContain("Die Frauenkirche.");
});

test("stop ends was_ist_da's wait, and the stopped tool resumes nothing", async () => {
  // the contract the session's `run.stop` rests on (ask-session.ts): a
  // request more would be on the visitor's key
  const waiting = Promise.withResolvers<AbortSignal | undefined>();
  const { client, requests } = conversation(async (signal) => {
    waiting.resolve(signal);
    return await new Promise((_resolve, reject) => {
      signal?.addEventListener("abort", () => {
        reject(new DOMException("stopped", "AbortError"));
      });
    });
  });
  const sent = client.sendMessage("Was ist das?");
  const signal = await waiting.promise;
  expect(signal?.aborted).toBe(false);
  client.stop();
  expect(signal?.aborted).toBe(true);
  await sent;
  // whatever was still queued has had its turn
  await Bun.sleep(20);
  expect(requests.count).toBe(1);
});
