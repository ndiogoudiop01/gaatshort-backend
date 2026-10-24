import type { PrismaClient } from '@prisma/client';

/**
 * Matrice RBAC.
 *
 * On raisonne en PERMISSIONS granulaires, pas en rôles : un rôle est un
 * simple paquet de permissions. Créer « Gestionnaire régional » demain ne
 * touche donc aucun contrôleur — seulement cette table.
 *
 * Noter la distinction `:any` / `:assigned` : un gestionnaire ne voit que
 * les dossiers qui lui sont attribués, un administrateur voit tout.
 */
export const PERMISSIONS = [
  // Catalogue (séries, épisodes, genres, médias)
  ['catalog:read', 'catalog', 'read'],
  ['catalog:write', 'catalog', 'write'],
  ['catalog:publish', 'catalog', 'publish'],
  ['media:upload', 'media', 'upload'],
  // Droits de diffusion
  ['license:read', 'license', 'read'],
  ['license:write', 'license', 'write'],
  // Vitrine de la marque (séries publiées, mise en avant, prix)
  ['storefront:write', 'storefront', 'write'],
  // Monétisation
  ['pack:write', 'pack', 'write'],
  ['order:read', 'order', 'read'],
  // Spectateurs et assistance
  ['viewer:read', 'viewer', 'read'],
  ['wallet:adjust', 'wallet', 'adjust'],
  // Pilotage
  ['metrics:read', 'metrics', 'read'],
  ['tenant:manage', 'tenant', 'manage'],
  ['user:manage', 'user', 'manage'],
] as const;

/** Libellé de chaque permission, renvoyé par `GET /admin/permissions` et affiché au back-office. */
export const DESCRIPTIONS: Record<string, string> = {
  'catalog:read': 'Consulter le catalogue (séries, épisodes, genres)',
  'catalog:write': 'Créer et modifier séries, épisodes et genres',
  'catalog:publish': 'Publier ou retirer une série ou un épisode du catalogue',
  'media:upload': 'Téléverser des vidéos et des sous-titres',
  'license:read': 'Consulter les licences de diffusion',
  'license:write': 'Enregistrer et modifier les licences de diffusion',
  'storefront:write': 'Choisir les séries diffusées par la marque, leur mise en avant et leurs prix',
  'pack:write': 'Gérer les packs de crédits et leurs prix',
  'order:read': 'Consulter les commandes et paiements',
  'viewer:read': 'Consulter les spectateurs, leur solde et leurs achats',
  'wallet:adjust': 'Ajuster les crédits d’un spectateur (motif obligatoire, audité)',
  'metrics:read': 'Consulter le tableau de bord',
  'tenant:manage': 'Administrer les marques (routes réservées au SUPER_ADMIN)',
  'user:manage': 'Gérer les comptes du back-office, rôles et permissions',
};

const ALL = PERMISSIONS.map(([key]) => key as string);

/**
 * Rôles système.
 *  • VIEWER : spectateur de l'application (aucun droit back-office).
 *  • CONTENT_MANAGER : opérateur de contenu (catalogue, médias, licences) ; ne publie pas.
 *  • SUPPORT : assistance (lecture spectateurs et commandes, ajustement de crédits).
 *  • ADMIN : responsable de la marque, tout sauf l'administration des marques.
 *  • SUPER_ADMIN : tout le catalogue de permissions.
 */
export const ROLES: Record<string, string[]> = {
  VIEWER: [],
  CONTENT_MANAGER: ['catalog:read', 'catalog:write', 'media:upload', 'license:read', 'metrics:read'],
  SUPPORT: ['catalog:read', 'viewer:read', 'order:read', 'wallet:adjust'],
  ADMIN: ALL.filter((k) => k !== 'tenant:manage'),
  SUPER_ADMIN: ALL,
};

/** Libellé affiché au back-office à la CRÉATION du rôle (jamais réécrit ensuite). */
export const ROLE_NAMES: Record<string, string> = {
  VIEWER: 'Spectateur',
  CONTENT_MANAGER: 'Opérateur de contenu',
  SUPPORT: 'Assistance',
  ADMIN: 'Administrateur de la marque',
  SUPER_ADMIN: 'Super administrateur',
};

export async function seedPermissions(prisma: PrismaClient, tenantId: string): Promise<void> {
  // 1. Permissions globales
  for (const [key, resource, action] of PERMISSIONS) {
    const description = DESCRIPTIONS[key] ?? null;
    await prisma.permission.upsert({
      where: { key },
      create: { key, resource, action, description },
      update: { resource, action, description },
    });
  }
  // 2. Rôles système du tenant
  for (const [roleKey, permissionKeys] of Object.entries(ROLES)) {
    const role = await prisma.role.upsert({
      where: { tenantId_key: { tenantId, key: roleKey } },   // ← plus de null as never
      create: { tenantId, key: roleKey, name: ROLE_NAMES[roleKey] ?? roleKey, isSystem: true },
      update: {},
    });
    // 3. Liaison rôle ↔ permissions
    const permissions = await prisma.permission.findMany({
      where: { key: { in: permissionKeys } },
    });
    for (const permission of permissions) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
        create: { roleId: role.id, permissionId: permission.id },
        update: {},
      });
    }
  }
}