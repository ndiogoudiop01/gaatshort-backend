import type { INestApplicationContext } from '@nestjs/common';
import { Logger } from '@nestjs/common';

/**
 * Arrêt propre, pour l'API **comme pour le worker** :
 *  - API : on cesse d'accepter du trafic, on laisse les requêtes en vol finir.
 *  - Worker : `app.close()` déclenche `Worker.close()` de BullMQ, qui **draine**
 *    les jobs actifs avant de rendre la main.
 * Puis Prisma / Redis se ferment proprement.
 *
 * Garde-fou : si le drainage dépasse 30 s (job bloqué), on force `exit(1)` —
 * mieux vaut un job réessayé qu'un pod zombie que Kubernetes finira par SIGKILL.
 * Sans tout ça : des 502 à chaque déploiement et des jobs orphelins.
 */
export function setupGracefulShutdown(app: INestApplicationContext): void {
  const logger = new Logger('Shutdown');
  app.enableShutdownHooks();

  const shutdown = (signal: string) => {
    logger.log(`${signal} reçu — arrêt en cours…`);
    const timer = setTimeout(() => {
      logger.error("Arrêt forcé après 30 s d'attente");
      process.exit(1);
    }, 30_000);
    // `unref()` n'empêche PAS le minuteur de se déclencher tant que le process
    // vit : il faut l'annuler dès que l'arrêt aboutit (ou échoue). Sinon, dans
    // un process qui survit à `process.exit` (Jest `--runInBand`, où `exit` est
    // simulé), il tire 30 s plus tard un VRAI `exit(1)` au milieu d'une autre
    // suite de tests — c'était l'échec intermittent de `test:unit` en CI.
    timer.unref();

    void app
      .close()
      .then(() => {
        clearTimeout(timer);
        logger.log('Arrêt terminé');
        process.exit(0);
      })
      .catch((error: Error) => {
        clearTimeout(timer);
        logger.error(`Échec de l'arrêt : ${error.message}`);
        process.exit(1);
      });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
