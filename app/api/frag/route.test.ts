/**
 * POST /api/frag as the host calls it (ADR 0056): every refusal with its
 * status, code and log line, and one scripted answer (`FRAG_FAKE=1`)
 * through both requests of a scene tool's round trip. Only the
 * Stadtwissen's file read is replaced.
 */
import { uiMessagesToWire } from "@tanstack/ai";
import type { UIMessage } from "@tanstack/ai";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";
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

async function post(
  sent: unknown,
  { key = KEY, signal }: { key?: string; signal?: AbortSignal } = {}
): Promise<Response> {
  return await POST(
    new Request("http://localhost/api/frag", {
      method: "POST",
      body: typeof sent === "string" ? sent : JSON.stringify(sent),
      headers: { "Content-Type": "application/json", "x-frag-key": key },
      ...(signal ? { signal } : {}),
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

/** Twelve tool rounds since the question: the answer's turns are spent. */
function spentHistory() {
  const rows: Record<string, unknown>[] = [
    { id: "q", role: "user", content: "Frauenkirche" },
  ];
  for (let i = 0; i < 12; i += 1) {
    rows.push(
      {
        id: `a${i}`,
        role: "assistant",
        toolCalls: [
          {
            id: `c${i}`,
            type: "function",
            function: { name: "suche_stadt", arguments: '{"anfrage":"x"}' },
          },
        ],
      },
      { id: `t${i}`, role: "tool", toolCallId: `c${i}`, content: "{}" }
    );
  }
  return rows;
}

describe("a refused request", () => {
  const cases: {
    name: string;
    setup?: () => void;
    request: () => Promise<Response>;
    status: number;
    code: string;
    message: string;
  }[] = [
    {
      name: "a body that is not JSON",
      request: async () => await post("{not json"),
      status: 400,
      code: "bad-request",
      message: "Die Anfrage ist unvollständig.",
    },
    {
      name: "an unknown model",
      request: async () =>
        await post(body({ forwardedProps: { ...PROPS, model: "gpt-0" } })),
      status: 400,
      code: "bad-props",
      message: "unbekanntes Modell",
    },
    {
      name: "no key, no scripted model",
      request: async () => await post(body(), { key: "" }),
      status: 401,
      code: "no-key",
      message: "Ohne Schlüssel geht es nicht.",
    },
    {
      name: "a token the key check did not give",
      setup: () => {
        process.env.FRAG_SECRET = "s".repeat(32);
      },
      request: async () =>
        await post(body({ forwardedProps: { ...PROPS, token: "forged" } })),
      status: 401,
      code: "bad-token",
      message: "Der Schlüssel muss neu geprüft werden.",
    },
    {
      name: "41 messages",
      setup: () => {
        process.env.FRAG_FAKE = "1";
      },
      request: async () =>
        await post(
          body({
            messages: uiMessagesToWire(
              Array.from({ length: 41 }, (_, i) => question(`${i}`, "Hallo"))
            ),
          })
        ),
      status: 413,
      code: "too-long",
      message: "Das Gespräch ist zu lang geworden. Bitte neu beginnen.",
    },
    {
      name: "twelve tool rounds since the question",
      setup: () => {
        process.env.FRAG_FAKE = "1";
      },
      request: async () => await post(body({ messages: spentHistory() })),
      status: 422,
      code: "too-many-steps",
      message: "Die Antwort brauchte zu viele Schritte.",
    },
    {
      name: "a site without Stadtwissen",
      setup: () => {
        process.env.FRAG_FAKE = "1";
      },
      request: async () =>
        await post(body({ forwardedProps: { ...PROPS, site: "atlantis" } })),
      status: 404,
      code: "no-knowledge",
      message: "Für diese Stadt gibt es kein Stadtwissen.",
    },
    {
      name: "a request the browser already dropped",
      setup: () => {
        process.env.FRAG_FAKE = "1";
      },
      request: async () => {
        const gone = new AbortController();
        gone.abort();
        return await post(body(), { signal: gone.signal });
      },
      status: 499,
      code: "gone",
      message: "Die Anfrage wurde abgebrochen.",
    },
    {
      name: "a production server without a secret",
      setup: () => {
        Object.assign(process.env, { NODE_ENV: "production" });
      },
      request: async () => await post(body()),
      status: 501,
      code: "no-secret",
      message: "Frag die Stadt ist auf diesem Server nicht eingerichtet.",
    },
  ];

  for (const c of cases) {
    test(`${c.name}: ${c.status} ${c.code}`, async () => {
      c.setup?.();
      const res = await c.request();
      expect(res.status).toBe(c.status);
      expect(res.headers.get("Cache-Control")).toBe("no-store");
      const text = await res.text();
      expect(JSON.parse(text)).toEqual({ code: c.code, message: c.message });
      expect(logged).toEqual([`[frag] ${c.status} ${c.code}`]);
      expect(text).not.toContain(KEY);
    });
  }
});

test("the scripted answer shows the place, then says so on the resume", async () => {
  process.env.FRAG_FAKE = "1";
  const first = await post(body());
  expect(first.headers.get("Content-Type")).toContain("text/event-stream");
  expect(first.headers.get("Cache-Control")).toBe("no-store");
  const firstText = await first.text();
  const sent = events(firstText);
  const calls = sent
    .filter((e) => e.type === "TOOL_CALL_START")
    .map((e) => e.toolCallName);
  expect(calls).toEqual(["suche_stadt", "zeige"]);
  expect(sent.some((e) => e.type === "TOOL_CALL_RESULT")).toBe(true);
  expect(sent.some((e) => e.type === "RUN_ERROR")).toBe(false);
  const last = sent.at(-1) as {
    outcome?: { interrupts?: { id: string }[]; type?: string };
    type: string;
  };
  expect(last.type).toBe("RUN_FINISHED");
  expect(last.outcome?.type).toBe("interrupt");

  // the browser ran zeige and resumes the run with its result
  const snapshot = sent.findLast((e) => e.type === "MESSAGES_SNAPSHOT");
  const interrupt = last.outcome?.interrupts?.[0]?.id ?? "";
  const second = await post(
    body({
      parentRunId: "r1",
      messages: snapshot?.messages,
      resume: [
        { interruptId: interrupt, status: "resolved", payload: { ok: true } },
      ],
    })
  );
  const secondText = await second.text();
  const words = events(secondText)
    .filter((e) => e.type === "TEXT_MESSAGE_CONTENT")
    .map((e) => String(e.delta))
    .join("");
  expect(words.startsWith("Testantwort: Hier ist es")).toBe(true);
  expect(events(secondText).some((e) => e.type === "RUN_ERROR")).toBe(false);
  expect(firstText + secondText).not.toContain(KEY);
  expect(logged).toEqual([]);
});
