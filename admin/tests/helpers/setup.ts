import { execSync } from "child_process";

// Set test environment variables
process.env["DATABASE_URL"] ??= "postgresql://postgres:postgres@localhost:5435/agenticms_test";
process.env["JWT_SECRET"] = "test-jwt-secret-for-vitest-only";
process.env["INTERNAL_API_KEY"] = "test-internal-api-key";
process.env["WEBSITE_URL"] = "http://localhost:4321";
process.env["LAYOUTS_DIR"] = "./layouts";
process.env["ASSETS_DIR"] = "./assets";
process.env["BUILDS_DIR"] = "./builds-test";
// Functional suites must not be throttled; the dedicated rate-limit tests
// (submissions-ratelimit.test.ts / login-ratelimit.test.ts) override these
// before their own imports.
process.env["SUBMISSIONS_RATE_MAX"] = "1000";
process.env["LOGIN_RATE_MAX"] = "1000";

// Reset test database schema before tests
try {
  execSync("npx prisma db push --force-reset --skip-generate", {
    cwd: process.cwd(),
    env: { ...process.env },
    stdio: "pipe",
  });
} catch {
  // DB may not be available in CI — tests that need DB will fail naturally
}
