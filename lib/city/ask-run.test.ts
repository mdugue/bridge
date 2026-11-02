import { describe, expect, test } from "bun:test";
import { fakeText } from "@tanstack/ai/testing";
import type { AskPromptSite } from "./ask-city";
import { knowledgeOf } from "./ask-knowledge";
import type { StreamChunk } from "@tanstack/ai";
import {
  DEADLINE,
  ended,
  roundsSinceQuestion,
  runAsk,
  scrubbed,
} from "./ask-run";
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
      x: 411_803.4,
      y: 5_656_354.6,
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
const SITE: AskPromptSite = {
  epsg: 25_833,
  label: "Dresden",
  layers: [],
  styles: ["pastel: Pastell"],
};

type Chunk = { type: string } & Record<string, unknown>;

async function collect(stream: AsyncIterable<unknown>): Promise<Chunk[]> {
  const chunks: Chunk[] = [];
  for await (const c of stream) {
    chunks.push(c as Chunk);
  }
  return chunks;
}

describe("runAsk", () => {
  test("runs the Stadtwissen tools itself and hands the scene's to the browser", async () => {
    const adapter = fakeText();
    adapter.setResponses([
      {
        toolCalls: [
          { name: "suche_stadt", input: { anfrage: "Frauenkirche" } },
        ],
      },
      ({ request }) => {
        // the search's result is in the conversation the model sees next
        const seen = JSON.stringify(request.messages);
        expect(seen).toContain("Q157229");
        return {
          toolCalls: [
            {
              name: "zeige",
              input: { x: 411_803, y: 5_656_355, h: 94 },
            },
          ],
        };
      },
    ]);
    const chunks = await collect(
      runAsk({
        adapter,
        knowledge: knowledgeOf(INDEX, [TILE]),
        messages: [{ role: "user", content: "Wo ist die Frauenkirche?" }],
        site: SITE,
        threadId: "t1",
        today: new Date(2026, 9, 29),
      })
    );
    const types = chunks.map((c) => c.type);
    expect(types).toContain("TOOL_CALL_START");
    // the loop stops at the browser's tool: no third model call
    expect(adapter.state.callCount).toBe(2);
    const names = chunks
      .filter((c) => c.type === "TOOL_CALL_START")
      .map((c) => c.toolCallName ?? c.toolName);
    expect(names).toEqual(["suche_stadt", "zeige"]);
  });

  test("the fixed prompt and tools reach the model, whatever the request", async () => {
    const adapter = fakeText();
    adapter.setResponses([
      ({ request }) => {
        const tools = (request.tools ?? [])
          .map((t: { name: string }) => t.name)
          .sort((a, b) => a.localeCompare(b));
        expect(tools).toEqual(
          [
            "datenschicht",
            "fakten",
            "in_der_naehe",
            "quellen",
            "setze_stil",
            "setze_zeit",
            "suche_stadt",
            "wo_bin_ich",
            "zeige",
          ].sort((a, b) => a.localeCompare(b))
        );
        expect(JSON.stringify(request.systemPrompts)).toContain(
          "Stadtführer im digitalen Stadtmodell von Dresden"
        );
        return { text: "Hallo." };
      },
    ]);
    await collect(
      runAsk({
        adapter,
        knowledge: knowledgeOf(INDEX, [TILE]),
        messages: [{ role: "user", content: "Hallo" }],
        site: SITE,
        threadId: "t2",
        today: new Date(2026, 9, 29),
      })
    );
    expect(adapter.state.callCount).toBe(1);
  });
});

describe("scrubbed", () => {
  const KEY = "sk-ant-api03-0123456789abcdef";
  async function* errors(): AsyncIterable<StreamChunk> {
    yield { type: "RUN_STARTED", runId: "r", threadId: "t" } as StreamChunk;
    yield {
      type: "RUN_ERROR",
      message: `invalid x-api-key ${KEY}`,
      code: "401",
      error: { message: KEY },
      rawEvent: { key: KEY },
    } as unknown as StreamChunk;
    throw new Error(`socket closed for ${KEY}`);
  }

  test("an error reaches the browser without the key or the provider's raw event", async () => {
    const out = await collect(scrubbed(errors(), KEY));
    const text = JSON.stringify(out);
    expect(text).not.toContain(KEY);
    expect(text).not.toContain("rawEvent");
    expect(out.map((c) => c.type)).toEqual([
      "RUN_STARTED",
      "RUN_ERROR",
      "RUN_ERROR",
    ]);
    expect(out[1].code).toBe("401");
  });
});

test("an answer's turns count across resumed requests, not its calls", () => {
  const call = (id: string, name: string) => ({
    type: "tool-call" as const,
    id,
    name,
    arguments: "{}",
    state: "input-complete" as const,
  });
  const messages = [
    {
      id: "1",
      role: "user" as const,
      parts: [{ type: "text" as const, content: "Alt" }],
    },
    { id: "2", role: "assistant" as const, parts: [call("o", "zeige")] },
    {
      id: "3",
      role: "user" as const,
      parts: [{ type: "text" as const, content: "Neu" }],
    },
    {
      id: "4",
      role: "assistant" as const,
      parts: [
        call("a", "suche_stadt"),
        call("b", "fakten"),
        {
          type: "tool-result" as const,
          toolCallId: "a",
          content: "{}",
          state: "complete" as const,
        },
        {
          type: "tool-result" as const,
          toolCallId: "b",
          content: "{}",
          state: "complete" as const,
        },
        { ...call("c", "zeige"), output: { ok: true } },
      ],
    },
  ];
  // two parallel calls are one turn, the zeige after their results another
  expect(roundsSinceQuestion(messages as never)).toBe(2);
  expect(roundsSinceQuestion([])).toBe(0);
});

