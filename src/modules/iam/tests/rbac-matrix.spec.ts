import { DESCRIPTIONS, PERMISSIONS, ROLE_NAMES, ROLES } from '../../../../prisma/seed/permissions.seed';
import { SUPER_ADMIN, SYSTEM_ROLE_KEYS } from '../domain/services/access-admin-rules';

/**
 * Garde-fous de la matrice RBAC (prisma/seed/permissions.seed.ts).
 *
 * La matrice vit dans le seed, les règles qui la rendent sûre vivent ici :
 * une faute de frappe dans une clé, ou un `:any` donné à un rôle de terrain,
 * casse la CI au lieu d'ouvrir silencieusement un accès en production.
 */
const CATALOG = PERMISSIONS.map(([key]) => key as string);
const roleNames = Object.keys(ROLES);

describe('Matrice RBAC — cohérence du catalogue', () => {
  it('chaque clé est unique, décrite et cohérente avec (ressource, action)', () => {
    expect(new Set(CATALOG).size).toBe(CATALOG.length);
    for (const [key, resource, action] of PERMISSIONS) {
      expect(key).toBe(`${resource}:${action}`);
      expect(DESCRIPTIONS[key]).toEqual(expect.any(String));
    }
  });

  it('chaque rôle ne référence que des permissions du catalogue, sans doublon', () => {
    for (const role of roleNames) {
      const keys = ROLES[role];
      expect(new Set(keys).size).toBe(keys.length);
      expect(keys.filter((k) => !CATALOG.includes(k))).toEqual([]);
    }
  });

  it('les rôles système du seed sont exactement les clés réservées côté API, chacun nommé', () => {
    expect([...roleNames].sort()).toEqual([...SYSTEM_ROLE_KEYS].sort());
    for (const role of roleNames) expect(ROLE_NAMES[role]).toEqual(expect.any(String));
  });

  it('SUPER_ADMIN détient tout le catalogue', () => {
    expect([...ROLES[SUPER_ADMIN]].sort()).toEqual([...CATALOG].sort());
  });
});

describe('Matrice RBAC — règles de sécurité', () => {
  it('le spectateur n’a aucun droit back-office', () => {
    expect(ROLES.VIEWER).toEqual([]);
  });

  it('l’opérateur de contenu prépare le catalogue mais ne publie pas', () => {
    expect(ROLES.CONTENT_MANAGER).toContain('catalog:write');
    expect(ROLES.CONTENT_MANAGER).not.toContain('catalog:publish');
    expect(ROLES.CONTENT_MANAGER).not.toContain('license:write');
  });

  it('l’assistance ne touche ni au catalogue ni aux prix', () => {
    const writes = ROLES.SUPPORT.filter((k) => /:(write|publish|upload)$/.test(k));
    expect(writes).toEqual([]);
  });

  it('tenant:manage reste réservé au SUPER_ADMIN', () => {
    expect(roleNames.filter((r) => ROLES[r].includes('tenant:manage'))).toEqual([SUPER_ADMIN]);
  });
});
