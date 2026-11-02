/**
 * POST /api/frag — one answer of *Frag die Stadt* (ADR 0056), streamed as
 * server-sent events. Stateless: the browser sends the conversation, its
 * key in the `x-frag-key` header, where the visitor stands in the model
 * in `x-frag-ort` and the token the key check gave it; this relays the
 * turn to the visitor's provider with the fixed prompt and tools
 * (lib/city/ask-run.ts), runs the Stadtwissen tools and `wo_bin_ich`
 * itself, acknowledges the view's and leaves only `was_ist_da` to the
 * browser. The key goes to the provider and nowhere else; an error the
 * provider sends back is scrubbed of it. Neither the pose nor anything
 * else of the request is kept or logged.
 */
import {
  chatParamsFromRequestBody,
  toServerSentEventsResponse,
} from "@tanstack/ai";
import {
  ASK_KEY_HEADER,
  ASK_VISITOR_HEADER,
  askPromptSite,
  askReasoning,
  conversationProblem,
  lastQuestion,
  parseAskProps,
  parseAskVisitor,
} from "@/lib/city/ask-city";
import { runAsk, scrubbed } from "@/lib/city/ask-run";
import { siteById } from "@/sites";
import { askAdapter, fakeAskAdapter } from "./adapters";
import { keyRefusal, refuse } from "./guard";
import { siteKnowledge } from "./knowledge";

export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  const fake = process.env.FRAG_FAKE === "1";
  const key = request.headers.get(ASK_KEY_HEADER)?.trim() ?? "";
  let params: Awaited<ReturnType<typeof chatParamsFromRequestBody>>;
  try {
    params = await chatParamsFromRequestBody(await request.json());
  } catch {
    return refuse(400, "bad-request", "Die Anfrage ist unvollständig.");
  }
  const props = parseAskProps(params.forwardedProps);
  if (typeof props === "string") {
    return refuse(400, "bad-props", props);
  }
  const refused = await keyRefusal(props, key, fake);
  if (refused) {
    return refused;
  }
  const problem = conversationProblem(
    params.messages,
    lastQuestion(params.messages)
  );
  if (problem) {
    return refuse(413, "too-long", problem);
  }
  const site = siteById(props.site);
  const knowledge = site ? await siteKnowledge(site.id) : null;
  if (!(site && knowledge)) {
    return refuse(
      404,
      "no-knowledge",
      "Für diese Stadt gibt es kein Stadtwissen."
    );
  }
  const abortController = new AbortController();
  request.signal.addEventListener("abort", () => abortController.abort());
  const stream = runAsk({
    adapter: fake
      ? fakeAskAdapter()
      : askAdapter(props.provider, props.model, key),
    abortController,
    knowledge,
    messages: params.messages,
    reasoning: askReasoning(props.provider, props.model),
    ...(params.resume ? { resume: params.resume } : {}),
    ...(params.parentRunId ? { parentRunId: params.parentRunId } : {}),
    site: askPromptSite(site),
    runId: params.runId,
    threadId: params.threadId,
    today: new Date(),
    visitor: parseAskVisitor(request.headers.get(ASK_VISITOR_HEADER)),
    voice: props.voice,
  });
  return toServerSentEventsResponse(scrubbed(stream, key), {
    abortController,
    headers: { "Cache-Control": "no-store" },
  });
}
