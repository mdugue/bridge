/**
 * One answer turn of *Frag die Stadt* (ADR 0056): `answerTurn` runs a
 * request's checks in their order, then the agent loop over the fixed
 * prompt and tools, on whichever adapter the route binds (the visitor's
 * provider, or the scripted model). The route (`app/api/frag/route.ts`)
 * only binds the turn's dependencies (`TurnDeps`): the adapters, the
 * Stadtwissen, the secret, the clock and the log. The Stadtwissen tools
 * run here, the scene tools are declared without a body, so the loop
 * hands them to the browser and resumes with the browser's result on the
 * next request. Free of the file system, the environment and the
 * providers, so a test drives a whole turn with a scripted adapter
 * (`@tanstack/ai/testing`).
 */
import {
  chat,
  chatParamsFromRequestBody,
  convertMessagesToModelMessages,
  EventType,
  maxIterations,
  toServerSentEventsResponse,
} from "@tanstack/ai";
import type {
  AnyTextAdapter,
  ModelMessage,
  StreamChunk,
  UIMessage,
} from "@tanstack/ai";
import { scrubSecrets } from "@tanstack/ai/byok";
import {
  ASK_LIMITS,
  askSystemPrompt,
  conversationProblem,
  CUT_SHORT,
  lastQuestion,
  parseAskProps,
  plausibleKey,
  TOO_MANY_STEPS,
} from "./ask-city";
import type { AskPromptSite, AskRequestProps } from "./ask-city";
import {
  factsOf,
  nearKnowledge,
  searchKnowledge,
  sourcesOf,
} from "./ask-knowledge";
import type { Knowledge } from "./ask-knowledge";
import { verifyAskToken } from "./ask-token";
import {
  factsTool,
  nearTool,
  SCENE_TOOLS,
  searchTool,
  sourcesTool,
} from "./ask-tools";

/** The Stadtwissen tools, bound to one site's knowledge. */
export function knowledgeTools(k: Knowledge) {
  return [
    searchTool.server(({ anfrage }) => {
      const hits = searchKnowledge(k, anfrage);
      return hits.length > 0
        ? { treffer: hits }
        : { treffer: [], hinweis: "Nichts gefunden — anders schreiben?" };
    }),
    nearTool.server(({ x, y, radius }) => ({
      treffer: nearKnowledge(k, x, y, radius ?? 120),
    })),
    factsTool.server(({ id }) => factsOf(k, id) ?? { fehler: "unbekannte id" }),
    sourcesTool.server(() => ({ quellen: sourcesOf(k) })),
  ];
}

export interface AskRun {
  adapter: AnyTextAdapter;
  abortController?: AbortController;
  knowledge: Knowledge;
  /** the conversation as the client sent it */
  messages: Parameters<typeof chat>[0]["messages"];
  /** the interrupted run a resume continues */
  parentRunId?: string;
  /** the scene tools' results, when the browser resumes an interrupted run */
  resume?: Parameters<typeof chat>[0]["resume"];
  /** the model turns this request may still take (the answer's rest) */
  turns?: number;
  /** the client's run id: an interrupted run (a scene tool) resumes under it */
  runId?: string;
  site: AskPromptSite;
  threadId: string;
  today: Date;
  /** the answers are read aloud */
  voice?: boolean;
}

/**
 * The model turns that asked for tools since the last question. Each
 * scene tool ends a request and the browser resumes with a new one, so
 * the per-request turn cap alone never bounds an answer; the client's
 * UI messages fold several turns into one, the conversion splits them.
 */
export function roundsSinceQuestion(
  messages: readonly (UIMessage | ModelMessage)[]
): number {
  // the whole conversation converts, as the run will convert it: one that
  // does not is refused here, not halfway through the answer
  const model = convertMessagesToModelMessages([...messages]);
  const question = model.findLastIndex((m) => m.role === "user");
  return model
    .slice(question + 1)
    .filter((m) => m.role === "assistant" && (m.toolCalls?.length ?? 0) > 0)
    .length;
}

/**
 * A stopped call's stand-in result. It names no cause (a stop, the
 * deadline or a dropped line end a run alike) and says `ok: false`, which
 * the trace shows as not done when a later snapshot brings it back to the
 * browser.
 */
const STOPPED_RESULT = JSON.stringify({
  abgebrochen: true,
  ok: false,
  hinweis: "Abgebrochen, bevor ein Ergebnis kam.",
});

