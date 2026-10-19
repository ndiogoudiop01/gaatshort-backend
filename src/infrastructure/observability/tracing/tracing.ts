import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { readTracingEnv } from '@config/tracing-env';

let activeSdk: NodeSDK | null = null;

/**
 * Doit être importé EN PREMIER dans main.ts, avant tout autre module :
 * l'instrumentation automatique patche http/pg/ioredis au chargement.
 * Un import plus tardif ne trace rien et le bug est silencieux.
 *
 * Désactivé par défaut : ne fait RIEN tant que `OTEL_ENABLED=true` n'est pas
 * posé. Idempotent — un second appel renvoie le SDK déjà démarré (utile en
 * test, et si les deux entrypoints partagent le module).
 */
export function startTracing(): NodeSDK | null {
  if (activeSdk) return activeSdk;

  const env = readTracingEnv();
  if (!env.enabled) return null;

  const sdk = new NodeSDK({
    serviceName: env.serviceName,
    traceExporter: new OTLPTraceExporter({
      url: `${env.otlpEndpoint}/v1/traces`,
    }),
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false },
      }),
    ],
  });

  sdk.start();
  // `once` : un seul handler même si le module est rechargé (évite la fuite
  // de listeners « MaxListenersExceededWarning »).
  process.once('SIGTERM', () => void sdk.shutdown());
  activeSdk = sdk;
  return sdk;
}
