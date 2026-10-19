import type { AppConfiguration } from '@config/configuration';
import { REDACTED_PATHS, buildLoggerConfig } from '../observability/logger/logger.config';

const fakeConfig = {
  app: { name: 'gaatshort-api', env: 'test' },
  observability: { logLevel: 'info', logPretty: false },
} as unknown as AppConfiguration;

describe('buildLoggerConfig', () => {
  it('expurge les secrets ET les données personnelles, de façon récursive', () => {
    const { redact } = buildLoggerConfig(fakeConfig).pinoHttp as {
      redact: { paths: string[]; censor: string };
    };

    // secrets
    expect(redact.paths).toEqual(expect.arrayContaining(['req.headers.authorization', '*.password', '*.token', '*.otp']));
    // PII — le vrai enjeu RGPD
    expect(redact.paths).toEqual(expect.arrayContaining(['*.email', '*.phone', '*.firstName', '*.identity', '*.iban']));
    expect(redact.censor).toBe('[REDACTED]');
    expect(REDACTED_PATHS).toBe(redact.paths);
  });

  it('réutilise le x-request-id entrant et le renvoie dans la réponse', () => {
    const { genReqId } = buildLoggerConfig(fakeConfig).pinoHttp as {
      genReqId: (req: unknown, res: unknown) => string;
    };
    const setHeader = jest.fn();
    const id = genReqId(
      { headers: { 'x-request-id': 'trace-abc' } },
      { setHeader },
    );

    expect(id).toBe('trace-abc');
    expect(setHeader).toHaveBeenCalledWith('x-request-id', 'trace-abc');
  });

  it('génère un identifiant quand l’appelant n’en fournit pas', () => {
    const { genReqId } = buildLoggerConfig(fakeConfig).pinoHttp as {
      genReqId: (req: unknown, res: unknown) => string;
    };
    const id = genReqId({ headers: {} }, { setHeader: jest.fn() });
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('coupe l’auto-logging de pino-http (l’access-log vient de LoggingInterceptor)', () => {
    const { autoLogging } = buildLoggerConfig(fakeConfig).pinoHttp as { autoLogging: boolean };
    expect(autoLogging).toBe(false);
  });

  it('n’expose que requestId/service/env à la création du child (pas de tenantId ici)', () => {
    const { customProps } = buildLoggerConfig(fakeConfig).pinoHttp as {
      customProps: (req: unknown) => Record<string, unknown>;
    };
    const props = customProps({ id: 'req-1' });
    expect(props).toEqual({ requestId: 'req-1', service: 'gaatshort-api', env: 'test' });
  });
});
