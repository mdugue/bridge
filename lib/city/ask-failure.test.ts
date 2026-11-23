import { describe, expect, test } from "bun:test";
import { ASK_FAILURES, askFailure, codedRefusals } from "./ask-failure";

/** An error as the chat client hands it to the card. */
const failed = (message: string, extra: Record<string, unknown> = {}) =>
  Object.assign(new Error(message), extra);

describe("the card's words for a failed answer", () => {
  const cases: {
    name: string;
    error: Error;
    text: string;
    key?: true;
    reset?: true;
  }[] = [
    {
      name: "a token the check did not give",
      error: failed("Der Schlüssel muss neu geprüft werden.", {
        code: "bad-token",
      }),
      text: "Der Schlüssel muss neu geprüft werden.",
      key: true,
    },
    {
      name: "a request from an older page",
      error: failed("…", { code: "bad-props" }),
      text: "Die Anfrage passt nicht zu diesem Server — lade die Seite neu.",
    },
    {
      name: "a conversation past the caps",
      error: failed("…", { code: "too-long" }),
      text: "Das Gespräch ist zu lang geworden.",
      reset: true,
    },
    {
      name: "a question past its cap: the conversation goes on",
      error: failed("…", { code: "question-too-long" }),
      text: "Die Frage ist zu lang (höchstens 1200 Zeichen).",
    },
    {
      name: "an answer whose turns are spent",
      error: failed("…", { code: "too-many-steps" }),
      text: "Die Antwort brauchte zu viele Schritte. Frag bitte anders.",
      reset: true,
    },
    {
      name: "a site without Stadtwissen",
      error: failed("…", { code: "no-knowledge" }),
      text: "Für diese Stadt gibt es kein Stadtwissen.",
    },
    {
      name: "a server not set up",
      error: failed("…", { code: "no-secret" }),
      text: "Frag die Stadt ist auf diesem Server nicht eingerichtet.",
    },
    {
      name: "a host's 504",
      error: failed("HTTP error! status: 504", { status: 504 }),
      text: "Der Server antwortet mit Status 504.",
    },
    {
      name: "deployment protection's 401, without our code",
      error: failed("HTTP error! status: 401", { status: 401 }),
      text: "Der Schlüssel muss neu geprüft werden.",
      key: true,
    },
    {
      name: "the platform's payload limit (413), without our code",
      error: failed("HTTP error! status: 413", { status: 413 }),
      text: "Das Gespräch ist zu lang geworden.",
      reset: true,
    },
    {
      name: "a proxy's 422, without our code",
      error: failed("HTTP error! status: 422", { status: 422 }),
      text: "Die Antwort brauchte zu viele Schritte. Frag bitte anders.",
      reset: true,
    },
    {
      name: "the turn cap in the stream",
      error: failed(
        "Die Antwort brauchte zu viele Schritte. Frag bitte anders.",
        {
          code: "too-many-steps",
        }
      ),
      text: "Die Antwort brauchte zu viele Schritte. Frag bitte anders.",
      reset: true,
    },
    {
      name: "the model's output spent mid-answer",
      error: failed("…", { code: "cut-short" }),
      text: "Die Antwort wurde abgeschnitten: dem Modell gingen die Wörter aus.",
    },
    {
      name: "the deadline",
      error: failed("…", { code: "too-late" }),
      text: "Die Antwort dauerte zu lange.",
    },
    {
      name: "a filtered answer",
      error: failed("…", { code: "broke-off" }),
      text: "Das Modell brach die Antwort ab. Frag bitte noch einmal.",
    },
    {
      name: "a refusal in the provider's words, naming no key",
      error: failed("Model refused: credentials are private", {
        code: "refusal",
      }),
      text: "Das Modell brach die Antwort ab. Frag bitte noch einmal.",
    },
    {
      name: "a stream that ended before its stop reason",
      error: failed("Anthropic stream ended before a stop reason", {
        code: "incomplete-stream",
      }),
      text: "Das Modell brach die Antwort ab. Frag bitte noch einmal.",
    },
    {
      name: "a tool call never finished",
      error: failed("Tool call incomplete", { code: "incomplete-tool-call" }),
      text: "Das Modell brach die Antwort ab. Frag bitte noch einmal.",
    },
    {
      name: "a provider's 401",
      error: failed("invalid x-api-key", { code: "401" }),
      text: "invalid x-api-key",
      key: true,
    },
    {
      name: "a provider's 402",
      error: failed("payment required", { code: "402" }),
      text: "payment required",
      key: true,
    },
    {
      name: "a provider's 403",
      error: failed("not allowed", { code: "403" }),
      text: "not allowed",
      key: true,
    },
    {
      name: "Anthropic's spent output",
      error: failed("max_tokens", { code: "max_tokens" }),
      text: "Die Antwort wurde abgeschnitten: dem Modell gingen die Wörter aus.",
    },
    {
      name: "OpenAI's spent output",
      error: failed("max_output_tokens", { code: "incomplete" }),
      text: "Die Antwort wurde abgeschnitten: dem Modell gingen die Wörter aus.",
    },
    {
      name: "a full context",
      error: failed("context window exceeded", { code: "context_overflow" }),
      text: "Das Gespräch ist zu lang geworden.",
      reset: true,
    },
    {
      name: "a provider's words about credit",
      error: failed("Your credit balance is too low"),
      text: "Your credit balance is too low",
      key: true,
    },
    {
      name: "a provider's plain words",
      error: failed("Overloaded"),
      text: "Overloaded",
    },
    {
      name: "no words at all",
      error: failed(""),
      text: "Die Antwort brach ab.",
    },
  ];

  test.each(cases)("$name", ({ error, text, key, reset }) => {
    expect(askFailure(error)).toEqual({
      text,
      key: key === true,
      reset: reset === true,
    });
  });
});

