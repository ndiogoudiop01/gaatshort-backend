import { BusinessRuleViolationError, ForbiddenActionError } from '@shared/kernel/errors/domain.error';
import { canSeeCountry, type CountryScope } from '@shared/kernel/access/country-scope';

/**
 * BSG-12 — règles d'administration des comptes, rôles et permissions.
 *
 * C'est l'écran où une erreur d'affichage devient une erreur de sécurité :
 * ces règles sont donc appliquées ICI, par le serveur, et le back-office se
 * contente de les refléter (il reçoit `manageable` et `grantable` calculés).
 *
 * Quatre principes :
 *  1. ANTI-ESCALADE — on ne donne (ni ne retire) que ce qu'on possède : une
 *     permission absente de son propre jeton, un rôle plus puissant que soi,
 *     un pays hors de son périmètre.
 *  2. ANTI-VERROUILLAGE — on ne se retire pas à soi-même le droit
 *     d'administrer (`user:manage`), on ne se suspend pas.
 *  3. DERNIER SUPER_ADMIN — la plateforme en garde toujours au moins un.
 *  4. PÉRIMÈTRE PAYS — seul un SUPER_ADMIN l'élargit (demande du métier :
 *     « le Sénégal ne voit pas le Maroc, sauf accord du super admin »).
 */

export const ADMIN_PERMISSION = 'user:manage';
export const SUPER_ADMIN = 'SUPER_ADMIN';
/**
 * Rôles SYSTÈME amorcés par `prisma/seed/permissions.seed.ts` (même liste,
 * vérifiée par test) : un rôle personnalisé ne peut pas prendre leur clé.
 */
export const SYSTEM_ROLE_KEYS: readonly string[] = [
  'CANDIDATE', 'PARTNER', 'MANAGER', 'ADMIN', SUPER_ADMIN,
  'LEARNER', 'ENTREPRENEUR', 'TRAINER', 'ACADEMY_MANAGER',
  'ENTREPRENEUR_OFFICER', 'ENTREPRENEUR_OPS_LEAD', 'LEGAL_REFERENT',
  'FINANCING_OFFICER', 'FINANCING_DIRECTOR', 'FLEET_OPERATIONS', 'NETWORK_MANAGER', 'QUALITY_AUDITOR',
];
/** Rôles dont la liste de permissions ne se modifie pas depuis l'écran. */
export const LOCKED_ROLES: readonly string[] = [SUPER_ADMIN];

export interface Actor {
  readonly id: string;
  readonly roles: readonly string[];
  readonly permissions: readonly string[];
  readonly countries: CountryScope;
}

export interface RoleSnapshot {
  readonly key: string;
  readonly permissions: readonly string[];
}

export interface TargetUser {
  readonly id: string;
  readonly countryCode: string | null;
  readonly allCountries: boolean;
  readonly roles: readonly RoleSnapshot[];
}

const isSuperAdmin = (actor: Pick<Actor, 'roles'>) => actor.roles.includes(SUPER_ADMIN);
const permissionsOf = (roles: readonly RoleSnapshot[]) => [...new Set(roles.flatMap((r) => r.permissions))];

/** Clés modifiées entre deux listes (ajoutées OU retirées). */
export function changedKeys(before: readonly string[], after: readonly string[]): string[] {
  const a = new Set(before);
  const b = new Set(after);
  return [...new Set([...before.filter((k) => !b.has(k)), ...after.filter((k) => !a.has(k))])].sort();
}

