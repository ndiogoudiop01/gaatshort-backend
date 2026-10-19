import { startTracing } from '@infra/observability/tracing/tracing';
startTracing();

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Logger as PinoLogger } from 'nestjs-pino';
import { setupGracefulShutdown } from './bootstrap/graceful-shutdown';
import { WorkerModule } from './worker.module';

/**
 * Process worker : même code, mêmes modules métier, AUCUN serveur HTTP.
 *
 * POURQUOI SÉPARER ? Un export CSV de 50 000 lignes ou un envoi de 3 000
 * e-mails ne doit pas voler du temps CPU à l'event loop qui sert les requêtes
 * du simulateur. On dimensionne les deux indépendamment : l'API scale sur la
 * latence p95, les workers sur la profondeur des files.
 *
 * ARRÊT : `setupGracefulShutdown` (partagé avec l'API) draine les jobs BullMQ
 * en cours sur SIGTERM/SIGINT, avec une borne de 30 s.
 */
async function bootstrapWorker(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });
  // `bufferLogs: true` MET EN ATTENTE tous les logs (y compris ceux de
  // démarrage/arrêt ci-dessous) jusqu'à ce qu'un logger soit explicitement
  // attaché. Sans cet appel, rien n'était jamais attaché : les logs
  // restaient bufferisés indéfiniment — aucune trace, ni au démarrage, ni
  // à l'arrêt (`SIGTERM reçu…`), pas même une erreur. Repéré en testant le
  // drainage réel des jobs en conteneur (SIB-55) : le process s'arrêtait
  // proprement (code de sortie 0) mais sans laisser la moindre preuve dans
  // les logs qu'il l'avait fait.
  app.useLogger(app.get(PinoLogger));

  setupGracefulShutdown(app);

  new Logger('Worker').log('Worker démarré — en écoute sur les files BullMQ');
}

void bootstrapWorker();
