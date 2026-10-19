import type { Params } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import type { AppConfiguration } from '@config/configuration';

/**
 * Chemins expurgés des logs.
 *
 * Deux familles :
 *  1. secrets d'authentification — leur fuite est une faille de sécurité ;
 *  2. données personnelles — leur présence dans un log conservé 90 jours est
 *     un traitement RGPD non déclaré (US-IG-028).
 *
 * Les motifs `*.champ` s'appliquent à n'importe quel niveau, et pas seulement
 * sous `req.body` : un `logger.log({ email })` émis depuis un use case est
 * couvert au même titre qu'un corps de requête. On préfère sur-expurger :
 * un identifiant technique (`id`, `tenantId`, `requestId`, `status`) reste
 * toujours visible, jamais une donnée personnelle.
 */
const SECRETS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'req.headers["x-webhook-signature"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.currentPassword',
  '*.newPassword',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.otp',
  '*.secret',
  '*.apiKey',
  '*.authorization',
];

const PERSONAL_DATA = [
  '*.email',
  '*.contactEmail',
  '*.phone',
  '*.phoneE164',
  '*.contactPhone',
  '*.firstName',
  '*.lastName',
  '*.fullName',
  '*.birthName',
  '*.dateOfBirth',
  '*.identity', // état civil du candidat
  '*.nationalId',
  '*.iban',
  '*.address',
  '*.postalAddress',
];

export const REDACTED_PATHS = [...SECRETS, ...PERSONAL_DATA];

/**
 * Logs structurés JSON, corrélés (`requestId` / `tenantId` / `userId`) et
 * expurgés. `requestId` est posé ici (disponible dès `genReqId`) ; `tenantId`
 * et `userId` sont ajoutés après résolution par `LogCorrelationInterceptor`
 * via `PinoLogger.assign()` — ils apparaissent alors sur TOUTES les lignes
 * de la requête, y compris les logs applicatifs des use cases.
 */
export const buildLoggerConfig = (config: AppConfiguration): Params => ({
  pinoHttp: {
    level: config.observability.logLevel,
    genReqId: (req, res) => {
      const existing = (req.headers['x-request-id'] as string) || randomUUID();
      res.setHeader('x-request-id', existing);
      return existing;
    },
    redact: { paths: REDACTED_PATHS, censor: '[REDACTED]' },
    // L'access-log est produit par `LoggingInterceptor` (une ligne par requête,
    // avec le patron de route, la durée, l'issue et le trio de corrélation).
    // On coupe l'auto-logging de pino-http pour ne pas doubler chaque requête.
    //
    // C'est aussi ce qui règle, définitivement, le bruit des sondes repéré par
    // SIB-55 : `/health/*` et `/metrics` n'ont JAMAIS le préfixe global `/api`
    // (cf. le `exclude` de `setGlobalPrefix` dans main.ts — les sondes ne sont
    // pas versionnées), si bien qu'une liste d'exclusion écrite sur
    // `/api/health/live` ne filtrait jamais rien et qu'un ping toutes les 30 s
    // polluait les logs. `LoggingInterceptor` écarte ces routes avec un motif
    // qui tolère les deux formes.
    autoLogging: false,
    // `requestId` est le seul champ disponible au moment où le child logger
    // est créé (avant middlewares/guards). Le reste est ajouté par `assign()`.
    customProps: (req) => ({
      requestId: (req as { id?: string }).id,
      service: config.app.name,
      env: config.app.env,
    }),
    transport: config.observability.logPretty
      ? { target: 'pino-pretty', options: { singleLine: true, translateTime: 'HH:MM:ss.l' } }
      : undefined,
  },
});
