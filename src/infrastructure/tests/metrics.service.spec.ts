import { MetricsService } from '../observability/metrics/metrics.service';

describe('MetricsService', () => {
  it('expose les métriques au format Prometheus', async () => {
    const service = new MetricsService();
    service.businessEvents.inc({ event: 'application.submitted' });

    const output = await service.scrape();

    expect(output).toContain('business_events_total');
  });

  it('la métrique de latence HTTP ne porte pas de label tenant', async () => {
    const service = new MetricsService();
    service.httpDuration.observe({ method: 'GET', route: '/things', status: '200' }, 0.012);

    const line = (await service.scrape())
      .split('\n')
      .find((l) => l.startsWith('http_request_duration_seconds_count'));

    expect(line).toBeDefined();
    expect(line).not.toMatch(/tenant/i);
    expect(line).toContain('route="/things"');
  });

  it('les compteurs métier restent à cardinalité bornée (label `event` seul)', async () => {
    const service = new MetricsService();
    service.businessEvents.inc({ event: 'simulation.run' });
    service.businessEvents.inc({ event: 'partner.lead' });

    const output = await service.scrape();
    // pas de dimension tenant/route/user qui ferait exploser les séries
    expect(output).toMatch(/business_events_total\{event="simulation\.run"\} 1/);
    expect(output).toMatch(/business_events_total\{event="partner\.lead"\} 1/);
  });

  it('inclut les métriques process par défaut (CPU, heap, event loop)', async () => {
    const output = await new MetricsService().scrape();
    expect(output).toContain('process_cpu_user_seconds_total');
    expect(output).toContain('nodejs_eventloop_lag_seconds');
  });
});
