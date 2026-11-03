/**
 * One answer of *Frag die Stadt* (ADR 0056): the agent loop over the
 * fixed prompt and tools, on whichever adapter the route built from the
 * visitor's key. The Stadtwissen tools run here, the scene tools are
 * declared without a body, so the loop hands them to the browser and
 * resumes with the browser's result on the next request. Server-side but
 * free of the file system and the providers — the route loads both — so
 * a test drives it with a scripted adapter (`@tanstack/ai/testing`).
 */
import {
  type AnyTextAdapter,
  chat,
  convertMessagesToModelMessages,
  type ModelMessage,
  maxIterations,
  type StreamChunk,
  type UIMessage,
} from "@tanstack/ai";
import { scrubSecrets } from "@tanstack/ai/byok";
import {
  ASK_LIMITS,
  type AskPromptSite,
  askSystemPrompt,
  CUT_SHORT,
  TOO_MANY_STEPS,
} from "./ask-city";
import {
  factsOf,
  type Knowledge,
  nearKnowledge,
  searchKnowledge,
  sourcesOf,
} from "./ask-knowledge";
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
}

/**
 * The model turns that asked for tools since the last question. Each
 * scene tool ends a request and the browser resumes with a new one, so
 * the per-request turn cap alone never bounds an answer; the client's
 * UI messages fold several turns into one, the conversion splits them.
 */
export function roundsSinceQuestion(
  messages: ReadonlyArray<UIMessage | ModelMessage>
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

/** The answer as a stream of AG-UI events, for an SSE response. */
export function runAsk(run: AskRun) {
  return chat({
    adapter: run.adapter,
    messages: run.messages,
    threadId: run.threadId,
    ...(run.runId ? { runId: run.runId } : {}),
    ...(run.resume ? { resume: run.resume } : {}),
    ...(run.parentRunId ? { parentRunId: run.parentRunId } : {}),
    systemPrompts: [askSystemPrompt(run.site, run.today)],
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
    type: "RUN_ERROR",
    timestamp: Date.now(),
    message,
    ...(code ? { code } : {}),
  } as StreamChunk;
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
 */
export async function* ended(
  stream: AsyncIterable<StreamChunk>,
  signal: AbortSignal,
  onEnd: () => void = () => {}
): AsyncIterable<StreamChunk> {
  let last: StreamChunk | undefined;
  let before: StreamChunk | undefined;
  try {
    for await (const chunk of stream) {
      // the abort's own error would say less than the deadline's
      if (signal.reason === DEADLINE && chunk.type === "RUN_ERROR") {
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
    case "waits":
      return null;
    case "cut":
      return late ? "Die Antwort dauerte zu lange." : TOO_MANY_STEPS;
    case "length":
      return late ? "Die Antwort dauerte zu lange." : CUT_SHORT;
    case "refused":
      // a refusal, or (OpenRouter) a provider's failure mid-answer
      return "Das Modell brach die Antwort ab. Frag bitte noch einmal.";
    case "other":
      return late ? "Die Antwort dauerte zu lange." : null;
  }
}

function runEnd(
  last: StreamChunk | undefined,
  before: StreamChunk | undefined
): RunEnd {
  if (last?.type === "TOOL_CALL_RESULT") {
    return "cut";
  }
  if (last?.type !== "RUN_FINISHED") {
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
    return before?.type === "TOOL_CALL_RESULT" && state === "output-error"
      ? "cut"
      : "length";
  }
  return reason === "content_filter" ? "refused" : "stop";
}

/** The stream with the key taken out of any error, thrown or sent. */
export async function* scrubbed(
  stream: AsyncIterable<StreamChunk>,
  key: string
): AsyncIterable<StreamChunk> {
  try {
    for await (const chunk of stream) {
      yield chunk.type === "RUN_ERROR"
        ? errorChunk(String(chunk.message), key, chunk.code)
        : chunk;
    }
  } catch (error) {
    yield errorChunk(
      error instanceof Error ? error.message : "Die Antwort brach ab.",
      key
    );
  }
}
