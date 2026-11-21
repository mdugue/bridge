/**
 * *Frag die Stadt* (ADR 0056): the chat about the city, run with the
 * visitor's own key. What the browser and the server share of it — the
 * providers and their curated models, how a key names its provider, the
 * caps a conversation keeps to — as pure data and functions. No THREE, no
 * DOM, no network: the server route (`app/api/frag/route.ts`) and the card
 * (`app/_components/ask-city.tsx`) both read it. The prompt is the
 * server's (`ask-prompt.ts`).
 */
import { QUESTION_CHARS } from "./ask-failure";
import type { AskRefusalCode } from "./ask-failure";

/** A provider the chat can run on, with the visitor's key. */
export type AskProviderId = "anthropic" | "gateway" | "openai" | "openrouter";

export interface AskModel {
  id: string;
  /** what the picker shows (German, like the HUD) */
  label: string;
}

export interface AskProviderDef {
  /**
   * The request that proves a key, no tokens spent: the provider's list of
   * models, or its key's own record. `bearer` puts the key in an
   * `Authorization` header, `anthropic` in Anthropic's `x-api-key`.
   */
  check: { auth: "anthropic" | "bearer"; url: string };
  id: AskProviderId;
  /** where a visitor makes a key */
  keysUrl: string;
  label: string;
  /** the first is the default: fast and cheap */
  models: readonly AskModel[];
  /** how a key of this provider begins (a hint, not a check) */
  prefix: string;
}

