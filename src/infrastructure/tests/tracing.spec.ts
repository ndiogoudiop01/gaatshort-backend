import { readTracingEnv } from '@config/tracing-env';
import { startTracing } from '../observability/tracing/tracing';

/**
 * Le traçage OpenTelemetry est OPT-IN strict : rien ne démarre tant que
 * `OTEL_ENABLED=true` n'est pas posé. On ne teste QUE le chemin désactivé —
 * démarrer le vrai SDK patcherait http/pg/ioredis pour tout le process de test.
 */
describe('OpenTelemetry — activation par variable d’environnement', () => {
  const original = process.env.OTEL_ENABLED;
  afterEach(() => {
    if (original === undefined) delete process.env.OTEL_ENABLED;
    else process.env.OTEL_ENABLED = original;
  });

  it('readTracingEnv : désactivé par défaut', () => {
    delete process.env.OTEL_ENABLED;
    expect(readTracingEnv().enabled).toBe(false);
  });

  it('readTracingEnv : n’est activé QUE par la valeur exacte "true"', () => {
    process.env.OTEL_ENABLED = '1';
    expect(readTracingEnv().enabled).toBe(false);
    process.env.OTEL_ENABLED = 'true';
    expect(readTracingEnv().enabled).toBe(true);
  });

  it('startTracing : renvoie null et ne patche rien quand c’est désactivé', () => {
    delete process.env.OTEL_ENABLED;
    expect(startTracing()).toBeNull();
    expect(startTracing()).toBeNull(); // idempotent, aucun effet de bord
  });
});
