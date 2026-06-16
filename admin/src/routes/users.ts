import type { FastifyInstance, FastifyReply, FastifyBaseLogger } from "fastify";
import bcrypt from "bcrypt";

const BCRYPT_ROUNDS = 10;

interface CreateUserBody {
  email: string;
  password: string;
  role: "admin" | "editor";
}

interface UpdateUserBody {
  email?: string;
  role?: "admin" | "editor";
  password?: string;
}

export default async function usersRoutes(app: FastifyInstance) {
  app.addHook("onRequest", app.requireRole("admin"));

  // GET / — return all users ordered by createdAt desc (strip passwordHash)
  app.get("/", async (_request, reply) => {
    const users = await app.prisma.user.findMany({
      orderBy: { createdAt: "desc" },
    });
    const sanitized = users.map(({ passwordHash: _ph, ...rest }) => rest);
    return reply.send(sanitized);
  });

  // POST / — create user
  app.post<{ Body: CreateUserBody }>("/", async (request, reply) => {
    const { email, password, role } = request.body ?? {};

    if (!email || !password || !role) {
      return reply.status(400).send({ error: "email, password, and role are required" });
    }

    request.log.info({ op: "user.create", role }, "user.create requested");

    const existing = await app.prisma.user.findUnique({ where: { email } });
    if (existing) {
      return reply.status(409).send({ error: "Email already in use" });
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    const user = await app.prisma.user.create({
      data: { email, passwordHash, role },
    });

    const { passwordHash: _ph, ...sanitized } = user;
    request.log.info({ op: "user.create", userId: user.id, role: user.role }, "user.create done");
    return reply.status(201).send(sanitized);
  });

  // Update a user (email/role/password). PUT and PATCH share this handler —
  // the admin frontend sends PATCH for partial updates (incl. password change).
  async function updateUserById(
    id: string,
    body: UpdateUserBody,
    reply: FastifyReply,
    log: FastifyBaseLogger
  ) {
    const { email, role, password } = body ?? {};

    log.info({ op: "user.update", userId: id, changes: { email: email !== undefined, role: role !== undefined, password: password !== undefined } }, "user.update requested");

    const existing = await app.prisma.user.findUnique({ where: { id } });
    if (!existing) {
      log.info({ op: "user.update", userId: id }, "user.update NO-OP — nothing matched");
      return reply.status(404).send({ error: "User not found" });
    }

    const updateData: Record<string, unknown> = {};
    if (email !== undefined) updateData["email"] = email;
    if (role !== undefined) updateData["role"] = role;
    if (password !== undefined) updateData["passwordHash"] = await bcrypt.hash(password, BCRYPT_ROUNDS);

    const user = await app.prisma.user.update({
      where: { id },
      data: updateData,
    });

    const { passwordHash: _ph, ...sanitized } = user;
    log.info({ op: "user.update", userId: id }, "user.update done");
    return reply.send(sanitized);
  }

  // PUT /:id and PATCH /:id
  app.put<{ Params: { id: string }; Body: UpdateUserBody }>("/:id", (request, reply) =>
    updateUserById(request.params.id, request.body, reply, request.log)
  );
  app.patch<{ Params: { id: string }; Body: UpdateUserBody }>("/:id", (request, reply) =>
    updateUserById(request.params.id, request.body, reply, request.log)
  );

  // DELETE /:id — delete user (prevent self-deletion)
  app.delete<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const { id } = request.params;

    request.log.info({ op: "user.delete", userId: id }, "user.delete requested");

    if (request.user!.id === id) {
      request.log.warn({ op: "user.delete", userId: id }, "user.delete rejected — self-deletion");
      return reply.status(400).send({ error: "Cannot delete yourself" });
    }

    const existing = await app.prisma.user.findUnique({ where: { id } });
    if (!existing) {
      request.log.info({ op: "user.delete", userId: id }, "user.delete NO-OP — nothing matched");
      return reply.status(404).send({ error: "User not found" });
    }

    await app.prisma.user.delete({ where: { id } });
    request.log.info({ op: "user.delete", userId: id }, "user.delete done");
    return reply.send({ ok: true });
  });
}