/** In the order the picker lists them. */
export const ASK_PROVIDERS: readonly AskProviderDef[] = [
  {
    id: "anthropic",
    label: "Anthropic",
    prefix: "sk-ant-",
    keysUrl: "https://console.anthropic.com/settings/keys",
    check: { auth: "anthropic", url: "https://api.anthropic.com/v1/models" },
    models: [
      { id: "claude-haiku-5-5", label: "Claude Haiku 5.5 · schnell" },
      { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5 · gründlich" },
    ],
  },
  {
    id: "openai",
    label: "OpenAI",
    prefix: "sk-",
    keysUrl: "https://platform.openai.com/api-keys",
    check: { auth: "bearer", url: "https://api.openai.com/v1/models" },
    models: [
      { id: "gpt-5.4-mini", label: "GPT-5.4 mini · schnell" },
      { id: "gpt-5.5", label: "GPT-5.5 · gründlich" },
    ],
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    prefix: "sk-or-",
    keysUrl: "https://openrouter.ai/settings/keys",
    check: { auth: "bearer", url: "https://openrouter.ai/api/v1/key" },
    models: [
      { id: "anthropic/claude-haiku-5.5", label: "Claude Haiku 5.5 · schnell" },
      {
        id: "anthropic/claude-sonnet-5.5",
        label: "Claude Sonnet 5.5 · gründlich",
      },
      { id: "openai/gpt-5.5", label: "GPT-5.5 · gründlich" },
    ],
  },
  {
    id: "gateway",
    label: "Vercel AI Gateway",
    prefix: "vck_",
    keysUrl: "https://vercel.com/docs/ai-gateway/authentication",
    check: { auth: "bearer", url: "https://ai-gateway.vercel.sh/v1/credits" },
    models: [
      { id: "anthropic/claude-haiku-5.5", label: "Claude Haiku 5.5 · schnell" },
      {
        id: "anthropic/claude-sonnet-5.5",
        label: "Claude Sonnet 5.5 · gründlich",
      },
      { id: "openai/gpt-5.5", label: "GPT-5.5 · gründlich" },
    ],
  },
];

export const ASK_PROVIDER_BY_ID: Readonly<
  Record<AskProviderId, AskProviderDef>
> = Object.fromEntries(ASK_PROVIDERS.map((p) => [p.id, p])) as Record<
  AskProviderId,
  AskProviderDef
>;

export function isAskProvider(value: unknown): value is AskProviderId {
  return typeof value === "string" && Object.hasOwn(ASK_PROVIDER_BY_ID, value);
}

/** Whether `model` is one the picker offers for `provider`. */
export function isAskModel(provider: AskProviderId, model: unknown): boolean {
  return ASK_PROVIDER_BY_ID[provider].models.some((m) => m.id === model);
}

/**
 * The provider a key's prefix suggests, longest prefix first (`sk-ant-`
 * and `sk-or-` before OpenAI's bare `sk-`); null when none fits. Only a
 * hint for the picker: the server's check against the provider decides.
 */
export function providerForKey(key: string): AskProviderId | null {
  const trimmed = key.trim();
  const byLength = [...ASK_PROVIDERS].sort(
    (a, b) => b.prefix.length - a.prefix.length
  );
  return byLength.find((p) => trimmed.startsWith(p.prefix))?.id ?? null;
}

/** A key as the card shows it once it is set: its start and its end. */
export function maskedKey(key: string): string {
  const k = key.trim();
  return k.length <= 12 ? "•••" : `${k.slice(0, 7)}…${k.slice(-4)}`;
}

/**
 * Whether a string can be a key at all: printable ASCII without spaces, of
 * a plausible length. It keeps a pasted sentence or a header injection
 * (a newline) from ever reaching a provider.
 */
export function plausibleKey(key: string): boolean {
  return /^[\u0021-\u007E]{20,300}$/u.test(key);
}

/**
 * The header that carries the visitor's key to the site's two routes —
 * never a body field or a URL, so no request log that records either
 * holds it. The routes forward it to the provider and drop it.
 */
export const ASK_KEY_HEADER = "x-frag-key";

// --- caps ---------------------------------------------------------------------

/**
 * What one conversation may hold and do. The visitor pays for it with
 * their key, the site for the function that relays it: a long or looping
 * conversation is cut off here, not by a bill.
 */
export const ASK_LIMITS = {
  /** characters of one question */
  questionChars: QUESTION_CHARS,
  /** messages the server takes (questions, answers, tool results): an
   *  answer with a search, a view and its follow-ups is seven of them;
   *  the characters below are the cost's real bound */
  messages: 48,
  /** characters of the whole conversation the server takes */
  conversationChars: 60_000,
  /** model turns of one request (each tool round is one) */
  iterations: 8,
  /** model turns of one answer, across the requests a scene tool resumes */
  answerRounds: 12,
  /** entries one search or neighbourhood tool returns */
  results: 12,
  /** the radius the neighbourhood tool reaches (m) */
  radius: 400,
  /** how long a checked key's token lasts (ms) */
  tokenMs: 12 * 3600 * 1000,
} as const;

/** What the server reads of a request beyond the messages. */
export interface AskRequestProps {
  model: string;
  provider: AskProviderId;
  site: string;
  token: string;
  /** the answers are read aloud (the Sprachführer): the prompt says so */
  voice: boolean;
}

/**
 * The request's `forwardedProps`, checked: a provider and one of its
 * curated models (no free model id, so a visitor's key cannot be pointed
 * at a model the site did not choose), a site id, and the token the key
 * check issued. A string naming the problem otherwise.
 */
export function parseAskProps(
  props: Record<string, unknown>
): AskRequestProps | string {
  const { model, provider, site, token, voice } = props;
  if (!isAskProvider(provider)) {
    return "unbekannter Anbieter";
  }
  if (typeof model !== "string" || !isAskModel(provider, model)) {
    return "unbekanntes Modell";
  }
  if (typeof site !== "string" || !/^[a-z]{2,24}$/u.test(site)) {
    return "unbekannte Stadt";
  }
  return {
    model,
    provider,
    site,
    token: typeof token === "string" ? token : "",
    voice: voice === true,
  };
}

/** The text of a message's content: a string, or its text parts. */
function contentText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((part: unknown) => {
      if (typeof part !== "object" || part === null) {
        return "";
      }
      const p = part as { content?: unknown; text?: unknown; type?: unknown };
      if (p.type !== "text") {
        return "";
      }
      if (typeof p.content === "string") {
        return p.content;
      }
      return typeof p.text === "string" ? p.text : "";
    })
    .join("");
}

/** The last question the visitor asked: the last user message's text. */
export function lastQuestion(messages: readonly unknown[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i] as {
      content?: unknown;
      parts?: unknown;
      role?: unknown;
    };
    if (m.role === "user") {
      return contentText(m.parts ?? m.content);
    }
  }
  return "";
}

/** The text a message carries, however a client shaped it. */
function messageChars(message: unknown): number {
  return JSON.stringify(message ?? "").length;
}

/**
 * Whether a conversation stays within the caps: a message count, the
 * whole conversation's characters and the last question's. Null when it
 * does, else the refusal's code (its words are `ASK_FAILURES`').
 */
export function conversationProblem(
  messages: readonly unknown[],
  question: string
): Extract<
  AskRefusalCode,
  "no-question" | "too-long" | "question-too-long"
> | null {
  if (messages.length === 0) {
    return "no-question";
  }
  if (messages.length > ASK_LIMITS.messages) {
    return "too-long";
  }
  const chars = messages.reduce<number>((n, m) => n + messageChars(m), 0);
  if (chars > ASK_LIMITS.conversationChars) {
    return "too-long";
  }
  if (question.length > ASK_LIMITS.questionChars) {
    return "question-too-long";
  }
  return null;
}
