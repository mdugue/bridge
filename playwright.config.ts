import { defineConfig, devices } from "@playwright/test";

const PORT = 3000;
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
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
