import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { buildApp } from "../../src/app.js";
import type { FastifyInstance } from "fastify";
import { createTestUser, getAccessToken } from "../helpers/auth.js";

let app: FastifyInstance;
let adminToken: string;
let adminId: string;

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

  const { user: admin } = await createTestUser(app, { role: "admin", email: "admin@example.com" });
  adminToken = getAccessToken(admin);
  adminId = admin.id;
});

// ---------------------------------------------------------------------------
// GET /api/users
// ---------------------------------------------------------------------------
describe("GET /api/users", () => {
  it("lists users without password hashes", async () => {
    await createTestUser(app, { role: "editor", email: "editor@example.com" });

    const res = await app.inject({
      method: "GET",
      url: "/api/users",
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.length).toBeGreaterThanOrEqual(2);
    for (const user of body) {
      expect(user).not.toHaveProperty("passwordHash");
      expect(user).toHaveProperty("email");
      expect(user).toHaveProperty("role");
    }
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({ method: "GET", url: "/api/users" });
    expect(res.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// POST /api/users
// ---------------------------------------------------------------------------
describe("POST /api/users", () => {
  it("creates a user (201) and strips passwordHash", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/users",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { email: "new@example.com", password: "securepass", role: "editor" },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).toHaveProperty("id");
    expect(body.email).toBe("new@example.com");
    expect(body.role).toBe("editor");
    expect(body).not.toHaveProperty("passwordHash");
  });

  it("returns 409 for duplicate email", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/users",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { email: "admin@example.com", password: "x", role: "editor" },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: "Email already in use" });
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/users",
      payload: { email: "x@x.com", password: "x", role: "editor" },
    });
    expect(res.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// PUT /api/users/:id
// ---------------------------------------------------------------------------
describe("PUT /api/users/:id", () => {
  it("updates a user's role", async () => {
    const { user: target } = await createTestUser(app, { role: "editor", email: "target@example.com" });

    const res = await app.inject({
      method: "PUT",
      url: `/api/users/${target.id}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { role: "admin" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.role).toBe("admin");
    expect(body).not.toHaveProperty("passwordHash");
  });

  it("updates a user's password (hashed)", async () => {
    const { user: target } = await createTestUser(app, { role: "editor", email: "pwchange@example.com" });

    const res = await app.inject({
      method: "PUT",
      url: `/api/users/${target.id}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { password: "newpassword123" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).not.toHaveProperty("passwordHash");
  });

  it("returns 404 for unknown id", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/users/nonexistent-id",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { role: "editor" },
    });
    expect(res.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/users/:id
// ---------------------------------------------------------------------------
describe("DELETE /api/users/:id", () => {
  it("deletes a user", async () => {
    const { user: target } = await createTestUser(app, { role: "editor", email: "bye@example.com" });

    const res = await app.inject({
      method: "DELETE",
      url: `/api/users/${target.id}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });

    const remaining = await app.prisma.user.findUnique({ where: { id: target.id } });
    expect(remaining).toBeNull();
  });

  it("prevents self-deletion (400)", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/api/users/${adminId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: "Cannot delete yourself" });
  });

  it("returns 404 for unknown id", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/api/users/nonexistent-id",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/api/users/${adminId}`,
    });
    expect(res.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/users/:id — the admin frontend sends PATCH (incl. password
// change). Regression: this 404'd in prod ({"error":"Not Found"}).
// ---------------------------------------------------------------------------
describe("PATCH /api/users/:id", () => {
  it("changes a user's password (200), strips passwordHash, new password works", async () => {
    const { user: target } = await createTestUser(app, {
      role: "editor",
      email: "patchpw@example.com",
    });

    const res = await app.inject({
      method: "PATCH",
      url: `/api/users/${target.id}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { password: "brand-new-pw-123" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).not.toHaveProperty("passwordHash");

    // end-to-end: the new password actually authenticates
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "patchpw@example.com", password: "brand-new-pw-123" },
    });
    expect(login.statusCode).toBe(200);
  });

  it("returns 404 for a missing user", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/users/does-not-exist",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { role: "admin" },
    });
    expect(res.statusCode).toBe(404);
  });
});
