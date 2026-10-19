import { Logger, type Provider } from '@nestjs/common';
import Redis, { type RedisOptions } from 'ioredis';
import { AppConfigService } from '@config/app-config.service';

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');
/** Connexion dédiée BullMQ : `maxRetriesPerRequest: null` est exigé par la lib. */
export const REDIS_QUEUE_CLIENT = Symbol('REDIS_QUEUE_CLIENT');

/**
 * Journalisation des erreurs de connexion, dédupliquée.
 *
 * Sans ça, un Redis éteint produit des centaines de lignes par minute :
 * `retryStrategy` reconnecte toutes les 200 ms → 5 s, et chaque tentative
 * émet un `error`. Le vrai message est noyé et les logs deviennent illisibles.
 *
 * Deux points de détail ioredis qui expliquaient le `Redis:` vide des logs :
 *   - l'erreur de connexion est un `AggregateError` dont `.message` est vide ;
 *     l'information utile est dans `.code` (ECONNREFUSED) et `.errors[]` ;
 *   - un client SANS écouteur `error` fait émettre à ioredis son propre
 *     « [ioredis] Unhandled error event », hors de Pino. Chaque client doit
 *     donc avoir le sien — y compris la connexion BullMQ.
 */
function attachErrorLogging(client: Redis, logger: Logger, label: string): void {
  let lastSignature = '';
  let repeats = 0;

  client.on('error', (error: Error & { code?: string; errors?: Error[] }) => {
    const code = error.code ?? error.name;
    const detail = error.message || error.errors?.[0]?.message || 'aucun détail';
    const signature = `${code}:${detail}`;

    if (signature === lastSignature) {
      repeats += 1;
      // Une ligne toutes les 50 occurrences : on garde la trace du problème
      // persistant sans inonder la sortie.
      if (repeats % 50 === 0) {
        logger.error(`${label} toujours injoignable (${code}) — ${repeats} tentatives.`);
      }
      return;
    }

    lastSignature = signature;
    repeats = 1;
    logger.error(`${label} : ${code} — ${detail}`);
  });

  client.on('ready', () => {
    if (repeats > 0) logger.log(`${label} rétabli après ${repeats} tentative(s).`);
    else logger.log(`${label} prêt`);
    lastSignature = '';
    repeats = 0;
  });
}

export const redisProviders: Provider[] = [
  {
    provide: REDIS_CLIENT,
    inject: [AppConfigService],
    useFactory: (config: AppConfigService) => {
      const logger = new Logger('Redis');
      const options: RedisOptions = {
        keyPrefix: `${config.redis.keyPrefix}:`,
        // `null` et non `3` : avec une limite, toute commande émise pendant
        // une coupure rejette en `MaxRetriesPerRequestError`. Les crons
        // (relais outbox, purges) remontaient l'erreur en boucle au lieu
        // d'attendre la reconnexion. Le plafond réel reste `commandTimeout`.
        maxRetriesPerRequest: null,
        commandTimeout: 5_000,
        enableReadyCheck: true,
        enableOfflineQueue: true,
        lazyConnect: false,
        retryStrategy: (times) => Math.min(times * 200, 5_000),
      };
      const client = new Redis(config.redis.url, options);
      attachErrorLogging(client, logger, 'Redis');
      return client;
    },
  },
  {
    provide: REDIS_QUEUE_CLIENT,
    inject: [AppConfigService],
    useFactory: (config: AppConfigService) => {
      const client = new Redis(config.redis.url, {
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
      });
      // Indispensable : sans écouteur, ioredis écrit lui-même sur stderr.
      attachErrorLogging(client, new Logger('Redis/Queue'), 'Redis (files)');
      return client;
    },
  },
];
