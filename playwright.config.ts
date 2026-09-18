import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.PORT ?? 3000);
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // Two retries of a four-minute software-GL spec cannot finish inside the CI
  // job budget — the job gets cancelled mid-upload and reports nothing useful.
  // One retry still absorbs a genuine flake and leaves headroom.
  retries: process.env.CI ? 1 : 0,
  // Software-rendered WebGL is CPU-bound, so parallel viewer pages steal frames
  // from each other: on a 4-core runner two workers roughly halve each spec's
  // frame rate and push both past their timeout. Serial is slower on paper and
  // far faster in practice here.
  workers: process.env.CI ? 1 : undefined,
  // Every frame of the viewer specs is software-rendered (SwiftShader) through
  // the full post stack, so they run minutes, not seconds; a shared CI runner
  // is about half the speed of a developer machine: measured on two cores, one
  // clay frame costs ~4 s and one ghost frame ~20 s, and the style walk waits on
  // 26 of them. This has to be the config default rather than
  // `test.setTimeout()` in the spec: under load the browser context itself can
  // take longer than Playwright's 30 s default to come up, and that happens
  // before any code in the test body runs.
  timeout: process.env.CI ? 600_000 : 240_000,
  reporter: "html",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // Build once and serve in CI; use the dev server locally for fast iteration.
  // NEXT_PUBLIC_POC_DEBUG exposes the window.__poc smoke-test hook in the CI
  // build (dev builds expose it automatically; real prod builds never do).
  webServer: {
    command: process.env.CI
      ? "NEXT_PUBLIC_POC_DEBUG=1 bun run build && bun run start"
      : "bun run dev",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
