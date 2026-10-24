import { z } from 'zod';

/**
 * Contrat d'environnement. Validé au démarrage : le process refuse de
 * booter avec une configuration incomplète — jamais de `undefined` qui
 * remonte trois heures plus tard en production.
 */
const csv = (value: string) => value.split(',').map((v) => v.trim()).filter(Boolean);

/**
 * `z.coerce.boolean()` appelle `Boolean(valeur)` — pour une chaîne, TOUTE
 * chaîne non vide est truthy en JS, donc `LOG_PRETTY=false` (la chaîne
 * `"false"`, ce qu'un fichier `.env` fournit TOUJOURS) devenait `true`.
 * Six variables utilisaient ce piège (`TENANCY_ALLOW_ANONYMOUS_FALLBACK`,
 * `DATABASE_LOG_QUERIES`, `STORAGE_FORCE_PATH_STYLE`, `LOG_PRETTY`,
 * `METRICS_ENABLED`, `OTEL_ENABLED`) — la plus grave étant la première :
 * un opérateur qui pose `TENANCY_ALLOW_ANONYMOUS_FALLBACK=false` pour
 * DÉSACTIVER le repli anonyme en production ne désactivait en réalité rien.
 * Trouvé en testant le déploiement conteneurisé (SIB-55) : le conteneur ne
 * démarrait pas avec `LOG_PRETTY=false` (tente de charger `pino-pretty`,
 * absent des dépendances de production).
 */
const TRUTHY = ['true', '1', 'yes', 'on'];
const FALSY = ['false', '0', 'no', 'off'];

const bool = (defaultValue: boolean) =>
  z.preprocess((value) => {
    if (typeof value !== 'string') return value;
    const normalized = value.trim().toLowerCase();
    // Chaîne vide = non renseignée : `FOO=` dans un `.env` est une absence, pas
    // une erreur. La valeur par défaut s'applique.
    if (normalized === '') return undefined;
    if (TRUTHY.includes(normalized)) return true;
    if (FALSY.includes(normalized)) return false;
    // Ni vrai ni faux : on laisse passer la chaîne telle quelle pour que
    // `z.boolean()` la REFUSE. Une valeur mal saisie (`ture`, `oui`) doit faire
    // échouer le démarrage, pas basculer en silence sur `false` — c'est
    // précisément le mode de panne que ce helper existe pour supprimer.
    return normalized;
  }, z.boolean().default(defaultValue));

