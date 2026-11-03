/**
 * One answer of *Frag die Stadt* (ADR 0056): the agent loop over the
 * fixed prompt and tools, on whichever adapter the route built from the
 * visitor's key. The Stadtwissen tools and `wo_bin_ich` run here (the
 * visitor's pose comes with the request), the view-changing ones are
 * acknowledged here and carried out by the card from the stream
 * (ask-shown.ts), and only `was_ist_da` is declared without a body: the
 * loop hands it to the browser and resumes with its result on the next
 * request. Most answers so take two model turns in one request. Server-
 * side but free of the file system and the providers — the route loads
 * both — so a test drives it with a scripted adapter
 * (`@tanstack/ai/testing`).
 */
import {
  type AgentLoopStrategy,
  type AnyTextAdapter,
  chat,
  combineStrategies,
  convertMessagesToModelMessages,
  maxIterations,
  type ModelMessage,
  type StreamChunk,
  type UIMessage,
} from "@tanstack/ai";
import { scrubSecrets } from "@tanstack/ai/byok";
import {
  ASK_LIMITS,
  type AskPromptSite,
  type AskVisitor,
  askSystemPrompt,
  CUT_SHORT,
  TOO_MANY_STEPS,
} from "./ask-city";
import {
  factsOf,
  type Knowledge,
  nearKnowledge,
  nearReach,
  searchKnowledge,
  sourcesOf,
} from "./ask-knowledge";
import { layerAnswer, showAnswer, timeAnswer } from "./ask-shown";
import {
  BROWSER_TOOLS,
  factsTool,
  layerTool,
  lookTool,
  NEAR_RADIUS,
  nearTool,
  searchTool,
  SHOWN_TOOLS,
  showTool,
  sourcesTool,
  styleTool,
  suggestTool,
  timeTool,
  whereTool,
} from "./ask-tools";

/** The site as the tools read it. */
type ToolSite = Pick<AskPromptSite, "holds" | "layerKeys">;

/** The Stadtwissen tools, bound to one site's knowledge and
 *  the visitor's pose (null while the scene loads). */
export function knowledgeTools(
  k: Knowledge,
  site: ToolSite,
  visitor: AskVisitor | null = null
) {
  return [
    searchTool.server(({ anfrage }) => {
      const hits = searchKnowledge(k, anfrage);
      return hits.length > 0
        ? { treffer: hits }
        : { treffer: [], hinweis: "Nichts gefunden — anders schreiben?" };
    }),
    nearTool.server(({ x, y, radius }) => {
      const given = x !== undefined && y !== undefined;
      const at = given ? { x, y } : visitor;
      if (!at) {
        return {
          fehler:
            "Wo der Besucher steht, ist nicht bekannt (die Szene lädt noch): nenne x und y.",
        };
      }
      // the centre and reach said, so the answer can say what it took for near
      const reach = nearReach(radius ?? NEAR_RADIUS);
      return {
        mitte: { x: Math.round(at.x), y: Math.round(at.y) },
        ...(given ? {} : { um_den_besucher: true }),
        umkreis_m: reach.buildings,
        wahrzeichen_bis_m: reach.landmarks,
        treffer: nearKnowledge(k, at.x, at.y, reach.buildings),
      };
    }),
    factsTool.server(({ id }) => factsOf(k, id) ?? { fehler: "unbekannte id" }),
    sourcesTool.server(() => ({ quellen: sourcesOf(k) })),
    whereTool.server(
      () =>
        visitor ?? {
          fehler:
            "Die Szene lädt noch: wo der Besucher steht, ist nicht bekannt.",
        }
    ),
    // the chips are the card's: the server only takes them in
    suggestTool.server(() => ({
      ok: true,
      hinweis:
        "Die Knöpfe stehen. Steht deine Antwort noch nicht als Text da, schreib sie jetzt.",
    })),
  ];
}

/** The view-changing tools, acknowledged at once: the card carries each
 *  out when its result reaches the stream (app/_components/ask-effects.ts). */
export function shownTools(site: ToolSite, visitor: AskVisitor | null = null) {
  return [
    // framed for the visitor's screen, as the card will frame it
    showTool.server((ask) =>
      showAnswer(ask, visitor?.seitenverhaeltnis, site.holds)
    ),
    timeTool.server((ask) => timeAnswer(ask)),
    styleTool.server(() => ({ ok: true })),
    layerTool.server((ask) => layerAnswer(site.layerKeys, ask)),
  ];
}

/** The tools that need nothing back but an ok: a turn of only these
 *  ends the answer once it has its text. */
const DONE = new Set<string>([
  suggestTool.name,
  ...SHOWN_TOOLS.map((t) => t.name),
]);

