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
  maxIterations,
  type StreamChunk,
} from "@tanstack/ai";
import { scrubSecrets } from "@tanstack/ai/byok";
import { ASK_LIMITS, type AskPromptSite, askSystemPrompt } from "./ask-city";
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
  factsTool,
  floodTool,
  NEAR_RADIUS,
  nearTool,
  SCENE_TOOLS,
  searchTool,
  shadowTool,
  sourcesTool,
  suggestTool,
} from "./ask-tools";

/** The Stadtwissen and scenario tools, bound to one site's knowledge. */
export function knowledgeTools(
  k: Knowledge,
  site: Pick<AskPromptSite, "epsg" | "id">
) {
  return [
    searchTool.server(({ anfrage }) => {
      const hits = searchKnowledge(k, anfrage);
      return hits.length > 0
        ? { treffer: hits }
        : { treffer: [], hinweis: "Nichts gefunden — anders schreiben?" };
    }),
    nearTool.server(({ x, y, radius }) => {
      // the reach said, so the answer can say what it took for near
      const reach = nearReach(radius ?? NEAR_RADIUS);
      return {
        umkreis_m: reach.buildings,
        wahrzeichen_bis_m: reach.landmarks,
        treffer: nearKnowledge(k, x, y, reach.buildings),
      };
    }),
    factsTool.server(({ id }) => factsOf(k, id) ?? { fehler: "unbekannte id" }),
    sourcesTool.server(() => ({ quellen: sourcesOf(k) })),
    // the chips are the card's: the server only takes them in
    suggestTool.server(() => ({ ok: true })),
    floodTool.server((ask) => floodAffected(k, site.id, site.epsg, ask)),
    shadowTool.server((ask) =>
      shadowAnswer(k, site.epsg, { ...ask, drehung: ask.drehung ?? 0 })
    ),
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
  /** the client's run id: an interrupted run (a scene tool) resumes under it */
  runId?: string;
  site: AskPromptSite;
  threadId: string;
  today: Date;
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
    tools: [...knowledgeTools(run.knowledge, run.site), ...SCENE_TOOLS],
    agentLoopStrategy: maxIterations(ASK_LIMITS.iterations),
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
