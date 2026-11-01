/**
 * The text adapter for a request of *Frag die Stadt* (ADR 0056): the
 * provider the visitor chose, the curated model, the visitor's key. Built
 * per request and dropped with it; nothing keeps the key.
 */
import type { AnyTextAdapter } from "@tanstack/ai";
import { type FakeResponseStep, fakeText } from "@tanstack/ai/testing";
import { createAnthropicChat } from "@tanstack/ai-anthropic";
import { createGeminiChat } from "@tanstack/ai-gemini";
import { createOpenaiChat } from "@tanstack/ai-openai";
import { openaiCompatibleText } from "@tanstack/ai-openai/compatible";
import { createOpenRouterText } from "@tanstack/ai-openrouter";
import { type AskProviderId, lastQuestion } from "@/lib/city/ask-city";

/** One retry of a failed call, and no answer waits longer than this. */
const CLIENT = { maxRetries: 1, timeout: 60_000 } as const;

// reason: the model ids are checked against the curated list
// (`parseAskProps`) before they get here; the factories' literal unions
// would only repeat that list.
type ModelId = Parameters<typeof createAnthropicChat>[0];
type OpenAiModel = Parameters<typeof createOpenaiChat>[0];
type OpenRouterModel = Parameters<typeof createOpenRouterText>[0];
type GeminiModel = Parameters<typeof createGeminiChat>[0];

export function askAdapter(
  provider: AskProviderId,
  model: string,
  key: string
): AnyTextAdapter {
  switch (provider) {
    case "anthropic":
      return createAnthropicChat(model as ModelId, key, CLIENT);
    case "openai":
      return createOpenaiChat(model as OpenAiModel, key, CLIENT);
    case "google":
      return createGeminiChat(model as GeminiModel, key, {
        httpOptions: {
          timeout: CLIENT.timeout,
          // the original and one retry, as the other providers
          retryOptions: { attempts: CLIENT.maxRetries + 1 },
        },
      });
    case "openrouter":
      return createOpenRouterText(model as OpenRouterModel, key, {
        timeoutMs: CLIENT.timeout,
        retryConfig: { strategy: "none" },
      });
    case "gateway":
      return openaiCompatibleText(model, {
        name: "vercel-ai-gateway",
        baseURL: "https://ai-gateway.vercel.sh/v1",
        apiKey: key,
        ...CLIENT,
      });
  }
}

/**
 * A scripted model for local tests only (`FRAG_FAKE=1`, never set on a
 * deployment): it searches for the question, shows the hits (the first
 * alone, the others as chips), says so and offers two follow-ups; asked
 * "was ist das", it asks the view's centre — the whole
 * round trip through both kinds of tools, with no
 * key and no provider.
 */
export function fakeAskAdapter(): AnyTextAdapter {
  const adapter = fakeText({ model: "fake" });
  const step: FakeResponseStep = ({ request }) => {
    const messages = request.messages;
    const last = messages.at(-1);
    if (last?.role !== "tool") {
      const question = lastQuestion(messages);
      if (/was ist (das|da)|vor mir/i.test(question)) {
        return { toolCalls: [{ name: "was_ist_da", input: {} }] };
      }
      if (/hochwasser/i.test(question)) {
        return {
          toolCalls: [
            { name: "hochwasser_betroffen", input: { ereignis: "2002" } },
          ],
        };
      }
      return {
        toolCalls: [{ name: "suche_stadt", input: { anfrage: question } }],
      };
    }
    const result =
      typeof last.content === "string"
        ? last.content
        : JSON.stringify(last.content);
    if (result.includes("gebaeude_unter_wasser")) {
      return {
        toolCalls: [{ name: "zeige_hochwasser", input: { ereignis: "2002" } }],
      };
    }
    if (result.includes("wasserspiegel_am_pegel")) {
      const n = /"pegel_cm":(\d+)/.exec(result)?.[1];
      return {
        text: `Testantwort: Wasserstand ${n ?? "?"} cm am Pegel — eine Modellrechnung, kein amtliches Ergebnis.`,
      };
    }
    const hits = [
      ...result.matchAll(/"name":"([^"]+)","x":(\d+),"y":(\d+)/g),
    ].slice(0, 3);
    if (result.includes("treffer") && hits.length > 0) {
      return {
        toolCalls: [
          {
            name: "zeige",
            input: {
              ziele: hits.map((h) => ({
                name: h[1],
                x: Number(h[2]),
                y: Number(h[3]),
              })),
              alle: false,
            },
          },
        ],
      };
    }
    const seen = /"name":"([^"]+)"/.exec(result)?.[1];
    return {
      text: `Testantwort: Hier ist es${seen && result.includes("gefunden") ? `, ${seen}` : ""} (Quelle: Wikidata).`,
      toolCalls: [
        {
          name: "vorschlaege",
          input: { fragen: ["Wer hat es gebaut?", "Was steht daneben?"] },
        },
      ],
    };
  };
  adapter.setResponses([step, step, step, step]);
  return adapter;
}

/** The Prüfstand's judge for local tests only (`FRAG_FAKE=1`): every
 *  answer kept, with a fixed reason. */
export function fakeJudgeAdapter(): AnyTextAdapter {
  const adapter = fakeText({ model: "fake" });
  adapter.setResponses([
    {
      text: JSON.stringify({
        ort_passt: 2,
        daten_reichen: 2,
        antwort: 1,
        erfunden: false,
        urteil: "behalten",
        vorschlag: "",
        begruendung: "Testurteil.",
      }),
    },
  ]);
  return adapter;
}
