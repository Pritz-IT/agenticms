import { PrismaClient } from '@prisma/client';
import { pathToFileURL } from 'node:url';
import bcrypt from 'bcrypt';

const DEFAULT_ADMIN_EMAIL = 'admin@agenticms.local';
const BCRYPT_ROUNDS = 10;

/**
 * Resolve the initial admin password from the environment.
 *
 * SECURITY: there is no default. A missing/blank ADMIN_PASSWORD throws, so the
 * seed can never create an admin with publicly-known credentials. (This closes
 * the default-credential takeover: previously ADMIN_PASSWORD fell back to the
 * hardcoded `admin123`, and the login endpoint is internet-reachable via nginx.)
 */
export function requireAdminPassword(env: NodeJS.ProcessEnv = process.env): string {
  const password = env.ADMIN_PASSWORD;
  if (!password || password.trim() === '') {
    throw new Error(
      'ADMIN_PASSWORD is required to seed the initial admin user — there is no default password. ' +
        'Set a strong ADMIN_PASSWORD (see .env.example) and redeploy.'
    );
  }
  return password;
}

/**
 * Idempotently seed the initial admin user.
 *
 * The password is required ONLY when an admin must actually be created: a fresh
 * deployment fails closed (throws) rather than creating a default-credential
 * admin, while an existing deployment keeps booting without re-supplying it.
 */
export async function seedAdminUser(
  prisma: PrismaClient,
  env: NodeJS.ProcessEnv = process.env
): Promise<{ created: boolean; email: string }> {
  const email = env.ADMIN_EMAIL ?? DEFAULT_ADMIN_EMAIL;

  const existingAdmin = await prisma.user.findFirst({
    where: { role: 'admin' },
    orderBy: { createdAt: 'asc' },
  });
  if (existingAdmin) {
    console.log(`Admin user already exists: ${existingAdmin.email}`);
    return { created: false, email: existingAdmin.email };
  }

  const password = requireAdminPassword(env);
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  await prisma.user.create({
    data: {
      email,
      passwordHash,
      role: 'admin',
    },
  });
  console.log(`Created admin user: ${email}`);
  return { created: true, email };
}

async function main() {
  const prisma = new PrismaClient();
  try {
    // 1. Admin user
    await seedAdminUser(prisma);

    // 2. Default site
    const demoSite = await prisma.site.upsert({
      where: { key: 'demo' },
      update: {
        name: 'Demo Site',
        domain: 'example.com',
        stagingDomain: 'staging.example.com',
        defaultLocale: 'de',
        siteUrl: 'https://example.com',
      },
      create: {
        key: 'demo',
        name: 'Demo Site',
        domain: 'example.com',
        stagingDomain: 'staging.example.com',
        defaultLocale: 'de',
        siteUrl: 'https://example.com',
      },
    });
    console.log('Upserted default site: demo.');

    // 3. Default locale
    const localeCount = await prisma.locale.count({ where: { siteId: demoSite.id } });
    if (localeCount > 0) {
      console.log('Locales already exist — skipping.');
    } else {
      await prisma.locale.create({
        data: {
          siteId: demoSite.id,
          code: 'de',
          label: 'Deutsch',
          isDefault: true,
        },
      });
      console.log('Created default locale: de (Deutsch).');
    }
  } finally {
    await prisma.$disconnect();
  }
}

// Only run the seed when executed directly (e.g. `node dist/seed.js`), not when
// imported by tests — importing must never connect to a database or run main().
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  });
}
