import { validateEnv } from '../env.schema';

/** Jeu minimal de variables SANS défaut — les seules exigées par le schéma. */
function baseEnv(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    APP_PUBLIC_URL: 'http://localhost:3000',
    FRONTEND_URL: 'http://localhost:5173',
    CORS_ORIGINS: 'http://localhost:5173',
    TENANCY_ROOT_DOMAIN: 'gaatshort.com',
    TENANCY_DEFAULT_SLUG: 'gaatshort',
    DATABASE_URL: 'postgresql://gaatshort:gaatshort@localhost:5432/gaatshort',
    REDIS_URL: 'redis://localhost:6379',
    JWT_ACCESS_SECRET: 'x'.repeat(32),
    JWT_REFRESH_SECRET: 'y'.repeat(32),
    STORAGE_BUCKET: 'bucket',
    STORAGE_ACCESS_KEY: 'key',
    STORAGE_SECRET_KEY: 'secret',
    STORAGE_ALLOWED_MIME: 'application/pdf',
    MAIL_FROM: 'no-reply@gaatshort.com',
    ...overrides,
  };
}

/**
 * SIB-55 — `z.coerce.boolean()` appelle `Boolean(valeur)` : pour une
 * chaîne, TOUTE chaîne non vide est truthy, donc la chaîne `"false"` (ce
 * qu'un fichier `.env` fournit TOUJOURS) devenait `true`. Trouvé en testant
 * le déploiement conteneurisé : le conteneur refusait de démarrer avec
 * `LOG_PRETTY=false` (tentait quand même de charger `pino-pretty`, absent
 * des dépendances de production).
 */
describe('validateEnv — coercion booléenne (SIB-55)', () => {
  it.each([
    'TENANCY_ALLOW_ANONYMOUS_FALLBACK',
    'DATABASE_LOG_QUERIES',
    'STORAGE_FORCE_PATH_STYLE',
    'LOG_PRETTY',
    'METRICS_ENABLED',
    'OTEL_ENABLED',
  ])('interprète %s="false" comme false, pas true', (key) => {
    const env = validateEnv(baseEnv({ [key]: 'false' }));
    expect(env[key as keyof typeof env]).toBe(false);
  });

  it.each([
    'TENANCY_ALLOW_ANONYMOUS_FALLBACK',
    'DATABASE_LOG_QUERIES',
    'STORAGE_FORCE_PATH_STYLE',
    'LOG_PRETTY',
    'METRICS_ENABLED',
    'OTEL_ENABLED',
  ])('interprète %s="true" comme true', (key) => {
    const env = validateEnv(baseEnv({ [key]: 'true' }));
    expect(env[key as keyof typeof env]).toBe(true);
  });

  it('est insensible à la casse ("TRUE"/"FALSE")', () => {
    const env = validateEnv(baseEnv({ LOG_PRETTY: 'FALSE', METRICS_ENABLED: 'TRUE' }));
    expect(env.LOG_PRETTY).toBe(false);
    expect(env.METRICS_ENABLED).toBe(true);
  });

  it('retombe sur la valeur par défaut quand la variable est absente', () => {
    const env = validateEnv(baseEnv());
    expect(env.TENANCY_ALLOW_ANONYMOUS_FALLBACK).toBe(true);
    expect(env.LOG_PRETTY).toBe(false);
    expect(env.METRICS_ENABLED).toBe(true);
  });

  // Le vrai mode de panne n'est pas `"false"` — c'est la valeur que le schéma
  // ne reconnaît pas, saisie à la main dans une interface de déploiement.
  it.each([['ture'], ['oui'], ['vrai'], ['2'], ['enabled']])(
    'refuse une valeur booléenne non reconnue (%p) au lieu de la traiter comme false',
    (value) => {
      expect(() => validateEnv(baseEnv({ TENANCY_ALLOW_ANONYMOUS_FALLBACK: value }))).toThrow(
        /Configuration d'environnement invalide/,
      );
    },
  );

  it('accepte les synonymes usuels ("1"/"0", "yes"/"no", "on"/"off")', () => {
    expect(validateEnv(baseEnv({ METRICS_ENABLED: '0' })).METRICS_ENABLED).toBe(false);
    expect(validateEnv(baseEnv({ METRICS_ENABLED: '1' })).METRICS_ENABLED).toBe(true);
    expect(validateEnv(baseEnv({ LOG_PRETTY: 'yes' })).LOG_PRETTY).toBe(true);
    expect(validateEnv(baseEnv({ LOG_PRETTY: 'off' })).LOG_PRETTY).toBe(false);
  });

  it('traite la chaîne vide comme une absence, pas comme une erreur', () => {
    // `FOO=` dans un `.env` : la valeur par défaut doit s'appliquer.
    expect(validateEnv(baseEnv({ METRICS_ENABLED: '' })).METRICS_ENABLED).toBe(true);
  });

  it('refuse de démarrer avec une configuration incomplète (message clair, pas une exception brute)', () => {
    expect(() => validateEnv({})).toThrow(/Configuration d'environnement invalide/);
  });
});

/**
 * Déploiement CapRover — `APP_VERSION` est figée dans l'image par
 * `build:image` (SHA du commit) et renvoyée par `/health/live` ; le smoke
 * test du pipeline la compare au SHA déployé.
 */
describe('validateEnv — APP_VERSION', () => {
  it('vaut « dev » hors image construite par la CI', () => {
    expect(validateEnv(baseEnv()).APP_VERSION).toBe('dev');
  });

  it('reprend la valeur injectée au build', () => {
    expect(validateEnv(baseEnv({ APP_VERSION: 'a1b2c3d' })).APP_VERSION).toBe('a1b2c3d');
  });
});

describe('Vidéo et paiement', () => {
  it('pilotes factices par défaut ; une variable vide vaut absence', () => {
    const env = validateEnv(baseEnv({ PAYTECH_SUCCESS_URL: '', BUNNY_STREAM_API_KEY: '' }));
    expect(env.VIDEO_DRIVER).toBe('fake');
    expect(env.PAYMENT_DRIVER).toBe('fake');
    expect(env.PAYTECH_SUCCESS_URL).toBeUndefined();
  });

  it('bunny et paytech exigent leurs clés', () => {
    expect(() => validateEnv(baseEnv({ VIDEO_DRIVER: 'bunny' }))).toThrow(/BUNNY_STREAM_API_KEY/);
    expect(() => validateEnv(baseEnv({ PAYMENT_DRIVER: 'paytech' }))).toThrow(/PAYTECH_API_SECRET/);
    const ok = validateEnv(baseEnv({ PAYMENT_DRIVER: 'paytech', PAYTECH_API_KEY: 'k', PAYTECH_API_SECRET: 's' }));
    expect(ok.PAYMENT_DRIVER).toBe('paytech');
  });

  it('les pilotes factices sont interdits en production', () => {
    expect(() => validateEnv(baseEnv({ NODE_ENV: 'production' }))).toThrow(/fake interdit en production/);
  });
});
