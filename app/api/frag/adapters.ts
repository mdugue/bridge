/**
 * The text adapter for a request of *Frag die Stadt* (ADR 0056): the
 * provider the visitor chose, the curated model, the visitor's key. Built
 * per request and dropped with it; nothing keeps the key.
 */
import type { AnyTextAdapter } from "@tanstack/ai";
import { fakeText } from "@tanstack/ai/testing";
import type { FakeResponseStep } from "@tanstack/ai/testing";
import { createAnthropicChat } from "@tanstack/ai-anthropic";
import { createGeminiChat } from "@tanstack/ai-gemini";
import { createOpenaiChat } from "@tanstack/ai-openai";
import { openaiCompatibleText } from "@tanstack/ai-openai/compatible";
import { createOpenRouterText } from "@tanstack/ai-openrouter";
import { lastQuestion } from "@/lib/city/ask-city";
import type { AskProviderId } from "@/lib/city/ask-city";

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
    case "anthropic": {
      return createAnthropicChat(model as ModelId, key, CLIENT);
    }
    case "openai": {
      return createOpenaiChat(model as OpenAiModel, key, CLIENT);
    }
    case "google": {
      return createGeminiChat(model as GeminiModel, key, {
        httpOptions: {
          timeout: CLIENT.timeout,
          // the original and one retry, as the other providers
          retryOptions: { attempts: CLIENT.maxRetries + 1 },
        },
      });
    }
    case "openrouter": {
      return createOpenRouterText(model as OpenRouterModel, key, {
        timeoutMs: CLIENT.timeout,
        retryConfig: { strategy: "none" },
      });
    }
    case "gateway": {
      return openaiCompatibleText(model, {
        name: "vercel-ai-gateway",
        baseURL: "https://ai-gateway.vercel.sh/v1",
        apiKey: key,
        ...CLIENT,
      });
    }
    default: {
      throw new Error(`unknown provider: ${String(provider)}`);
    }
  }
}

/** One scripted turn of the fake model. */
const fakeStep: FakeResponseStep = ({ request }) => {
  const { messages } = request;
  const last = messages.at(-1);
  if (last?.role !== "tool") {
    const question = lastQuestion(messages);
    if (/was ist (?:das|da)|vor mir/iu.test(question)) {
      return { toolCalls: [{ name: "was_ist_da", input: {} }] };
    }
    return {
      toolCalls: [{ name: "suche_stadt", input: { anfrage: question } }],
    };
  }
  const result =
    typeof last.content === "string"
      ? last.content
      : JSON.stringify(last.content);
  const hits = [
    ...result.matchAll(
      /"name":"(?<name>[^"]+)","x":(?<x>\d+),"y":(?<y>\d+)(?:,"z":(?<z>\d+))?/gu
    ),
  ].slice(0, 3);
  if (result.includes("treffer") && hits.length > 0) {
    return {
      toolCalls: [
        {
          name: "zeige",
          input: {
            ziele: hits.map((h) => ({
              name: h.groups?.name,
              x: Number(h.groups?.x),
              y: Number(h.groups?.y),
            })),
            alle: false,
          },
        },
      ],
    };
  }
  const seen = /"name":"(?<seen>[^"]+)"/u.exec(result)?.groups?.seen;
  const found = result.includes('"gefunden":true');
  return {
    text: `Testantwort: Hier ist es${seen && found ? `, ${seen}` : ""} (Quelle: Wikidata).`,
    toolCalls: [
      {
        name: "vorschlaege",
        input: { fragen: ["Wer hat es gebaut?", "Was steht daneben?"] },
      },
    ],
  };
};

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
  adapter.setResponses([fakeStep, fakeStep, fakeStep]);
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
