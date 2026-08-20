import { defineConfig, devices } from "@playwright/test";

const PORT = 4322;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? "list" : [["list"]],
  use: {
    baseURL: `http://localhost:${String(PORT)}`,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // Serves the real build, not the dev server, so the test exercises the same
  // inlined island a visitor gets. `astro preview` daemonizes when stdout is
  // not a TTY, which Playwright reads as the server exiting, so serve dist
  // directly instead.
  webServer: {
    command: `pnpm build && python3 -m http.server ${String(PORT)} --directory dist --bind 127.0.0.1`,
    url: `http://localhost:${String(PORT)}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
