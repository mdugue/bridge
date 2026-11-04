/**
 * How an answer of *Frag die Stadt* fails (ADR 0056), in one table: every
 * reason the server refuses a request or ends a run with, as a code, the
 * status a refusal answers with, and the words the card shows. The
 * server (`lib/city/ask-run.ts`, the two routes) and the card
 * (`app/_components/ask-city.tsx`) read it; nothing of the main bundle
 * does. Pure data and functions.
 */

/** Why an answer stopped at its turn cap, in the stream or as a 422. */
export const TOO_MANY_STEPS = "Die Antwort brauchte zu viele Schritte.";

/** A conversation past what the server or the model takes. */
export const TOO_LONG = "Das Gespräch ist zu lang geworden.";

/** Why an answer ended mid-text: the model's output ran out. */
export const CUT_SHORT =
  "Die Antwort wurde abgeschnitten: dem Modell gingen die Wörter aus.";

/** A reason of ours. Kebab-case, so never a provider's code. */
export type AskFailureCode =
  | "bad-request"
  | "bad-props"
  | "no-key"
  | "bad-token"
  | "no-secret"
  | "too-long"
  | "too-many-steps"
  | "no-knowledge"
  | "gone"
  | "cut-short"
  | "too-late"
  | "broke-off";

/**
 * Each reason: the status of a refusal (none for an end in the stream),
 * the card's words, and whether the card offers the key check again or a
 * fresh start.
 */
export const ASK_FAILURES: Readonly<
  Record<
    AskFailureCode,
    { status?: number; text: string; key?: true; reset?: true }
  >
> = {
  // an older page, or a model the server no longer offers
  "bad-request": {
    status: 400,
    text: "Die Anfrage passt nicht zu diesem Server — lade die Seite neu.",
  },
  "bad-props": {
    status: 400,
    text: "Die Anfrage passt nicht zu diesem Server — lade die Seite neu.",
  },
  "no-key": {
    status: 401,
    text: "Der Schlüssel muss neu geprüft werden.",
    key: true,
  },
  "bad-token": {
    status: 401,
    text: "Der Schlüssel muss neu geprüft werden.",
    key: true,
  },
  // 501, not 503: the client retries a 503 as a passing outage
  "no-secret": {
    status: 501,
    text: "Frag die Stadt ist auf diesem Server nicht eingerichtet.",
  },
  "too-long": { status: 413, text: TOO_LONG, reset: true },
  "too-many-steps": {
    status: 422,
    text: `${TOO_MANY_STEPS} Frag bitte anders.`,
    reset: true,
  },
  "no-knowledge": {
    status: 404,
    text: "Für diese Stadt gibt es kein Stadtwissen.",
  },
  // the tab is gone: nobody reads it but a log
  gone: { status: 499, text: "Die Anfrage wurde abgebrochen." },
  "cut-short": { text: CUT_SHORT },
  "too-late": { text: "Die Antwort dauerte zu lange." },
  // a content filter, or (OpenRouter) a provider's failure mid-answer
  "broke-off": {
    text: "Das Modell brach die Antwort ab. Frag bitte noch einmal.",
  },
};

/** A provider's error that names the key or the account's credit. */
const KEY_TROUBLE =
  /\b(?:401|402|403|unauthori[sz]ed|forbidden|authenticat\w*|api[ _-]?key|credits?|credentials?|quota|billing|insufficient)\b/iu;
/** The same, as the code a provider's error carries. */
const KEY_CODES = new Set(["401", "402", "403"]);

/** One failed answer's words and what the visitor can do about it. */
const say = (text: string, key = false, reset = false) => ({
  key,
  reset,
  text,
});

/** A row of the table as the card says it. */
const sayRow = (code: AskFailureCode) => {
  const row = ASK_FAILURES[code];
  return say(row.text, row.key === true, row.reset === true);
};

/** A code as text: strings and numbers as written, else nothing. */
function codeText(value: unknown): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : "";
}

/** A failed answer in words, by the status the server sent, and what
 *  the visitor can do about it: check the key again or start over. */
export function askFailure(error: Error): {
  key: boolean;
  reset: boolean;
  text: string;
} {
  const { status } = error as { status?: unknown };
  if (status === 401) {
    return sayRow("bad-token");
  }
  if (status === 400) {
    return sayRow("bad-request");
  }
  if (status === 413) {
    return sayRow("too-long");
  }
  if (status === 422) {
    return sayRow("too-many-steps");
  }
  if (status === 404) {
    return sayRow("no-knowledge");
  }
  if (status === 501) {
    return sayRow("no-secret");
  }
  if (typeof status === "number") {
    return say(`Der Server antwortet mit Status ${status}.`);
  }
  // a key revoked or out of credit after the check fails in the stream,
  // in the provider's words: offer the check again for those only
  const message = error.message || "Die Antwort brach ab.";
  const code = codeText((error as { code?: unknown }).code);
  if (message === TOO_MANY_STEPS) {
    return sayRow("too-many-steps");
  }
  // the codes first, the provider's words only where no code says it
  if (KEY_CODES.has(code)) {
    return say(message, true);
  }
  // the adapters' codes for a spent output budget and a full context
  if (
    code === "max_tokens" ||
    (code === "incomplete" && message === "max_output_tokens")
  ) {
    return say(CUT_SHORT);
  }
  if (code === "context_overflow") {
    return say(TOO_LONG, false, true);
  }
  return say(message, KEY_TROUBLE.test(message));
}
