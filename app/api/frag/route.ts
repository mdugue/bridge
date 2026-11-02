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
  type StreamChunk,
  toServerSentEventsResponse,
} from "@tanstack/ai";
import {
  ASK_KEY_HEADER,
  ASK_LIMITS,
  conversationProblem,
  askPromptSite,
  lastQuestion,
  parseAskProps,
  plausibleKey,
} from "@/lib/city/ask-city";
import { roundsSinceQuestion, runAsk, scrubbed } from "@/lib/city/ask-run";
import { verifyAskToken } from "@/lib/city/ask-token";
import { siteById } from "@/sites";
import { askAdapter, fakeAskAdapter } from "./adapters";
import { fakeModel } from "./env";
import { siteKnowledge } from "./knowledge";

/** Up to eight model calls with tool rounds between them: a careful
 *  model's answer can outlast a minute (Vercel's ceiling with fluid
 *  compute). */
export const maxDuration = 300;

/**
 * A refused request: its reason as a code in the log (never the key, the
 * token or the conversation) and as words for the visitor.
 */
function refuse(status: number, code: string, message: string): Response {
  console.warn(`[frag] ${status} ${code}`);
  return Response.json(
    { code, message },
    { status, headers: { "Cache-Control": "no-store" } }
  );
}

/** A conversation past the caps, or an answer with no turns left. */
function conversationRefusal(
  messages: Parameters<typeof roundsSinceQuestion>[0],
  turns: number
): Response | null {
  const problem = conversationProblem(messages, lastQuestion(messages));
  if (problem) {
    return refuse(413, "too-long", problem);
  }
  if (turns <= 0) {
    return refuse(
      422,
      "too-many-steps",
      "Die Antwort brauchte zu viele Schritte."
    );
  }
  return null;
}

export async function POST(request: Request): Promise<Response> {
  const fake = fakeModel();
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
  if (!fake && !plausibleKey(key)) {
    return refuse(401, "no-key", "Ohne Schlüssel geht es nicht.");
  }
  const secret = process.env.FRAG_SECRET;
  // a production server holds the key check: without its secret, no relay
  if (!(fake || secret) && process.env.NODE_ENV === "production") {
    // 501, not 503: the client retries a 503 as a passing outage
    return refuse(
      501,
      "no-secret",
      "Frag die Stadt ist auf diesem Server nicht eingerichtet."
    );
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
    return refuse(401, "bad-token", "Der Schlüssel muss neu geprüft werden.");
  }
  const turns = ASK_LIMITS.answerRounds - roundsSinceQuestion(params.messages);
  const tooMuch = conversationRefusal(params.messages, turns);
  if (tooMuch) {
    return tooMuch;
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
    ...(params.resume ? { resume: params.resume } : {}),
    ...(params.parentRunId ? { parentRunId: params.parentRunId } : {}),
    site: askPromptSite(site),
    runId: params.runId,
    threadId: params.threadId,
    today: new Date(),
    turns,
  });
  // the host ends the function at maxDuration without a word: end the
  // answer a little before, with an error the visitor sees
  const deadline = setTimeout(
    () => abortController.abort("deadline"),
    (maxDuration - 10) * 1000
  );
  return toServerSentEventsResponse(
    timed(scrubbed(stream, key), abortController.signal, deadline),
    {
      abortController,
      headers: { "Cache-Control": "no-store" },
    }
  );
}

/** The stream, closed by an error when the deadline aborts it. */
async function* timed(
  stream: AsyncIterable<StreamChunk>,
  signal: AbortSignal,
  deadline: ReturnType<typeof setTimeout>
): AsyncIterable<StreamChunk> {
  try {
    yield* stream;
  } finally {
    clearTimeout(deadline);
  }
  if (signal.reason === "deadline") {
    yield {
      type: "RUN_ERROR",
      timestamp: Date.now(),
      message: "Die Antwort dauerte zu lange.",
    } as StreamChunk;
  }
}
