# Files asynchrones & process worker

> Sortir du cycle requête/réponse tout ce qui est **lent, faillible ou
> externe**, et dimensionner les workers **indépendamment** de l'API.

| Élément | Fichier |
|---|---|
| Files, jobs, options par défaut, priorités, concurrence | `src/infrastructure/queue/queue.constants.ts` |
| Câblage BullMQ (connexion, `defaultJobOptions`, priorité par file) | `src/infrastructure/queue/queue.module.ts` |
| Restauration du contexte tenant dans un job | `src/infrastructure/queue/tenant-aware-job.service.ts` |
| Socle des processors (contexte, mesure, log, retry) | `src/infrastructure/queue/processors/base.processor.ts` |
| Process worker autonome | `src/worker.main.ts` + `src/worker.module.ts` |
| Arrêt propre (partagé API/worker) | `src/bootstrap/graceful-shutdown.ts` |

---

## 1. Une file par domaine de préoccupation

`QUEUES` — 7 files, une par sujet : `outbox`, `notifications`, `scoring`,
`documents`, `analytics`, `exports`, `maintenance`. Un export CSV de 50 000
lignes ne partage jamais la file d'une notification transactionnelle
« votre dossier est présélectionné ».

### Priorité & concurrence — déclarées une seule fois

| | Sert à | Où c'est appliqué |
|---|---|---|
| `QUEUE_PRIORITY[q]` | ordonner les jobs **dans** une file (1 = le plus urgent) ; matérialiser l'intention | `queue.module.ts` → `defaultJobOptions.priority` de chaque file |
| `QUEUE_CONCURRENCY[q]` | nombre de jobs traités **en parallèle** par un worker | chaque `@Processor(q, { concurrency: QUEUE_CONCURRENCY[q] })` |

**Priorité entre files** : BullMQ (sans l'édition Pro) n'ordonne pas d'une file
à l'autre — un worker écoute *une* file. La priorité inter-files vient donc de :
1. la **concurrence** ci-dessus (transactionnel large, bulk étroit) ;
2. le **nombre de replicas worker par file** au déploiement (ex. 3 pods
   `notifications`, 1 pod `exports`).

Le champ `priority` reste utile : quand une même file porte du transactionnel
ET du bulk (ex. `notifications` : un « présélectionné » vs un mailing), les jobs
à faible `priority` passent devant.

## 2. Options de job par défaut — le retry, sans y penser

`DEFAULT_JOB_OPTIONS` est passé en **`defaultJobOptions` à la racine** de
BullMQ (`queue.module.ts`). Donc **chaque** `queue.add(...)` en hérite :

```
attempts: 5
backoff:  { type: 'exponential', delay: 2000 }   →  2s, 4s, 8s, 16s
removeOnComplete: { age: 1h, count: 1000 }
removeOnFail:     { age: 7 jours }                →  post-mortem possible
```

Un nouveau `queue.add()` qui **oublie** de re-spécifier ces options garde
quand même le retry exponentiel. (Les call sites passent en plus un `jobId`
stable → dédoublonnage BullMQ, notamment pour le relais outbox.)

## 3. Le worker : même code, aucun serveur HTTP

`worker.main.ts` : `NestFactory.createApplicationContext(WorkerModule)` — pas
de `listen()`, pas de contrôleur. `WorkerModule` importe les **mêmes modules
métier** que l'API (ceux qui ont des jobs), sans le middleware de tenancy.

**Pourquoi séparer** : un envoi de 3 000 e-mails ne doit pas voler de l'event
loop aux requêtes du simulateur. L'API scale sur la **latence p95**, les
workers sur la **profondeur des files** — deux signaux, deux déploiements.

## 4. Un job restaure le contexte tenant depuis son payload

Un worker n'a ni sous-domaine ni JWT. Le tenant **voyage dans le payload** :

```ts
interface TenantJobPayload<T> { tenantId: string; correlationId?: string; data: T }
```

À l'enfilage : `tenantJobs.wrap(data)` capture le `tenantId` du contexte courant.
Au traitement : `BaseTenantProcessor.process()` fait
`tenantJobs.runInTenant(tenantId, () => this.handle(data, job))`, qui
**résout le tenant** (annuaire Redis) puis ouvre le contexte ALS **avant**
`handle()`. Tout accès base via `TenantPrismaService` est donc scopé + RLS.

> Sans ça, le worker écrit hors RLS ou plante — le piège n°1 du multi-tenant
> asynchrone.

Les jobs **plateforme cross-tenant** (relais outbox, purge RGPD, rollup
analytics) sont des `@Cron`, pas des `BaseTenantProcessor` : ils utilisent
`$privileged()` et parcourent tous les tenants (cf.
[docs/11 §5](11-tenant-isolation.md)).

## 5. `BaseTenantProcessor` — le socle

Pour chaque job : restaure le contexte, **mesure** `durationMs`, **journalise**
succès et échec avec `job`, `jobId`, `tenantId`, `correlationId`, et sur échec
`attempt` / `maxAttempts` + l'erreur. Puis **relance l'erreur** → BullMQ
applique le backoff.

> **RÈGLE : `handle()` doit être idempotent.** Livraison « au moins une fois »
> (outbox + retry) : un job PEUT être rejoué. Vérifier l'état avant d'agir,
> jamais un delta aveugle. Les processors existants le font (table
> `notifications` comme garde-fou, `scanStatus !== 'PENDING'` → skip, etc.).

## 6. Arrêt propre & drainage

`setupGracefulShutdown` (partagé API ↔ worker) : sur SIGTERM/SIGINT →
`app.close()`, qui déclenche `Worker.close()` de BullMQ et **draine les jobs
actifs**. Garde-fou : au-delà de **30 s**, `process.exit(1)` forcé (mieux vaut
un job réessayé qu'un pod zombie que Kubernetes SIGKILL). Erreur de fermeture →
`exit(1)` aussi.

## 7. Où c'est testé

| Aspect | Test |
|---|---|
| Files/jobs sans doublon, backoff exponentiel, priorité < pour le transactionnel, concurrence outbox = 1 | `src/infrastructure/tests/queue-constants.spec.ts` |
| Restauration du contexte, propagation `correlationId`, relance de l'erreur | `src/infrastructure/tests/base.processor.spec.ts` |
| `wrap()` capture le tenant, `runInTenant()` résout puis ouvre le contexte | `src/infrastructure/tests/tenant-aware-job.service.spec.ts` |
| Worker : aucun contrôleur, partage des modules métier | `src/shared/tests/modules-smoke.spec.ts` |
| Drainage borné : exit(0) au succès, exit(1) si close échoue ou dépasse 30 s | `src/bootstrap/tests/graceful-shutdown.spec.ts` |

## 8. Checklist de revue

- [ ] Nouveau job → un `@Processor` qui étend `BaseTenantProcessor` ; `handle()`
      **idempotent**.
- [ ] Nouvel enqueue → `tenantJobs.wrap(data)` pour le payload (jamais un
      `tenantId` en dur), `jobId` stable si dédoublonnage souhaité.
- [ ] Nouvelle file → une entrée dans `QUEUES`, `QUEUE_PRIORITY`,
      `QUEUE_CONCURRENCY` (les 3 tests l'exigent).
- [ ] Traitement cross-tenant → `@Cron` + `$privileged()`, pas un
      `BaseTenantProcessor`.
