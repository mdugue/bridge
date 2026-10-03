import { expect, test } from "bun:test";
import { apiOrigin, releaseBody, releasePlan } from "./sentry-release";

const SHA = "3b74f39d6894e26a36f2b11c18f242c961dc3b69";
const vercel = {
  NEXT_PUBLIC_SENTRY_DSN: "https://k3y@o1.ingest.de.sentry.io/42",
  SENTRY_AUTH_TOKEN: "sntrys_token",
  SENTRY_ORG: "acme",
  SENTRY_PROJECT: "bridge",
  VERCEL_ENV: "production",
  VERCEL_URL: "bridge-abc.vercel.app",
  VERCEL_GIT_COMMIT_SHA: SHA,
  VERCEL_GIT_COMMIT_MESSAGE: "feat: crash reports",
  VERCEL_GIT_COMMIT_AUTHOR_NAME: "Manuel",
  VERCEL_GIT_REPO_OWNER: "mdugue",
  VERCEL_GIT_REPO_SLUG: "bridge",
};

test("a Vercel build plans its release under the page's release name", () => {
  expect(releasePlan(vercel)).toEqual({
    api: "https://de.sentry.io/api/0/organizations/acme",
    token: "sntrys_token",
    project: "bridge",
    version: `bridge@${SHA}`,
    environment: "production",
    finalize: true,
    repository: "mdugue/bridge",
    commit: { id: SHA, message: "feat: crash reports", author_name: "Manuel" },
    url: "https://bridge-abc.vercel.app",
  });
  // A preview records its deploy but does not finalize.
  expect(releasePlan({ ...vercel, VERCEL_ENV: "preview" })).toMatchObject({
    environment: "preview",
    finalize: false,
  });
});

test("without the token or a release there is nothing to create", () => {
  expect(releasePlan({ ...vercel, SENTRY_AUTH_TOKEN: "" })).toEqual({
    skip: "SENTRY_AUTH_TOKEN unset",
  });
  expect(releasePlan({ ...vercel, VERCEL_GIT_COMMIT_SHA: undefined })).toEqual({
    skip: "no release (neither SENTRY_RELEASE nor a Vercel commit)",
  });
});

test("the API follows the DSN's region, or SENTRY_URL", () => {
  expect(apiOrigin("https://k@o1.ingest.de.sentry.io/42")).toBe(
    "https://de.sentry.io"
  );
  expect(apiOrigin("https://k@o1.ingest.sentry.io/42")).toBe(
    "https://sentry.io"
  );
  expect(apiOrigin("http://k@errors.example:9000/7")).toBe(
    "http://errors.example:9000"
  );
  // A self-hosted tracker under a path: its API lives under it too.
  expect(apiOrigin("https://k@example.org/sentry/3")).toBe(
    "https://example.org/sentry"
  );
  expect(apiOrigin(null, "https://glitchtip.example/")).toBe(
    "https://glitchtip.example"
  );
});

test("a connected repository is named by ref, else its commit is sent", () => {
  const plan = releasePlan(vercel);
  if ("skip" in plan) {
    throw new Error(plan.skip);
  }
  expect(releaseBody(plan, true)).toEqual({
    version: `bridge@${SHA}`,
    projects: ["bridge"],
    refs: [{ repository: "mdugue/bridge", commit: SHA }],
  });
  expect(releaseBody(plan, false)).toEqual({
    version: `bridge@${SHA}`,
    projects: ["bridge"],
    commits: [
      {
        id: SHA,
        message: "feat: crash reports",
        author_name: "Manuel",
        repository: "mdugue/bridge",
      },
    ],
  });
});
