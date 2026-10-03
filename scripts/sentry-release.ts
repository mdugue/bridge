import { reportBuild } from "../lib/city/crash-reports";

/**
 * Creates the build's release in Sentry, after `next build` (ADR 0043):
 * under the name the page tags its reports with (`reportBuild`, the one
 * place it is derived — two names would split a release's events from
 * its commits), with its commit and a deploy into the build's
 * environment; a production deploy also finalizes it ("resolve in the
 * next release" counts from there). Sentry's REST API: no sentry-cli, no
 * SDK.
 *
 * Commits: when the repository is connected to the Sentry organisation
 * (its GitHub integration), the release names its commit by ref and
 * Sentry fetches the commits since the previous release itself — suspect
 * commits, "Fixes BRIDGE-12A"; otherwise it carries the one commit Vercel
 * describes.
 *
 * Skips, and says so, without SENTRY_AUTH_TOKEN, SENTRY_ORG and
 * SENTRY_PROJECT (an organisation token is enough) or without a release
 * (a local build). A failed request warns and never fails the build: a
 * missing release is worth a line in the log, not a deploy. `bun run
 * build` runs it with NODE_ENV=production, so Bun reads the same
 * `.env.production` that `next build` gave next.config.ts.
 */

type Env = Record<string, string | undefined>;

export interface ReleasePlan {
  /** the organisation's API, `https://<region>.sentry.io/api/0/organizations/<org>` */
  api: string;
  token: string;
  project: string;
  version: string;
  environment: string;
  /** a production deploy finalizes its release */
  finalize: boolean;
  /** `owner/repo`, as Sentry names a connected repository */
  repository?: string;
  commit?: { id: string; message?: string; author_name?: string };
  /** the deployment's URL */
  url?: string;
}

/**
 * The Sentry API a DSN belongs to: its region's (`o1.ingest.de.sentry.io`
 * → `https://de.sentry.io`), sentry.io's, or a self-hosted tracker's own
 * host with the path it lives under (`https://k@host/sentry/3` →
 * `https://host/sentry`, as `envelopeUrl` sends there); SENTRY_URL
 * overrides it.
 */
export function apiOrigin(dsn: string | null, override?: string): string {
  if (override) {
    return override.replace(/\/+$/, "");
  }
  if (!dsn) {
    return "https://sentry.io";
  }
  const { protocol, host, hostname, pathname } = new URL(dsn);
  const region = /\.ingest\.([a-z]+)\.sentry\.io$/.exec(hostname)?.[1];
  if (region) {
    return `https://${region}.sentry.io`;
  }
  if (hostname.endsWith("sentry.io")) {
    return "https://sentry.io";
  }
  // The path before the project id.
  const prefix = pathname.split("/").filter(Boolean).slice(0, -1);
  return `${protocol}//${host}${prefix.map((part) => `/${part}`).join("")}`;
}

/** What to send, or why nothing is. */
export function releasePlan(env: Env): ReleasePlan | { skip: string } {
  const build = reportBuild(env);
  const missing = ["SENTRY_AUTH_TOKEN", "SENTRY_ORG", "SENTRY_PROJECT"].filter(
    (name) => !env[name]
  );
  if (missing.length > 0) {
    return { skip: `${missing.join(", ")} unset` };
  }
  if (!build.release) {
    return { skip: "no release (neither SENTRY_RELEASE nor a Vercel commit)" };
  }
  const sha = env.VERCEL_GIT_COMMIT_SHA;
  const owner = env.VERCEL_GIT_REPO_OWNER;
  const slug = env.VERCEL_GIT_REPO_SLUG;
  return {
    api: `${apiOrigin(build.dsn, env.SENTRY_URL)}/api/0/organizations/${env.SENTRY_ORG}`,
    token: env.SENTRY_AUTH_TOKEN ?? "",
    project: env.SENTRY_PROJECT ?? "",
    version: build.release,
    environment: build.environment,
    finalize: build.environment === "production",
    repository: owner && slug ? `${owner}/${slug}` : undefined,
    commit: sha
      ? {
          id: sha,
          message: env.VERCEL_GIT_COMMIT_MESSAGE,
          author_name: env.VERCEL_GIT_COMMIT_AUTHOR_NAME,
        }
      : undefined,
    url: env.VERCEL_URL ? `https://${env.VERCEL_URL}` : undefined,
  };
}

/**
 * The release's body: its commit by ref where Sentry knows the repository
 * (it then fetches the range since the previous release), else the commit
 * itself.
 */
export function releaseBody(plan: ReleasePlan, connected: boolean) {
  const body: Record<string, unknown> = {
    version: plan.version,
    projects: [plan.project],
  };
  if (plan.commit && plan.repository) {
    if (connected) {
      body.refs = [{ repository: plan.repository, commit: plan.commit.id }];
    } else {
      body.commits = [{ ...plan.commit, repository: plan.repository }];
    }
  }
  return body;
}

const say = (line: string) => process.stdout.write(`sentry-release: ${line}\n`);

async function call(
  plan: ReleasePlan,
  method: string,
  path: string,
  body?: unknown
): Promise<unknown> {
  const response = await fetch(`${plan.api}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${plan.token}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const text = (await response.text()).slice(0, 300);
    throw new Error(`${method} ${path}: ${response.status} ${text}`);
  }
  return response.status === 204 ? null : response.json();
}

/**
 * Whether Sentry knows the repository (its integration is connected). A
 * token that may not read the organisation's repositories gets the commit
 * sent itself rather than no release.
 */
async function connected(plan: ReleasePlan): Promise<boolean> {
  if (!plan.repository) {
    return false;
  }
  try {
    const repos = (await call(
      plan,
      "GET",
      `/repos/?query=${encodeURIComponent(plan.repository)}`
    )) as { name?: string }[];
    return repos.some((repo) => repo.name === plan.repository);
  } catch (error) {
    say(
      `could not read the connected repositories, sending the commit itself: ${error instanceof Error ? error.message : String(error)}`
    );
    return false;
  }
}

async function release(plan: ReleasePlan): Promise<void> {
  const linked = await connected(plan);
  await call(plan, "POST", "/releases/", releaseBody(plan, linked));
  const version = `/releases/${encodeURIComponent(plan.version)}/`;
  if (plan.finalize) {
    await call(plan, "PUT", version, {
      dateReleased: new Date().toISOString(),
    });
  }
  await call(plan, "POST", `${version}deploys/`, {
    environment: plan.environment,
    url: plan.url,
  });
  say(
    `${plan.version} · ${plan.environment}` +
      (plan.finalize ? " · finalized" : "") +
      (linked
        ? ` · commits from ${plan.repository}`
        : plan.commit
          ? " · its commit (connect the repository in Sentry for the range)"
          : " · no commit")
  );
}

if (import.meta.main) {
  const plan = releasePlan(process.env);
  if ("skip" in plan) {
    say(`skipped: ${plan.skip}`);
  } else {
    try {
      await release(plan);
    } catch (error) {
      say(
        `FAILED, the build goes on without it: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
