/**
 * What both routes of *Frag die Stadt* that spend a visitor's key check
 * first (ADR 0056): a plausible key, the site's secret on the host, and
 * the token the key check issued for this key and provider. A refusal
 * logs a status and a reason code — never the key, the token or the
 * conversation — and says the reason in words.
 */
import { type AskRequestProps, plausibleKey } from "@/lib/city/ask-city";
import { verifyAskToken } from "@/lib/city/ask-token";

/** A refused request: its reason as a code in the log, words for the
 *  visitor. */
export function refuse(
  status: number,
  code: string,
  message: string
): Response {
  console.warn(`[frag] ${status} ${code}`);
  return Response.json(
    { code, message },
    { status, headers: { "Cache-Control": "no-store" } }
  );
}

/** The refusal for a request that may not spend `key`, or null. */
export async function keyRefusal(
  props: AskRequestProps,
  key: string,
  fake: boolean
): Promise<Response | null> {
  if (!fake && !plausibleKey(key)) {
    return refuse(401, "no-key", "Ohne Schlüssel geht es nicht.");
  }
  const secret = process.env.FRAG_SECRET;
  // on the host the key check must hold: without its secret, no relay
  if (!(fake || secret) && process.env.VERCEL) {
    // 501, not 503: the client retries a 503 as a passing outage
    return refuse(
      501,
      "no-secret",
      "Frag die Stadt ist auf diesem Server nicht eingerichtet."
    );
  }
  if (
    !fake &&
    secret &&
    !(await verifyAskToken(
      secret,
      props.token,
      props.provider,
      key,
      Date.now()
    ))
  ) {
    return refuse(401, "bad-token", "Der Schlüssel muss neu geprüft werden.");
  }
  return null;
}
