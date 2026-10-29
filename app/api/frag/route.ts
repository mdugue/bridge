/**
 * POST /api/frag — one answer of *Frag die Stadt* (ADR 0056), streamed as
 * server-sent events. Stateless: the browser sends the conversation, its
 * key in the `x-frag-key` header and the token the key check gave it;
 * this relays the turn to the visitor's provider with the fixed prompt
 * and tools (lib/city/ask-run.ts), runs the Stadtwissen tools itself and
 * leaves the scene's to the browser. The key goes to the provider and
 * nowhere else; an error the provider sends back is scrubbed of it.
 */
import {
  chatParamsFromRequestBody,
  toServerSentEventsResponse,
} from "@tanstack/ai";
import {
  ASK_KEY_HEADER,
  conversationProblem,
  askPromptSite,
  lastQuestion,
  parseAskProps,
  plausibleKey,
} from "@/lib/city/ask-city";
import { runAsk, scrubbed } from "@/lib/city/ask-run";
import { verifyAskToken } from "@/lib/city/ask-token";
import { siteById } from "@/sites";
import { askAdapter, fakeAskAdapter } from "./adapters";
import { siteKnowledge } from "./knowledge";

export const maxDuration = 60;

const refuse = (status: number, message: string) =>
  Response.json(
    { message },
    { status, headers: { "Cache-Control": "no-store" } }
  );

export async function POST(request: Request): Promise<Response> {
  const fake = process.env.FRAG_FAKE === "1";
  const key = request.headers.get(ASK_KEY_HEADER)?.trim() ?? "";
  let params: Awaited<ReturnType<typeof chatParamsFromRequestBody>>;
  try {
    params = await chatParamsFromRequestBody(await request.json());
  } catch {
    return refuse(400, "Die Anfrage ist unvollständig.");
  }
  const props = parseAskProps(params.forwardedProps);
  if (typeof props === "string") {
    return refuse(400, props);
  }
  if (!fake && !plausibleKey(key)) {
    return refuse(401, "Ohne Schlüssel geht es nicht.");
  }
  const secret = process.env.FRAG_SECRET;
  // on the host the key check must hold: without its secret, no relay
  if (!(fake || secret) && process.env.VERCEL) {
    return refuse(503, "Frag die Stadt ist hier nicht eingerichtet.");
  }
  if (
    !fake &&
    secret &&
    !(await verifyAskToken(
      secret,
      props.token,
      props.provider,
      key,
      Date.now()
    ))
  ) {
    return refuse(401, "Der Schlüssel muss neu geprüft werden.");
  }
  const problem = conversationProblem(
    params.messages,
    lastQuestion(params.messages)
  );
  if (problem) {
    return refuse(413, problem);
  }
  const site = siteById(props.site);
  const knowledge = site ? await siteKnowledge(site.id) : null;
  if (!(site && knowledge)) {
    return refuse(404, "Für diese Stadt gibt es kein Stadtwissen.");
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
    ...(params.resume ? { resume: params.resume } : {}),
    ...(params.parentRunId ? { parentRunId: params.parentRunId } : {}),
    site: askPromptSite(site),
    runId: params.runId,
    threadId: params.threadId,
    today: new Date(),
  });
  return toServerSentEventsResponse(scrubbed(stream, key), {
    abortController,
    headers: { "Cache-Control": "no-store" },
  });
}
