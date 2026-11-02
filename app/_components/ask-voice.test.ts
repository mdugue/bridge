import { expect, test } from "bun:test";
import {
  dictationProblem,
  sentences,
  speakable,
  lineDeadline,
  spokenLines,
  yearWords,
} from "./ask-voice";

test("an answer is heard without links, list marks or Markdown, with units as words", () => {
  expect(
    speakable(
      "Die **Frauenkirche** ist 91 m hoch (https://www.wikidata.org/wiki/Q157229).\n- Kuppel: 1 200 m²"
    )
  ).toBe("Die Frauenkirche ist 91 Meter hoch. Kuppel: 1 200 Quadratmeter");
});

test("a Markdown link is heard by its words", () => {
  expect(
    speakable("Mehr bei [Wikipedia](https://de.wikipedia.org/wiki/Zwinger).")
  ).toBe("Mehr bei Wikipedia.");
});

test("a recognition error the visitor caused says nothing, others say why", () => {
  expect(dictationProblem("no-speech")).toBeNull();
  expect(dictationProblem("aborted")).toBeNull();
  expect(dictationProblem("not-allowed")).toContain("Mikrofon");
  expect(dictationProblem("whatever")).toBeTruthy();
});

test("a count is not read as a year", () => {
  expect(speakable("eine Bude für 1800 Leute, 1200 m lang")).toBe(
    "eine Bude für 1800 Leute, 1200 Meter lang"
  );
  expect(speakable("Im Februar 1945 brannte es, von 1808 an wohnte er")).toBe(
    "Im Februar neunzehnhundertfünfundvierzig brannte es, von achtzehnhundertacht an wohnte er"
  );
  expect(speakable("seit 1990 Denkmal")).toBe(
    "seit neunzehnhundertneunzig Denkmal"
  );
});

test("a year is heard as German says it, other numbers as written", () => {
  expect(yearWords(1711)).toBe("siebzehnhundertelf");
  expect(yearWords(1901)).toBe("neunzehnhunderteins");
  expect(yearWords(1100)).toBe("elfhundert");
  expect(yearWords(1945)).toBe("neunzehnhundertfünfundvierzig");
  expect(yearWords(2013)).toBe("zweitausenddreizehn");
  expect(
    speakable(
      "Am 13. Februar 1985 – nach 40 Jahren – öffnete es, 35.798 Stücke, ca. 4000 Pfähle."
    )
  ).toBe(
    "Am 13. Februar neunzehnhundertfünfundachtzig, nach 40 Jahren, öffnete es, 35.798 Stücke, circa 4000 Pfähle."
  );
  expect(speakable("„Fest der vier Elemente“ in St. Petersburg, Nr. 13")).toBe(
    "Fest der vier Elemente in Sankt Petersburg, Nummer 13"
  );
});

test("a text is read sentence by sentence", () => {
  expect(sentences("Ein Satz. Noch einer! Und 1711 der dritte.")).toEqual([
    "Ein Satz.",
    "Noch einer!",
    "Und 1711 der dritte.",
  ]);
  // an ordinal's point is no sentence's end
  expect(sentences("Am 15. September feierte man.")).toEqual([
    "Am 15. September feierte man.",
  ]);
  expect(sentences("Geweiht 1494. Die Hauben kamen später.")).toEqual([
    "Geweiht 1494.",
    "Die Hauben kamen später.",
  ]);
});

test("a told text is read in its tones: the title slower and higher, a pause after each part", () => {
  const lines = spokenLines([
    { tone: "title", text: "Die Kuppel." },
    { tone: "story", text: "Sie ist aus Stein. Sie wurde 1743 fertig." },
    { tone: "label", text: "Genauer hingesehen." },
    { tone: "aside", text: "Oben." },
  ]);
  expect(lines.map((l) => l.text)).toEqual([
    "Die Kuppel.",
    "Sie ist aus Stein.",
    "Sie wurde siebzehnhundertdreiundvierzig fertig.",
    "Genauer hingesehen.",
    "Oben.",
  ]);
  const [title, first, last, label, aside] = lines;
  expect(title.rate).toBeLessThan(first.rate);
  expect(title.pitch).toBeGreaterThan(first.pitch);
  expect(label.pitch).toBeLessThan(first.pitch);
  // a breath between sentences, a pause after a part
  expect(first.pause).toBeLessThan(last.pause);
  expect(title.pause).toBeGreaterThan(last.pause);
  expect(aside.text).toBe("Oben.");
  expect(spokenLines([{ tone: "story", text: "  " }])).toEqual([]);
});

test("a line's end counts as lost only well past its time", () => {
  const short = lineDeadline({ rate: 1, text: "Hier." });
  const long = lineDeadline({ rate: 0.84, text: "x".repeat(260) });
  expect(short).toBeGreaterThanOrEqual(2000);
  // 260 characters at rate 0.84 take some 24 s: lost only past ~36 s
  expect(long).toBeGreaterThan((260 / 13 / 0.84) * 1000 * 1.4);
});
