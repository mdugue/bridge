import { expect, test } from "bun:test";
import { chat, maxIterations } from "@tanstack/ai";
import { fakeText } from "@tanstack/ai/testing";
import { ChatClient, stream } from "@tanstack/ai-client";
import { lookTool, SCENE_TOOLS } from "@/lib/city/ask-tools";
import { frameTargets, streetView } from "@/lib/city/ask-view";
import { AERIAL_REACH, sceneTools, showPlaces } from "./ask-scene-tools";
import type { AskScene } from "./ask-scene-tools";
import type { ViewpointGeometry } from "@/lib/city/site";

const STUB: AskScene = {
  from: () => null,
  frameView: async (places, from) =>
    await Promise.resolve(frameTargets(places, { aspect: 1.5, from })),
  streetView: async (place, from) =>
    await Promise.resolve(streetView(place, from ?? place)),
  haltAnswerGlide: () => {},
  look: async () => ({}),
  moment: () => ({
    at: null,
    now: new Date(),
    landmarks: [],
    layers: [],
  }),
  setLayer: () => true,
  setListening: () => {},
  setStyle: () => ({}),
  setTime: () => ({ zeit: "" }),
  select: () => {},
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

test("zeige frames the places together, or the first alone when they lie too far apart", async () => {
  const shown: ViewpointGeometry[] = [];
  const scene = {
    ...STUB,
    show: (v: ViewpointGeometry) => {
      shown.push(v);
      return true;
    },
  };
  const near = [
    { name: "Kreuzkirche", x: 0, y: 0, z: 110, h: 90, r: 30 },
    { name: "Frauenkirche", x: 250, y: 150, z: 112, h: 90, r: 30 },
  ];
  const together = await showPlaces(scene, { ziele: near });
  expect(together.gezeigt).toEqual(["Kreuzkirche", "Frauenkirche"]);
  expect(together.abstand_m as number).toBeLessThanOrEqual(AERIAL_REACH);
  const far = [near[0], { ...near[1], x: 4000 }];
  const apart = await showPlaces(scene, { ziele: far });
  expect(apart.gezeigt).toEqual(["Kreuzkirche"]);
  expect(apart.hinweis).toBeDefined();
  const first = await showPlaces(scene, { ziele: near, alle: false });
  expect(first.gezeigt).toEqual(["Kreuzkirche"]);
  const street = await showPlaces(scene, { ziele: near, aus_der_luft: false });
  expect(street.gezeigt).toEqual(["Kreuzkirche"]);
  expect(shown.at(-1)?.mode).toBe("walk");
  expect(shown.slice(0, 3).every((v) => v.mode === "fly")).toBe(true);
});

test("zeige leaves out places off the city, refuses when none is on it, and waits for the scene", async () => {
  const place = { name: "Kreuzkirche", x: 0, y: 0, z: 110, h: 90, r: 30 };
  const off = { ...place, name: "Weit weg", x: 51, y: 13 };
  const inside = { ...STUB, within: (x: number) => x === 0 };
  const outside = await showPlaces(inside, { ziele: [off] });
  expect(outside.ausserhalb).toBe(true);
  const left = await showPlaces(inside, { ziele: [off, place] });
  expect(left.gezeigt).toEqual(["Kreuzkirche"]);
  const loading = { ...STUB, show: () => false };
  const waits = await showPlaces(loading, { ziele: [place] });
  expect(waits.ok).toBe(false);
  const unborn = {
    ...STUB,
    frameView: async () => await Promise.resolve(null),
  };
  const none = await showPlaces(unborn, { ziele: [place] });
  expect(none.ok).toBe(false);
});

test("zeige takes the eye over the places' ground and shows eight at most", async () => {
  const grounds: (number | undefined)[] = [];
  let shown = 0;
  const scene = {
    ...STUB,
    show: (v: ViewpointGeometry, ground?: number) => {
      grounds.push(ground);
      shown = v.aboveGround;
      return true;
    },
  };
  const place = { name: "Kirche", x: 0, y: 0, z: 140, h: 40, r: 20 };
  await showPlaces(scene, { ziele: [place] });
  expect(grounds).toEqual([140]);
  expect(shown).toBeGreaterThan(0);
  // a place whose ground nobody knew: the glide measures it
  await showPlaces(scene, { ziele: [{ ...place, z: undefined }] });
  expect(grounds[1]).toBeUndefined();
  const many = Array.from({ length: 12 }, (_, i) => ({
    ...place,
    name: `Ort ${i}`,
    x: i * 20,
  }));
  const eight = await showPlaces(scene, { ziele: many });
  expect(eight.gezeigt).toHaveLength(8);
});

test("what an answer shows is selected: all of them, or the answer alone", async () => {
  const selected: (readonly { x: number; y: number }[])[] = [];
  const scene = {
    ...STUB,
    select: (p: readonly { x: number; y: number }[]) => selected.push(p),
  };
  const ziele = [
    { name: "A", x: 0, y: 0 },
    { name: "B", x: 60, y: 0 },
    { name: "C", x: 5000, y: 0 },
  ];
  await showPlaces(scene, { ziele: ziele.slice(0, 2) });
  await showPlaces(scene, { ziele, alle: false });
  // spread too far for one view: still every place selected
  await showPlaces(scene, { ziele });
  await showPlaces(scene, { ziele: ziele.slice(0, 2), aus_der_luft: false });
  expect(selected.map((s) => s.length)).toEqual([2, 1, 3, 2]);
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
