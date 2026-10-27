import { Prisma, type PrismaClient } from "@prisma/client";
import type { FastifyBaseLogger } from "fastify";
import { log } from "../../logging.js";
import { LayoutKindError, requireLayoutOfKind } from "./layout-kind.js";
import { assertNoRouteCollisions, collectSiteRoutes, lockSiteRoutes, RouteCollisionError } from "./route-lock.js";

export type MasterdataKind = "category" | "tag";
export type MasterdataAction = "create" | "update" | "delete";

export class MasterdataError extends Error {
  constructor(public readonly statusCode: 400 | 404 | 409, message: string) {
    super(message);
    this.name = "MasterdataError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function findBloglistReferences(
  prisma: Prisma.TransactionClient,
  siteId: string,
  kind: MasterdataKind,
  key: string,
  logger: FastifyBaseLogger = log,
): Promise<string[]> {
  const site = await prisma.site.findUniqueOrThrow({ where: { id: siteId }, select: { defaultLocale: true } });
  const contents = await prisma.content.findMany({
    where: { page: { siteId }, type: "bloglist", locale: site.defaultLocale },
    select: { id: true, value: true, page: { select: { path: true } } },
  });
  const paths = new Set<string>();
  const field = kind === "category" ? "categories" : "tags";
  for (const content of contents) {
    if (!content.value.trim()) continue;
    let filter: unknown;
    try {
      filter = JSON.parse(content.value);
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      logger.warn({ siteId, contentId: content.id }, "bloglist reference check skipped invalid JSON");
      continue;
    }
    if (isRecord(filter) && Array.isArray(filter[field]) && filter[field].includes(key)) paths.add(content.page.path);
  }
  return [...paths].sort();
}

const categoryInclude = { names: true, page: { select: { path: true } }, defaultLayout: { select: { name: true } } } as const;

type MasterdataRecord = {
  key: string;
  sortOrder: number;
  names: { locale: string; name: string }[];
  page?: { path: string };
  defaultLayout?: { name: string };
};

function serialize(record: MasterdataRecord) {
  return {
    key: record.key,
    sortOrder: record.sortOrder,
    names: Object.fromEntries(record.names.map(({ locale, name }) => [locale, name])),
    ...(record.page && { pagePath: record.page.path }),
    ...(record.defaultLayout && { defaultLayout: record.defaultLayout.name }),
  };
}

export async function listBlogMasterdata(prisma: Prisma.TransactionClient, siteId: string, kind: MasterdataKind) {
  const orderBy = [{ sortOrder: "asc" }, { key: "asc" }] satisfies Prisma.BlogTagOrderByWithRelationInput[];
  const records = kind === "category"
    ? await prisma.blogCategory.findMany({ where: { siteId }, orderBy, include: categoryInclude })
    : await prisma.blogTag.findMany({ where: { siteId }, orderBy, include: { names: true } });
  return records.map(serialize);
}

async function validateBody(tx: Prisma.TransactionClient, siteId: string, kind: MasterdataKind, body: unknown, existingKey?: string) {
  if (!isRecord(body)) throw new MasterdataError(400, "Body must be an object");
  const allowed = ["key", "sortOrder", "names", ...(kind === "category" ? ["pagePath", "defaultLayout"] : [])];
  if (Object.keys(body).some((field) => !allowed.includes(field))) throw new MasterdataError(400, "Unknown masterdata field");
  const key = body.key ?? existingKey;
  if (typeof key !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(key)) {
    throw new MasterdataError(400, "key must contain lowercase letters, digits and single hyphens");
  }
  if (existingKey !== undefined && key !== existingKey) throw new MasterdataError(400, "key cannot be changed");
  if ("key" in body && body.key !== key) throw new MasterdataError(400, "key must be a string");
  const sortOrder = body.sortOrder;
  if (sortOrder !== undefined && (typeof sortOrder !== "number" || !Number.isInteger(sortOrder) || sortOrder < -2147483648 || sortOrder > 2147483647)) {
    throw new MasterdataError(400, "sortOrder must be a 32-bit integer");
  }
  let names: { locale: string; name: string }[] | undefined;
  if (existingKey === undefined || "names" in body) {
    if (!isRecord(body.names)) throw new MasterdataError(400, "names must be a locale-to-name object");
    const locales = await tx.locale.findMany({ where: { siteId }, select: { code: true } });
    names = Object.entries(body.names).map(([locale, name]) => {
      if (!locales.some(({ code }) => code === locale)) throw new MasterdataError(400, `Locale ${locale} is not configured for this site`);
      if (typeof name !== "string" || !name.trim()) throw new MasterdataError(400, `Name for ${locale} cannot be empty`);
      return { locale, name };
    });
  }
  let pageId: string | undefined;
  let defaultLayoutId: string | undefined;
  if (kind === "category") {
    if (existingKey === undefined || "pagePath" in body) {
      if (typeof body.pagePath !== "string" || !body.pagePath.startsWith("/") || body.pagePath === "/") {
        throw new MasterdataError(400, "pagePath must reference a non-root page");
      }
      const page = await tx.page.findUnique({ where: { siteId_path: { siteId, path: body.pagePath } } });
      if (!page) throw new MasterdataError(400, "Page not found for this site");
      pageId = page.id;
    }
    if (existingKey === undefined || "defaultLayout" in body) {
      if (typeof body.defaultLayout !== "string" || !body.defaultLayout.trim()) throw new MasterdataError(400, "defaultLayout must be a layout name");
      const layouts = await tx.layout.findMany({ where: { siteId, name: body.defaultLayout, kind: "post" }, select: { id: true }, take: 2 });
      if (layouts.length !== 1) throw new MasterdataError(400, layouts.length ? "Post layout name is ambiguous" : "Post layout not found for this site");
      defaultLayoutId = (await requireLayoutOfKind(tx, siteId, layouts[0].id, "post")).id;
    }
  }
  return { key, sortOrder, names, pageId, defaultLayoutId };
}

export async function mutateBlogMasterdata(
  prisma: PrismaClient,
  siteId: string,
  kind: MasterdataKind,
  action: MasterdataAction,
  key: string | undefined,
  body: unknown,
  logger: FastifyBaseLogger = log,
) {
  const context = { op: `blog.${kind}.${action}`, siteId, key: key ?? (isRecord(body) && typeof body.key === "string" ? body.key : undefined) };
  logger.info(context, `${context.op} requested`);
  try {
    const result = await prisma.$transaction(async (tx) => {
      await lockSiteRoutes(tx, siteId);
      const where = { siteId_key: { siteId, key: key ?? "" } };
      const existing = action === "create" ? null : kind === "category"
        ? await tx.blogCategory.findUnique({ where, include: categoryInclude })
        : await tx.blogTag.findUnique({ where, include: { names: true } });
      if (action !== "create" && !existing) throw new MasterdataError(404, `Blog ${kind} not found`);
      if (action === "delete") {
        const posts = await tx.blogPost.findMany({
          where: { siteId, ...(kind === "category" ? { categoryId: existing!.id } : { tags: { some: { tagId: existing!.id } } }) },
          select: { key: true }, orderBy: { key: "asc" },
        });
        const pages = await findBloglistReferences(tx, siteId, kind, existing!.key, logger);
        if (posts.length || pages.length) {
          throw new MasterdataError(409, `Blog ${kind} is used by ${[
            ...posts.map((post) => `post ${post.key}`), ...pages.map((path) => `page ${path}`),
          ].join(", ")}`);
        }
        if (kind === "category") await tx.blogCategory.delete({ where });
        else await tx.blogTag.delete({ where });
        return { value: { ok: true }, changed: true };
      }
      const data = await validateBody(tx, siteId, kind, body, existing?.key);
      const changed = !existing || (data.sortOrder !== undefined && data.sortOrder !== existing.sortOrder)
        || (data.pageId !== undefined && "pageId" in existing && data.pageId !== existing.pageId)
        || (data.defaultLayoutId !== undefined && "defaultLayoutId" in existing && data.defaultLayoutId !== existing.defaultLayoutId)
        || (data.names !== undefined && (data.names.length !== existing.names.length
          || data.names.some(({ locale, name }) => !existing.names.some((entry) => entry.locale === locale && entry.name === name))));
      if (!changed) return { value: serialize(existing!), changed: false };
      const names = data.names === undefined ? undefined : { ...(existing && { deleteMany: {} }), create: data.names };
      const common = { sortOrder: data.sortOrder, names };
      let saved: MasterdataRecord;
      if (kind === "category") {
        saved = existing
          ? await tx.blogCategory.update({ where, data: { ...common, pageId: data.pageId, defaultLayoutId: data.defaultLayoutId }, include: categoryInclude })
          : await tx.blogCategory.create({ data: { ...common, siteId, key: data.key, pageId: data.pageId!, defaultLayoutId: data.defaultLayoutId! }, include: categoryInclude });
        assertNoRouteCollisions(await collectSiteRoutes(tx, siteId));
      } else {
        saved = existing
          ? await tx.blogTag.update({ where, data: common, include: { names: true } })
          : await tx.blogTag.create({ data: { ...common, siteId, key: data.key }, include: { names: true } });
      }
      return { value: serialize(saved), changed: true };
    }, { timeout: 15000 });
    logger.info(context, result.changed ? `${context.op} done` : `${context.op} NO-OP — unchanged`);
    return result.value;
  } catch (error) {
    const rejection = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
      ? new MasterdataError(409, `Blog ${kind} key${kind === "category" ? " or page" : ""} is already in use`)
      : error;
    if (rejection instanceof MasterdataError || rejection instanceof LayoutKindError || rejection instanceof RouteCollisionError) {
      logger.warn({ ...context, err: rejection }, `${context.op} rejected`);
      logger.info(context, `${context.op} NO-OP — rejected`);
    } else {
      logger.error({ ...context, err: error }, `${context.op} failed`);
      logger.info(context, `${context.op} NO-OP — rolled back`);
    }
    throw rejection;
  }
}
