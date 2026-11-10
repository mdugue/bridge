/**
 * One answer turn (`answerTurn`, ADR 0056) against scripted adapters and
 * an in-memory Stadtwissen: the refusals in their order, the scripted
 * round trip through a scene tool, and how a run ends — scrubbed, capped,
 * late, cancelled.
 */
import { EventType, uiMessagesToWire } from "@tanstack/ai";
import type { AnyTextAdapter, StreamChunk, UIMessage } from "@tanstack/ai";
import { fakeText } from "@tanstack/ai/testing";
import { describe, expect, test } from "bun:test";
import { ASK_LIMITS } from "./ask-city";
import { knowledgeOf } from "./ask-knowledge";
import type { AskPromptSite } from "./ask-prompt";
import { answerTurn } from "./ask-run";
import type { TurnDeps } from "./ask-run";
import type { StadtwissenIndex, WissenTile } from "./stadtwissen";

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
const TILE: WissenTile = { tile: "t", monuments: [], buildings: [] };
const SITE: AskPromptSite = {
  epsg: 25_833,
  label: "Dresden",
  layers: [],
};
const KNOWLEDGE = knowledgeOf(INDEX, [TILE]);

const KEY = "sk-ant-api03-0123456789abcdefghij";
const PROPS = {
  site: "dresden",
  provider: "anthropic",
  model: "claude-haiku-5-5",
  token: "",
};

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

/** A turn's dependencies, recording what the turn asked of them. */
function host(adapters: AnyTextAdapter[], over: Partial<TurnDeps> = {}) {
  const asked = { adapters: 0, knowledge: 0 };
  const logged: string[] = [];
  const deps: TurnDeps = {
    adapterFor: () => {
      asked.adapters += 1;
      const next = adapters.shift();
      if (!next) {
        throw new Error("no adapter left");
      }
      return next;
    },
    knowledgeFor: async (id) => {
      asked.knowledge += 1;
      return await Promise.resolve(
        id === "dresden" ? { site: SITE, knowledge: KNOWLEDGE } : null
      );
    },
    secret: undefined,
    production: false,
    scripted: false,
    now: Date.now,
    deadlineMs: 60_000,
    log: (line) => {
      logged.push(line);
    },
    ...over,
  };
  return { asked, deps, logged };
}

async function turn(
  deps: TurnDeps,
  sent: unknown,
  { key = KEY, signal = new AbortController().signal } = {}
): Promise<Response> {
  return await answerTurn({ body: sent, key, signal }, deps);
}

type Event = { type: string } & Record<string, unknown>;

function events(text: string): Event[] {
  return text
    .split("\n\n")
    .filter((block) => block.startsWith("data: "))
    .map((block) => JSON.parse(block.slice("data: ".length)) as Event);
}

/** The answer's body, read whole. */
async function answered(deps: TurnDeps, sent: unknown): Promise<string> {
  const res = await turn(deps, sent);
  return await res.text();
}

const errorsOf = (sent: Event[]) => sent.filter((e) => e.type === "RUN_ERROR");

