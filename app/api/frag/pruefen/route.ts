/**
 * POST /api/frag/pruefen — the Prüfstand of *Frag die Stadt* (ADR 0056,
 * lib/city/ask-qa.ts), for the card's panel behind `?pruefstand=1`.
 * Stateless, two kinds of request:
 *
 * - `{ art: "plan", site, orte }`: the places and every case of a run,
 *   from the site's Stadtwissen — no key, nothing spent.
 * - `{ art: "fall", site, provider, model, token, fall }` with the key
 *   in `x-frag-key`: one case asked of `model` as a visitor standing at
 *   its place would ask it (the same prompt, tools and loop as
 *   /api/frag; `was_ist_da` answered from the twin, as there is no
 *   browser view). The answer and its timings come back as JSON.
 * - `{ art: "urteil", site, provider, model, token, fall, antwort }`
 *   with the key: that answer judged by `model`. A request of its own,
 *   so a slow answer and a thorough judge each have the function's
 *   whole time.
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
  parseAskProps,
} from "@/lib/city/ask-city";
import {
  answerRecorder,
  judgeMessage,
  QA_JUDGE_PROMPT,
  QA_VERDICT,
  type QaAnswer,
  type QaCase,
  RESULT_CHARS,
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

/** The most an answer the judge reads may carry: its text, its calls. */
const ANSWER_CHARS = 8000;
const ANSWER_CALLS = 24;

/** An answer as the panel sends it back to be judged, checked and
 *  capped: what the judge reads is what the case's request recorded. */
function parseAnswer(value: unknown): QaAnswer | null {
  const a = value as Partial<QaAnswer> | null;
  const num = (n: unknown): n is number =>
    typeof n === "number" && Number.isFinite(n) && n >= 0;
  if (
    !(
      a &&
      typeof a.text === "string" &&
      a.text.length <= ANSWER_CHARS &&
      Array.isArray(a.calls) &&
      a.calls.length <= ANSWER_CALLS &&
      num(a.totalMs) &&
      num(a.turns) &&
      (a.firstTextMs === null || num(a.firstTextMs))
    )
  ) {
    return null;
  }
  const calls = a.calls.flatMap((call) =>
    typeof call?.name === "string" && call.name.length <= 40
      ? [
          {
            name: call.name,
            input: call.input,
            ...(typeof call.result === "string"
              ? { result: call.result.slice(0, RESULT_CHARS) }
              : {}),
          },
        ]
      : []
  );
  return {
    calls,
    firstTextMs: a.firstTextMs ?? null,
    text: a.text,
    totalMs: a.totalMs,
    turns: a.turns,
    ...(typeof a.error === "string" ? { error: a.error.slice(0, 300) } : {}),
  };
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
  if (body.art === "urteil") {
    const answer = parseAnswer(body.antwort);
    if (!answer) {
      return refuse(400, "bad-answer", "Die Antwort ist unvollständig.");
    }
    return judged(c, answer, {
      adapter: fake
        ? fakeJudgeAdapter()
        : askAdapter(props.provider, props.model, key),
      abortController,
      key,
    });
  }
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
  return Response.json({ antwort: record.answer }, { headers: NO_STORE });
}

/** The verdict on one answer, or the judge's error, as JSON. */
async function judged(
  c: QaCase,
  answer: QaAnswer,
  run: {
    adapter: ReturnType<typeof askAdapter>;
    abortController: AbortController;
    key: string;
  }
): Promise<Response> {
  try {
    const verdict = await chat({
      adapter: run.adapter,
      messages: [{ role: "user", content: judgeMessage(c, answer) }],
      systemPrompts: [QA_JUDGE_PROMPT],
      outputSchema: QA_VERDICT,
      reasoning: { level: "low", summary: false },
      threadId: crypto.randomUUID(),
      abortController: run.abortController,
    });
    return Response.json({ urteil: verdict }, { headers: NO_STORE });
  } catch (error) {
    return Response.json(
      {
        urteil: null,
        urteil_fehler: scrubSecrets(
          error instanceof Error ? error.message : "Die Bewertung schlug fehl.",
          [run.key]
        ),
      },
      { headers: NO_STORE }
    );
  }
}
