import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { requireAdminPassword, seedAdminUser } from "../../prisma/seed.js";

// A minimal fake prisma exposing only the `user` delegate methods seedAdminUser
// touches. Keeps the security assertion deterministic — no DB required, so this
// test proves the invariant even when the test Postgres is down.
function fakePrisma(existingUser: { id: string; email: string } | null) {
  const create = vi.fn().mockResolvedValue({ id: "created-id" });
  const findFirst = vi.fn().mockResolvedValue(existingUser);
  const client = { user: { findFirst, create } } as unknown as PrismaClient;
  return { client, create, findFirst };
}

describe("requireAdminPassword", () => {
  it("throws when ADMIN_PASSWORD is unset — there is NO default password", () => {
    expect(() => requireAdminPassword({})).toThrow(/ADMIN_PASSWORD is required/);
  });

  it("throws when ADMIN_PASSWORD is blank/whitespace", () => {
    expect(() => requireAdminPassword({ ADMIN_PASSWORD: "   " })).toThrow(/ADMIN_PASSWORD is required/);
  });

  it("returns exactly the configured password when set (no fallback)", () => {
    expect(requireAdminPassword({ ADMIN_PASSWORD: "s3cret-pw" })).toBe("s3cret-pw");
  });

  it("never resolves to the legacy hardcoded default 'admin123'", () => {
    expect(() => requireAdminPassword({})).toThrow();
    expect(requireAdminPassword({ ADMIN_PASSWORD: "anything-else" })).not.toBe("admin123");
  });
});

describe("seedAdminUser", () => {
  it("fails closed: throws and creates NO admin when ADMIN_PASSWORD is unset and none exists", async () => {
    const { client, create } = fakePrisma(null);
    await expect(
      seedAdminUser(client, { ADMIN_EMAIL: "ops@example.com" })
    ).rejects.toThrow(/ADMIN_PASSWORD is required/);
    expect(create).not.toHaveBeenCalled();
  });

  it("creates the admin with a bcrypt hash (never the plaintext) when ADMIN_PASSWORD is set", async () => {
    const { client, create } = fakePrisma(null);
    const res = await seedAdminUser(client, {
      ADMIN_EMAIL: "ops@example.com",
      ADMIN_PASSWORD: "a-strong-password",
    });
    expect(res).toEqual({ created: true, email: "ops@example.com" });
    expect(create).toHaveBeenCalledTimes(1);
    const data = (create.mock.calls[0][0] as { data: { email: string; passwordHash: string; role: string } }).data;
    expect(data.email).toBe("ops@example.com");
    expect(data.role).toBe("admin");
    expect(data.passwordHash).not.toBe("a-strong-password");
    expect(data.passwordHash.startsWith("$2")).toBe(true); // bcrypt hash prefix
  });

  it("defaults only the EMAIL (not the password) when ADMIN_EMAIL is unset", async () => {
    const { client, create } = fakePrisma(null);
    const res = await seedAdminUser(client, { ADMIN_PASSWORD: "pw" });
    expect(res.email).toBe("admin@agenticms.local");
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("is idempotent: skips creation and does NOT require a password when an admin already exists", async () => {
    const { client, create, findFirst } = fakePrisma({ id: "existing", email: "admin@old-name.local" });
    // Deliberately no ADMIN_PASSWORD: an existing deployment must keep booting.
    const res = await seedAdminUser(client, {});
    expect(res).toEqual({ created: false, email: "admin@old-name.local" });
    expect(findFirst).toHaveBeenCalledWith({
      where: { role: "admin" },
      orderBy: { createdAt: "asc" },
    });
    expect(create).not.toHaveBeenCalled();
  });
});