/**
 * The conversation with an answer for every tool call an earlier answer
 * ended before its result came (the visitor stopped it while a scene
 * tool waited): a call with no result makes the providers refuse every
 * later request. The stand-in `tool` row goes right before the next
 * question, after every row of the ended answer, so nothing it carried
 * (its thinking, a segment that continues it) loses its place; a result
 * counts only within its own answer, as some providers number calls
 * afresh in each. Calls after the last question are the answer's own,
 * which a resume completes. Arguments cut off mid-stream (a stop, or the
 * output cap) become `{}` in every row, for no resume finishes them and
 * the OpenAI-shaped adapters pass them on unparsed. The route hands this
 * the AG-UI wire rows (an assistant row's `toolCalls`, a `tool` row per
 * result); a UI message passes as it came. Throws on a row too malformed
 * to read.
 */
export function withStoppedCallsAnswered<T extends UIMessage | ModelMessage>(
  messages: readonly T[]
): (T | ModelMessage)[] {
  const question = messages.findLastIndex((m) => m.role === "user");
  const out: (T | ModelMessage)[] = [];
  // the open calls of the answer since the last question row
  let open = new Set<string>();
  for (let i = 0; i < messages.length; i += 1) {
    const m = messages[i];
    if (m.role === "user") {
      out.push(...[...open].map(stoppedResult));
      open = new Set();
    } else if (m.role === "tool" && "toolCallId" in m) {
      open.delete(String(m.toolCallId));
    }
    if (m.role === "assistant" && "toolCalls" in m) {
      // the running answer's calls are the resume's to answer; a call
      // without an id can be answered by none
      if (i < question) {
        for (const c of m.toolCalls ?? []) {
          if (typeof c.id === "string" && c.id !== "") {
            open.add(c.id);
          }
        }
      }
      out.push(withWholeArguments(m));
    } else {
      out.push(m);
    }
  }
  return out;
}

function stoppedResult(toolCallId: string): ModelMessage {
  return { role: "tool", toolCallId, content: STOPPED_RESULT };
}

/** The row with `{}` for arguments cut off before they were a JSON
 *  object; the same row when none were. */
function withWholeArguments<T extends ModelMessage>(m: T): T {
  let mended = false;
  const toolCalls = m.toolCalls?.map((c) => {
    if (isArgumentObject(c.function.arguments)) {
      return c;
    }
    mended = true;
    return { ...c, function: { ...c.function, arguments: "{}" } };
  });
  return mended ? { ...m, toolCalls } : m;
}

function isArgumentObject(text: string): boolean {
  try {
    const args: unknown = JSON.parse(text);
    return typeof args === "object" && args !== null && !Array.isArray(args);
  } catch {
    return false;
  }
}

/** The answer as a stream of AG-UI events, for an SSE response. */
export function runAsk(run: AskRun) {
  return chat({
    adapter: run.adapter,
    messages: run.messages,
    threadId: run.threadId,
    ...(run.runId ? { runId: run.runId } : {}),
    ...(run.resume ? { resume: run.resume } : {}),
    ...(run.parentRunId ? { parentRunId: run.parentRunId } : {}),
    systemPrompts: [askSystemPrompt(run.site, run.today, run.voice)],
    tools: [...knowledgeTools(run.knowledge), ...SCENE_TOOLS],
    agentLoopStrategy: maxIterations(
      Math.min(ASK_LIMITS.iterations, run.turns ?? ASK_LIMITS.iterations)
    ),
    // the prompt and the tools are the same for every request of a site:
    // the provider's cache holds them (Anthropic's cache_control, OpenAI's
    // automatic prefix cache), the conversation's thread is the key
    promptCache: "short",
    ...(run.abortController ? { abortController: run.abortController } : {}),
  });
}

/**
 * An error as the browser gets it: its message and code, scrubbed of the
 * key — not the provider's raw event or error object, which may quote the
 * request.
 */
function errorChunk(message: string, key: string, code?: unknown): StreamChunk {
  return runError(
    scrubSecrets(message, [key]),
    typeof code === "string" ? code : undefined
  );
}

function runError(message: string, code?: string): StreamChunk {
  return {
    type: EventType.RUN_ERROR,
    timestamp: Date.now(),
    message,
    ...(code ? { code } : {}),
  };
}

/** The reason the route aborts a run that nears the host's limit. */
export const DEADLINE = "deadline";

/**
 * The stream, closed by an error the visitor sees where it would stop
 * without one: at the deadline, at the turn cap (the run ends on a tool's
 * result, or on a tool round's RUN_FINISHED, before the model's turn on
 * it), or when the model's output ran out mid-answer. A run that ends on
 * its own, waits for a scene tool, or already sent an error is left as
 * it is: an answer without words is not told from one that said enough
 * before its last tool.
 *
 * @yields {StreamChunk} every chunk of `stream`, then the closing error if any
 */
