/**
 * The Prüfstand's sums (ask-qa.ts): every answer judged, by question —
 * whether to keep it, change it or replace it, with the judge's
 * suggestions — and by model — how long to the first word, how many
 * turns, how many answers without text or with made-up facts. As a
 * Markdown report to download and hand on. Pure, for the card's panel.
 */
import type { QaAnswer, QaCase, QaVerdict } from "./ask-qa";

/** One case asked of one model, as the route returns it. */
export interface QaResult {
  case: QaCase;
  model: string;
  answer: QaAnswer;
  /** null where the judge failed */
  verdict: QaVerdict | null;
}

export type QaCall = "behalten" | "anpassen" | "ersetzen";

/** A question template's verdict over its places and models. */
export interface QaQuestionSum {
  template: string;
  kind: string;
  runs: number;
  call: QaCall;
  /** how many judged it each way */
  calls: Record<QaCall, number>;
  /** mean scores (0–2) */
  fits: number;
  data: number;
  answer: number;
  madeUp: number;
  suggestions: string[];
}

/** A model's answers summed up. */
export interface QaModelSum {
  model: string;
  runs: number;
  /** median from the request to the first word (ms), over answers with text */
  firstTextMs: number | null;
  /** median of the whole answer (ms) */
  totalMs: number;
  turns: number;
  noText: number;
  madeUp: number;
  errors: number;
  answer: number;
}

