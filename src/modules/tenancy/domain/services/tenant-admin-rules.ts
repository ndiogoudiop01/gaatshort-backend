import { BusinessRuleViolationError } from '@shared/kernel/errors/domain.error';

/**
 * BSG-13 — règles d'administration d'un tenant (SUPER_ADMIN).
 *
 * `PATCH /admin/tenants/:id` s'exécute en `$privileged()` : il franchit
 * l'isolation multi-tenant. Avant BSG-13, il prenait `Record<string, unknown>`
 * et le passait tel quel à Prisma — n'importe quel champ (slug, isolation,
 * schemaName, deletedAt…) pouvait être écrit. Désormais :
 *  1. le DTO refuse tout champ hors liste blanche (400) ;
 *  2. `toTenantUpdate()` recopie les champs UN PAR UN — jamais de spread ;
 *  3. les règles ci-dessous protègent la plateforme d'elle-même.
 */

export const TENANT_STATUSES = ['ACTIVE', 'SUSPENDED', 'ARCHIVED'] as const;
export type TenantStatusValue = (typeof TENANT_STATUSES)[number];

/** Seuls champs modifiables. `slug`, `isolation`, `schemaName`, `settings`, les domaines : jamais. */
export const TENANT_EDITABLE_FIELDS = [
  'name',
  'legalName',
  'status',
  'defaultLocale',
  'defaultCountry',
  'defaultCurrency',
  'timezone',
  'branding',
  'featureFlags',
] as const;

export interface TenantPatch {
  readonly name?: string;
  readonly legalName?: string | null;
  readonly status?: TenantStatusValue;
  readonly defaultLocale?: string;
  readonly defaultCountry?: string;
  readonly defaultCurrency?: string;
  readonly timezone?: string;
  readonly branding?: { readonly primaryColor?: string | null; readonly logoUrl?: string | null };
  readonly featureFlags?: Readonly<Record<string, boolean>>;
}

export interface TenantCurrent {
  readonly id: string;
  readonly status: string;
  readonly branding: unknown;
  readonly featureFlags: unknown;
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {};

export const TenantAdminRules = {
  assertNotEmpty(patch: TenantPatch): void {
    if (!TENANT_EDITABLE_FIELDS.some((field) => patch[field] !== undefined)) {
      throw new BusinessRuleViolationError('TENANT_PATCH_EMPTY', 'Aucune modification demandée', {
        issues: [`body: au moins un champ parmi ${TENANT_EDITABLE_FIELDS.join(', ')}`],
      });
    }
  },

  /**
   * Suspendre ou archiver son PROPRE tenant couperait immédiatement l'accès
   * à toute la plateforme (l'annuaire refuse un tenant suspendu, jeton ou non),
   * y compris au SUPER_ADMIN qui vient de cliquer.
   */
  assertNotSelfLockout(callerTenantId: string, tenant: TenantCurrent, patch: TenantPatch): void {
    if (tenant.id === callerTenantId && patch.status && patch.status !== 'ACTIVE') {
      throw new BusinessRuleViolationError(
        'TENANT_SELF_LOCKOUT',
        'Vous ne pouvez pas suspendre ou archiver l’organisation depuis laquelle vous êtes connecté',
        { issues: ['status: organisation de votre session'] },
      );
    }
  },

  /**
   * Données Prisma construites CHAMP PAR CHAMP. `branding` et `featureFlags`
   * sont FUSIONNÉS avec l'existant : une clé inconnue de l'écran (ajoutée par
   * un autre outil) n'est pas effacée par une modification partielle.
   */
  toTenantUpdate(tenant: TenantCurrent, patch: TenantPatch): Record<string, unknown> {
    const data: Record<string, unknown> = {};
    if (patch.name !== undefined) data.name = patch.name.trim();
    if (patch.legalName !== undefined) data.legalName = patch.legalName?.trim() || null;
    if (patch.status !== undefined) data.status = patch.status;
    if (patch.defaultLocale !== undefined) data.defaultLocale = patch.defaultLocale;
    if (patch.defaultCountry !== undefined) data.defaultCountry = patch.defaultCountry;
    if (patch.defaultCurrency !== undefined) data.defaultCurrency = patch.defaultCurrency;
    if (patch.timezone !== undefined) data.timezone = patch.timezone;
    if (patch.branding !== undefined) {
      const branding = asRecord(tenant.branding);
      if (patch.branding.primaryColor !== undefined) branding.primaryColor = patch.branding.primaryColor;
      if (patch.branding.logoUrl !== undefined) branding.logoUrl = patch.branding.logoUrl;
      data.branding = branding;
    }
    if (patch.featureFlags !== undefined) {
      const flags = asRecord(tenant.featureFlags);
      for (const [key, value] of Object.entries(patch.featureFlags)) flags[key] = value === true;
      data.featureFlags = flags;
    }
    return data;
  },

  isValidTimezone(timezone: string): boolean {
    try {
      new Intl.DateTimeFormat('en', { timeZone: timezone });
      return /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)+$|^UTC$/.test(timezone);
    } catch {
      return false;
    }
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Création et suppression d'un tenant (SUPER_ADMIN)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Slug = sous-domaine et clé de cache de l'annuaire : 3 à 63 caractères,
 * minuscules, chiffres et tirets, ni en tête ni en fin. Immuable après création.
 */
export const TENANT_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,61})[a-z0-9]$/;