/** `rounds` tool rounds since the question, each answered. */
function roundsSinceQuestion(rounds: number) {
  const rows: Record<string, unknown>[] = [
    { id: "q", role: "user", content: "Frauenkirche" },
  ];
  for (let i = 0; i < rounds; i += 1) {
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

/** The signal of a request the browser already dropped. */
function gone(): AbortSignal {
  const c = new AbortController();
  c.abort();
  return c.signal;
}

describe("a refused request", () => {
  const cases: {
    name: string;
    over?: Partial<TurnDeps>;
    sent: unknown;
    key?: string;
    signal?: () => AbortSignal;
    status: number;
    code: string;
    message: string;
    /** what the log line adds to the code, where the code says less */
    detail?: string;
    /** the check comes after the Stadtwissen is looked up */
    knows?: true;
  }[] = [
    {
      name: "a body that is not JSON",
      sent: undefined,
      status: 400,
      code: "bad-request",
      message: "Die Anfrage passt nicht zu diesem Server — lade die Seite neu.",
    },
    {
      name: "an unknown model",
      sent: body({ forwardedProps: { ...PROPS, model: "gpt-0" } }),
      status: 400,
      code: "bad-props",
      message: "Die Anfrage passt nicht zu diesem Server — lade die Seite neu.",
      detail: "unbekanntes Modell",
    },
    {
      name: "no key, no scripted model",
      sent: body(),
      key: "",
      status: 401,
      code: "no-key",
      message: "Der Schlüssel muss neu geprüft werden.",
    },
    {
      name: "a token the key check did not give",
      over: { secret: "s".repeat(32) },
      sent: body({ forwardedProps: { ...PROPS, token: "forged" } }),
      status: 401,
      code: "bad-token",
      message: "Der Schlüssel muss neu geprüft werden.",
    },
    {
      name: "one message too many",
      sent: body({
        messages: uiMessagesToWire(
          Array.from({ length: ASK_LIMITS.messages + 1 }, (_, i) =>
            question(`${i}`, "Hallo")
          )
        ),
      }),
      status: 413,
      code: "too-long",
      message: "Das Gespräch ist zu lang geworden.",
    },
    {
      name: "a question past its cap",
      sent: body({
        messages: uiMessagesToWire([question("1", "x".repeat(1201))]),
      }),
      status: 413,
      code: "question-too-long",
      message: "Die Frage ist zu lang (höchstens 1200 Zeichen).",
    },
    {
      name: "no question",
      sent: body({ messages: [] }),
      status: 400,
      code: "no-question",
      message: "Es kam keine Frage an.",
    },
    {
      name: "twelve tool rounds since the question",
      sent: body({ messages: roundsSinceQuestion(12) }),
      status: 422,
      code: "too-many-steps",
      message: "Die Antwort brauchte zu viele Schritte. Frag bitte anders.",
    },
    {
      name: "a site without Stadtwissen",
      sent: body({ forwardedProps: { ...PROPS, site: "atlantis" } }),
      status: 404,
      code: "no-knowledge",
      message: "Für diese Stadt gibt es kein Stadtwissen.",
      knows: true,
    },
    {
      name: "a request the browser already dropped",
      sent: body(),
      signal: gone,
      status: 499,
      code: "gone",
      message: "Die Anfrage wurde abgebrochen.",
      knows: true,
    },
    {
      name: "a production server without a secret",
      over: { production: true },
      sent: body(),
      status: 501,
      code: "no-secret",
      message: "Frag die Stadt ist auf diesem Server nicht eingerichtet.",
    },
  ];

  test.each(cases)(
    "$name: $status $code",
    async ({
      over,
      sent,
      key,
      signal,
      status,
      code,
      message,
      detail,
      knows,
    }) => {
      const { asked, deps, logged } = host([fakeText()], over);
      const res = await turn(deps, sent, {
        key: key ?? KEY,
        signal: signal?.() ?? new AbortController().signal,
      });
      expect(res.status).toBe(status);
      expect(res.headers.get("Cache-Control")).toBe("no-store");
      const text = await res.text();
      expect(JSON.parse(text)).toEqual({ code, message });
      expect(logged).toEqual([
        `[frag] ${status} ${code}${detail ? ` ${detail}` : ""}`,
      ]);
      expect(text).not.toContain(KEY);
      // a refused request builds no model, and checks before the
      // Stadtwissen's do not look it up
      expect(asked.adapters).toBe(0);
      expect(asked.knowledge).toBe(knows ? 1 : 0);
    }
  );

  test("the caps count the rows as sent, before stand-ins are added", async () => {
    // 40 rows, one of them a stopped call mending would answer: the
    // stand-in is not counted, so the request passes the caps
    const rows: Record<string, unknown>[] = [
      { id: "q0", role: "user", content: "Was ist das?" },
      {
        id: "a0",
        role: "assistant",
        toolCalls: [
          {
            id: "s",
            type: "function",
            function: { name: "was_ist_da", arguments: "{}" },
          },
        ],
      },
      ...Array.from({ length: 38 }, (_, i) => ({
        id: `u${i}`,
        role: "user",
        content: "Und?",
      })),
    ];
    const model = fakeText();
    model.setResponses([{ text: "Gut." }]);
    const { deps, logged } = host([model]);
    const res = await turn(deps, body({ messages: rows }));
    expect(res.status).toBe(200);
    await res.text();
    expect(logged).toEqual([]);
  });
});

/** The assistant message the client keeps for a refusal's RUN_ERROR. */
const refused = (id: string): UIMessage => ({
  id,
  role: "assistant",
  parts: [],
  metadata: { tanstack: { stopReason: "error" } },
});

test("an answer a refusal left empty is neither counted nor sent to the provider", async () => {
  // 20 questions refused (the client keeps an empty assistant message for
  // each refusal's RUN_ERROR) and a 21st: 41 rows as the client sends them
  const ui = Array.from({ length: 20 }, (_, i) => [
    question(`q${i}`, "Frauenkirche"),
    refused(`a${i}`),
  ]).flat();
  ui.push(question("q20", "Und jetzt?"));
  const seen: string[][] = [];
  const model = fakeText();
  model.setResponses([
    ({ request }) => {
      seen.push(request.messages.map((m) => m.role));
      return { text: "Gut." };
    },
  ]);
  const { deps, logged } = host([model]);
  const res = await turn(deps, body({ messages: uiMessagesToWire(ui) }));
  expect(res.status).toBe(200);
  await res.text();
  expect(logged).toEqual([]);
  expect(seen).toEqual([Array.from({ length: 21 }, () => "user")]);
});

test("a scripted answer shows the place, then says so on the resume", async () => {
  const first = fakeText();
  first.setResponses([
    {
      toolCalls: [{ name: "suche_stadt", input: { anfrage: "Frauenkirche" } }],
    },
    ({ request }) => {
      // the search's hit is in what the model reads next
      expect(JSON.stringify(request.messages)).toContain("Q157229");
      return {
        toolCalls: [
          {
            name: "zeige",
            input: {
              ziele: [{ name: "Frauenkirche", x: 411_803, y: 5_656_355 }],
            },
          },
        ],
      };
    },
  ]);
  const resumed = fakeText();
  resumed.setResponses([
    { text: "Testantwort: Hier ist es (Quelle: Wikidata)." },
  ]);
  const { deps, logged } = host([first, resumed]);

  const one = await turn(deps, body());
  expect(one.headers.get("Content-Type")).toContain("text/event-stream");
  expect(one.headers.get("Cache-Control")).toBe("no-store");
  const oneText = await one.text();
  const sent = events(oneText);
  expect(
    sent.filter((e) => e.type === "TOOL_CALL_START").map((e) => e.toolCallName)
  ).toEqual(["suche_stadt", "zeige"]);
  expect(sent.some((e) => e.type === "TOOL_CALL_RESULT")).toBe(true);
  expect(errorsOf(sent)).toEqual([]);
  const last = sent.at(-1) as {
    outcome?: { interrupts?: { id: string }[]; type?: string };
    type: string;
  };
  expect(last.type).toBe("RUN_FINISHED");
  expect(last.outcome?.type).toBe("interrupt");

  const snapshot = sent.findLast((e) => e.type === "MESSAGES_SNAPSHOT");
  const two = await turn(
    deps,
    body({
      parentRunId: "r1",
      messages: snapshot?.messages,
      resume: [
        {
          interruptId: last.outcome?.interrupts?.[0]?.id ?? "",
          status: "resolved",
          payload: { ok: true },
        },
      ],
    })
  );
  const twoText = await two.text();
  const words = events(twoText)
    .filter((e) => e.type === "TEXT_MESSAGE_CONTENT")
    .map((e) => String(e.delta))
    .join("");
  expect(words.startsWith("Testantwort: Hier ist es")).toBe(true);
  expect(errorsOf(events(twoText))).toEqual([]);
  expect(oneText + twoText).not.toContain(KEY);
  expect(logged).toEqual([]);
});

describe("how a run ends", () => {
  test("a provider's error reaches the browser scrubbed of the key, its code kept", async () => {
    const provider = fakeText();
    // a provider that refuses the key, quoting it
    async function* refusing(): AsyncIterable<StreamChunk> {
      yield await Promise.resolve({
        type: EventType.RUN_ERROR,
        timestamp: 0,
        message: `invalid x-api-key ${KEY}`,
        code: "401",
      } as StreamChunk);
    }
    const adapter = Object.assign(provider, { chatStream: refusing });
    const { deps, logged } = host([adapter]);
    const text = await answered(deps, body());
    expect(text).not.toContain(KEY);
    const errors = errorsOf(events(text));
    expect(errors).toHaveLength(1);
    expect(errors[0]?.code).toBe("401");
    expect(String(errors[0]?.message)).toContain("invalid x-api-key");
    expect(logged.join("\n")).not.toContain(KEY);
  });

  test("the answer's last turn spent on a server tool ends on the cap", async () => {
    const model = fakeText();
    model.setResponses([
      { toolCalls: [{ name: "suche_stadt", input: { anfrage: "a" } }] },
      { toolCalls: [{ name: "suche_stadt", input: { anfrage: "b" } }] },
    ]);
    const { deps } = host([model]);
    const text = await answered(
      deps,
      body({ messages: roundsSinceQuestion(11) })
    );
    const errors = errorsOf(events(text));
    expect(errors.map((e) => [e.code, e.message])).toEqual([
      [
        "too-many-steps",
        "Die Antwort brauchte zu viele Schritte. Frag bitte anders.",
      ],
    ]);
    expect(model.state.callCount).toBe(1);
  });

  test("the deadline ends a slow answer with its own words only", async () => {
    const slow = fakeText({ tokensPerSecond: 20 });
    slow.setResponses([{ text: "Langsam. ".repeat(60) }]);
    const { deps } = host([slow], { deadlineMs: 50 });
    const text = await answered(deps, body());
    const errors = errorsOf(events(text));
    expect(errors.map((e) => [e.code, e.message])).toEqual([
      ["too-late", "Die Antwort dauerte zu lange."],
    ]);
  });

  test("a cancelled response stops the model", async () => {
    // the run's signal, as the provider's request would get it
    let run: AbortSignal | undefined;
    const model = fakeText({ tokensPerSecond: 100 });
    model.setResponses([
      ({ request }) => {
        run = request.request?.signal ?? undefined;
        return {
          text: "Ich suche. ".repeat(4),
          toolCalls: [{ name: "suche_stadt", input: { anfrage: "x" } }],
        };
      },
      { text: "Gefunden." },
    ]);
    const { deps } = host([model]);
    const res = await turn(deps, body());
    const reader = res.body?.getReader();
    await reader?.read();
    await reader?.read();
    expect(run?.aborted).toBe(false);
    await reader?.cancel();
    expect(run?.aborted).toBe(true);
    // the model is not asked again
    await Bun.sleep(300);
    expect(model.state.callCount).toBe(1);
  });

  test("a stopped call before the question reaches the model answered", async () => {
    const model = fakeText();
    model.setResponses([
      ({ request }) => {
        const stood = request.messages.find(
          (m) => m.role === "tool" && m.toolCallId === "s"
        );
        expect(JSON.stringify(stood?.content)).toContain("Abgebrochen");
        return { text: "Hier." };
      },
    ]);
    const { deps } = host([model]);
    const rows = [
      { id: "1", role: "user", content: "Was ist das?" },
      {
        id: "2",
        role: "assistant",
        toolCalls: [
          {
            id: "s",
            type: "function",
            function: { name: "was_ist_da", arguments: "{}" },
          },
        ],
      },
      { id: "3", role: "user", content: "Und das?" },
    ];
    const text = await answered(deps, body({ messages: rows }));
    expect(errorsOf(events(text))).toEqual([]);
    expect(model.state.callCount).toBe(1);
  });
});