function mean(values: readonly number[]): number {
  return values.length > 0
    ? values.reduce((a, b) => a + b, 0) / values.length
    : 0;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** The verdict of the many: replace where half say so, change where half
 *  would change or replace it, else keep. */
export function overallCall(calls: Record<QaCall, number>): QaCall {
  const n = calls.behalten + calls.anpassen + calls.ersetzen;
  if (n === 0) {
    return "behalten";
  }
  if (calls.ersetzen * 2 >= n) {
    return "ersetzen";
  }
  return (calls.anpassen + calls.ersetzen) * 2 >= n ? "anpassen" : "behalten";
}

/** Every question template's verdict, the ones to replace first. */
export function questionSums(results: readonly QaResult[]): QaQuestionSum[] {
  const by = new Map<string, QaResult[]>();
  for (const r of results) {
    const list = by.get(r.case.template) ?? [];
    list.push(r);
    by.set(r.case.template, list);
  }
  const order: Record<QaCall, number> = {
    ersetzen: 0,
    anpassen: 1,
    behalten: 2,
  };
  return [...by.entries()]
    .map(([template, list]) => {
      const judged = list.flatMap((r) => (r.verdict ? [r.verdict] : []));
      const calls = { behalten: 0, anpassen: 0, ersetzen: 0 };
      for (const v of judged) {
        calls[v.urteil] += 1;
      }
      return {
        template,
        kind: list[0].case.kind,
        runs: list.length,
        call: overallCall(calls),
        calls,
        fits: mean(judged.map((v) => v.ort_passt)),
        data: mean(judged.map((v) => v.daten_reichen)),
        answer: mean(judged.map((v) => v.antwort)),
        madeUp: judged.filter((v) => v.erfunden).length,
        suggestions: [
          ...new Set(
            judged.map((v) => v.vorschlag.trim()).filter((s) => s !== "")
          ),
        ].slice(0, 3),
      };
    })
    .sort((a, b) => order[a.call] - order[b.call] || a.answer - b.answer);
}

/** Every model's answers summed up, in the order first seen. */
export function modelSums(results: readonly QaResult[]): QaModelSum[] {
  const by = new Map<string, QaResult[]>();
  for (const r of results) {
    const list = by.get(r.model) ?? [];
    list.push(r);
    by.set(r.model, list);
  }
  return [...by.entries()].map(([model, list]) => ({
    model,
    runs: list.length,
    firstTextMs: median(
      list.flatMap((r) =>
        r.answer.firstTextMs === null ? [] : [r.answer.firstTextMs]
      )
    ),
    totalMs: median(list.map((r) => r.answer.totalMs)) ?? 0,
    turns: mean(list.map((r) => r.answer.turns)),
    noText: list.filter((r) => r.answer.text.trim() === "").length,
    madeUp: list.filter((r) => r.verdict?.erfunden).length,
    errors: list.filter((r) => r.answer.error !== undefined).length,
    answer: mean(list.flatMap((r) => (r.verdict ? [r.verdict.antwort] : []))),
  }));
}

const s = (ms: number | null) =>
  ms === null ? "–" : `${(ms / 1000).toFixed(1)} s`;
const n1 = (v: number) => v.toFixed(1);
/** A table cell: no pipes or line breaks. */
const cell = (t: string) => t.replace(/\|/g, "/").replace(/\s+/g, " ").trim();

/** The run as a Markdown report: models, questions, every answer. */
export function qaReport(
  results: readonly QaResult[],
  meta: { city: string; date: string; judge: string; places: string[] }
): string {
  const models = modelSums(results);
  const questions = questionSums(results);
  const lines = [
    `# Prüfstand Frag die Stadt — ${meta.city}, ${meta.date}`,
    "",
    `${results.length} Antworten von ${models.map((m) => m.model).join(", ")}; bewertet von ${meta.judge}.`,
    `Orte: ${meta.places.join("; ")}.`,
    "",
    "## Modelle",
    "",
    "| Modell | Antworten | bis zum ersten Wort (Median) | ganze Antwort (Median) | Modellschritte ⌀ | ohne Text | erfunden | Fehler | Antwort ⌀ (0–2) |",
    "|---|---|---|---|---|---|---|---|---|",
    ...models.map(
      (m) =>
        `| ${m.model} | ${m.runs} | ${s(m.firstTextMs)} | ${s(m.totalMs)} | ${n1(m.turns)} | ${m.noText} | ${m.madeUp} | ${m.errors} | ${n1(m.answer)} |`
    ),
    "",
    "## Fragen",
    "",
    "| Frage | Art | Urteil | behalten / anpassen / ersetzen | passt zum Ort ⌀ | Daten reichen ⌀ | Antwort ⌀ | erfunden | Vorschläge |",
    "|---|---|---|---|---|---|---|---|---|",
    ...questions.map(
      (q) =>
        `| ${cell(q.template)} | ${q.kind} | **${q.call}** | ${q.calls.behalten} / ${q.calls.anpassen} / ${q.calls.ersetzen} | ${n1(q.fits)} | ${n1(q.data)} | ${n1(q.answer)} | ${q.madeUp} | ${cell(q.suggestions.join(" · "))} |`
    ),
    "",
    "## Alle Antworten",
    "",
  ];
  for (const r of results) {
    const v = r.verdict;
    lines.push(
      `### ${r.case.question} — ${r.model}`,
      "",
      `${r.case.place.name}, ${r.case.at.slice(11, 16)} UTC · ${s(r.answer.firstTextMs)} bis zum ersten Wort, ${s(r.answer.totalMs)} gesamt, ${r.answer.turns} Schritte · Werkzeuge: ${r.answer.calls.map((c) => c.name).join(", ") || "keine"}`,
      "",
      `> ${(r.answer.text.trim() || "(kein Text)").replace(/\n+/g, "\n> ")}`,
      "",
      ...(r.answer.error ? [`Fehler: ${r.answer.error}`, ""] : []),
      v
        ? `Urteil: **${v.urteil}** (Ort ${v.ort_passt}, Daten ${v.daten_reichen}, Antwort ${v.antwort}${v.erfunden ? ", erfunden" : ""}) — ${v.begruendung}${v.vorschlag ? ` Vorschlag: „${v.vorschlag}“` : ""}`
        : "Urteil: (die Bewertung schlug fehl)",
      ""
    );
  }
  return lines.join("\n");
}
