/**
 * Le SDK OpenTelemetry doit démarrer AVANT que le conteneur d'injection Nest
 * n'existe (cf. `main.ts`) : `AppConfigService` n'est pas encore disponible.
 * Ce module est donc le seul endroit, avec `env.schema.ts`, autorisé à lire
 * `process.env` directement — la lecture reste confinée à `src/config/`.
 */
export interface TracingEnv {
  readonly enabled: boolean;
  readonly serviceName: string;
  readonly otlpEndpoint?: string;
}

export function readTracingEnv(): TracingEnv {
  return {
    enabled: process.env.OTEL_ENABLED === 'true',
    serviceName: process.env.APP_NAME ?? 'gaatshort-api',
    otlpEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
  };
}
