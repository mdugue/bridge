/**
 * How an answer of *Frag die Stadt* fails (ADR 0056), in one table: every
 * reason the server refuses a request or ends a run with, as a code, the
 * status a refusal answers with, and the words the card shows. The
 * server sends the code (a refusal's body, a stream's `RUN_ERROR`), the
 * card looks it up; the server's words are the card's. Read by the server
 * (`lib/city/ask-run.ts`, the two routes) and the card's chunk
 * (`app/_components/ask-city.tsx`), never the main bundle. Our codes are
 * kebab-case, so a provider's code (`"401"`, `max_tokens`) is never read
 * as ours.
 */

/** Why an answer stopped at its turn cap, in the stream or as a 422. */
const TOO_MANY_STEPS = "Die Antwort brauchte zu viele Schritte.";

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
interface AskFailureRow {
  status?: number;
  text: string;
  key?: true;
  reset?: true;
}

const ROWS = {
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
} as const satisfies Record<AskFailureCode, AskFailureRow>;

export const ASK_FAILURES: Readonly<Record<AskFailureCode, AskFailureRow>> =
  ROWS;

/** A reason a request is refused for: a row with a status. */
export type AskRefusalCode = {
  [C in AskFailureCode]: (typeof ROWS)[C] extends { status: number }
    ? C
    : never;
}[AskFailureCode];

/** The status a refusal answers with. */
export function askRefusalStatus(code: AskRefusalCode): number {
  return ROWS[code].status;
}

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

/** Whether a text is one of our codes. */
function isAskFailureCode(value: unknown): value is AskFailureCode {
  return typeof value === "string" && Object.hasOwn(ROWS, value);
}

/** A code as text: strings and numbers as written, else nothing. */
function codeText(value: unknown): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : "";
}

/**
 * What the card says and offers for a failed answer: check the key again
 * or start over. Our code reads its row; a provider's code, its status or
 * its words are read where no code of ours came (a host's 502 or 504
 * keeps its status).
 */
export function askFailure(error: Error): {
  key: boolean;
  reset: boolean;
  text: string;
} {
  const { code: sent, status } = error as { code?: unknown; status?: unknown };
  if (isAskFailureCode(sent)) {
    const row = ASK_FAILURES[sent];
    return say(row.text, row.key === true, row.reset === true);
  }
  // a key revoked or out of credit after the check fails in the stream,
  // in the provider's words: offer the check again for those only
  const message = error.message || "Die Antwort brach ab.";
  const code = codeText(sent);
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
  if (typeof status === "number") {
    return say(`Der Server antwortet mit Status ${status}.`);
  }
  return say(message, KEY_TROUBLE.test(message));
}

/** A refusal's body, where it is ours: its code and words. */
async function codedBody(
  response: Response
): Promise<{ code: AskFailureCode; message: string } | null> {
  const body: unknown = await response
    .clone()
    .json()
    .catch(() => null);
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const { code, message } = body as { code?: unknown; message?: unknown };
  return isAskFailureCode(code)
    ? { code, message: typeof message === "string" ? message : "" }
    : null;
}

/**
 * `fetch` for the chat's connection: a refusal that carries one of our
 * codes becomes a stream with one `RUN_ERROR` naming it, so it reaches the
 * card as an answer's error with its code — one path for a refusal and an
 * end, instead of the client's status-only error. Any other response
 * (an answer, a host's 502 or 504) passes as it came.
 */
export function codedRefusals(fetchFn: typeof fetch): typeof fetch {
  const coded = async (
    ...args: Parameters<typeof fetch>
  ): Promise<Response> => {
    const response = await fetchFn(...args);
    if (response.ok) {
      return response;
    }
    const refusal = await codedBody(response);
    if (!refusal) {
      return response;
    }
    const event = { type: "RUN_ERROR", timestamp: Date.now(), ...refusal };
    return new Response(`data: ${JSON.stringify(event)}\n\n`, {
      headers: { "Content-Type": "text/event-stream" },
    });
  };
  return Object.assign(coded, fetchFn);
}
