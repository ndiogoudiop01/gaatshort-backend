import { Injectable } from '@nestjs/common';
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

/**
 * Métriques Prometheus.
 *
 * Le label `tenant` est délibérément absent des métriques HTTP à forte
 * cardinalité : avec 200 tenants × 80 routes × 6 statuts, on explose la
 * mémoire de Prometheus. Le tenant reste dans les logs et les traces, où
 * il est cherchable, et n'apparaît que sur les compteurs métier bornés.
 */
@Injectable()
export class MetricsService {
  public readonly registry = new Registry();

  public readonly httpDuration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'Latence des requêtes HTTP',
    labelNames: ['method', 'route', 'status'] as const,
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [this.registry],
  });

  public readonly businessEvents = new Counter({
    name: 'business_events_total',
    help: 'Événements métier (candidatures, simulations, leads)',
    labelNames: ['event'] as const,
    registers: [this.registry],
  });

  public readonly queueDepth = new Gauge({
    name: 'queue_depth',
    help: 'Jobs en attente par file',
    labelNames: ['queue'] as const,
    registers: [this.registry],
  });

  /**
   * Messages outbox en attente de publication (`processed_at IS NULL`,
   * `attempts < 10`). C'EST L'ALERTE N°1 : si elle grimpe et ne redescend
   * pas, plus aucun événement ne part (e-mails, scoring, analytics…).
   * Alimentée à chaque passe du relais (5 s). Seuils : cf. docs/34-outbox.md.
   */
  public readonly outboxBacklog = new Gauge({
    name: 'outbox_backlog',
    help: 'Messages outbox non publiés, encore réessayables (attempts < 10)',
    registers: [this.registry],
  });

  /**
   * Messages outbox « isolés » : 10 tentatives de publication échouées, plus
   * jamais réessayés par le relais. Doit rester à 0 ; > 0 = investigation.
   */
  public readonly outboxDeadLetters = new Gauge({
    name: 'outbox_dead_letters',
    help: 'Messages outbox isolés (attempts >= 10) — à investiguer et rejouer',
    registers: [this.registry],
  });

  public readonly tenantResolutionFailures = new Counter({
    name: 'tenant_resolution_failures_total',
    help: 'Échecs de résolution de tenant',
    labelNames: ['reason'] as const,
    registers: [this.registry],
  });

  constructor() {
    collectDefaultMetrics({ register: this.registry });
  }

  public async scrape(): Promise<string> {
    return this.registry.metrics();
  }
}
