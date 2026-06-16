import type { PrismaClient } from "@prisma/client";
import type { FastifyInstance as _FastifyInstance } from "fastify";
import type { LayoutModuleCache } from "./services/layout-module-cache.js";

declare module "fastify" {
  interface FastifyInstance {
    prisma: PrismaClient;
    layoutModuleCache: LayoutModuleCache;
  }

  interface FastifyRequest {
    user?: {
      id: string;
      email: string;
      role: string;
    };
  }
}
