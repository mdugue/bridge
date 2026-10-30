import { describe, expect, test } from "bun:test";
import { fakeText } from "@tanstack/ai/testing";
import type { AskPromptSite } from "./ask-city";
import { knowledgeOf } from "./ask-knowledge";
import type { StreamChunk } from "@tanstack/ai";
import { runAsk, scrubbed } from "./ask-run";
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
  floods: [],
  id: "dresden",
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
              input: {
                ziele: [
                  { name: "Frauenkirche", x: 411_803, y: 5_656_355, h: 94 },
                ],
              },
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
            "hochwasser_betroffen",
            "in_der_naehe",
            "plane_baukoerper",
            "quellen",
            "schattenwurf",
            "setze_stil",
            "setze_zeit",
            "suche_stadt",
            "vorschlaege",
            "was_ist_da",
            "wo_bin_ich",
            "zeige",
            "zeige_hochwasser",
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
