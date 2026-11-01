/**
 * POST /api/frag/pruefen — the Prüfstand of *Frag die Stadt* (ADR 0056,
 * lib/city/ask-qa.ts), for the card's panel behind `?pruefstand=1`.
 * Stateless, two kinds of request:
 *
 * - `{ art: "plan", site, orte }`: the places and every case of a run,
 *   from the site's Stadtwissen — no key, nothing spent.
 * - `{ art: "fall", site, provider, model, richter, token, fall }` with
 *   the key in `x-frag-key`: one case asked of `model` as a visitor
 *   standing at its place would ask it (the same prompt, tools and loop
 *   as /api/frag; `was_ist_da` answered from the twin, as there is no
 *   browser view), then judged by `richter`. The answer, its timings and
 *   the verdict come back as JSON.
 *
 * The key goes to the provider and nowhere else; nothing is kept or
 * logged but a refusal's reason code.
 */
import { chat } from "@tanstack/ai";
import { scrubSecrets } from "@tanstack/ai/byok";
import {
  ASK_KEY_HEADER,
  ASK_LIMITS,
  askPromptSite,
  askReasoning,
  isAskModel,
  parseAskProps,
} from "@/lib/city/ask-city";
import {
  answerRecorder,
  judgeMessage,
  QA_JUDGE_PROMPT,
  QA_VERDICT,
  type QaCase,
  qaCases,
  qaLook,
  qaPlaces,
  qaVisitor,
} from "@/lib/city/ask-qa";
import { runAsk, scrubbed } from "@/lib/city/ask-run";
import { siteById } from "@/sites";
import { askAdapter, fakeAskAdapter, fakeJudgeAdapter } from "../adapters";
import { keyRefusal, refuse } from "../guard";
import { siteKnowledge } from "../knowledge";

export const maxDuration = 60;

/** The most places a run asks at. */
const MAX_PLACES = 8;

const NO_STORE = { "Cache-Control": "no-store" };

/** A case as the panel sends it back, checked: the plan's shape, short. */
function parseCase(value: unknown): QaCase | null {
  const c = value as Partial<QaCase> | null;
  const p = c?.place;
  const num = (n: unknown): n is number =>
    typeof n === "number" && Number.isFinite(n);
  const text = (t: unknown, max: number): t is string =>
    typeof t === "string" && t.length > 0 && t.length <= max;
  if (
    !(
      c &&
      p &&
      text(c.id, 40) &&
      text(c.kind, 12) &&
      text(c.question, ASK_LIMITS.questionChars) &&
      text(c.template, ASK_LIMITS.questionChars) &&
      text(c.at, 40) &&
      !Number.isNaN(Date.parse(c.at)) &&
      text(p.name, 120) &&
      num(p.x) &&
      num(p.y) &&
      num(p.heading) &&
      (p.ground === null || num(p.ground)) &&
      (p.ahead === null || text(p.ahead, 40))
    )
  ) {
    return null;
  }
  return c as QaCase;
}

export async function POST(request: Request): Promise<Response> {
  const fake = process.env.FRAG_FAKE === "1";
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return refuse(400, "bad-request", "Die Anfrage ist unvollständig.");
  }
  const site = siteById(typeof body.site === "string" ? body.site : "");
  const knowledge = site ? await siteKnowledge(site.id) : null;
  if (!(site && knowledge)) {
    return refuse(
      404,
      "no-knowledge",
      "Für diese Stadt gibt es kein Stadtwissen."
    );
  }
  const promptSite = askPromptSite(site);
  if (body.art === "plan") {
    const count = Math.min(
      Math.max(Math.round(Number(body.orte) || 4), 1),
      MAX_PLACES
    );
    const places = qaPlaces(knowledge, count);
    return Response.json(
      {
        orte: places,
        faelle: qaCases(knowledge, promptSite, places, new Date()),
      },
      { headers: NO_STORE }
    );
  }
  const props = parseAskProps({ ...body, voice: false });
  if (typeof props === "string") {
    return refuse(400, "bad-props", props);
  }
  if (!isAskModel(props.provider, body.richter)) {
    return refuse(400, "bad-judge", "unbekanntes Modell für die Bewertung");
  }
  const key = request.headers.get(ASK_KEY_HEADER)?.trim() ?? "";
  const refused = await keyRefusal(props, key, fake);
  if (refused) {
    return refused;
  }
  const c = parseCase(body.fall);
  if (!c) {
    return refuse(400, "bad-case", "Der Fall ist unvollständig.");
  }
  const abortController = new AbortController();
  request.signal.addEventListener("abort", () => abortController.abort());
  const record = answerRecorder();
  const start = Date.now();
  const stream = runAsk({
    adapter: fake
      ? fakeAskAdapter()
      : askAdapter(props.provider, props.model, key),
    abortController,
    knowledge,
    look: () => qaLook(knowledge, c.place),
    messages: [{ role: "user", content: c.question }],
    reasoning: askReasoning(props.provider, props.model),
    site: promptSite,
    threadId: crypto.randomUUID(),
    today: new Date(c.at),
    visitor: qaVisitor(c),
  });
  for await (const chunk of scrubbed(stream, key)) {
    record.take(chunk, Date.now() - start);
  }
  const judge = String(body.richter);
  let verdict: unknown = null;
  let judgeError: string | undefined;
  try {
    verdict = await chat({
      adapter: fake
        ? fakeJudgeAdapter()
        : askAdapter(props.provider, judge, key),
      messages: [{ role: "user", content: judgeMessage(c, record.answer) }],
      systemPrompts: [QA_JUDGE_PROMPT],
      outputSchema: QA_VERDICT,
      reasoning: { level: "low", summary: false },
      threadId: crypto.randomUUID(),
      abortController,
    });
  } catch (error) {
    judgeError = scrubSecrets(
      error instanceof Error ? error.message : "Die Bewertung schlug fehl.",
      [key]
    );
  }
  return Response.json(
    {
      antwort: record.answer,
      urteil: verdict,
      ...(judgeError ? { urteil_fehler: judgeError } : {}),
    },
    { headers: NO_STORE }
  );
}
