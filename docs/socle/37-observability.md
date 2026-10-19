# Observabilité : logs corrélés, métriques, sondes, traces

> **Depuis une alerte, remonter en minutes à : quel tenant, quelle requête,
> quelle étape.** Trois piliers — logs, métriques, traces — plus deux sondes
> Kubernetes aux rôles distincts.

| Élément | Fichier |
|---|---|
| Config Pino (corrélation + expurgation) | `src/infrastructure/observability/logger/logger.config.ts` |
| Corrélation `tenantId` / `userId` | `src/infrastructure/observability/logger/log-correlation.interceptor.ts` |
| Access-log métier | `src/shared/interceptors/logging.interceptor.ts` |
| Sondes `live` / `ready` | `src/infrastructure/observability/health/health.controller.ts` |
| Métriques (registre prom-client) | `src/infrastructure/observability/metrics/metrics.service.ts` |
| Métrique de latence HTTP | `src/infrastructure/observability/metrics/http-metrics.interceptor.ts` |
| Traçage OpenTelemetry | `src/infrastructure/observability/tracing/tracing.ts` + `src/config/tracing-env.ts` |

---

## 1. Logs — structurés, corrélés, expurgés

### Un seul flux, du JSON, partout

`main.ts` et `worker.main.ts` font `app.useLogger(app.get(Logger /* nestjs-pino */))`.
**Toutes** les lignes — Nest, use cases, guards, `AllExceptionsFilter`, jobs —
passent par Pino. Plus de `console.log` non structuré à côté.

En dev, `LOG_PRETTY=true` reformate en une ligne lisible ; en prod, du JSON
NDJSON prêt pour Loki / Elasticsearch.

### Le trio de corrélation sur chaque ligne

