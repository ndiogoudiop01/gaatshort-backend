import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  MemoryHealthIndicator,
  PrismaHealthIndicator,
} from '@nestjs/terminus';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { Public } from '@shared/decorators/public.decorator';
import { AppConfigService } from '@config/app-config.service';
import { PrismaService } from '@infra/persistence/prisma/prisma.service';
import { RedisHealthIndicator } from './redis.health';

/**
 * `live` et `ready` ne servent PAS à la même chose :
 *  - live  : le process est-il vivant ? Un échec → Kubernetes redémarre le pod.
 *  - ready : peut-il servir du trafic ? Un échec → retrait du load balancer,
 *            sans redémarrage. Confondre les deux provoque des redémarrages
 *            en boucle dès que Postgres a un hoquet.
 *
 * Le plafonnement est posé ROUTE PAR ROUTE, et surtout pas sur la classe : les
 * deux n'ont ni le même appelant ni le même coût.
 *
 *  - `live` est exempté : sans lui, la sonde hérite des seuils de n'importe
 *    quelle route (`ThrottlerGuard` global, cf. `TenantThrottlerGuard`), y
 *    compris le seau `public-form` (5/heure). Un `HEALTHCHECK` qui sonde
 *    toutes les 30 s dépasse ce seuil en 2-3 minutes : la sonde reçoit un 429,
 *    l'orchestrateur croit le process en panne et le redémarre — une sonde qui
 *    déclenche elle-même l'incident qu'elle est censée détecter. Vérifié en
 *    conditions réelles (SIB-55). Elle ne coûte rien : aucune dépendance.
 *  - `ready` garde un plafond : il ping Postgres et Redis À CHAQUE APPEL, et
 *    il est `@Public()`, hors préfixe `/api`, hors versionnement. L'exempter
 *    offrirait à un appelant anonyme une amplification vers la base.
 */
@ApiTags('Système')
// Sondes Kubernetes : jamais versionnées. Elles vivent à `/health/*`, hors
// préfixe `/api` (cf. main.ts) et hors préfixe de version `/v1`.
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prismaIndicator: PrismaHealthIndicator,
    private readonly redis: RedisHealthIndicator,
    private readonly memory: MemoryHealthIndicator,
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  @Public()
  @SkipThrottle()
  @Get('live')
  public live() {
    // `version` = SHA du commit figé dans l'image (APP_VERSION). Le smoke test
    // du déploiement s'en sert pour vérifier que c'est la NOUVELLE version qui
    // répond, et non l'ancienne restée en service après un rollback Swarm.
    return { status: 'ok', uptime: process.uptime(), version: this.config.app.version };
  }

  // 60/minute : une sonde de disponibilité légitime tourne à 1 toutes les 10 à
  // 30 secondes. Le plafond ne gêne personne et ferme l'amplification.
  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get('ready')
  @HealthCheck()
  public ready() {
    return this.health.check([
      () => this.prismaIndicator.pingCheck('database', this.prisma, { timeout: 2_000 }),
      () => this.redis.isHealthy('redis'),
      () => this.memory.checkHeap('memory_heap', 512 * 1024 * 1024),
    ]);
  }
}
