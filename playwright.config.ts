import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.PORT ?? 3000);
const baseURL = `http://localhost:${PORT}`;

/**
 * The viewer specs run against a PRODUCTION build by default, locally as well
 * as on CI. Two reasons: `next dev` serves unminified modules through
 * Turbopack, and React StrictMode double-mounts the viewer effect, so the dev
 * server boots the whole scene twice (the first instance is aborted, but only
 * after it has started fetching tiles). Set `E2E_DEV=1` to point the suite at
 * `bun dev` instead when iterating on a spec — or just leave `bun dev`
 * running, which `reuseExistingServer` picks up.
 *
 * On CI the build is an explicit workflow step (it doubles as the build check),
 * so the web server only has to start.
 */
function serverCommand(): string {
  if (process.env.CI) {
    return "bun run start";
  }
  if (process.env.E2E_DEV) {
    return "bun run dev";
  }
  // NEXT_PUBLIC_POC_DEBUG exposes the window.__poc test hook; it is inlined at
  // build time, so a real production build never carries it.
  return "NEXT_PUBLIC_POC_DEBUG=1 bun run build && bun run start";
}

export default defineConfig({
  testDir: "./e2e",
  // The --headed snapshot harness renders every shots/*.json at the full
  // profile and overwrites the PNGs; it only runs when asked for (bun run shots).
  testIgnore: process.env.SHOTS ? [] : ["**/snapshot-shot.spec.ts"],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // Software-rendered WebGL is CPU-bound, so parallel viewer pages steal frames
  // from each other: on a 4-core runner two workers roughly halve each spec's
  // frame rate and push both past their timeout. Serial is slower on paper and
  // far faster in practice here.
  workers: process.env.CI ? 1 : undefined,
  // Every frame of the viewer specs is still software-rendered (SwiftShader)
  // through the full post stack, so they run in tens of seconds, not
  // milliseconds. The `lite` scene profile (see app/_components/scene-profile.ts)
  // is what keeps that from being minutes: the specs load one tile instead of
  // four and shadow-map at 512² instead of 3072². This has to be the config
  // default rather than `test.setTimeout()` in the spec: under load the browser
  // context itself can take longer than Playwright's 30 s default to come up,
  // and that happens before any code in the test body runs.
  timeout: process.env.CI ? 180_000 : 120_000,
  // `github` annotates the failing line in the PR diff; `html` is the artifact
  // the workflow uploads. Locally the HTML report is enough.
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }]]
    : [["html", { open: "never" }]],
  use: {
    baseURL,
    // A first-attempt failure leaves something to look at (retries: 0 locally).
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: serverCommand(),
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    // A cold local production build has to fit in here too.
    timeout: 240_000,
  },
});
