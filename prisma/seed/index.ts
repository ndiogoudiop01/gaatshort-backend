import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * `ts-node prisma/seed/index.ts` ne passe pas par Nest : sans ceci, le `.env`
 * n'était pas chargé et `SEED_ADMIN_EMAIL` retombait sur
 * `admin@gaatshort.local` — d'où un 401 en se connectant avec l'adresse du
 * `.env`. Les variables déjà définies dans le shell restent prioritaires.
 */
const envFile = resolve(__dirname, '../../.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const { PrismaClient } = require('@prisma/client');
import { seedAdminUser } from './admin-user.seed';
import { seedPermissions } from './permissions.seed';
import { seedReferenceData } from './reference-data.seed';
import { seedTenant } from './tenant.seed';
import { seedCatalog } from './catalog.seed';

/**
 * Amorçage : référentiels globaux, permissions, puis un tenant de démonstration.
 * Idempotent — rejouable autant de fois que nécessaire sans dupliquer.
 */
const prisma = new PrismaClient();

/**
 * Ce script écrit un tenant de DÉMONSTRATION et écrase du paramétrage
 * (plusieurs `upsert` ont un `update:` non vide). Rien n'empêchait de le
 * lancer sur une base de production : `pnpm db:seed` ne lit que
 * `DATABASE_URL`, qu'un `.env` mal copié ou une variable héritée du shell
 * suffit à faire pointer ailleurs. Contrairement à `prisma migrate reset`,
 * qui refuse de lui-même en production, `db:seed` n'avait aucun garde-fou.
 *
 * La garde ne déclenche que si `NODE_ENV` vaut explicitement `production`
 * (elle ne gêne donc ni le développement local, où la variable est souvent
 * absente, ni la CI, qui n'appelle jamais ce script). `ALLOW_PRODUCTION_SEED=true`
 * reste la porte de sortie pour le cas légitime : amorcer les référentiels
 * d'un environnement neuf.
 */
function assertSeedingIsAllowed(): void {
  if (process.env.NODE_ENV !== 'production') return;
  // `--allow-production` (via `pnpm db:seed:prod`) plutôt qu'une variable
  // d'environnement seule : `ALLOW_PRODUCTION_SEED=true pnpm …` ne fonctionne
  // pas sous cmd.exe / PowerShell, et un `cross-env` de plus n'est pas
  // nécessaire pour ça. Les deux formes restent acceptées.
  if (process.argv.includes('--allow-production') || process.env.ALLOW_PRODUCTION_SEED === 'true') {
    console.warn('⚠ NODE_ENV=production et ALLOW_PRODUCTION_SEED=true — amorçage forcé.');
    return;
  }
  console.error(
    '✖ Refus d’amorcer : NODE_ENV=production.\n' +
      '  Ce seed écrit un tenant de démonstration et écrase du paramétrage existant.\n' +
      '  Si c’est réellement voulu (environnement neuf à amorcer), relancez avec\n' +
      '  `pnpm db:seed:prod`.',
  );
  process.exit(1);
}

async function main(): Promise<void> {
  assertSeedingIsAllowed();
  console.log('► Référentiels globaux (pays, devises)…');
  await seedReferenceData(prisma);
  console.log('► Marque maison « gaatshort »…');
  const tenant = await seedTenant(prisma);
  console.log('► Permissions et rôles système…');
  await seedPermissions(prisma, tenant.id);
  console.log('► Compte administrateur du back-office…');
  await seedAdminUser(prisma, tenant.id);
  console.log('► Genres, packs de crédits et catalogue de démonstration…');
  await seedCatalog(prisma, tenant.id);
  console.log('✓ Amorçage terminé');
}

main()
  .catch((error) => {
    console.error('✖ Échec de l’amorçage :', error);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
