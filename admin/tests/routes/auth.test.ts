import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { buildApp } from "../../src/app.js";
import type { FastifyInstance } from "fastify";
import { createTestUser } from "../helpers/auth.js";

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({ logger: false });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await app.prisma.refreshToken.deleteMany();
  await app.prisma.user.deleteMany();
});

// ---------------------------------------------------------------------------
// POST /api/auth/login
// ---------------------------------------------------------------------------
describe("POST /api/auth/login", () => {
  it("returns accessToken and sets httpOnly cookie on valid credentials", async () => {
    const { user, password } = await createTestUser(app, { role: "editor" });

    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: user.email, password },
    });

    expect(res.statusCode).toBe(200);

    const body = res.json();
    expect(body).toHaveProperty("accessToken");
    expect(typeof body.accessToken).toBe("string");
    expect(body.user).toMatchObject({
      id: user.id,
      email: user.email,
      role: user.role,
    });
    expect(body.user).not.toHaveProperty("passwordHash");

    const setCookie = res.headers["set-cookie"] as string | string[];
    const cookieHeader = Array.isArray(setCookie) ? setCookie.join("; ") : setCookie;
    expect(cookieHeader).toContain("refreshToken=");
    expect(cookieHeader).toContain("HttpOnly");
    expect(cookieHeader).toContain("Path=/api/auth");
  });

  it("returns 401 on wrong password", async () => {
    const { user } = await createTestUser(app, { role: "editor" });

    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: user.email, password: "wrong-password" },
    });

    expect(res.statusCode).toBe(401);
  });

  it("returns 401 on non-existent email", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "nobody@example.com", password: "any-password" },
    });

    expect(res.statusCode).toBe(401);
  });

  it("returns 400 when body fields are missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "missing-password@example.com" },
    });

    expect(res.statusCode).toBe(400);
  });

  it("does not leak account existence via response timing", async () => {
    // A real user with a wrong password runs bcrypt.compare. A non-existent
    // user must do equivalent work, otherwise response time is an enumeration
    // oracle. Compare medians over a few iterations to absorb jitter.
    const { user } = await createTestUser(app, { role: "editor" });

    const median = (xs: number[]) =>
      [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

    const time = async (payload: { email: string; password: string }) => {
      const t0 = performance.now();
      await app.inject({ method: "POST", url: "/api/auth/login", payload });
      return performance.now() - t0;
    };

    const existing: number[] = [];
    const missing: number[] = [];
    for (let i = 0; i < 5; i++) {
      existing.push(await time({ email: user.email, password: "wrong-pw" }));
      missing.push(await time({ email: `ghost-${i}@example.com`, password: "wrong-pw" }));
    }

    const mE = median(existing);
    const mM = median(missing);
    // Pre-fix the missing-user path skips bcrypt entirely (ratio ~0.05).
    // After the fix both run one bcrypt.compare and are comparable.
    expect(mM).toBeGreaterThan(mE * 0.5);
  });
});

// ---------------------------------------------------------------------------
// POST /api/auth/refresh
// ---------------------------------------------------------------------------
describe("POST /api/auth/refresh", () => {
  it("returns new accessToken for a valid refresh cookie", async () => {
    const { user, password } = await createTestUser(app, { role: "admin" });

    // First login to get a cookie
    const loginRes = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: user.email, password },
    });

    expect(loginRes.statusCode).toBe(200);

    const setCookie = loginRes.headers["set-cookie"] as string | string[];
    const cookieStr = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    // Extract raw cookie value for subsequent requests
    const cookieValue = cookieStr?.split(";")[0] ?? "";

    const refreshRes = await app.inject({
      method: "POST",
      url: "/api/auth/refresh",
      headers: { cookie: cookieValue },
    });

    expect(refreshRes.statusCode).toBe(200);
    const body = refreshRes.json();
    expect(body).toHaveProperty("accessToken");
    expect(typeof body.accessToken).toBe("string");
  });

  it("returns 401 when no cookie is present", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/refresh",
    });

    expect(res.statusCode).toBe(401);
  });

  it("returns 401 for an invalid/unknown refresh token", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/refresh",
      headers: { cookie: "refreshToken=totally-invalid-token-value" },
    });

    expect(res.statusCode).toBe(401);
  });

  const cookieOf = (res: { headers: Record<string, unknown> }) => {
    const sc = res.headers["set-cookie"] as string | string[];
    const first = Array.isArray(sc) ? sc[0] : sc;
    return first?.split(";")[0] ?? "";
  };

  it("rotates the refresh token: the old cookie stops working, the new one works", async () => {
    const { user, password } = await createTestUser(app, { role: "admin" });

    const loginRes = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: user.email, password },
    });
    const oldCookie = cookieOf(loginRes);

    const refreshRes = await app.inject({
      method: "POST",
      url: "/api/auth/refresh",
      headers: { cookie: oldCookie },
    });
    expect(refreshRes.statusCode).toBe(200);
    const newCookie = cookieOf(refreshRes);
    // A fresh refresh cookie must be issued and must differ from the old one.
    expect(newCookie).toContain("refreshToken=");
    expect(newCookie).not.toBe(oldCookie);

    // New cookie works.
    const withNew = await app.inject({
      method: "POST",
      url: "/api/auth/refresh",
      headers: { cookie: newCookie },
    });
    expect(withNew.statusCode).toBe(200);
  });

  it("detects refresh-token reuse and revokes the whole session family", async () => {
    const { user, password } = await createTestUser(app, { role: "admin" });

    const loginRes = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: user.email, password },
    });
    const stolenCookie = cookieOf(loginRes);

    // Legit client rotates once.
    const rotated = await app.inject({
      method: "POST",
      url: "/api/auth/refresh",
      headers: { cookie: stolenCookie },
    });
    const livingCookie = cookieOf(rotated);
    expect(rotated.statusCode).toBe(200);

    // Attacker replays the already-rotated (now revoked) token.
    const replay = await app.inject({
      method: "POST",
      url: "/api/auth/refresh",
      headers: { cookie: stolenCookie },
    });
    expect(replay.statusCode).toBe(401);

    // Reuse must invalidate the entire family — even the legit living token.
    const afterReuse = await app.inject({
      method: "POST",
      url: "/api/auth/refresh",
      headers: { cookie: livingCookie },
    });
    expect(afterReuse.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// POST /api/auth/logout
// ---------------------------------------------------------------------------
describe("POST /api/auth/logout", () => {
  it("revokes refresh token so subsequent refresh fails", async () => {
    const { user, password } = await createTestUser(app);

    // Login
    const loginRes = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: user.email, password },
    });

    expect(loginRes.statusCode).toBe(200);

    const setCookie = loginRes.headers["set-cookie"] as string | string[];
    const cookieStr = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    const cookieValue = cookieStr?.split(";")[0] ?? "";

    // Logout
    const logoutRes = await app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: { cookie: cookieValue },
    });

    expect(logoutRes.statusCode).toBe(200);
    expect(logoutRes.json()).toEqual({ ok: true });

    // Subsequent refresh must fail
    const refreshRes = await app.inject({
      method: "POST",
      url: "/api/auth/refresh",
      headers: { cookie: cookieValue },
    });

    expect(refreshRes.statusCode).toBe(401);
  });

  it("returns ok:true even without a cookie", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/logout",
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });
});
