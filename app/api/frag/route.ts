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
  ASK_LIMITS,
  ASK_VISITOR_HEADER,
  TOO_MANY_STEPS,
  askPromptSite,
  askReasoning,
  conversationProblem,
  lastQuestion,
  parseAskProps,
  parseAskVisitor,
} from "@/lib/city/ask-city";
import {
  DEADLINE,
  ended,
  roundsSinceQuestion,
  withStoppedCallsAnswered,
  runAsk,
  scrubbed,
} from "@/lib/city/ask-run";
import { siteById } from "@/sites";
import { askAdapter, fakeAskAdapter } from "./adapters";
import { fakeModel } from "./env";
import { keyRefusal, refuse } from "./guard";
import { siteKnowledge } from "./knowledge";

/** Up to eight model calls with tool rounds between them: a careful
 *  model's answer can outlast a minute (Vercel's ceiling with fluid
 *  compute). */
export const maxDuration = 300;

/**
 * The history the run sends (a stand-in for every stopped call) and the
 * model turns the answer has left; null for rows that do not read or
 * convert (the request's shape is checked only loosely before).
 */
function answerHistory(rows: Parameters<typeof withStoppedCallsAnswered>[0]): {
  messages: ReturnType<typeof withStoppedCallsAnswered>;
  turns: number;
} | null {
  try {
    const messages = withStoppedCallsAnswered(rows);
    return {
      messages,
      turns: ASK_LIMITS.answerRounds - roundsSinceQuestion(messages),
    };
  } catch {
    return null;
  }
}

/** A conversation past the caps. */
function conversationRefusal(messages: readonly unknown[]): Response | null {
  const problem = conversationProblem(messages, lastQuestion(messages));
  return problem ? refuse(413, "too-long", problem) : null;
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
  const keyProblem = await keyRefusal(props, key, fake);
  if (keyProblem) {
    return keyProblem;
  }
  const tooMuch = conversationRefusal(params.messages);
  if (tooMuch) {
    return tooMuch;
  }
  // a stopped answer's unanswered call would make the provider refuse
  const history = answerHistory(params.messages);
  if (history === null) {
    return refuse(400, "bad-request", "Die Anfrage ist unvollständig.");
  }
  if (history.turns <= 0) {
    return refuse(422, "too-many-steps", TOO_MANY_STEPS);
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
  // the model's run and the response's delivery stop apart: the deadline
  // stops the run, and the response still carries the error that says so
  const abortController = new AbortController();
  const runController = new AbortController();
  // a closed tab or a cancelled body stops the run too
  const stop = () => runController.abort();
  abortController.signal.addEventListener("abort", stop);
  request.signal.addEventListener("abort", () => abortController.abort());
  if (request.signal.aborted) {
    return refuse(499, "gone", "Die Anfrage wurde abgebrochen.");
  }
  const stream = runAsk({
    adapter: fake
      ? fakeAskAdapter()
      : askAdapter(props.provider, props.model, key),
    abortController: runController,
    knowledge,
    messages: history.messages,
    reasoning: askReasoning(props.provider, props.model),
    ...(params.resume ? { resume: params.resume } : {}),
    ...(params.parentRunId ? { parentRunId: params.parentRunId } : {}),
    site: askPromptSite(site),
    runId: params.runId,
    threadId: params.threadId,
    today: new Date(),
    turns: history.turns,
    visitor: parseAskVisitor(request.headers.get(ASK_VISITOR_HEADER)),
    voice: props.voice,
  });
  // the host ends the function at maxDuration without a word: end the
  // answer a little before, with an error the visitor sees
  const deadline = setTimeout(
    () => runController.abort(DEADLINE),
    (maxDuration - 10) * 1000
  );
  return toServerSentEventsResponse(
    ended(scrubbed(stream, key), runController.signal, () =>
      clearTimeout(deadline)
    ),
    {
      abortController,
      headers: { "Cache-Control": "no-store" },
    }
  );
}
