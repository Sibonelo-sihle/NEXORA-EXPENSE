import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: true,
  use: { headless: true },
  webServer: [
    {
      command: "NODE_ENV=production node dist-server/index.js",
      url: "http://127.0.0.1:3104",
      env: {
        PORT: "3104",
        SUPABASE_URL: "",
        SUPABASE_SERVICE_ROLE_KEY: "",
        APP_ORIGIN: "",
        CORS_ORIGINS: "http://localhost:3000",
      },
    },
    {
      command: "npm run server",
      url: "http://127.0.0.1:3103/api/health",
      env: {
        PORT: "3103",
        SUPABASE_URL: "",
        SUPABASE_SERVICE_ROLE_KEY: "",
        PAYFAST_MODE: "sandbox",
        APP_ORIGIN: "",
        CORS_ORIGINS: "http://localhost:3000",
      },
    },
    {
      command: "npm run dev -- --host 127.0.0.1 --port 3100",
      url: "http://127.0.0.1:3100",
      reuseExistingServer: false,
      env: { VITE_SUPABASE_URL: "", VITE_SUPABASE_ANON_KEY: "" },
    },
    {
      command: "npm run dev -- --host 127.0.0.1 --port 3101",
      url: "http://127.0.0.1:3101",
      reuseExistingServer: false,
      env: {
        VITE_SUPABASE_URL: "https://nexora-test.supabase.co",
        VITE_SUPABASE_ANON_KEY: "public-test-key",
      },
    },
  ],
});
