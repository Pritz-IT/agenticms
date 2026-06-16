import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import type { FastifyInstance } from "fastify";
import type { User } from "@prisma/client";

const BCRYPT_ROUNDS = 10;

interface CreateTestUserOptions {
  email?: string;
  role?: "admin" | "editor";
}

interface TestUser {
  user: User;
  password: string;
}

export async function createTestUser(
  app: FastifyInstance,
  overrides: CreateTestUserOptions = {}
): Promise<TestUser> {
  const password = "test-password-" + Math.random().toString(36).slice(2);
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  const user = await app.prisma.user.create({
    data: {
      email: overrides.email ?? `test-${Date.now()}@example.com`,
      passwordHash,
      role: overrides.role ?? "editor",
    },
  });

  return { user, password };
}

export function getAccessToken(user: Pick<User, "id" | "email" | "role">): string {
  const secret = process.env["JWT_SECRET"];
  if (!secret) throw new Error("JWT_SECRET not set");

  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      role: user.role,
    },
    secret,
    { expiresIn: "15m" }
  );
}
