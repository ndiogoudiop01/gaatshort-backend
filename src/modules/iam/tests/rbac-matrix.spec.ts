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
  /** Une permission « passerelle » n'a de sens qu'avec une portée (:any ou :assigned). */
  const GATEWAYS: Record<string, string[]> = {
    'application:read': ['application:read:any', 'application:read:assigned'],
    'application:transition': ['application:transition:any', 'application:transition:assigned'],
    'entrepreneur:read': ['entrepreneur:read:any', 'entrepreneur:read:assigned'],
    'academy:learner:read': ['academy:learner:read:any', 'academy:learner:read:assigned'],
  };

  it('toute passerelle est accompagnée d’une portée, et inversement', () => {
    for (const role of roleNames.filter((r) => r !== SUPER_ADMIN)) {
      for (const [gateway, scopes] of Object.entries(GATEWAYS)) {
        const hasGateway = ROLES[role].includes(gateway);
        const hasScope = scopes.some((s) => ROLES[role].includes(s));
        expect({ role, gateway, ok: hasGateway === hasScope }).toEqual({ role, gateway, ok: true });
      }
    }
  });

  it('les rôles de terrain n’ont jamais de portée :any (sinon l’ABAC devient un no-op)', () => {
    for (const role of ['MANAGER', 'TRAINER', 'ENTREPRENEUR_OFFICER', 'LEGAL_REFERENT', 'FINANCING_OFFICER', 'NETWORK_MANAGER']) {
      expect({ role, any: ROLES[role].filter((k) => k.endsWith(':any')) }).toEqual({ role, any: [] });
    }
  });

  it('les comptes publics (candidat, apprenant, entrepreneur) n’ont que des droits « :own » ou d’apprentissage', () => {
    for (const role of ['CANDIDATE', 'LEARNER', 'ENTREPRENEUR']) {
      expect(ROLES[role].filter((k) => !k.endsWith(':own') && k !== 'academy:learn')).toEqual([]);
    }
  });

  it('proposer et décider sont séparés là où le process exige une validation', () => {
    // P02-F06 : le formateur propose, le Responsable Academy certifie.
    expect(ROLES.TRAINER).toContain('academy:decision:propose');
    expect(ROLES.TRAINER).not.toContain('academy:certification:decide');
    // P01-F05 : le chargé propose, le responsable valide l'admission.
    expect(ROLES.ENTREPRENEUR_OFFICER).not.toContain('application:admit');
    expect(ROLES.ENTREPRENEUR_OPS_LEAD).toContain('application:admit');
    // P04-F06 : l'ordre de commande n'est pas autorisé par celui qui instruit.
    expect(ROLES.FINANCING_OFFICER).not.toContain('financing:purchase:authorize');
    expect(ROLES.FINANCING_DIRECTOR).toContain('financing:purchase:authorize');
  });

  it('l’auditeur qualité ne peut rien écrire', () => {
    const writes = ROLES.QUALITY_AUDITOR.filter((k) => !/(:read(:any)?|^quality:audit|^metrics:read)$/.test(k));
    expect(writes).toEqual([]);
  });

  it('tenant:manage reste réservé au SUPER_ADMIN', () => {
    expect(roleNames.filter((r) => ROLES[r].includes('tenant:manage'))).toEqual([SUPER_ADMIN]);
  });
});