export async function* ended(
  stream: AsyncIterable<StreamChunk>,
  signal: AbortSignal,
  onEnd: () => void = () => {
    // no hook given: nothing to tell when the stream is done
  }
): AsyncIterable<StreamChunk> {
  let last: StreamChunk | undefined;
  let before: StreamChunk | undefined;
  try {
    for await (const chunk of stream) {
      // the abort's own error would say less than the deadline's
      if (signal.reason === DEADLINE && chunk.type === EventType.RUN_ERROR) {
        continue;
      }
      before = last;
      last = chunk;
      yield chunk;
    }
  } finally {
    onEnd();
  }
  const why = stopText(runEnd(last, before), signal.reason === DEADLINE);
  if (why) {
    yield runError(why);
  }
}

/**
 * How the stream's last chunk leaves the run: `stop` (the model chose to
 * end), `waits` (a scene tool waits for the browser), `cut` (between a
 * tool's result and the model's turn on it: the turn cap), `length` (the
 * model's output ran out mid-answer), `refused` (a content filter, or
 * on OpenRouter a provider's failure mid-answer) or `other` (an error
 * already said why, or nothing came).
 */
type RunEnd = "stop" | "waits" | "cut" | "length" | "refused" | "other";

/** Why a run stopped, where the stream would not say it. */
function stopText(end: RunEnd, late: boolean): string | null {
  switch (end) {
    case "stop":
    case "waits": {
      return null;
    }
    case "cut": {
      return late ? "Die Antwort dauerte zu lange." : TOO_MANY_STEPS;
    }
    case "length": {
      return late ? "Die Antwort dauerte zu lange." : CUT_SHORT;
    }
    case "refused": {
      // a refusal, or (OpenRouter) a provider's failure mid-answer
      return "Das Modell brach die Antwort ab. Frag bitte noch einmal.";
    }
    case "other": {
      // an error already said why, or nothing came
      return late ? "Die Antwort dauerte zu lange." : null;
    }
    default: {
      const unknown: never = end;
      throw new Error(`unknown run end: ${String(unknown)}`);
    }
  }
}

function runEnd(
  last: StreamChunk | undefined,
  before: StreamChunk | undefined
): RunEnd {
  if (last?.type === EventType.TOOL_CALL_RESULT) {
    return "cut";
  }
  if (last?.type !== EventType.RUN_FINISHED) {
    return "other";
  }
  const c = last as {
    metadata?: { tanstack?: { finishReason?: unknown } };
    outcome?: { type?: unknown };
  };
  if (c.outcome?.type === "interrupt") {
    return "waits";
  }
  const reason = c.metadata?.tanstack?.finishReason;
  if (reason === "tool_calls") {
    return "cut";
  }
  if (reason === "length") {
    // a capped run whose last tool call the length cut: chat() ends it on
    // `length` right after that call's failed result
    const state = (before as { metadata?: { tanstack?: { state?: unknown } } })
      ?.metadata?.tanstack?.state;
    return before?.type === EventType.TOOL_CALL_RESULT &&
      state === "output-error"
      ? "cut"
      : "length";
  }
  return reason === "content_filter" ? "refused" : "stop";
}

/**
 * The stream with the key taken out of any error, thrown or sent.
 *
 * @yields {StreamChunk} every chunk of `stream`, errors scrubbed
 */
export async function* scrubbed(
  stream: AsyncIterable<StreamChunk>,
  key: string
): AsyncIterable<StreamChunk> {
  try {
    for await (const chunk of stream) {
      if (chunk.type === EventType.RUN_ERROR) {
        // a text only by its type: an adapter may send anything
        const message: unknown = chunk.message;
        yield errorChunk(String(message), key, chunk.code);
      } else {
        yield chunk;
      }
    }
  } catch (error) {
    yield errorChunk(
      error instanceof Error ? error.message : "Die Antwort brach ab.",
      key
    );
  }
}

// --- the turn -------------------------------------------------------------------
// The parts above stay exported for ask-run.test.ts only (an internal
// seam): every caller runs a turn through `answerTurn`.

/** What a turn needs from its host; the route binds each one. */
export interface TurnDeps {
  /** the model for a request that passed every check */
  adapterFor: (props: AskRequestProps, key: string) => AnyTextAdapter;
  /** a site's prompt facts and Stadtwissen; null where none was built */
  knowledgeFor: (
    siteId: string
  ) => Promise<{ site: AskPromptSite; knowledge: Knowledge } | null>;
  /** FRAG_SECRET; undefined where unset */
  secret: string | undefined;
  /** a production server: without a secret, no relay */
  production: boolean;
  /** the scripted model answers: no key, no token check */
  scripted: boolean;
  /** ms since the epoch: the token's clock and today's date */
  now: () => number;
  /** when the run is aborted with DEADLINE, from the request's start */
  deadlineMs: number;
  /** one line per refusal: `[frag] <status> <code>` */
  log: (line: string) => void;
}

