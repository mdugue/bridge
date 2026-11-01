/**
 * The text adapter for a request of *Frag die Stadt* (ADR 0056): the
 * provider the visitor chose, the curated model, the visitor's key. Built
 * per request and dropped with it; nothing keeps the key.
 */
import type { AnyTextAdapter } from "@tanstack/ai";
import { type FakeResponseStep, fakeText } from "@tanstack/ai/testing";
import { createAnthropicChat } from "@tanstack/ai-anthropic";
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
 * deployment): it searches for the question, shows the first hit and
 * says so — the whole round trip through both kinds of tools, with no
 * key and no provider.
 */
export function fakeAskAdapter(): AnyTextAdapter {
  const adapter = fakeText({ model: "fake" });
  const step: FakeResponseStep = ({ request }) => {
    const messages = request.messages;
    const last = messages.at(-1);
    if (last?.role !== "tool") {
      const question = lastQuestion(messages);
      return {
        toolCalls: [{ name: "suche_stadt", input: { anfrage: question } }],
      };
    }
    const result =
      typeof last.content === "string"
        ? last.content
        : JSON.stringify(last.content);
    const hit = /"name":"([^"]+)","x":(\d+),"y":(\d+)(?:,"z":(\d+))?/.exec(
      result
    );
    if (result.includes("treffer") && hit) {
      return {
        toolCalls: [
          {
            name: "zeige",
            input: {
              x: Number(hit[2]),
              y: Number(hit[3]),
            },
          },
        ],
      };
    }
    return { text: "Testantwort: Hier ist es (Quelle: Wikidata)." };
  };
  adapter.setResponses([step, step, step]);
  return adapter;
}
