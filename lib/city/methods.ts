/**
 * How the viewer came by a statement or a drawn thing: the four methods the
 * inquiry card marks with a badge (and, later, the knowledge base). Two
 * families: deterministic — `taken` as the source publishes it, `computed`
 * from measured values by a fixed formula (the same data give the same
 * result) — and inferred — `detected` by pattern recognition (thresholds,
 * matching two sources, image analysis: it can be wrong), `assumed` where
 * nothing is known of this thing (a default, an average, a design choice).
 * The badge says what the viewer did with the data; how the source itself
 * was made (LoD2 is partly modelled automatically) is the data-sources
 * page's business. No THREE, no DOM.
 */

export type Method = "taken" | "computed" | "detected" | "assumed";

export interface MethodInfo {
  /** the badge's word */
  label: string;
  /** the badge's word on the English pages */
  labelEn: string;
  /** a glyph that tells the method apart without its colour */
  glyph: string;
  /** deterministic (solid badge) or inferred (dashed) */
  inferred: boolean;
  /** one sentence: what it means, for the legend and the tooltip */
  meaning: string;
  /** the same in English */
  meaningEn: string;
}

export const METHODS: Record<Method, MethodInfo> = {
  taken: {
    label: "übernommen",
    labelEn: "taken",
    glyph: "❝",
    inferred: false,
    meaning: "steht so in der Quelle und wird unverändert gezeigt.",
    meaningEn: "as the source publishes it, shown unchanged.",
  },
  computed: {
    label: "berechnet",
    labelEn: "computed",
    glyph: "=",
    inferred: false,
    meaning:
      "mit einer festen Formel aus Messwerten: gleiche Daten ergeben immer dasselbe Ergebnis.",
    meaningEn:
      "by a fixed formula over measured values: the same data always give the same result.",
  },
  detected: {
    label: "erkannt",
    labelEn: "detected",
    glyph: "◎",
    inferred: true,
    meaning:
      "durch Mustererkennung: Schwellenwerte, Abgleich zweier Quellen oder Bildanalyse. Kann sich irren.",
    meaningEn:
      "by pattern recognition: thresholds, matching two sources or image analysis. It can be wrong.",
  },
  assumed: {
    label: "angenommen",
    labelEn: "assumed",
    glyph: "≈",
    inferred: true,
    meaning:
      "für dieses Ding liegt nichts vor: eine Vorgabe, ein Durchschnitt oder eine Gestaltung.",
    meaningEn:
      "nothing is known of this thing: a default, an average or a design choice.",
  },
};

/** The methods in the legend's order: deterministic first. */
export const METHOD_ORDER: readonly Method[] = [
  "taken",
  "computed",
  "detected",
  "assumed",
];

/** A statement with the method it was come by. */
export interface Stated {
  text: string;
  method: Method;
}

/**
 * The method a badge token in the docs names — the glyph and the word, in
 * either language (`◎ erkannt`, `◎ detected`), written as inline code so
 * GitHub shows a readable token and /wissen a badge — or null.
 */
export function methodOfToken(token: string): Method | null {
  const text = token.trim();
  for (const method of METHOD_ORDER) {
    const info = METHODS[method];
    if (
      text === `${info.glyph} ${info.label}` ||
      text === `${info.glyph} ${info.labelEn}`
    ) {
      return method;
    }
  }
  return null;
}
