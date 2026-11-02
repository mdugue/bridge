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
 * without one: at the deadline, or when the turn cap ends the run right
 * after a server tool ran, before the model could answer with its result.
 */
export async function* ended(
  stream: AsyncIterable<StreamChunk>,
  signal: AbortSignal,
  onEnd: () => void = () => {}
): AsyncIterable<StreamChunk> {
  let last: StreamChunk | undefined;
  // the calls this request made, and whether the model still owes words
  // on one's result: a scene tool's result a resume brings back was asked
  // for in an earlier request, and its words came before it
  const called = new Set<string>();
  let owed = false;
  try {
    for await (const chunk of stream) {
      // the abort's own error would say less than the deadline's
      if (signal.reason === DEADLINE && chunk.type === "RUN_ERROR") {
        continue;
      }
      last = chunk;
      if (chunk.type === "TOOL_CALL_START") {
        called.add(chunk.toolCallId);
      } else if (chunk.type === "TOOL_CALL_RESULT") {
        owed ||= called.has(chunk.toolCallId);
      } else if (chunk.type === "TEXT_MESSAGE_CONTENT") {
        owed = false;
      }
      yield chunk;
    }
  } finally {
    onEnd();
  }
  const why = stopText(runEnd(last), owed, signal.reason === DEADLINE);
  if (why) {
    yield runError(why);
  }
}

/** Why a run stopped, where the stream would not say: null where it is
 *  whole, waits for the browser, or an error already said it. */
function stopText(end: RunEnd, owed: boolean, late: boolean): string | null {
  if (late) {
    return end === "stop" || end === "waits"
      ? null
      : "Die Antwort dauerte zu lange.";
  }
  if (!owed) {
    return null;
  }
  switch (end) {
    case "cut":
      return TOO_MANY_STEPS;
    case "length":
      return "Die Antwort wurde abgeschnitten: dem Modell gingen die Wörter aus.";
    case "stop":
      return "Das Modell gab keine Antwort. Frag bitte noch einmal.";
    case "waits":
    case "other":
      return null;
  }
}

/**
 * How the stream's last chunk leaves the run: `stop` (the model chose to
 * end), `waits` (a scene tool waits for the browser), `cut` (it stopped
 * between a tool's result and the model's turn on it: the turn cap),
 * `length` (the model's output ran out) or `other` (an error already
 * said why, or nothing came).
 */
type RunEnd = "stop" | "waits" | "cut" | "length" | "other";

function runEnd(last: StreamChunk | undefined): RunEnd {
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
  return reason === "length" ? "length" : "stop";
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
