/**
 * Whether the scripted model answers (`FRAG_FAKE=1`, ADR 0056): local
 * tests only, never on a Vercel deployment, where a copied variable
 * would switch off the key check. Its own module so the key check's
 * function does not bundle the provider SDKs to read one variable.
 */
export function fakeModel(): boolean {
  return process.env.FRAG_FAKE === "1" && !process.env.VERCEL;
}
