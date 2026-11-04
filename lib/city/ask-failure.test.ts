import { describe, expect, test } from "bun:test";
import { askFailure } from "./ask-failure";

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
      name: "a 401",
      error: failed("HTTP error! status: 401", { status: 401 }),
      text: "Der Schlüssel muss neu geprüft werden.",
      key: true,
    },
    {
      name: "a 400",
      error: failed("HTTP error! status: 400", { status: 400 }),
      text: "Die Anfrage passt nicht zu diesem Server — lade die Seite neu.",
    },
    {
      name: "a 413",
      error: failed("HTTP error! status: 413", { status: 413 }),
      text: "Das Gespräch ist zu lang geworden.",
      reset: true,
    },
    {
      name: "a 422",
      error: failed("HTTP error! status: 422", { status: 422 }),
      text: "Die Antwort brauchte zu viele Schritte. Frag bitte anders.",
      reset: true,
    },
    {
      name: "a 404",
      error: failed("HTTP error! status: 404", { status: 404 }),
      text: "Für diese Stadt gibt es kein Stadtwissen.",
    },
    {
      name: "a 501",
      error: failed("HTTP error! status: 501", { status: 501 }),
      text: "Frag die Stadt ist auf diesem Server nicht eingerichtet.",
    },
    {
      name: "a host's 504",
      error: failed("HTTP error! status: 504", { status: 504 }),
      text: "Der Server antwortet mit Status 504.",
    },
    {
      name: "the turn cap in the stream",
      error: failed("Die Antwort brauchte zu viele Schritte."),
      text: "Die Antwort brauchte zu viele Schritte. Frag bitte anders.",
      reset: true,
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
