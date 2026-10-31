/**
 * POST /api/schluessel — checks a visitor's key with its provider
 * (*Frag die Stadt*, ADR 0056) by a request that spends no tokens: the
 * provider's model list or its key record. A key that works earns a
 * token (lib/city/ask-token.ts) the chat route asks for. The key comes in
 * the `x-frag-key` header and goes nowhere but to the provider; it is
 * neither stored nor logged.
 */
import {
  ASK_KEY_HEADER,
  ASK_LIMITS,
  ASK_PROVIDER_BY_ID,
  type AskProviderDef,
  isAskProvider,
  plausibleKey,
} from "@/lib/city/ask-city";
import { issueAskToken } from "@/lib/city/ask-token";

export const maxDuration = 15;

function authHeaders(def: AskProviderDef, key: string): Record<string, string> {
  return def.check.auth === "anthropic"
    ? { "x-api-key": key, "anthropic-version": "2023-06-01" }
    : { Authorization: `Bearer ${key}` };
}

const answer = (status: number, body: Record<string, unknown>) =>
  Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });

/**
 * A key not taken: the reason as a code in the log (never the key) and
 * as words for the visitor.
 */
function refuse(status: number, code: string, message: string): Response {
  console.warn(`[schluessel] ${status} ${code}`);
  return answer(status, { ok: false, code, message });
}

export async function POST(request: Request): Promise<Response> {
  const key = request.headers.get(ASK_KEY_HEADER)?.trim() ?? "";
  const body = (await request.json().catch(() => null)) as {
    provider?: unknown;
  } | null;
  const provider = body?.provider;
  if (!isAskProvider(provider) || !plausibleKey(key)) {
    return refuse(400, "no-key", "Das ist kein Schlüssel.");
  }
  const def = ASK_PROVIDER_BY_ID[provider];
  // local tests only (app/api/frag/adapters.ts fakeAskAdapter)
  if (process.env.FRAG_FAKE === "1") {
    return answer(200, { ok: true, token: "", expires: Date.now() + 60_000 });
  }
  const secret = process.env.FRAG_SECRET;
  // the chat route refuses without it on the host: say so at the check
  if (!secret && process.env.VERCEL) {
    return refuse(
      501,
      "no-secret",
      "Frag die Stadt ist auf diesem Server nicht eingerichtet."
    );
  }
  let status: number;
  try {
    const res = await fetch(def.check.url, {
      headers: authHeaders(def, key),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    status = res.status;
    await res.body?.cancel();
  } catch {
    return refuse(
      502,
      "provider-unreachable",
      `${def.label} ist gerade nicht zu erreichen.`
    );
  }
  if (status === 401 || status === 403) {
    return refuse(
      401,
      "key-rejected",
      `${def.label} nimmt diesen Schlüssel nicht an.`
    );
  }
  if (status < 200 || status >= 300) {
    return refuse(
      502,
      `provider-${status}`,
      `${def.label} antwortet mit Status ${status}.`
    );
  }
  const expires = Date.now() + ASK_LIMITS.tokenMs;
  const token = secret
    ? await issueAskToken(secret, provider, key, expires)
    : "";
  return answer(200, { ok: true, token, expires });
}
