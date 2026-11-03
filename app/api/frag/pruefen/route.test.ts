import { afterAll, beforeAll, expect, mock, test } from "bun:test";
import { knowledgeOf } from "@/lib/city/ask-knowledge";
import type { QaCase } from "@/lib/city/ask-qa";
import type { StadtwissenIndex, WissenTile } from "@/lib/city/stadtwissen";

const INDEX: StadtwissenIndex = {
  epsg: 25_833,
  site: "dresden",
  sources: {},
  tiles: [{ id: "t", file: "t.json" }],
  landmarks: [
    {
      id: "Q157229",
      name: "Frauenkirche",
      tile: "t",
      x: 411_803,
      y: 5_656_355,
      z: 113,
      h: 94,
      links: 48,
      objects: [],
      facts: { label: "Frauenkirche", claims: {} },
    },
  ],
};
const TILE: WissenTile = { tile: "t", monuments: [], buildings: [] };

// the twin as a fixture: the build's copy is not here in a unit run
await mock.module("../knowledge", () => ({
  siteKnowledge: async (site: string) =>
    site === "dresden" ? knowledgeOf(INDEX, [TILE]) : null,
}));

const { POST } = await import("./route");

const post = (body: unknown) =>
  POST(
    new Request("http://localhost/api/frag/pruefen", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );

beforeAll(() => {
  process.env.FRAG_FAKE = "1";
});
afterAll(() => {
  delete process.env.FRAG_FAKE;
});

test("plans the cases, asks one with the scripted model and judges it", async () => {
  const plan = (await (
    await post({ art: "plan", site: "dresden", orte: 2 })
  ).json()) as { faelle: QaCase[] };
  expect(plan.faelle.length).toBeGreaterThan(4);
  // the scripted model asks the view for a question "vor mir"
  const c = plan.faelle.find((f) => f.question.includes("vor mir"));
  expect(c).toBeDefined();
  const res = await post({
    art: "fall",
    site: "dresden",
    provider: "anthropic",
    model: "claude-haiku-5-5",
    token: "",
    fall: c,
  });
  expect(res.status).toBe(200);
  const { antwort } = (await res.json()) as {
    antwort: { calls: { name: string }[]; text: string };
  };
  // was_ist_da answered on the server: the answer goes on to its text
  expect(antwort.calls.map((x) => x.name)).toContain("was_ist_da");
  expect(antwort.text).toContain("Testantwort");
  // the verdict in a request of its own
  const judged = await post({
    art: "urteil",
    site: "dresden",
    provider: "anthropic",
    model: "claude-opus-5-5",
    token: "",
    fall: c,
    antwort,
  });
  const { urteil } = (await judged.json()) as { urteil: { urteil: string } };
  expect(urteil.urteil).toBe("behalten");
});

test("refuses a model the provider does not offer, a broken case or answer", async () => {
  const base = {
    art: "fall",
    site: "dresden",
    provider: "anthropic",
    model: "claude-haiku-5-5",
    token: "",
  };
  expect((await post({ ...base, model: "gpt-6-luna" })).status).toBe(400);
  expect((await post({ ...base, fall: { id: "x" } })).status).toBe(400);
  const plan = (await (
    await post({ art: "plan", site: "dresden", orte: 1 })
  ).json()) as { faelle: QaCase[] };
  expect(
    (
      await post({
        ...base,
        art: "urteil",
        fall: plan.faelle[0],
        antwort: { text: "x".repeat(9000), calls: [] },
      })
    ).status
  ).toBe(400);
  expect((await post({ art: "plan", site: "atlantis" })).status).toBe(404);
});