test("no code of ours has a provider's shape", () => {
  // kebab-case: a provider's "401" or max_tokens is never read as ours
  for (const code of Object.keys(ASK_FAILURES)) {
    expect(code).toMatch(/^[a-z]+(?:-[a-z]+)*$/u);
  }
});

/** A `fetch` that answers every request with `response`. */
function replying(response: Response): typeof fetch {
  return Object.assign(
    async () => await Promise.resolve(response.clone()),
    fetch
  );
}

describe("a refusal on its way to the card", () => {
  test("one with our code becomes a stream error naming it", async () => {
    const fetchFn = codedRefusals(
      replying(
        Response.json(
          {
            code: "bad-token",
            message: "Der Schlüssel muss neu geprüft werden.",
          },
          { status: 401 }
        )
      )
    );
    const res = await fetchFn("/api/frag");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");
    const text = await res.text();
    expect(text.startsWith("data: ")).toBe(true);
    expect(text.endsWith("\n\n")).toBe(true);
    const event = JSON.parse(text.slice("data: ".length)) as Record<
      string,
      unknown
    >;
    expect(event).toMatchObject({
      type: "RUN_ERROR",
      code: "bad-token",
      message: "Der Schlüssel muss neu geprüft werden.",
    });
    expect(typeof event.timestamp).toBe("number");
  });

  test("a host's page passes as it came", async () => {
    const page = new Response("<html>Bad Gateway</html>", {
      status: 501,
      headers: { "Content-Type": "text/html" },
    });
    const res = await codedRefusals(replying(page))("/api/frag");
    expect(res.status).toBe(501);
    expect(await res.text()).toBe("<html>Bad Gateway</html>");
  });

  test("a code not ours passes as it came", async () => {
    const res = await codedRefusals(
      replying(Response.json({ code: "401", message: "nope" }, { status: 401 }))
    )("/api/frag");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ code: "401", message: "nope" });
  });

  test("an answer passes as it came", async () => {
    const stream = new Response("data: {}\n\n", {
      headers: { "Content-Type": "text/event-stream" },
    });
    const res = await codedRefusals(replying(stream))("/api/frag");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("data: {}\n\n");
  });
});