describe("an answer that stops says why", () => {
  const chunk = (type: string) =>
    ({ type, timestamp: 0, toolCallId: "t1" }) as StreamChunk;
  async function* of(...types: string[]) {
    for (const t of types) {
      yield chunk(t);
    }
  }
  const types = async (stream: AsyncIterable<StreamChunk>) => {
    const out: string[] = [];
    for await (const c of stream) {
      out.push(
        c.type === "RUN_ERROR" ? `RUN_ERROR:${String(c.message)}` : c.type
      );
    }
    return out;
  };

  test("a run the turn cap ends after a server tool", async () => {
    const out = await types(
      ended(
        of(
          "RUN_STARTED",
          "TOOL_CALL_START",
          "RUN_FINISHED",
          "TOOL_CALL_RESULT"
        ),
        new AbortController().signal
      )
    );
    expect(out.at(-1)).toContain("zu viele Schritte");
  });

  const finished = (finishReason: string) =>
    ({
      ...chunk("RUN_FINISHED"),
      metadata: { tanstack: { finishReason } },
    }) as StreamChunk;
  async function* list(...chunks: StreamChunk[]) {
    yield* chunks;
  }

  test("a cut run that ends on its RUN_FINISHED after the results", async () => {
    const out = await types(
      ended(
        list(
          chunk("TOOL_CALL_START"),
          {
            ...chunk("TOOL_CALL_RESULT"),
            metadata: { tanstack: { state: "output-error" } },
          },
          finished("length")
        ),
        new AbortController().signal
      )
    );
    expect(out.at(-1)).toContain("zu viele Schritte");
  });

  test("a turn that spends its output before a word is cut, not capped", async () => {
    const out = await types(
      ended(
        list(chunk("TOOL_CALL_RESULT"), finished("length")),
        new AbortController().signal
      )
    );
    expect(out.at(-1)).toContain("abgeschnitten");
  });

  test("a refusal says so", async () => {
    const out = await types(
      ended(list(finished("content_filter")), new AbortController().signal)
    );
    expect(out.at(-1)).toContain("verweigert");
  });

  test("an answer the model's output cut mid-sentence says so", async () => {
    const out = await types(
      ended(
        list(chunk("TEXT_MESSAGE_CONTENT"), finished("length")),
        new AbortController().signal
      )
    );
    expect(out.at(-1)).toContain("abgeschnitten");
  });

  test("a resumed scene tool's result needs no new words", async () => {
    const out = await types(
      ended(
        list(chunk("TOOL_CALL_RESULT"), chunk("RUN_STARTED"), finished("stop")),
        new AbortController().signal
      )
    );
    expect(out.at(-1)).toBe("RUN_FINISHED");
  });

  test("a provider's error after a result keeps its own words", async () => {
    const error = { ...chunk("RUN_ERROR"), message: "401 invalid x-api-key" };
    const out = await types(
      ended(
        list(chunk("TOOL_CALL_RESULT"), error),
        new AbortController().signal
      )
    );
    expect(out.at(-1)).toBe("RUN_ERROR:401 invalid x-api-key");
  });

  test("a scene tool's interrupt is not a stop", async () => {
    async function* interrupt() {
      yield chunk("TOOL_CALL_RESULT");
      yield {
        ...chunk("RUN_FINISHED"),
        outcome: { type: "interrupt", interrupts: [] },
        metadata: { tanstack: { finishReason: "tool_calls" } },
      } as StreamChunk;
    }
    const out = await types(ended(interrupt(), new AbortController().signal));
    expect(out).toEqual(["TOOL_CALL_RESULT", "RUN_FINISHED"]);
  });

  test("an answered run ends as it is", async () => {
    const out = await types(
      ended(
        of("RUN_STARTED", "TEXT_MESSAGE_END", "RUN_FINISHED"),
        new AbortController().signal
      )
    );
    expect(out).toEqual(["RUN_STARTED", "TEXT_MESSAGE_END", "RUN_FINISHED"]);
  });

  test("the deadline after a tool round is still the deadline", async () => {
    const c = new AbortController();
    c.abort(DEADLINE);
    async function* round() {
      yield chunk("RUN_STARTED");
      yield {
        ...chunk("RUN_FINISHED"),
        finishReason: "tool_calls",
      } as StreamChunk;
      yield chunk("TOOL_CALL_RESULT");
    }
    const out = await types(ended(round(), c.signal));
    expect(out.at(-1)).toBe("RUN_ERROR:Die Antwort dauerte zu lange.");
  });

  test("a run that finished before the deadline stays whole", async () => {
    const c = new AbortController();
    c.abort(DEADLINE);
    async function* whole() {
      yield chunk("RUN_STARTED");
      yield {
        ...chunk("RUN_FINISHED"),
        metadata: { tanstack: { finishReason: "stop" } },
      } as StreamChunk;
    }
    const out = await types(ended(whole(), c.signal));
    expect(out).toEqual(["RUN_STARTED", "RUN_FINISHED"]);
  });

  test("the deadline's error replaces the abort's", async () => {
    const c = new AbortController();
    c.abort(DEADLINE);
    const out = await types(ended(of("RUN_STARTED", "RUN_ERROR"), c.signal));
    expect(out).toEqual([
      "RUN_STARTED",
      "RUN_ERROR:Die Antwort dauerte zu lange.",
    ]);
  });
});
