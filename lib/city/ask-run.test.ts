import {
  EventType,
  chatParamsFromRequestBody,
  convertMessagesToModelMessages,
  uiMessagesToWire,
} from "@tanstack/ai";
import type { UIMessage, ModelMessage, StreamChunk } from "@tanstack/ai";
import { describe, expect, test } from "bun:test";
import { fakeText } from "@tanstack/ai/testing";
import type { AskPromptSite } from "./ask-city";
import { knowledgeOf } from "./ask-knowledge";
import {
  DEADLINE,
  ended,
  roundsSinceQuestion,
  runAsk,
  withStoppedCallsAnswered,
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
  layerKeys: ["tramLayer"],
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
  test("runs the Stadtwissen tools and acknowledges the view's: one request, no browser round trip", async () => {
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
          text: "Die Frauenkirche steht am Neumarkt.",
          toolCalls: [
            {
              name: "zeige",
              input: {
                ziele: [
                  { name: "Frauenkirche", x: 411_803, y: 5_656_355, h: 94 },
                ],
              },
            },
            { name: "vorschlaege", input: { fragen: ["Wer baute sie?"] } },
          ],
        };
      },
      { text: "nie gefragt" },
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
    // the flight and the chips need no third turn
    expect(adapter.state.callCount).toBe(2);
    const results = chunks.filter((c) => c.type === "TOOL_CALL_RESULT");
    // every call answered on the server: none waits on the browser
    expect(results).toHaveLength(3);
    expect(JSON.stringify(results)).toContain("gezeigt");
  });

  test("an answer of chips and a flight without words goes on until it has its text", async () => {
    const adapter = fakeText();
    adapter.setResponses([
      {
        toolCalls: [
          {
            name: "zeige",
            input: { ziele: [{ name: "Frauenkirche", x: 1, y: 2 }] },
          },
          { name: "vorschlaege", input: { fragen: ["Wer baute sie?"] } },
        ],
      },
      { text: "Das ist die Frauenkirche." },
      { text: "nie gefragt" },
    ]);
    await collect(
      runAsk({
        adapter,
        knowledge: knowledgeOf(INDEX, [TILE]),
        messages: [{ role: "user", content: "Zeig mir die Frauenkirche" }],
        site: SITE,
        threadId: "t4",
        today: new Date(2026, 9, 29),
      })
    );
    expect(adapter.state.callCount).toBe(2);
  });

  test("words before a lookup are not the answer: a later turn of chips alone goes on", async () => {
    const adapter = fakeText();
    adapter.setResponses([
      {
        text: "Ich schaue nach.",
        toolCalls: [
          { name: "suche_stadt", input: { anfrage: "Frauenkirche" } },
        ],
      },
      {
        toolCalls: [
          { name: "vorschlaege", input: { fragen: ["Wer baute sie?"] } },
        ],
      },
      { text: "George Bähr baute sie." },
    ]);
    await collect(
      runAsk({
        adapter,
        knowledge: knowledgeOf(INDEX, [TILE]),
        messages: [{ role: "user", content: "Wer baute die Frauenkirche?" }],
        site: SITE,
        threadId: "t5",
        today: new Date(2026, 9, 29),
      })
    );
    expect(adapter.state.callCount).toBe(3);
  });

  test("where the visitor stands comes with the request: here needs no question to the browser", async () => {
    const adapter = fakeText();
    adapter.setResponses([
      {
        toolCalls: [
          { name: "wo_bin_ich", input: {} },
          { name: "in_der_naehe", input: { radius: 50 } },
        ],
      },
      ({ request }) => {
        const seen = JSON.stringify(request.messages);
        // the pose, and the neighbourhood round it
        expect(seen).toContain("blick_grad");
        expect(seen).toContain("um_den_besucher");
        expect(seen).toContain("Frauenkirche");
        return { text: "Vor dir steht die Frauenkirche." };
      },
    ]);
    const chunks = await collect(
      runAsk({
        adapter,
        knowledge: knowledgeOf(INDEX, [TILE]),
        messages: [{ role: "user", content: "Was steht hier?" }],
        site: SITE,
        threadId: "t6",
        today: new Date(2026, 9, 29),
        visitor: { x: 411_790, y: 5_656_340, blick_grad: 45 },
      })
    );
    expect(adapter.state.callCount).toBe(2);
    expect(chunks.map((c) => c.type)).not.toContain("RUN_ERROR");
  });

  test("only was_ist_da waits on the browser", async () => {
    const adapter = fakeText();
    adapter.setResponses([
      { toolCalls: [{ name: "was_ist_da", input: {} }] },
      { text: "nie gefragt" },
    ]);
    const chunks = await collect(
      runAsk({
        adapter,
        knowledge: knowledgeOf(INDEX, [TILE]),
        messages: [{ role: "user", content: "Was ist das da vorne?" }],
        site: SITE,
        threadId: "t7",
        today: new Date(2026, 9, 29),
      })
    );
    expect(adapter.state.callCount).toBe(1);
    expect(chunks.map((c) => c.type)).not.toContain("TOOL_CALL_RESULT");
  });

  test("a fast model is asked not to think", async () => {
    const adapter = fakeText();
    adapter.setResponses([
      ({ request }) => {
        expect(request.reasoning?.level).toBe("off");
        expect(request.reasoning?.summary).toBe(false);
        return { text: "Hallo." };
      },
    ]);
    await collect(
      runAsk({
        adapter,
        knowledge: knowledgeOf(INDEX, [TILE]),
        messages: [{ role: "user", content: "Hallo" }],
        reasoning: "off",
        site: SITE,
        threadId: "t8",
        today: new Date(2026, 9, 29),
      })
    );
    expect(adapter.state.callCount).toBe(1);
  });

  test("an answer ends at its follow-ups, without a turn to acknowledge them", async () => {
    const adapter = fakeText();
    adapter.setResponses([
      {
        text: "Die Frauenkirche.",
        toolCalls: [
          { name: "vorschlaege", input: { fragen: ["Wer baute sie?"] } },
        ],
      },
      { text: "nie gefragt" },
    ]);
    const chunks = await collect(
      runAsk({
        adapter,
        knowledge: knowledgeOf(INDEX, [TILE]),
        messages: [{ role: "user", content: "Was ist das?" }],
        site: SITE,
        threadId: "t3",
        today: new Date(2026, 9, 29),
      })
    );
    expect(adapter.state.callCount).toBe(1);
    expect(chunks.map((c) => c.type)).toContain("TOOL_CALL_RESULT");
    // and the end is no turn cap: the visitor sees no error
    async function* again() {
      yield* chunks as unknown as StreamChunk[];
    }
    const closed = await collect(ended(again(), new AbortController().signal));
    expect(closed.map((c) => c.type)).not.toContain("RUN_ERROR");
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
            "vorschlaege",
            "was_ist_da",
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
    yield {
      type: EventType.RUN_STARTED,
      runId: "r",
      threadId: "t",
    };
    yield {
      type: EventType.RUN_ERROR,
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

const turnCall = (id: string, name: string) => ({
  type: "tool-call" as const,
  id,
  name,
  arguments: "{}",
  state: "input-complete" as const,
});

test("an answer's turns count across resumed requests, not its calls", () => {
  const messages = [
    {
      id: "1",
      role: "user" as const,
      parts: [{ type: "text" as const, content: "Alt" }],
    },
    { id: "2", role: "assistant" as const, parts: [turnCall("o", "zeige")] },
    {
      id: "3",
      role: "user" as const,
      parts: [{ type: "text" as const, content: "Neu" }],
    },
    {
      id: "4",
      role: "assistant" as const,
      parts: [
        turnCall("a", "suche_stadt"),
        turnCall("b", "fakten"),
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
        { ...turnCall("c", "zeige"), output: { ok: true } },
      ],
    },
  ];
  // two parallel calls are one turn, the zeige after their results another
  expect(roundsSinceQuestion(messages as never)).toBe(2);
  expect(roundsSinceQuestion([])).toBe(0);
});

const EVENT_TYPES = new Map<string, EventType>(
  Object.values(EventType).map((v) => [v, v])
);
const eventType = (name: string): EventType => {
  const found = EVENT_TYPES.get(name);
  if (!found) {
    throw new Error(`unknown event type ${name}`);
  }
  return found;
};
const chunk = (type: string) =>
  ({
    type: eventType(type),
    timestamp: 0,
    toolCallId: "t1",
  }) as StreamChunk;
async function* of(...types: string[]) {
  for (const t of types) {
    yield chunk(t);
  }
}
const types = async (stream: AsyncIterable<StreamChunk>) => {
  const out: string[] = [];
  for await (const c of stream) {
    out.push(
      c.type === EventType.RUN_ERROR ? `RUN_ERROR:${c.message}` : c.type
    );
  }
  return out;
};
const finished = (finishReason: string) =>
  ({
    ...chunk("RUN_FINISHED"),
    metadata: { tanstack: { finishReason } },
  }) as StreamChunk;
async function* list(...chunks: StreamChunk[]) {
  yield* chunks;
}
async function* interrupt() {
  yield chunk("TOOL_CALL_RESULT");
  yield {
    ...chunk("RUN_FINISHED"),
    outcome: { type: "interrupt", interrupts: [] },
    metadata: { tanstack: { finishReason: "tool_calls" } },
  } as StreamChunk;
}
async function* round() {
  yield chunk("RUN_STARTED");
  yield {
    ...chunk("RUN_FINISHED"),
    finishReason: "tool_calls",
  } as StreamChunk;
  yield chunk("TOOL_CALL_RESULT");
}
async function* whole() {
  yield chunk("RUN_STARTED");
  yield {
    ...chunk("RUN_FINISHED"),
    metadata: { tanstack: { finishReason: "stop" } },
  } as StreamChunk;
}

describe("an answer that stops says why", () => {
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

  test("a cut round that only shows ends an answer with words, not one without", async () => {
    const show = { ...chunk("TOOL_CALL_START"), toolCallName: "zeige" };
    const words = { ...chunk("TEXT_MESSAGE_CONTENT"), delta: "Dort." };
    const said = await endedTypes(
      words as StreamChunk,
      show,
      chunk("TOOL_CALL_RESULT")
    );
    expect(said.join(" ")).not.toContain("RUN_ERROR");
    const mute = await endedTypes(show, chunk("TOOL_CALL_RESULT"));
    expect(mute.at(-1)).toContain("zu viele Schritte");
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

  test("a filtered or failed answer says it broke off", async () => {
    const out = await types(
      ended(list(finished("content_filter")), new AbortController().signal)
    );
    expect(out.at(-1)).toContain("brach die Antwort ab");
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
    const out = await types(ended(round(), c.signal));
    expect(out.at(-1)).toBe("RUN_ERROR:Die Antwort dauerte zu lange.");
  });

  test("a run that finished before the deadline stays whole", async () => {
    const c = new AbortController();
    c.abort(DEADLINE);
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

/** The chunk types `ended` passes on from `chunks`. */
const endedTypes = async (...chunks: StreamChunk[]) =>
  await types(ended(list(...chunks), new AbortController().signal));

const stoppedCall = (id: string, output?: unknown) => ({
  type: "tool-call" as const,
  id,
  name: "was_ist_da",
  arguments: "{}",
  state: "input-complete" as const,
  ...(output === undefined ? {} : { output }),
});
const textPart = (content: string) => ({ type: "text" as const, content });

test("a stopped answer's tool call gets a stand-in result, the running answer's calls stay open", async () => {
  const ui = [
    { id: "1", role: "user" as const, parts: [textPart("Was ist das?")] },
    // stopped while was_ist_da waited: no output
    { id: "2", role: "assistant" as const, parts: [stoppedCall("s")] },
    { id: "3", role: "user" as const, parts: [textPart("Und das?")] },
    {
      id: "4",
      role: "assistant" as const,
      parts: [
        textPart("Moment."),
        stoppedCall("x", { gefunden: true }),
        stoppedCall("r"),
      ],
    },
  ] as UIMessage[];
  // the way the request reaches the route: the client's wire rows, read
  // back by the server
  const params = await chatParamsFromRequestBody({
    threadId: "t",
    runId: "r",
    messages: uiMessagesToWire(ui),
    tools: [],
    context: [],
    state: {},
    forwardedProps: {},
  });
  const model = convertMessagesToModelMessages(
    withStoppedCallsAnswered(params.messages)
  );
  // every call before the last question has its result right after its
  // answer, the stopped one a stand-in
  const answer = (id: string) =>
    model.find((m) => m.role === "tool" && m.toolCallId === id);
  expect(model.map((m) => m.role)).toEqual([
    "user",
    "assistant",
    "tool",
    "user",
    "assistant",
    "tool",
  ]);
  expect(model[2]?.toolCallId).toBe("s");
  expect(answer("s")?.content).toContain("Abgebrochen");
  // after the last question the open call stays: a resume answers it
  expect(answer("r")).toBeUndefined();
});

test("a stand-in keeps a stopped answer's thinking and segments together and mends cut-off arguments", async () => {
  const ui = [
    {
      id: "1",
      role: "user",
      parts: [{ type: "text", content: "Was ist das?" }],
    },
    {
      id: "2",
      role: "assistant",
      parts: [
        { type: "thinking", content: "hm" },
        { type: "text", content: "Ich schaue." },
        {
          type: "tool-call",
          id: "a",
          name: "suche_stadt",
          arguments: '{"anfrage":"x"}',
          state: "complete",
          output: { ok: true },
        },
        { type: "thinking", content: "weiter" },
        { type: "text", content: "Moment." },
        // stopped while its arguments still streamed
        {
          type: "tool-call",
          id: "s",
          name: "suche_stadt",
          arguments: '{"anfrage":"Fra',
          state: "input-streaming",
        },
      ],
    },
    { id: "3", role: "user", parts: [{ type: "text", content: "Und das?" }] },
  ] as UIMessage[];
  const params = await chatParamsFromRequestBody({
    threadId: "t",
    runId: "r",
    messages: uiMessagesToWire(ui),
    tools: [],
    context: [],
    state: {},
    forwardedProps: {},
  });
  const model = convertMessagesToModelMessages(
    withStoppedCallsAnswered(params.messages)
  );
  expect(model.map((m) => m.role)).toEqual([
    "user",
    "assistant",
    "tool",
    "tool",
    "user",
  ]);
  // one joined row: both segments, both thoughts, both calls
  expect(model[1]?.thinking).toHaveLength(2);
  expect(model[1]?.toolCalls?.map((c) => [c.id, c.function.arguments])).toEqual(
    [
      ["a", '{"anfrage":"x"}'],
      ["s", "{}"],
    ]
  );
  expect(model.slice(2, 4).map((m) => m.toolCallId)).toEqual(["a", "s"]);
});

const searchCall = (id: string, args: string) => ({
  id,
  type: "function" as const,
  function: { name: "suche_stadt", arguments: args },
});
const argumentsOf = (m: ModelMessage | undefined) =>
  m?.toolCalls?.map((c) => c.function.arguments);

test("cut-off arguments are mended in every row, answered or not", () => {
  const rows: ModelMessage[] = [
    { role: "user", content: "Wo?" },
    {
      role: "assistant",
      content: null,
      toolCalls: [
        searchCall("a", '{"anfrage":"Fra'),
        searchCall("b", "null"),
        searchCall("c", "[]"),
        searchCall("d", ""),
        searchCall("e", '{"anfrage":"x"}'),
      ],
    },
    // the output cap ended the run with a failed result for each
    ...["a", "b", "c", "d", "e"].map((id): ModelMessage => ({
      role: "tool",
      toolCallId: id,
      content: "{}",
    })),
    { role: "user", content: "Und?" },
    { role: "assistant", content: null, toolCalls: [searchCall("f", '{"anf')] },
  ];
  const out = withStoppedCallsAnswered(rows);
  expect(argumentsOf(out[1])).toEqual([
    "{}",
    "{}",
    "{}",
    "{}",
    '{"anfrage":"x"}',
  ]);
  // all answered: no stand-in, the rows as they were
  expect(out).toHaveLength(rows.length);
  // the running answer's too: a resume never finishes them
  expect(argumentsOf(out.at(-1))).toEqual(["{}"]);
});

const zeigeCall = (id: string) => ({
  id,
  type: "function" as const,
  function: { name: "zeige", arguments: "{}" },
});

test("a result counts only within its own answer", () => {
  const rows: ModelMessage[] = [
    { role: "user", content: "Zeig!" },
    // stopped: the provider numbers calls afresh in every answer
    { role: "assistant", content: null, toolCalls: [zeigeCall("call_0")] },
    { role: "user", content: "Nochmal." },
    { role: "assistant", content: null, toolCalls: [zeigeCall("call_0")] },
    { role: "tool", toolCallId: "call_0", content: "{}" },
    { role: "user", content: "Danke." },
  ];
  const out = withStoppedCallsAnswered(rows);
  expect(out.map((m) => m.role)).toEqual([
    "user",
    "assistant",
    "tool",
    "user",
    "assistant",
    "tool",
    "user",
  ]);
});
