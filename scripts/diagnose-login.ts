/* eslint-disable no-console */
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

/**
 * Pourquoi `POST /auth/login` répond INVALID_CREDENTIALS.
 *
 *   pnpm ts-node -r tsconfig-paths/register scripts/diagnose-login.ts
 *
 * Volontairement sur un `PrismaClient` NU — sans l'extension multi-tenant et
 * sans RLS : on veut voir ce que la base contient RÉELLEMENT, pas ce que le
 * tenant courant laisse voir. C'est justement la différence entre les deux
 * qui révèle le cas « l'utilisateur existe, mais dans un autre tenant ».
 *
 * `AuthService.loginWithPassword` échoue si et seulement si l'une de ces
 * conditions est vraie ; le script les teste dans l'ordre :
 *   1. le tenant `gaatshort` n'existe pas ;
 *   2. aucune ligne `users` pour (tenant, e-mail) — seed jamais joué, ou joué
 *      sur une AUTRE base que celle que l'API utilise ;
 *   3. la ligne existe mais `passwordHash` est NULL (seed passé sans
 *      SEED_ADMIN_PASSWORD : il saute l'étape avec un simple avertissement) ;
 *   4. `deletedAt` non nul — le `where` du login l'exclut ;
 *   5. le hash ne vérifie pas le mot de passe fourni.
 */
const prisma = new PrismaClient();

const EMAIL = (process.env.SEED_ADMIN_EMAIL ?? 'admin@gaatshort.com').toLowerCase().trim();
const PASSWORD = process.env.SEED_ADMIN_PASSWORD;
const TENANT_SLUG = process.env.TENANCY_DEFAULT_SLUG ?? 'gaatshort';

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL ?? '(absente)';
  // L'URL est affichée SANS le mot de passe : ce script finira collé dans un
  // ticket ou un salon d'équipe.
  console.log(`Base      : ${url.replace(/:\/\/([^:]+):[^@]*@/, '://$1:***@')}`);
  console.log(`E-mail    : ${EMAIL}`);
  console.log(`Mot de passe fourni : ${PASSWORD ? 'oui' : 'NON (SEED_ADMIN_PASSWORD absent)'}\n`);

  const tenant = await prisma.tenant.findUnique({ where: { slug: TENANT_SLUG } });
  if (!tenant) {
    const all = await prisma.tenant.findMany({ select: { slug: true } });
    console.error(`✖ Tenant « ${TENANT_SLUG} » absent.`);
    console.error(`  Tenants présents : ${all.map((t) => t.slug).join(', ') || 'aucun'}`);
    console.error('  → Le seed n’a jamais tourné sur cette base : pnpm db:seed');
    return;
  }
  console.log(`✓ Tenant « ${tenant.slug} » : ${tenant.id} (statut ${tenant.status})`);

  const sameEmailAnywhere = await prisma.user.findMany({
    where: { email: EMAIL },
    select: { id: true, tenantId: true, status: true, deletedAt: true, passwordHash: true },
  });

  if (sameEmailAnywhere.length === 0) {
    const count = await prisma.user.count();
    console.error(`\n✖ Aucun utilisateur « ${EMAIL} », dans aucun tenant.`);
    console.error(`  Table users : ${count} ligne(s) au total.`);
    console.error('  → Cause la plus probable : le seed n’a pas créé le compte.');
    console.error('    Relancez `pnpm db:seed` et cherchez la ligne :');
    console.error(`    « ✓ ${EMAIL} (SUPER_ADMIN) »`);
    console.error('    Si vous voyez à la place « ⚠ SEED_ADMIN_PASSWORD absent »,');
    console.error('    c’est que le seed a tourné sans lire votre .env.');
    return;
  }

  const user = sameEmailAnywhere.find((u) => u.tenantId === tenant.id);
  if (!user) {
    console.error(`\n✖ « ${EMAIL} » existe, mais dans un AUTRE tenant :`);
    for (const other of sameEmailAnywhere) console.error(`    tenantId = ${other.tenantId}`);
    console.error(`  Le login est scopé au tenant résolu (${tenant.id}) : il ne le voit pas.`);
    console.error('  → Base amorcée avant un changement d’ID de tenant. `make reset` règle le cas.');
    return;
  }

  console.log(`✓ Utilisateur trouvé : ${user.id}`);
  console.log(`  statut = ${user.status}, deletedAt = ${user.deletedAt ?? 'null'}`);

  if (user.deletedAt) {
    console.error('\n✖ `deletedAt` non nul — le `where` du login exclut cette ligne.');
    return;
  }
  if (!user.passwordHash) {
    console.error('\n✖ `passwordHash` est NULL : le compte existe mais sans mot de passe.');
    console.error('  → Le seed a tourné sans SEED_ADMIN_PASSWORD. Renseignez-le, puis pnpm db:seed');
    return;
  }

  console.log(`  passwordHash = ${user.passwordHash.slice(0, 32)}…`);

  if (!PASSWORD) {
    console.error('\n✖ SEED_ADMIN_PASSWORD absent de l’environnement : vérification impossible.');
    return;
  }

  const ok = await argon2.verify(user.passwordHash, PASSWORD);
  if (ok) {
    console.log('\n✓ Le hash vérifie bien SEED_ADMIN_PASSWORD.');
    console.log('  La base est correcte : si l’API renvoie quand même 401, c’est que');
    console.log('  l’API ne lit PAS cette base — comparez son DATABASE_URL avec l’URL ci-dessus.');
  } else {
    console.error('\n✖ Le hash ne vérifie PAS la valeur actuelle de SEED_ADMIN_PASSWORD.');
    console.error('  → Le mot de passe du .env a changé depuis le dernier seed.');
    console.error('    `pnpm db:seed` réécrit le hash (update: { passwordHash }).');
  }

  const roles = await prisma.userRole.findMany({
    where: { userId: user.id },
    select: { role: { select: { key: true } } },
  });
  console.log(`\nRôles : ${roles.map((r) => r.role.key).join(', ') || 'AUCUN'}`);
  if (roles.length === 0) {
    console.warn('  ⚠ Sans rôle, la connexion réussit mais le back-office refusera les écrans.');
  }
}

main()
  .catch((error) => {
    console.error('✖ Le diagnostic a échoué :', error);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
