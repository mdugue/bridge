import { expect, test } from "bun:test";
import { dictationProblem, sentences, speakable, yearWords } from "./ask-voice";

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

test("a link with brackets in it goes whole, and a bracketed source with it", () => {
  expect(
    speakable(
      "Die [Frauenkirche](https://de.wikipedia.org/wiki/Frauenkirche_(Dresden)) steht am Neumarkt (Quelle: https://de.wikipedia.org/wiki/Neumarkt_(Dresden))."
    )
  ).toBe("Die Frauenkirche steht am Neumarkt.");
  expect(
    speakable("Siehe https://de.wikipedia.org/wiki/Zwinger_(Dresden) dort.")
  ).toBe("Siehe dort.");
});

test("lines are heard as sentences, ids keep their underscores, a link leaves the full stop", () => {
  expect(
    speakable("**Fakten:**\n- Höhe: 40 m\n- Raum: 300 m³\nKennung DESN_0815")
  ).toBe("Fakten: Höhe: 40 Meter. Raum: 300 Kubikmeter. Kennung DESN_0815");
  expect(speakable("Siehe https://x.de/a.")).toBe("Siehe.");
  // a number before the line's end is no ordinal
  expect(speakable("Baujahr: 1726\nArchitekt: George Bähr")).toBe(
    "Baujahr: siebzehnhundertsechsundzwanzig; Architekt: George Bähr"
  );
});

test("a date at a line's start is no list mark", () => {
  expect(speakable("13. Februar 1945: die Bomben.\n1743.\nWeiter")).toBe(
    "13. Februar neunzehnhundertfünfundvierzig: die Bomben. siebzehnhundertdreiundvierzig. Weiter"
  );
});

test("a word after a number that starts with m stays a word", () => {
  expect(
    speakable("Seit 1945 müssen die 2 mächtigen Türme 91 m hoch sein.")
  ).toBe(
    "Seit neunzehnhundertfünfundvierzig müssen die 2 mächtigen Türme 91 Meter hoch sein."
  );
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

test("a year after a capital, before a measure, in an id, and a sentence it starts", () => {
  expect(speakable("Seit 1990 Menschen hier")).toBe(
    "Seit neunzehnhundertneunzig Menschen hier"
  );
  expect(speakable("um 1900 m hoch")).toBe("um 1900 Meter hoch");
  expect(speakable("Kennung DESN_AL1718abc")).toBe("Kennung DESN_AL1718abc");
  expect(sentences(speakable("Die Kirche brannte. 1945 fiel sie."))).toEqual([
    "Die Kirche brannte.",
    "neunzehnhundertfünfundvierzig fiel sie.",
  ]);
  expect(sentences(speakable("Bau: 1726\nWeihe: 1734\nKuppel: 1743"))).toEqual([
    "Bau: siebzehnhundertsechsundzwanzig;",
    "Weihe: siebzehnhundertvierunddreißig;",
    "Kuppel: siebzehnhundertdreiundvierzig",
  ]);
});
