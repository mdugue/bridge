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
  maxIterations,
  type ModelMessage,
  type StreamChunk,
} from "@tanstack/ai";
import { scrubSecrets } from "@tanstack/ai/byok";
import {
  ASK_LIMITS,
  type AskPromptSite,
  type AskVisitor,
  askSystemPrompt,
} from "./ask-city";
import {
  factsOf,
  type Knowledge,
  nearKnowledge,
  nearReach,
  searchKnowledge,
  sourcesOf,
} from "./ask-knowledge";
import { floodAffected, shadowAnswer } from "./ask-scenario";
import {
  floodShown,
  layerAnswer,
  showAnswer,
  timeAnswer,
  volumeShown,
} from "./ask-shown";
import {
  BROWSER_TOOLS,
  factsTool,
  floodShowTool,
  floodTool,
  layerTool,
  lookTool,
  NEAR_RADIUS,
  nearTool,
  searchTool,
  shadowTool,
  SHOWN_TOOLS,
  showTool,
  sourcesTool,
  styleTool,
  suggestTool,
  timeTool,
  volumeTool,
  whereTool,
} from "./ask-tools";
import { riverOf } from "./scenario";

/** The site as the tools read it. */
type ToolSite = Pick<AskPromptSite, "epsg" | "id" | "layerKeys">;

/** The Stadtwissen and scenario tools, bound to one site's knowledge and
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
    floodTool.server((ask) => floodAffected(k, site.id, site.epsg, ask)),
    shadowTool.server((ask) =>
      shadowAnswer(k, site.epsg, { ...ask, drehung: ask.drehung ?? 0 })
    ),
  ];
}

/** The view-changing tools, acknowledged at once: the card carries each
 *  out when its result reaches the stream (app/_components/ask-effects.ts). */
export function shownTools(site: ToolSite) {
  const river = riverOf(site.id);
  return [
    showTool.server((ask) => showAnswer(ask)),
    timeTool.server((ask) => timeAnswer(ask)),
    styleTool.server(() => ({ ok: true })),
    layerTool.server((ask) => layerAnswer(site.layerKeys, ask)),
    floodShowTool.server((ask) => floodShown(river, ask).answer),
    volumeTool.server((ask) => volumeShown(ask).answer),
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
      ...shownTools(run.site),
      ...(run.look ? [lookTool.server(run.look)] : BROWSER_TOOLS),
    ],
    agentLoopStrategy: combineStrategies([
      maxIterations(ASK_LIMITS.iterations),
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
  return {
    type: "RUN_ERROR",
    timestamp: Date.now(),
    message: scrubSecrets(message, [key]),
    ...(typeof code === "string" ? { code } : {}),
  } as StreamChunk;
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
