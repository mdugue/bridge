/**
 * What the legal pages (/impressum, /datenschutz) say about this
 * deployment, read from the build's environment (ADR 0045): who runs it,
 * and where its crash reports go. Pure, no DOM.
 *
 * The operator is not in the repository: a deployment names its own (a
 * fork is someone else's site), and a private address stays out of git.
 * Set on the host, for the production build:
 *
 * - `IMPRESSUM_NAME` — the person (or body) responsible
 * - `IMPRESSUM_ADDRESS` — a postal address that takes letters; lines
 *   separated by newlines, or by commas
 * - `IMPRESSUM_EMAIL`
 * - `IMPRESSUM_PHONE` — optional
 */

type Env = Record<string, string | undefined>;

/** The variables an Impressum cannot do without. */
export const OPERATOR_VARS = [
  "IMPRESSUM_NAME",
  "IMPRESSUM_ADDRESS",
  "IMPRESSUM_EMAIL",
] as const;

/** Who runs this deployment — the Impressum's provider, the controller. */
export interface Operator {
  name: string;
  /** the postal address, one line each */
  address: string[];
  email: string;
  phone?: string;
}

/** A variable's value, trimmed; an empty one is not set. */
const value = (env: Env, key: string) => {
  const v = env[key]?.trim();
  return v === "" ? undefined : v;
};

/** The address's lines: by newline (a literal `\n` too), else by comma. */
export function addressLines(address: string): string[] {
  const unescaped = address.replaceAll("\\n", "\n");
  const lines = unescaped.includes("\n")
    ? unescaped.split("\n")
    : unescaped.split(",");
  return lines.map((line) => line.trim()).filter(Boolean);
}

/**
 * The operator from the build's environment, or null with the variables
 * that are missing — the pages then say so instead of guessing.
 */
export function operatorFrom(env: Env): {
  operator: Operator | null;
  missing: string[];
} {
  const missing = OPERATOR_VARS.filter((key) => !value(env, key));
  const name = value(env, "IMPRESSUM_NAME");
  const address = value(env, "IMPRESSUM_ADDRESS");
  const email = value(env, "IMPRESSUM_EMAIL");
  if (!(name && address && email)) {
    return { operator: null, missing };
  }
  const phone = value(env, "IMPRESSUM_PHONE");
  return {
    operator: {
      name,
      address: addressLines(address),
      email,
      ...(phone ? { phone } : {}),
    },
    missing,
  };
}

/**
 * Where a DSN's reports end up, as the privacy page names it: Sentry by
 * its region (its EU region ingests at `*.ingest.de.sentry.io` and keeps
 * the data in Germany), or any other tracker that speaks Sentry's
 * protocol by its host. Null without a DSN (the reports are off).
 */
export type Tracker =
  | { kind: "sentry"; region: "eu" | "us" }
  | { kind: "other"; host: string };

export function trackerOf(dsn: string | null): Tracker | null {
  if (!dsn) {
    return null;
  }
  let host: string;
  try {
    host = new URL(dsn).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (host === "sentry.io" || host.endsWith(".sentry.io")) {
    return {
      kind: "sentry",
      region: host.split(".").includes("de") ? "eu" : "us",
    };
  }
  return { kind: "other", host };
}