/** Chaîne optionnelle : `FOO=` (vide) vaut absence. */
const optional = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), schema.optional());

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  APP_NAME: z.string().default('gaatshort-api'),
  APP_PORT: z.coerce.number().int().positive().default(3000),
  APP_GLOBAL_PREFIX: z.string().default('api'),
  APP_DEFAULT_API_VERSION: z.string().default('1'),
  APP_PUBLIC_URL: z.string().url(),
  // SHA du commit, figé dans l'image au build (docker/Dockerfile, `build:image`).
  APP_VERSION: z.string().min(1).default('dev'),
  FRONTEND_URL: z.string().url(),
  CORS_ORIGINS: z.string().transform(csv),

  TENANCY_STRATEGY: z.enum(['shared_rls', 'schema']).default('shared_rls'),
  TENANCY_RESOLVERS: z.string().default('jwt,subdomain,header').transform(csv),
  TENANCY_HEADER_NAME: z.string().default('x-tenant-id'),
  TENANCY_ROOT_DOMAIN: z.string(),
  TENANCY_DEFAULT_SLUG: z.string(),
  TENANCY_CACHE_TTL_SECONDS: z.coerce.number().int().default(300),
  TENANCY_ALLOW_ANONYMOUS_FALLBACK: bool(true),

  DATABASE_URL: z.string().url(),
  DATABASE_DIRECT_URL: z.string().url().optional(),
  DATABASE_READ_REPLICA_URL: z.string().url().or(z.literal('')).optional(),
  DATABASE_LOG_QUERIES: bool(false),
  DATABASE_SLOW_QUERY_MS: z.coerce.number().int().default(300),

  REDIS_URL: z.string().url(),
  REDIS_KEY_PREFIX: z.string().default('gs'),
  CACHE_DEFAULT_TTL_SECONDS: z.coerce.number().int().default(60),

  JWT_ACCESS_SECRET: z.string().min(32, 'Secret trop court : 32 caractères minimum'),
  JWT_ACCESS_TTL: z.string().default('900s'),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_REFRESH_TTL: z.string().default('30d'),
  MAGIC_LINK_TTL_SECONDS: z.coerce.number().int().default(900),
  OTP_TTL_SECONDS: z.coerce.number().int().default(300),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().default(5),
  OTP_LENGTH: z.coerce.number().int().min(4).max(8).default(6),
  /**
   * Numéros de TEST à code fixe (recette, démonstration, relecture des stores) :
   * `+221700000001:111111,+221700000002:222222`. Aucun SMS n'est envoyé pour eux ; le code
   * reste soumis à l'expiration et au nombre d'essais. Refusés en production sauf
   * AUTH_TEST_PHONES_IN_PRODUCTION=true (comptes de relecture Apple / Google).
   */
  AUTH_TEST_PHONES: optional(z.string()),
  AUTH_TEST_PHONES_IN_PRODUCTION: bool(false),
  ARGON2_MEMORY_COST: z.coerce.number().int().default(19456),
  ARGON2_TIME_COST: z.coerce.number().int().default(2),

  STORAGE_DRIVER: z.enum(['s3', 'local']).default('s3'),
  STORAGE_ENDPOINT: z.string().optional(),
  STORAGE_REGION: z.string().default('eu-west-1'),
  STORAGE_BUCKET: z.string(),
  STORAGE_ACCESS_KEY: z.string(),
  STORAGE_SECRET_KEY: z.string(),
  STORAGE_FORCE_PATH_STYLE: bool(false),
  STORAGE_PRESIGN_TTL_SECONDS: z.coerce.number().int().default(900),
  // TTL de l'URL GET de consultation. Distinct et volontairement court :
  // un lien de téléchargement n'est pas partageable durablement (critère : 15 min).
  STORAGE_DOWNLOAD_TTL_SECONDS: z.coerce.number().int().positive().max(3600).default(900),
  STORAGE_MAX_FILE_SIZE_MB: z.coerce.number().int().default(15),
  STORAGE_ALLOWED_MIME: z.string().transform(csv),

  MAIL_DRIVER: z.enum(['smtp', 'ses', 'resend', 'log']).default('log'),
  MAIL_FROM: z.string(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMS_DRIVER: z.enum(['twilio', 'orange', 'log']).default('log'),
  SMS_SENDER_ID: z.string().default('GAATSHRT'),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  LOG_PRETTY: bool(false),
  METRICS_ENABLED: bool(true),
  OTEL_ENABLED: bool(false),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
  SENTRY_DSN: z.string().optional(),

  RATE_LIMIT_TTL_SECONDS: z.coerce.number().int().default(60),
  RATE_LIMIT_LIMIT: z.coerce.number().int().default(120),
  RATE_LIMIT_PUBLIC_FORM_LIMIT: z.coerce.number().int().default(5),

  GDPR_RETENTION_APPLICATION_DAYS: z.coerce.number().int().default(730),
  GDPR_RETENTION_REJECTED_DAYS: z.coerce.number().int().default(365),
  GDPR_EXPORT_TTL_HOURS: z.coerce.number().int().default(48),

  // ── Vidéo (VideoProviderPort) ─────────────────────────────────────────
  // `fake` : aucun appel externe, lecture d'un flux HLS de démonstration.
  VIDEO_DRIVER: z.enum(['bunny', 'fake']).default('fake'),
  VIDEO_FAKE_HLS_URL: z.string().url().default('https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8'),
  VIDEO_PLAYBACK_TTL_SECONDS: z.coerce.number().int().positive().max(86_400).default(14_400),
  BUNNY_STREAM_LIBRARY_ID: optional(z.string()),
  BUNNY_STREAM_API_KEY: optional(z.string()),
  BUNNY_STREAM_CDN_HOST: optional(z.string()), // ex. vz-xxxx.b-cdn.net
  BUNNY_STREAM_TOKEN_KEY: optional(z.string()), // clé d'authentification par jeton de la zone
  BUNNY_WEBHOOK_SECRET: optional(z.string()), // segment secret de l'URL de webhook

  // ── Paiement (PaymentProviderPort) ────────────────────────────────────
  // `fake` : pas d'appel externe ; la commande se valide via l'écran de simulation (hors production).
  PAYMENT_DRIVER: z.enum(['paytech', 'fake']).default('fake'),
  PAYMENT_ORDER_TTL_MINUTES: z.coerce.number().int().positive().default(30),
  PAYTECH_API_KEY: optional(z.string()),
  PAYTECH_API_SECRET: optional(z.string()),
  PAYTECH_ENV: z.enum(['test', 'prod']).default('test'),
  PAYTECH_SUCCESS_URL: optional(z.string().url()),
  PAYTECH_CANCEL_URL: optional(z.string().url()),
}).superRefine((env, ctx) => {
  const need = (key: keyof typeof env, when: string) => {
    if (!env[key]) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: `obligatoire quand ${when}` });
  };
  if (env.VIDEO_DRIVER === 'bunny') {
    for (const k of ['BUNNY_STREAM_LIBRARY_ID', 'BUNNY_STREAM_API_KEY', 'BUNNY_STREAM_CDN_HOST', 'BUNNY_STREAM_TOKEN_KEY', 'BUNNY_WEBHOOK_SECRET'] as const) {
      need(k, 'VIDEO_DRIVER=bunny');
    }
  }
  if (env.PAYMENT_DRIVER === 'paytech') {
    for (const k of ['PAYTECH_API_KEY', 'PAYTECH_API_SECRET'] as const) need(k, 'PAYMENT_DRIVER=paytech');
  }
  if (env.AUTH_TEST_PHONES) {
    const entries = parseTestPhones(env.AUTH_TEST_PHONES);
    if (!entries) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['AUTH_TEST_PHONES'], message: 'format attendu : +221700000001:111111,+221700000002:222222' });
    } else if (Object.values(entries).some((code) => code.length !== env.OTP_LENGTH)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['AUTH_TEST_PHONES'], message: `chaque code doit compter OTP_LENGTH (${env.OTP_LENGTH}) chiffres` });
    }
    if (env.NODE_ENV === 'production' && !env.AUTH_TEST_PHONES_IN_PRODUCTION) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['AUTH_TEST_PHONES'], message: 'interdit en production sans AUTH_TEST_PHONES_IN_PRODUCTION=true' });
    }
  }
  // Les pilotes factices n'ont rien à faire en production : on refuse de démarrer.
  if (env.NODE_ENV === 'production') {
    if (env.VIDEO_DRIVER === 'fake') ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['VIDEO_DRIVER'], message: 'fake interdit en production' });
    if (env.PAYMENT_DRIVER === 'fake') ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['PAYMENT_DRIVER'], message: 'fake interdit en production' });
  }
});

export type Env = z.infer<typeof envSchema>;

/** `+221700000001:111111,…` → { '+221700000001': '111111' } ; `null` si une entrée est mal formée. */
export function parseTestPhones(value: string | undefined): Record<string, string> | null {
  if (!value) return {};
  const out: Record<string, string> = {};
  for (const entry of csv(value)) {
    const m = /^(\+[1-9]\d{7,14}):(\d{4,8})$/.exec(entry);
    if (!m) return null;
    out[m[1]] = m[2];
  }
  return out;
}

export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `  • ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Configuration d'environnement invalide :\n${details}`);
  }
  return parsed.data;
}
