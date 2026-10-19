import type { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { seedUserIdFor } from './fixed-ids';

/**
 * Compte SUPER_ADMIN pour se connecter au back-office (`POST /auth/login`).
 * Identifiants lus dans `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` : aucun
 * mot de passe n'est écrit en dur dans le dépôt. Sans mot de passe fourni,
 * l'étape est sautée.
 *
 * Rejouer le seed réinitialise le mot de passe à la valeur du `.env`.
 */
export async function seedAdminUser(
  prisma: PrismaClient,
  tenantId: string,
  tenantSlug = 'gaatshort',
): Promise<void> {
  const email = (process.env.SEED_ADMIN_EMAIL ?? 'admin@gaatshort.local').toLowerCase().trim();
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!password) {
    // En production, sauter silencieusement laisserait un environnement SANS
    // aucun compte d'administration, sans que personne ne le remarque avant
    // la première tentative de connexion : on échoue bruyamment.
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'SEED_ADMIN_PASSWORD est obligatoire en production : sans lui, aucun compte ' +
          "d'administration n'est créé et le back-office reste inaccessible.",
      );
    }
    console.warn('  ⚠ SEED_ADMIN_PASSWORD absent — compte administrateur non créé.');
    return;
  }

  // Mêmes paramètres que `PasswordHasher`, pour que le login vérifie ce hash.
  const passwordHash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: Number(process.env.ARGON2_MEMORY_COST ?? 19_456),
    timeCost: Number(process.env.ARGON2_TIME_COST ?? 2),
    parallelism: 1,
  });

  const user = await prisma.user.upsert({
    where: { tenantId_email: { tenantId, email } },
    create: {
      // ID stable : les jetons, favoris et fixtures qui le référencent
      // restent valides après un reset de la base.
      id: seedUserIdFor(tenantSlug, email),
      tenantId,
      email,
      passwordHash,
      firstName: 'Admin',
      lastName: 'Gaatshort',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
      // BSG-12 : le compte plateforme voit tous les pays du tenant.
      allCountries: true,
    },
    update: { passwordHash, status: 'ACTIVE', deletedAt: null, allCountries: true },
  });

  const role = await prisma.role.findUniqueOrThrow({
    where: { tenantId_key: { tenantId, key: 'SUPER_ADMIN' } },
  });
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: user.id, roleId: role.id } },
    create: { userId: user.id, roleId: role.id, tenantId },
    update: {},
  });

  console.log(`  ✓ ${email} (SUPER_ADMIN)`);
}