/** Sous-domaines techniques ou trompeurs : jamais attribués à une organisation. */
export const RESERVED_TENANT_SLUGS: readonly string[] = [
  'admin', 'api', 'app', 'assets', 'auth', 'backoffice', 'cdn', 'docs', 'ftp', 'mail',
  'public', 'root', 'smtp', 'gaatshort', 'static', 'status', 'support', 'system', 'test', 'www',
];

/**
 * Fuseau proposé par défaut pour les pays du référentiel. Un pays absent de
 * cette table exige un `timezone` explicite à la création.
 */
export const COUNTRY_DEFAULT_TIMEZONES: Readonly<Record<string, string>> = {
  SN: 'Africa/Dakar',
  CI: 'Africa/Abidjan',
  CM: 'Africa/Douala',
  ML: 'Africa/Bamako',
  BF: 'Africa/Ouagadougou',
  BJ: 'Africa/Porto-Novo',
  TG: 'Africa/Lome',
  GN: 'Africa/Conakry',
  MA: 'Africa/Casablanca',
  GM: 'Africa/Banjul',
  FR: 'Europe/Paris',
};

/** Au plus 20 pays rattachés à la création (le pays par défaut compris). */
export const TENANT_MAX_COUNTRIES = 20;

export interface TenantCreateInput {
  readonly slug: string;
  readonly name: string;
  readonly legalName?: string | null;
  readonly status?: 'ACTIVE' | 'SUSPENDED';
  readonly defaultLocale?: string;
  readonly defaultCountry: string;
  readonly defaultCurrency?: string;
  readonly timezone?: string;
  readonly countries?: readonly string[];
  readonly branding?: { readonly primaryColor?: string | null; readonly logoUrl?: string | null };
  readonly featureFlags?: Readonly<Record<string, boolean>>;
}

/** Ligne trouvée dans une table métier pour le tenant à supprimer. */
export interface TenantDataUsage {
  readonly table: string;
  readonly rows: number;
}

/**
 * Tables techniques : elles ne constituent PAS des « données » au sens de la
 * règle de suppression.
 *  - `purge` : supprimées avec le tenant (paramétrage, jetons, file sortante).
 *  - `keep`  : conservées pour la traçabilité (pas de clé étrangère vers
 *              `tenants`) — on doit pouvoir retrouver qui a fait quoi.
 * Toute AUTRE table portant `tenant_id` (users, applications, rôles
 * personnalisés, contenus, futures tables Academy…) bloque la suppression :
 * la liste n'est pas codée en dur, elle est lue dans le catalogue Postgres.
 */
export const TENANT_TECHNICAL_TABLES = {
  purge: ['tenant_countries', 'tenant_domains', 'idempotency_keys', 'outbox_messages', 'auth_challenges'],
  keep: ['audit_logs'],
} as const;

const isTechnicalTable = (table: string): boolean =>
  (TENANT_TECHNICAL_TABLES.purge as readonly string[]).includes(table) ||
  (TENANT_TECHNICAL_TABLES.keep as readonly string[]).includes(table);