/** Whether an assistant message carries words of an answer. */
function hasText(m: ModelMessage): boolean {
  const c = m.content;
  if (typeof c === "string") {
    return c.trim() !== "";
  }
  return (
    Array.isArray(c) &&
    c.some((p) => p.type === "text" && p.content.trim() !== "")
  );
}

/**
 * The answer ends at a turn that only shows (`zeige`, `vorschlaege`, the
 * scene's settings) once it has its text — written in that turn or after
 * the last lookup — without another model turn to acknowledge them. A
 * turn that shows but has written nothing yet goes on: chips and a
 * camera flight without words are no answer (GPT-6 tended to stop there).
 */
export const endsWhenAnswered: AgentLoopStrategy = ({ messages }) => {
  const asked = messages.findLastIndex((m) => m.role === "user");
  const turns = messages.slice(asked + 1).filter((m) => m.role === "assistant");
  const last = turns.at(-1);
  const calls = last?.toolCalls ?? [];
  if (calls.length === 0 || !calls.every((c) => DONE.has(c.function.name))) {
    return true;
  }
  const looked = turns.findLastIndex((t) =>
    (t.toolCalls ?? []).some((c) => !DONE.has(c.function.name))
  );
  return !turns.slice(looked + 1).some(hasText);
};

export interface AskRun {
  adapter: AnyTextAdapter;
  abortController?: AbortController;
  knowledge: Knowledge;
  /** the conversation as the client sent it */
  messages: Parameters<typeof chat>[0]["messages"];
  /** how hard the model thinks (`askReasoning`); the provider's default
   *  without */
  reasoning?: "low" | "off";
  /** the interrupted run a resume continues */
  parentRunId?: string;
  /** `was_ist_da`'s result, when the browser resumes an interrupted run */
  resume?: Parameters<typeof chat>[0]["resume"];
  /** the model turns this request may still take (the answer's rest) */
  turns?: number;
  /** the client's run id: an interrupted run (a browser tool) resumes under it */
  runId?: string;
  site: AskPromptSite;
  threadId: string;
  today: Date;
  /** where the visitor stands, as the request's header said */
  visitor?: AskVisitor | null;
  /** answers `was_ist_da` on the server (the Prüfstand, which has no
   *  browser); without, the browser does */
  look?: () => Record<string, unknown>;
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
): Array<T | ModelMessage> {
  const question = messages.findLastIndex((m) => m.role === "user");
  const out: Array<T | ModelMessage> = [];
  // the open calls of the answer since the last question row
  let open = new Set<string>();
  for (const [i, m] of messages.entries()) {
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
    tools: [
      ...knowledgeTools(run.knowledge, run.site, run.visitor ?? null),
      ...shownTools(run.site, run.visitor ?? null),
      ...(run.look ? [lookTool.server(run.look)] : BROWSER_TOOLS),
    ],
    agentLoopStrategy: combineStrategies([
      maxIterations(
        Math.min(ASK_LIMITS.iterations, run.turns ?? ASK_LIMITS.iterations)
      ),
      endsWhenAnswered,
    ]),
    // no thinking summary streamed: the card shows the steps, not thoughts
    ...(run.reasoning
      ? { reasoning: { level: run.reasoning, summary: false } }
      : {}),
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
  const round = new LastRound();
  try {
    for await (const chunk of stream) {
      // the abort's own error would say less than the deadline's
      if (signal.reason === DEADLINE && chunk.type === "RUN_ERROR") {
        continue;
      }
      before = last;
      last = chunk;
      round.see(chunk);
      yield chunk;
    }
  } finally {
    onEnd();
  }
  let end = runEnd(last, before);
  // a round that only shows ends an answer that has its text
  // (`endsWhenAnswered`); one without text is still cut short
  if (end === "cut" && round.endsAnswer()) {
    end = "stop";
  }
  const why = stopText(end, signal.reason === DEADLINE);
  if (why) {
    yield runError(why);
  }
}

/** The tool names of the stream's last round of calls, and whether the
 *  stream carried words of an answer. */
class LastRound {
  private names: string[] = [];
  private answered = false;
  private texted = false;

  see(chunk: StreamChunk): void {
    if (chunk.type === "TEXT_MESSAGE_CONTENT") {
      const delta = (chunk as { delta?: unknown }).delta;
      this.texted ||= typeof delta === "string" && delta.trim() !== "";
    } else if (chunk.type === "TOOL_CALL_START") {
      // the first call after a round's results opens the next round
      if (this.answered) {
        this.names = [];
        this.answered = false;
      }
      const c = chunk as { toolCallName?: unknown; toolName?: unknown };
      const name = c.toolCallName ?? c.toolName;
      this.names.push(typeof name === "string" ? name : "");
    } else if (chunk.type === "TOOL_CALL_RESULT") {
      this.answered = true;
    }
  }

  endsAnswer(): boolean {
    return (
      this.texted &&
      this.names.length > 0 &&
      this.names.every((n) => DONE.has(n))
    );
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
