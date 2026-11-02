import { expect, test } from "bun:test";
import type { QaCase, QaVerdict } from "./ask-qa";
import {
  modelSums,
  overallCall,
  type QaResult,
  qaReport,
  questionSums,
} from "./ask-qa-report";

const place = {
  name: "vor Frauenkirche",
  x: 1,
  y: 2,
  heading: 0,
  ground: 110,
  ahead: "Q1",
};
const caseOf = (template: string, question = template): QaCase => ({
  id: question,
  kind: "ort",
  question,
  template,
  place,
  at: "2026-11-01T13:00:00.000Z",
});
const verdict = (urteil: QaVerdict["urteil"], antwort = 2): QaVerdict => ({
  ort_passt: 2,
  daten_reichen: 2,
  antwort,
  erfunden: false,
  urteil,
  vorschlag: urteil === "behalten" ? "" : "Wie hoch ist {ort}?",
  begruendung: "Weil.",
});
const result = (
  model: string,
  c: QaCase,
  v: QaVerdict | null,
  text = "Antwort.",
  totalMs = 4000
): QaResult => ({
  case: c,
  model,
  answer: {
    calls: [{ name: "suche_stadt", input: {} }],
    firstTextMs: text ? 2000 : null,
    text,
    totalMs,
    turns: 2,
  },
  verdict: v,
});

test("the many decide: replace at half, change where half would change", () => {
  expect(overallCall({ behalten: 1, anpassen: 0, ersetzen: 1 })).toBe(
    "ersetzen"
  );
  expect(overallCall({ behalten: 2, anpassen: 1, ersetzen: 1 })).toBe(
    "anpassen"
  );
  expect(overallCall({ behalten: 3, anpassen: 1, ersetzen: 0 })).toBe(
    "behalten"
  );
  expect(overallCall({ behalten: 0, anpassen: 0, ersetzen: 0 })).toBe(
    "behalten"
  );
});

test("a question is summed over its places and models, the worst first", () => {
  const good = caseOf(
    "Wer hat {ort} gebaut?",
    "Wer hat die Frauenkirche gebaut?"
  );
  const bad = caseOf("Wo standen hier Weihnachtsmärkte?");
  const results = [
    result("a", good, verdict("behalten")),
    result("b", good, verdict("behalten")),
    result("a", bad, verdict("ersetzen", 0)),
    result("b", bad, null, ""),
  ];
  const sums = questionSums(results);
  expect(sums.map((q) => q.call)).toEqual(["ersetzen", "behalten"]);
  expect(sums[0].suggestions).toEqual(["Wie hoch ist {ort}?"]);
  expect(sums[1].runs).toBe(2);
  const models = modelSums(results);
  expect(models.map((m) => m.model)).toEqual(["a", "b"]);
  expect(models[1].noText).toBe(1);
  expect(models[0].firstTextMs).toBe(2000);
  const report = qaReport(results, {
    city: "Dresden",
    date: "2026-11-01",
    judge: "c",
    places: ["vor Frauenkirche"],
  });
  expect(report).toContain(
    "| Wo standen hier Weihnachtsmärkte? | ort | **ersetzen**"
  );
  expect(report).toContain("(kein Text)");
  expect(report).toContain("die Bewertung schlug fehl");
});
