import { Controller, Get, Header, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '@shared/decorators/public.decorator';
import { MetricsService } from './metrics.service';

/**
 * Endpoint de scrape Prometheus.
 *
 * Cet endpoint est `@Public()`, hors du préfixe `/api` et non versionné :
 * il est donc joignable sans authentification par quiconque atteint le
 * conteneur. Chaque appel déclenche une collecte complète du registre.
 *
 * Il portait `@SkipThrottle()`, justifié par « exposé uniquement sur le
 * réseau interne (règle d'ingress) » — mais cette règle d'ingress n'existe
 * nulle part dans ce dépôt, et `METRICS_ENABLED` n'est lu par aucun code :
 * la protection supposée n'est pas vérifiable côté application.
 *
 * D'où une limite explicite plutôt qu'une exemption : 120 req/min laisse
 * Prometheus scraper toutes les 15-30 s (2 à 4 appels/min) avec ~30x de
 * marge, y compris avec plusieurs scrapers, tout en bornant le coût d'un
 * appel non sollicité.
 */
@ApiExcludeController()
@Throttle({ default: { limit: 120, ttl: 60_000 } })
// Scrape Prometheus : hors préfixe `/api` (cf. main.ts) et non versionné.
@Controller({ path: 'metrics', version: VERSION_NEUTRAL })
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Public()
  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4')
  public scrape(): Promise<string> {
    return this.metrics.scrape();
  }
}