export const AccessAdminRules = {
  /** Permissions qu'un acteur peut cocher ou décocher : celles de son jeton. */
  grantable(actor: Actor, permissionKey: string): boolean {
    return actor.permissions.includes(permissionKey);
  },

  /** Un rôle ne peut être donné ou retiré que s'il ne dépasse pas l'acteur. */
  canHandleRole(actor: Actor, role: RoleSnapshot): boolean {
    if (role.key === SUPER_ADMIN) return isSuperAdmin(actor);
    return role.permissions.every((p) => actor.permissions.includes(p));
  },

  /**
   * L'acteur peut-il administrer CE compte ? Il doit le voir (pays), et le
   * compte ne doit pas le dépasser (permissions, périmètre pays).
   * Renvoie la raison du refus, ou `null`.
   */
  manageBlocker(actor: Actor, target: TargetUser): 'OUTRANKS' | 'OUT_OF_SCOPE' | null {
    if (isSuperAdmin(actor)) return null;
    if (!canSeeCountry(actor.countries, target.countryCode)) return 'OUT_OF_SCOPE';
    if (target.allCountries && actor.countries !== null) return 'OUTRANKS';
    const targetPermissions = permissionsOf(target.roles);
    if (target.roles.some((r) => r.key === SUPER_ADMIN)) return 'OUTRANKS';
    if (!targetPermissions.every((p) => actor.permissions.includes(p))) return 'OUTRANKS';
    return null;
  },

  assertCanManage(actor: Actor, target: TargetUser): void {
    const blocker = AccessAdminRules.manageBlocker(actor, target);
    if (blocker) {
      throw new ForbiddenActionError(
        'manage',
        'User',
        blocker === 'OUTRANKS' ? 'ce compte dispose de droits supérieurs aux vôtres' : 'hors de votre périmètre pays',
      );
    }
  },

  /** Nouveau jeu de rôles d'un compte. */
  assertRoleChange(
    actor: Actor,
    target: TargetUser,
    nextRoles: readonly RoleSnapshot[],
    superAdminCount: number,
  ): void {
    const before = target.roles.map((r) => r.key);
    const after = nextRoles.map((r) => r.key);
    const touched = changedKeys(before, after);
    const all = [...target.roles, ...nextRoles];
    const refused = touched.filter((key) => {
      const role = all.find((r) => r.key === key);
      return !role || !AccessAdminRules.canHandleRole(actor, role);
    });
    if (refused.length) {
      throw new BusinessRuleViolationError('ROLE_NOT_GRANTABLE', 'Vous ne pouvez pas attribuer ou retirer ces rôles', {
        roles: refused,
        issues: refused.map((key) => `roles: « ${key} » donne des droits que vous n'avez pas`),
      });
    }
    if (target.id === actor.id && !permissionsOf(nextRoles).includes(ADMIN_PERMISSION)) {
      throw new BusinessRuleViolationError(
        'SELF_LOCKOUT',
        "Vous ne pouvez pas retirer votre propre droit d'administration des comptes",
        { issues: ["roles: vos nouveaux rôles ne contiennent plus « user:manage »"] },
      );
    }
    const losesSuperAdmin = before.includes(SUPER_ADMIN) && !after.includes(SUPER_ADMIN);
    if (losesSuperAdmin && superAdminCount <= 1) {
      throw new BusinessRuleViolationError('LAST_SUPER_ADMIN', 'La plateforme doit garder au moins un super administrateur', {
        issues: ['roles: dernier SUPER_ADMIN'],
      });
    }
  },

  assertStatusChange(actor: Actor, target: TargetUser, status: 'ACTIVE' | 'SUSPENDED', superAdminCount: number): void {
    if (status !== 'SUSPENDED') return;
    if (target.id === actor.id) {
      throw new BusinessRuleViolationError('SELF_LOCKOUT', 'Vous ne pouvez pas suspendre votre propre compte', {
        issues: ['status: votre propre compte'],
      });
    }
    if (target.roles.some((r) => r.key === SUPER_ADMIN) && superAdminCount <= 1) {
      throw new BusinessRuleViolationError('LAST_SUPER_ADMIN', 'La plateforme doit garder au moins un super administrateur', {
        issues: ['status: dernier SUPER_ADMIN actif'],
      });
    }
  },

  /** Pays de rattachement : dans le périmètre de l'acteur. */
  assertHomeCountry(actor: Actor, countryCode: string | null): void {
    if (isSuperAdmin(actor) || actor.countries === null) return;
    if (!countryCode || !actor.countries.includes(countryCode)) {
      throw new BusinessRuleViolationError('COUNTRY_OUT_OF_SCOPE', 'Ce pays est hors de votre périmètre', {
        issues: [`countryCode: « ${countryCode ?? '—'} » hors de votre périmètre (${actor.countries.join(', ') || 'aucun pays'})`],
      });
    }
  },

  /** Élargir ou restreindre le périmètre pays : SUPER_ADMIN seulement. */
  assertCanEditCountryScope(actor: Actor): void {
    if (!isSuperAdmin(actor)) {
      throw new ForbiddenActionError('grant-countries', 'User', 'réservé au super administrateur');
    }
  },

  /** Nouvelle liste de permissions d'un rôle. */
  assertRolePermissionsChange(
    actor: Actor,
    role: RoleSnapshot,
    nextPermissions: readonly string[],
    actorRolesAfter: readonly RoleSnapshot[],
  ): void {
    if (LOCKED_ROLES.includes(role.key)) {
      throw new BusinessRuleViolationError('ROLE_LOCKED', `Les permissions du rôle ${role.key} ne se modifient pas`, {
        issues: [`role: ${role.key} est verrouillé`],
      });
    }
    const refused = changedKeys(role.permissions, nextPermissions).filter((k) => !AccessAdminRules.grantable(actor, k));
    if (refused.length) {
      throw new BusinessRuleViolationError('PERMISSION_NOT_GRANTABLE', 'Vous ne pouvez modifier que les permissions que vous possédez', {
        permissions: refused,
        issues: refused.map((k) => `permissions: « ${k} » absente de vos propres droits`),
      });
    }
    if (actor.roles.includes(role.key) && !permissionsOf(actorRolesAfter).includes(ADMIN_PERMISSION)) {
      throw new BusinessRuleViolationError(
        'SELF_LOCKOUT',
        "Cette modification vous retirerait votre propre droit d'administration des comptes",
        { issues: [`permissions: « ${ADMIN_PERMISSION} » est votre seul accès à cet écran`] },
      );
    }
  },
};
