import { describe, expect, test } from "bun:test";
import {
  ASK_LIMITS,
  ASK_PROVIDERS,
  askReasoning,
  askSystemPrompt,
  askVisitorHeader,
  conversationProblem,
  isAskModel,
  lastQuestion,
  maskedKey,
  parseAskProps,
  parseAskVisitor,
  plausibleKey,
  providerForKey,
} from "./ask-city";

describe("providers", () => {
  test("a key's prefix names its provider, the longest prefix first", () => {
    expect(providerForKey("sk-ant-api03-abc")).toBe("anthropic");
    expect(providerForKey("sk-or-v1-abc")).toBe("openrouter");
    expect(providerForKey("sk-proj-abc")).toBe("openai");
    expect(providerForKey("vck_abc")).toBe("gateway");
    expect(providerForKey("AIzaSyA-abc")).toBe("google");
    expect(providerForKey("  sk-ant-x ")).toBe("anthropic");
    expect(providerForKey("hello")).toBeNull();
  });

  test("every provider has models and its first is the default", () => {
    for (const p of ASK_PROVIDERS) {
      expect(p.models.length).toBeGreaterThan(0);
      expect(isAskModel(p.id, p.models[0].id)).toBe(true);
      expect(p.check.url.startsWith("https://")).toBe(true);
    }
    expect(isAskModel("openai", "claude-haiku-5-5")).toBe(false);
  });

  test("a gateway offers every maker's models under its maker's name", () => {
    const direct = ASK_PROVIDERS.filter((p) => !p.id.match(/gateway|router/));
    for (const p of ASK_PROVIDERS.filter((q) => !direct.includes(q))) {
      expect(p.models.map((m) => m.label)).toEqual(
        direct.flatMap((d) => d.models.map((m) => m.label))
      );
      for (const m of p.models) {
        expect(m.id.startsWith(`${m.maker.toLowerCase()}/`)).toBe(true);
      }
    }
    expect(isAskModel("gateway", "anthropic/claude-sonnet-5.5")).toBe(true);
    expect(isAskModel("openrouter", "google/gemini-4-argon")).toBe(true);
  });

  test("only a plausible key goes anywhere", () => {
    expect(plausibleKey("sk-ant-api03-0123456789abcdef")).toBe(true);
    expect(plausibleKey("short")).toBe(false);
    expect(plausibleKey("sk-ant-api03-0123456789\nX-Evil: 1")).toBe(false);
    expect(plausibleKey("ein ganzer Satz mit Leerzeichen drin")).toBe(false);
  });

  test("a masked key shows its ends only", () => {
    expect(maskedKey("sk-ant-api03-0123456789abcdef")).toBe("sk-ant-…cdef");
    expect(maskedKey("short")).toBe("•••");
  });
});

describe("requests", () => {
  test("the props name a curated model of a known provider", () => {
    expect(
      parseAskProps({
        provider: "anthropic",
        model: "claude-haiku-5-5",
        site: "dresden",
        token: "v1.1.x",
      })
    ).toEqual({
      provider: "anthropic",
      model: "claude-haiku-5-5",
      site: "dresden",
      token: "v1.1.x",
      voice: false,
    });
    expect(
      typeof parseAskProps({ provider: "anthropic", model: "claude-opus-9" })
    ).toBe("string");
    expect(typeof parseAskProps({ provider: "x", model: "y" })).toBe("string");
    expect(
      typeof parseAskProps({
        provider: "openai",
        model: "gpt-5.5",
        site: "../etc",
      })
    ).toBe("string");
  });

  test("the last question is the last user message's text, in either shape", () => {
    expect(
      lastQuestion([
        { role: "user", content: "eins" },
        { role: "assistant", content: "a" },
        { role: "user", parts: [{ type: "text", content: "zwei" }] },
      ])
    ).toBe("zwei");
    expect(lastQuestion([{ role: "assistant", content: "a" }])).toBe("");
  });

  test("a conversation keeps to the caps", () => {
    const one = [{ role: "user", content: "Hallo" }];
    expect(conversationProblem(one, "Hallo")).toBeNull();
    expect(conversationProblem([], "")).not.toBeNull();
    const many = Array.from({ length: ASK_LIMITS.messages + 1 }, () => one[0]);
    expect(conversationProblem(many, "Hallo")).not.toBeNull();
    const long = "x".repeat(ASK_LIMITS.questionChars + 1);
    expect(
      conversationProblem([{ role: "user", content: long }], long)
    ).toContain("zu lang");
    const huge = [
      { role: "user", content: "y".repeat(ASK_LIMITS.conversationChars) },
    ];
    expect(conversationProblem(huge, "kurz")).not.toBeNull();
  });
});

test("the prompt names the site, the date and the rules", () => {
  const prompt = askSystemPrompt(
    {
      epsg: 25_833,
      floods: [],
      id: "dresden",
      label: "Dresden",
      layers: [],
      layerKeys: [],
      styles: ["pastel (Pastell)"],
    },
    new Date(2026, 9, 31, 12)
  );
  expect(prompt).toContain("Dresden");
  expect(prompt).toContain("EPSG:25833");
  expect(prompt).toContain("31. Oktober 2026");
  expect(prompt).toContain("keine Datenebenen");
  expect(prompt).toContain("Legenden als Legenden");
});

describe("the visitor header", () => {
  test("carries the pose there and back, rounded, and nothing else", () => {
    const raw = askVisitorHeader({
      x: 411_803.4,
      y: 5_656_354.6,
      blick_grad: 271.6,
      modus: "walk",
      zeit: "Samstag, 31. Oktober 2026 um 12:00",
      stil: "pastel",
      ebenen: ["trees", "<script>"],
      fremd: "nie",
    });
    expect(raw).not.toBeNull();
    // a header value: no line break, nothing but URI characters
    expect(raw).toMatch(/^[\x21-\x7e]+$/);
    expect(parseAskVisitor(raw)).toEqual({
      x: 411_803,
      y: 5_656_355,
      blick_grad: 272,
      modus: "walk",
      zeit: "Samstag, 31. Oktober 2026 um 12:00",
      stil: "pastel",
      ebenen: ["trees"],
    });
  });

  test("without a position, or anything else, there is no visitor", () => {
    expect(askVisitorHeader({ fehler: "Die Szene lädt noch." })).toBeNull();
    expect(parseAskVisitor(null)).toBeNull();
    expect(parseAskVisitor("%7B")).toBeNull();
    expect(parseAskVisitor(encodeURIComponent('{"x":"1","y":2}'))).toBeNull();
    expect(parseAskVisitor("x".repeat(2000))).toBeNull();
    const line = encodeURIComponent(
      JSON.stringify({ x: 1, y: 2, modus: "a\nb" })
    );
    expect(parseAskVisitor(line)).toEqual({ x: 1, y: 2 });
  });
});

test("a fast model answers without thinking, the others think a little", () => {
  for (const p of ASK_PROVIDERS) {
    for (const m of p.models) {
      expect(askReasoning(p.id, m.id)).toBe(
        m.hint === "schnell" ? "off" : "low"
      );
    }
  }
});
