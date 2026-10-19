import type { ConfigService } from '@nestjs/config';
import { AppConfigService } from '../app-config.service';
import type { AppConfiguration } from '../configuration';

function buildService(values: Partial<Record<keyof AppConfiguration, unknown>>): AppConfigService {
  const get = jest.fn((key: string) => values[key as keyof AppConfiguration]);
  return new AppConfigService({ get } as unknown as ConfigService<AppConfiguration, true>);
}

describe('AppConfigService', () => {
  it('expose chaque section de configuration typée par sa propre clé', () => {
    const service = buildService({
      app: { name: 'Gaatshort' },
      tenancy: { rootDomain: 'gaatshort.com' },
      database: { slowQueryMs: 200 },
      redis: { url: 'redis://localhost' },
      auth: { accessSecret: 'x' },
      storage: { bucket: 'x' },
      mail: { from: 'x' },
      sms: { driver: 'log' },
      observability: { logLevel: 'info' },
      rateLimit: { ttlSeconds: 60 },
      gdpr: { applicationRetentionDays: 1095 },
    });

    expect((service.app as { name: string }).name).toBe('Gaatshort');
    expect((service.tenancy as { rootDomain: string }).rootDomain).toBe('gaatshort.com');
    expect((service.database as { slowQueryMs: number }).slowQueryMs).toBe(200);
    expect((service.redis as { url: string }).url).toBe('redis://localhost');
    expect((service.auth as { accessSecret: string }).accessSecret).toBe('x');
    expect((service.storage as { bucket: string }).bucket).toBe('x');
    expect((service.mail as { from: string }).from).toBe('x');
    expect((service.sms as { driver: string }).driver).toBe('log');
    expect((service.observability as { logLevel: string }).logLevel).toBe('info');
    expect((service.rateLimit as { ttlSeconds: number }).ttlSeconds).toBe(60);
    expect((service.gdpr as { applicationRetentionDays: number }).applicationRetentionDays).toBe(1095);
  });
});