/**
 * A refused request: its reason as a code in the log (never the key, the
 * token or the conversation) and as words for the visitor.
 */
function refuse(
  deps: TurnDeps,
  status: number,
  code: string,
  message: string
): Response {
  deps.log(`[frag] ${status} ${code}`);
  return Response.json(
    { code, message },
    { status, headers: { "Cache-Control": "no-store" } }
  );
}

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
function conversationRefusal(
  deps: TurnDeps,
  messages: readonly unknown[]
): Response | null {
  const problem = conversationProblem(messages, lastQuestion(messages));
  return problem ? refuse(deps, 413, "too-long", problem) : null;
}

/** A key the turn does not relay: none, no secret to check it with in
 *  production, or a token the key check did not give for it. */
async function keyRefusal(
  deps: TurnDeps,
  key: string,
  props: AskRequestProps
): Promise<Response | null> {
  const fake = deps.scripted;
  if (!fake && !plausibleKey(key)) {
    return refuse(deps, 401, "no-key", "Ohne Schlüssel geht es nicht.");
  }
  const { secret } = deps;
  // a production server holds the key check: without its secret, no relay
  if (!(fake || secret) && deps.production) {
    // 501, not 503: the client retries a 503 as a passing outage
    return refuse(
      deps,
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
      deps.now()
    ))
  ) {
    return refuse(
      deps,
      401,
      "bad-token",
      "Der Schlüssel muss neu geprüft werden."
    );
  }
  return null;
}

/**
 * One answer turn. The checks run in this order, and the first that
 * fails answers alone (nothing after it runs, no adapter is built): the
 * body, the props, the key, the caps on the rows as sent (the stand-ins
 * mending adds must not count), the answer's turns on the mended rows,
 * the site's Stadtwissen, a request already gone. Every refusal is JSON
 * `{ code, message }`, `no-store`, with one log line. An answer is the
 * run as server-sent events, scrubbed of the key and closed by an error
 * where the stream would not say why it stopped; the run stops when the
 * body is cancelled, the request aborts, or at `deadlineMs`. Rejects only
 * if a dependency throws; a provider's failure arrives in the stream.
 */
export async function answerTurn(
  request: { body: unknown; key: string; signal: AbortSignal },
  deps: TurnDeps
): Promise<Response> {
  const { key } = request;
  let params: Awaited<ReturnType<typeof chatParamsFromRequestBody>>;
  try {
    params = await chatParamsFromRequestBody(request.body);
  } catch {
    return refuse(deps, 400, "bad-request", "Die Anfrage ist unvollständig.");
  }
  const props = parseAskProps(params.forwardedProps);
  if (typeof props === "string") {
    return refuse(deps, 400, "bad-props", props);
  }
  const keyProblem = await keyRefusal(deps, key, props);
  if (keyProblem) {
    return keyProblem;
  }
  const tooMuch = conversationRefusal(deps, params.messages);
  if (tooMuch) {
    return tooMuch;
  }
  // a stopped answer's unanswered call would make the provider refuse
  const history = answerHistory(params.messages);
  if (history === null) {
    return refuse(deps, 400, "bad-request", "Die Anfrage ist unvollständig.");
  }
  if (history.turns <= 0) {
    return refuse(deps, 422, "too-many-steps", TOO_MANY_STEPS);
  }
  const known = await deps.knowledgeFor(props.site);
  if (!known) {
    return refuse(
      deps,
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
    return refuse(deps, 499, "gone", "Die Anfrage wurde abgebrochen.");
  }
  const stream = runAsk({
    adapter: deps.adapterFor(props, key),
    abortController: runController,
    knowledge: known.knowledge,
    messages: history.messages,
    ...(params.resume ? { resume: params.resume } : {}),
    ...(params.parentRunId ? { parentRunId: params.parentRunId } : {}),
    site: known.site,
    runId: params.runId,
    threadId: params.threadId,
    today: new Date(deps.now()),
    turns: history.turns,
    voice: props.voice,
  });
  // the host ends the function at its limit without a word: end the
  // answer a little before, with an error the visitor sees
  const deadline = setTimeout(
    () => runController.abort(DEADLINE),
    deps.deadlineMs
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
