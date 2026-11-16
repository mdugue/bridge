/**
 * POST /api/frag as the host calls it (ADR 0056): what the route binds to
 * the turn (lib/city/ask-turn.test.ts holds the turn's own rules) — the
 * environment's secret and NODE_ENV, and the scripted model
 * (`FRAG_FAKE=1`) through both requests of a scene tool's round trip.
 * Only the Stadtwissen's file read is replaced.
 */
import { uiMessagesToWire } from "@tanstack/ai";
import type { UIMessage } from "@tanstack/ai";
import { afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { knowledgeOf } from "@/lib/city/ask-knowledge";
import type { StadtwissenIndex, WissenTile } from "@/lib/city/stadtwissen";

const INDEX: StadtwissenIndex = {
  epsg: 25_833,
  site: "dresden",
  sources: {
    wikidata: { label: "Wikidata", credit: "CC0", licence: "CC0" },
  },
  tiles: [{ id: "t", file: "stadtwissen_t.json" }],
  landmarks: [
    {
      id: "Q157229",
      name: "Frauenkirche",
      tile: "t",
      // whole metres: the scripted model reads them back as integers
      x: 411_803,
      y: 5_656_355,
      z: 113.9,
      h: 94.2,
      links: 48,
      objects: ["a"],
      facts: {
        label: "Frauenkirche",
        description: "Kirche in Dresden",
        claims: { P84: [{ v: "George Bähr" }] },
        wiki: "Frauenkirche Dresden",
      },
    },
  ],
};
const TILE: WissenTile = {
  tile: "t",
  monuments: [],
  buildings: [
    {
      id: "a",
      name: "Frauenkirche",
      wd: "Q157229",
      x: 411_803,
      y: 5_656_355,
      z: 113.9,
    },
  ],
};

void mock.module("./knowledge", () => ({
  siteKnowledge: async () => await Promise.resolve(knowledgeOf(INDEX, [TILE])),
}));
const { POST } = await import("./route");

const KEY = "sk-ant-api03-0123456789abcdefghij";
const PROPS = {
  site: "dresden",
  provider: "anthropic",
  model: "claude-haiku-5-5",
  token: "",
};
const ENV = ["FRAG_FAKE", "FRAG_SECRET", "VERCEL", "NODE_ENV"] as const;

const question = (id: string, content: string): UIMessage => ({
  id,
  role: "user",
  parts: [{ type: "text", content }],
});

function body(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    threadId: "t",
    runId: "r1",
    messages: uiMessagesToWire([question("1", "Frauenkirche")]),
    tools: [],
    context: [],
    state: {},
    forwardedProps: PROPS,
    ...over,
  };
}

async function post(sent: unknown): Promise<Response> {
  return await POST(
    new Request("http://localhost/api/frag", {
      method: "POST",
      body: JSON.stringify(sent),
      headers: { "Content-Type": "application/json", "x-frag-key": KEY },
    })
  );
}

type Event = { type: string } & Record<string, unknown>;

function events(text: string): Event[] {
  return text
    .split("\n\n")
    .filter((block) => block.startsWith("data: "))
    .map((block) => JSON.parse(block.slice("data: ".length)) as Event);
}

let saved: Record<string, string | undefined> = {};
let warn: ReturnType<typeof spyOn<Console, "warn">>;
/** the lines this test logged */
const logged: string[] = [];

beforeEach(() => {
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  delete process.env.FRAG_FAKE;
  delete process.env.FRAG_SECRET;
  delete process.env.VERCEL;
  logged.length = 0;
  warn = spyOn(console, "warn").mockImplementation((...line: unknown[]) => {
    logged.push(line.map(String).join(" "));
  });
});

afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) {
      Reflect.deleteProperty(process.env, k);
    } else {
      Object.assign(process.env, { [k]: saved[k] });
    }
  }
  warn.mockRestore();
});

test("a production server without a secret refuses: 501 no-secret", async () => {
  Object.assign(process.env, { NODE_ENV: "production" });
  const res = await post(body());
  expect(res.status).toBe(501);
  expect(res.headers.get("Cache-Control")).toBe("no-store");
  expect(await res.json()).toEqual({
    code: "no-secret",
    message: "Frag die Stadt ist auf diesem Server nicht eingerichtet.",
  });
  expect(logged).toEqual(["[frag] 501 no-secret"]);
});

test("the scripted answer searches, shows and says so in one request", async () => {
  process.env.FRAG_FAKE = "1";
  const res = await post(body());
  expect(res.headers.get("Content-Type")).toContain("text/event-stream");
  expect(res.headers.get("Cache-Control")).toBe("no-store");
  const text = await res.text();
  const sent = events(text);
  // zeige is acknowledged on the server: no round trip through the browser
  expect(
    sent.filter((e) => e.type === "TOOL_CALL_START").map((e) => e.toolCallName)
  ).toEqual(["suche_stadt", "zeige", "vorschlaege"]);
  expect(sent.some((e) => e.type === "RUN_ERROR")).toBe(false);
  // the answer ends at its chips' result: nothing waits on the browser
  expect(
    sent.some(
      (e) => (e.outcome as { type?: string } | undefined)?.type === "interrupt"
    )
  ).toBe(false);
  const words = sent
    .filter((e) => e.type === "TEXT_MESSAGE_CONTENT")
    .map((e) => String(e.delta))
    .join("");
  expect(words.startsWith("Testantwort: Hier ist es")).toBe(true);
  expect(text).not.toContain(KEY);
  expect(logged).toEqual([]);
});

test("the scripted answer asks the browser what is ahead, then says so on the resume", async () => {
  process.env.FRAG_FAKE = "1";
  const ahead = uiMessagesToWire([question("1", "Was ist das da vorne?")]);
  const first = await post(body({ messages: ahead }));
  const firstText = await first.text();
  const sent = events(firstText);
  expect(
    sent.filter((e) => e.type === "TOOL_CALL_START").map((e) => e.toolCallName)
  ).toEqual(["was_ist_da"]);
  const last = sent.at(-1) as {
    outcome?: { interrupts?: { id: string }[]; type?: string };
    type: string;
  };
  expect(last.type).toBe("RUN_FINISHED");
  expect(last.outcome?.type).toBe("interrupt");

  // the browser looked and resumes the run with its result
  const snapshot = sent.findLast((e) => e.type === "MESSAGES_SNAPSHOT");
  const interrupt = last.outcome?.interrupts?.[0]?.id ?? "";
  const second = await post(
    body({
      parentRunId: "r1",
      messages: snapshot?.messages,
      resume: [
        {
          interruptId: interrupt,
          status: "resolved",
          payload: { gefunden: true, name: "Frauenkirche" },
        },
      ],
    })
  );
  const secondText = await second.text();
  const words = events(secondText)
    .filter((e) => e.type === "TEXT_MESSAGE_CONTENT")
    .map((e) => String(e.delta))
    .join("");
  expect(words).toContain("Frauenkirche");
  expect(events(secondText).some((e) => e.type === "RUN_ERROR")).toBe(false);
  expect(firstText + secondText).not.toContain(KEY);
  expect(logged).toEqual([]);
});