| Champ | Posé par | Quand |
|---|---|---|
| `requestId` | `genReqId` dans `logger.config.ts` (réutilise l'en-tête entrant `x-request-id`, sinon UUID ; renvoyé dans la réponse) | à la création du child logger |
| `tenantId` | `LogCorrelationInterceptor` → `PinoLogger.assign()` | après le middleware tenant + les guards |
| `userId` | idem (`req.user.id`) | idem |

**Pourquoi un interceptor et pas `customProps` ?** `customProps` (pino-http)
s'exécute avant la résolution du tenant et l'authentification : `tenantId` et
`userId` n'existent pas encore. `assign()` écrit dans le contexte ALS du
logger de requête → **toute** ligne émise ensuite (access-log ET logs des use
cases) porte les trois champs.

> Angle mort assumé : une requête rejetée par un **guard** (401/403) ou une
> route inexistante (404) est journalisée par `AllExceptionsFilter` avant que
> l'interceptor n'ait tourné → `tenantId`/`userId` peuvent manquer sur ces
> lignes. Le `requestId` et le message d'erreur, eux, sont toujours là.

### Access-log : une ligne par requête

`LoggingInterceptor` émet `{ method, path (patron de route), durationMs,
outcome, errorName?, requestId, tenantId, userId }`. L'auto-logging de
pino-http est **coupé** (`autoLogging: false`) pour ne pas doubler chaque
requête. Les sondes et `/metrics` sont exclus de l'access-log (bruit).

### Expurgation des données personnelles

`redact` (pino) applique `censor: '[REDACTED]'` sur, entre autres :

- **secrets** : `req.headers.authorization`, `cookie`, `x-api-key`,
  `x-webhook-signature`, `*.password`, `*.token`, `*.otp`, `*.secret`,
  `*.apiKey`, `set-cookie` ;
- **PII** : `*.email`, `*.phone`, `*.phoneE164`, `*.firstName`, `*.lastName`,
  `*.dateOfBirth`, `*.identity`, `*.nationalId`, `*.iban`, `*.address`.

Choix : **on sur-expurge**. Un log conservé 90 jours qui contient l'e-mail
d'un candidat est un traitement RGPD non déclaré (US-IG-028). Les identifiants
techniques (`id`, `tenantId`, `requestId`, `status`, codes d'erreur) restent
toujours visibles — le diagnostic ne repose jamais sur une PII.

Liste complète et motifs : `REDACTED_PATHS` dans `logger.config.ts`.

## 2. Sondes — `live` ≠ `ready`

| Sonde | Question | Échec ⇒ | Dépendances |
|---|---|---|---|
| `GET /health/live` | le process est-il vivant ? | Kubernetes **redémarre** le pod | **aucune** — répond `{ status, uptime }` sans I/O |
| `GET /health/ready` | peut-il servir du trafic ? | **retrait du load balancer**, sans redémarrage | Postgres (`ping`, 2 s), Redis (`ping`), heap < 512 Mo |

Confondre les deux = boucle de redémarrages dès que Postgres a un hoquet
réseau. `live` ne doit donc **jamais** dépendre d'une ressource externe.
Hors préfixe `/api` et non versionnées (`VERSION_NEUTRAL`).

## 3. Métriques — Prometheus, cardinalité maîtrisée

`GET /metrics` (hors `/api`, non versionné, réseau interne uniquement).

| Métrique | Type | Labels | Usage |
|---|---|---|---|
| `http_request_duration_seconds` | histogram | `method`, `route`, `status` | latence p50/p95/p99, taux d'erreur |
| `business_events_total` | counter | `event` | candidatures, simulations, leads |
| `queue_depth` | gauge | `queue` | profondeur des files BullMQ |
| `outbox_backlog` | gauge | — | **alerte n°1** : événements non publiés ([docs/34](34-outbox.md)) |
| `outbox_dead_letters` | gauge | — | messages isolés (`attempts ≥ 10`) |
| `tenant_resolution_failures_total` | counter | `reason` | tentatives d'accès mal routées |
| `process_*`, `nodejs_*` | — | — | défaut prom-client (CPU, heap, event loop) |

### Deux règles non négociables (cf. `HttpMetricsInterceptor`)

1. **`route` = patron de route** (`/users/:id`), jamais l'URL réelle
   (`/users/6f3c…`). Sinon chaque identifiant crée une série temporelle.
2. **Aucun label `tenant` sur les métriques HTTP.** 200 tenants × 80 routes ×
   6 statuts = 96 000 séries pour une seule métrique. Le tenant vit dans les
   **logs** et les **traces**, cherchable sans coût de stockage. Il n'apparaît
   que sur des compteurs métier **bornés** (`business_events_total`).

Les sondes et le scrape lui-même ne sont pas mesurés.

## 4. Traçage — OpenTelemetry, opt-in strict

`startTracing()` est appelé **en tout premier** dans `main.ts` /
`worker.main.ts` (avant tout autre import : l'auto-instrumentation patche
`http` / `pg` / `ioredis` au chargement).

- Ne fait **rien** tant que `OTEL_ENABLED=true` n'est pas posé (valeur exacte
  `"true"` ; `"1"` ne suffit pas).
- Activé : `NodeSDK` + exporteur OTLP/HTTP vers
  `OTEL_EXPORTER_OTLP_ENDPOINT` (`/v1/traces`), auto-instrumentations Node
  (sauf `fs`, trop bruyant).
- Idempotent : un second appel renvoie le SDK déjà démarré. `shutdown` sur
  `SIGTERM` (`process.once`, pas d'accumulation de listeners).

Un trace_id relie API → Postgres → Redis → job BullMQ. `tenantId` /
`requestId` sont propagés comme attributs de span.

## 5. Configuration

| Variable | Défaut | Rôle |
|---|---|---|
| `LOG_LEVEL` | `info` | `fatal`…`trace` |
| `LOG_PRETTY` | `false` | `true` en dev (sortie lisible) ; `false` en prod (NDJSON) |
| `METRICS_ENABLED` | `true` | exposition de `/metrics` |
| `OTEL_ENABLED` | `false` | active le SDK OpenTelemetry |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | — | collecteur OTLP/HTTP (ex. `http://localhost:4318`) |
| `SENTRY_DSN` | — | (réservé) remontée d'exceptions |

## 6. Checklist de revue

- [ ] Un nouveau log ne concatène **jamais** un e-mail / téléphone / nom dans
      le message : passer par un champ structuré (il sera expurgé).
- [ ] Une nouvelle métrique HTTP ou technique **n'ajoute pas** de label
      `tenant`, `user`, `id` ou toute valeur non bornée.
- [ ] Un nouveau compteur métier a un label `event` (ou équivalent) à
      cardinalité connue.
- [ ] Une nouvelle dépendance externe critique est ajoutée à `ready`, **pas** à
      `live`.
- [ ] Un `console.log` dans le code applicatif = refus de revue (utiliser le
      `Logger` injecté).

## 7. Où c'est testé

| Aspect | Test |
|---|---|
| `redact` couvre secrets + PII ; `genReqId` réutilise/propage `x-request-id` ; `autoLogging` coupé ; `customProps` minimal | `src/infrastructure/tests/logger.config.spec.ts` |
| `assign({ requestId, tenantId, userId })` après les guards ; passthrough hors HTTP | `src/infrastructure/tests/log-correlation.interceptor.spec.ts` |
| `route` = patron (jamais l'URL) ; **pas de label tenant** ; statut 500 sur erreur ; sondes non mesurées | `src/infrastructure/tests/http-metrics.interceptor.spec.ts` |
| Latence HTTP sans label tenant ; compteurs métier bornés ; métriques process | `src/infrastructure/tests/metrics.service.spec.ts` |
| `live` ne touche aucune dépendance ; `ready` agrège DB+Redis+heap et propage l'échec | `src/infrastructure/tests/health.controller.spec.ts` |
| OTel désactivé par défaut, activé à `"true"` seulement, `startTracing()` → `null` et idempotent | `src/infrastructure/tests/tracing.spec.ts` |

Voir aussi : [docs/06-scalability-playbook.md](06-scalability-playbook.md)
(cardinalité & budgets), [docs/34-outbox.md](34-outbox.md) (alerte backlog).

> Le résumé express `resume-observability.md` que la plupart des fiches de
> cette série possèdent n'a pas été écrit. Reste à produire.