export const TenantLifecycleRules = {
  assertValidSlug(slug: string): void {
    const issues: string[] = [];
    if (!TENANT_SLUG_PATTERN.test(slug)) {
      issues.push('slug: 3 à 63 caractères, minuscules, chiffres et tirets (ni en tête ni en fin)');
    } else if (slug.includes('--')) {
      issues.push('slug: deux tirets consécutifs interdits');
    }
    if (RESERVED_TENANT_SLUGS.includes(slug)) issues.push(`slug: « ${slug} » est réservé`);
    if (issues.length) throw new BusinessRuleViolationError('TENANT_INVALID', 'Identifiant d’organisation invalide', { issues });
  },

  /** Fuseau explicite, sinon celui du pays ; sinon erreur (pas de valeur par défaut silencieuse). */
  resolveTimezone(input: Pick<TenantCreateInput, 'timezone' | 'defaultCountry'>): string {
    const timezone = input.timezone ?? COUNTRY_DEFAULT_TIMEZONES[input.defaultCountry];
    if (!timezone) {
      throw new BusinessRuleViolationError('TENANT_INVALID', 'Fuseau horaire requis', {
        issues: [`timezone: aucun fuseau par défaut pour ${input.defaultCountry}, précisez-le (ex. Africa/Dakar)`],
      });
    }
    if (!TenantAdminRules.isValidTimezone(timezone)) {
      throw new BusinessRuleViolationError('TENANT_INVALID', 'Fuseau horaire inconnu', {
        issues: [`timezone: « ${timezone} » n'est pas un fuseau IANA (ex. Africa/Dakar)`],
      });
    }
    return timezone;
  },

  /** Pays rattachés : le pays par défaut en premier, sans doublon. */
  countriesToAttach(input: Pick<TenantCreateInput, 'defaultCountry' | 'countries'>): string[] {
    const codes = [input.defaultCountry, ...(input.countries ?? [])].map((c) => c.toUpperCase());
    const unique = [...new Set(codes)];
    if (unique.length > TENANT_MAX_COUNTRIES) {
      throw new BusinessRuleViolationError('TENANT_INVALID', 'Trop de pays rattachés', {
        issues: [`countries: ${TENANT_MAX_COUNTRIES} pays au plus`],
      });
    }
    return unique;
  },

  /** Données Prisma de création, champ par champ — jamais de spread du corps. */
  toTenantCreate(
    input: TenantCreateInput,
    resolved: { readonly timezone: string; readonly currency: string },
  ): Record<string, unknown> {
    const branding: Record<string, unknown> = {};
    if (input.branding?.primaryColor !== undefined) branding.primaryColor = input.branding.primaryColor;
    if (input.branding?.logoUrl !== undefined) branding.logoUrl = input.branding.logoUrl;
    const featureFlags: Record<string, boolean> = {};
    for (const [key, value] of Object.entries(input.featureFlags ?? {})) featureFlags[key] = value === true;
    return {
      slug: input.slug,
      name: input.name.trim(),
      legalName: input.legalName?.trim() || null,
      status: input.status ?? 'ACTIVE',
      defaultLocale: input.defaultLocale ?? 'fr',
      defaultCountry: input.defaultCountry,
      defaultCurrency: resolved.currency,
      timezone: resolved.timezone,
      branding,
      featureFlags,
    };
  },

  /** Tables métier qui comptent : tout sauf les tables techniques. */
  businessTables(tablesWithTenantColumn: readonly string[]): string[] {
    return tablesWithTenantColumn.filter((table) => !isTechnicalTable(table));
  },

  /** Tables techniques à purger qui existent réellement dans la base. */
  purgeableTables(tablesWithTenantColumn: readonly string[]): string[] {
    return (TENANT_TECHNICAL_TABLES.purge as readonly string[]).filter((t) => tablesWithTenantColumn.includes(t));
  },

  /**
   * Préconditions de suppression, dans l'ordre où l'écran les explique :
   *  1. jamais l'organisation de sa propre session ;
   *  2. confirmation explicite par le slug (garde-fou contre le mauvais clic) ;
   *  3. aucune donnée métier — sinon on liste ce qui bloque.
   */
  assertDeletable(
    callerTenantId: string,
    tenant: { readonly id: string; readonly slug: string },
    confirmSlug: string | undefined,
    usage: readonly TenantDataUsage[],
  ): void {
    if (tenant.id === callerTenantId) {
      throw new BusinessRuleViolationError(
        'TENANT_SELF_DELETE',
        'Vous ne pouvez pas supprimer l’organisation depuis laquelle vous êtes connecté',
        { issues: ['id: organisation de votre session'] },
      );
    }
    if (confirmSlug !== tenant.slug) {
      throw new BusinessRuleViolationError('TENANT_DELETE_CONFIRMATION', 'Confirmation requise', {
        issues: [`confirm: recopiez l’identifiant « ${tenant.slug} » pour confirmer la suppression`],
      });
    }
    const blocking = usage.filter((u) => u.rows > 0);
    if (blocking.length) {
      throw new BusinessRuleViolationError(
        'TENANT_HAS_DATA',
        'Cette organisation contient des données : archivez-la plutôt que de la supprimer',
        {
          issues: blocking.map((u) => `${u.table}: ${u.rows} ligne(s)`),
          tables: blocking,
        },
      );
    }
  },
};
