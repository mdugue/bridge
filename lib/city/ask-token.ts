/**
 * The token a checked key earns (*Frag die Stadt*, ADR 0056): the key
 * check (`app/api/schluessel/route.ts`) asks the provider whether the
 * key works and, if it does, signs `provider.expiry.hash(key)` with the
 * site's secret (`FRAG_SECRET`). The chat route answers only a request
 * whose token matches its key and provider and has not expired — so the
 * route relays nothing for a key nobody checked, and a token is worth
 * nothing with another key. The key itself is never stored: only a hash
 * of it is signed, and only in the visitor's own token.
 *
 * Web Crypto only (Node, Bun and the browser have it); no state.
 */

const encoder = new TextEncoder();

function base64url(bytes: ArrayBuffer): string {
  let text = "";
  for (const b of new Uint8Array(bytes)) {
    text += String.fromCharCode(b);
  }
  return btoa(text)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

async function sha256(text: string): Promise<string> {
  return base64url(await crypto.subtle.digest("SHA-256", encoder.encode(text)));
}

async function sign(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return base64url(
    await crypto.subtle.sign("HMAC", key, encoder.encode(payload))
  );
}

/** Compares in time independent of where two strings first differ. */
function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** A token for `key` at `provider`, valid until `expires` (ms epoch). */
export async function issueAskToken(
  secret: string,
  provider: string,
  key: string,
  expires: number
): Promise<string> {
  const exp = String(Math.floor(expires));
  const sig = await sign(secret, `${provider}.${exp}.${await sha256(key)}`);
  return `v1.${exp}.${sig}`;
}

/** Whether `token` was issued for this key and provider and still holds. */
export async function verifyAskToken(
  secret: string,
  token: string,
  provider: string,
  key: string,
  now: number
): Promise<boolean> {
  const [version, exp, sig] = token.split(".");
  if (version !== "v1" || !exp || !sig || !/^\d+$/.test(exp)) {
    return false;
  }
  if (Number(exp) < now) {
    return false;
  }
  const expected = await sign(
    secret,
    `${provider}.${exp}.${await sha256(key)}`
  );
  return sameText(sig, expected);
}
