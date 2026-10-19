# Outbox transactionnel & relais d'événements

> Un événement métier est publié **si et seulement si** la transaction qui l'a
> produit a été **validée**. Ni fantôme, ni perdu.

Décision : [ADR-0005](adr/0005-outbox-events.md). Ce document décrit le
**mécanisme**, les **métriques** et le **runbook**.

| Élément | Fichier |
|---|---|
| Unit of Work (transaction + collecte + insertion outbox) | `src/infrastructure/persistence/transaction/prisma-unit-of-work.ts` |
| Relais planifié | `src/infrastructure/events/outbox/outbox-relay.job.ts` |
| Table | `outbox_messages` (`prisma/schema.prisma`) |
| Métriques | `src/infrastructure/observability/metrics/metrics.service.ts` |

---

## 1. Le flux

```
UnitOfWork.execute(work)                       ← une seule transaction
  ├─ SET LOCAL app.current_tenant_id
  ├─ work()  → l'agrégat émet des DomainEvent, collectés en mémoire
  ├─ INSERT INTO outbox_messages (...)         ← MÊME transaction que work()
  └─ COMMIT                                     ← atomique : tout ou rien

OutboxRelayJob   (@Cron 5 s, verrou Redis « outbox:relay »)
  ├─ SELECT ... FROM outbox_messages
  │    WHERE processed_at IS NULL AND attempts < 10
  │    ORDER BY occurred_at  LIMIT 200  FOR UPDATE SKIP LOCKED
  ├─ pour chaque ligne : queue.add(eventName, payload, { jobId: ligne.id })
  │    └─ échec → attempts++ , last_error  (réessai à la passe suivante)
  ├─ UPDATE outbox_messages SET processed_at = NOW()  (lignes publiées)
  └─ (hors verrou, chaque pod) rafraîchit outbox_backlog / outbox_dead_letters
```

## 2. Unit of Work

- **Insertion dans la transaction** : `tx.outboxMessage.createMany(...)` est
  émis sur le **même `tx`** que `work()`, avant le `COMMIT`. Si `work()` jette
  → `$transaction` rollback → **zéro ligne** dans `outbox_messages`. Vérifié par
  `test/integration/outbox.spec.ts` (« un ROLLBACK ne publie AUCUN événement »).
- **`execute()` imbriqué** : ne rouvre **jamais** de transaction (Prisma ne le
  supporte pas) et **partage le sink** d'événements de l'`execute()` externe
  (via un `AsyncLocalStorage<DomainEvent[]>`). Sans ce partage, un événement
  produit dans l'imbrication serait silencieusement perdu.
- **Tenant** : `set_config('app.current_tenant_id', …, TRUE)` en tête de
  transaction → l'`INSERT` outbox passe la RLS (`tenant_id` estampillé).

## 3. Relais

| Aspect | Détail |
|---|---|
| Cadence | `@Cron` toutes les 5 s (latence de publication ≤ ~5 s — OK pour un e-mail, pas pour une réponse synchrone). |
| **Une seule instance** | Verrou distribué Redis `outbox:relay` (`SET NX PX 30 s` + libération compare-and-delete). Si le verrou est pris, le tick ne fait rien. C'est **LA** protection contre le double-relais. |
| `FOR UPDATE SKIP LOCKED` | Présent pour une future parallélisation. **Aujourd'hui il ne protège rien de plus** : les lignes sont lues dans une micro-transaction qui commite aussitôt, les verrous de ligne tombent avant la boucle `queue.add`. |
| Double-relais éventuel (TTL du verrou dépassé) | **Sans effet** : `jobId = id outbox` → BullMQ dédoublonne ; `processed_at` est idempotent. |
| Retry de publication | Sur échec `queue.add` (Redis KO…) : `attempts++` + `last_error`. Réessayé à la passe suivante. |
| **Isolation** | À `attempts >= 10`, la ligne sort de la requête du relais : **plus jamais réessayée**. Elle reste `processed_at IS NULL` → visible via `outbox_dead_letters`. |
| Livraison | **« au moins une fois »**. Tout consommateur d'événement **doit** être idempotent (vérifié en revue — cf. ADR-0005). |

## 4. Métriques & alertes  *(découpage « outbox_backlog + seuil documenté »)*

Rafraîchies à **chaque passe** du relais (5 s), par **chaque pod** (requête
`count` bornée) → Prometheus voit la même valeur quel que soit le pod scrapé.

| Métrique (Gauge) | Définition | Signification |
|---|---|---|
| `outbox_backlog` | `count(*) WHERE processed_at IS NULL AND attempts < 10` | Événements en attente, **encore réessayables**. En régime normal : proche de 0, pics brefs. |
| `outbox_dead_letters` | `count(*) WHERE processed_at IS NULL AND attempts >= 10` | Événements **isolés**. Doit rester **à 0**. |

### Seuils d'alerte proposés (à ajuster selon le volume réel)

```yaml
# Prometheus / Alertmanager
- alert: OutboxBacklogHigh
  expr: outbox_backlog > 100
  for: 5m
  labels: { severity: warning }
  annotations:
    summary: "Backlog outbox élevé ({{ $value }})"
    runbook: "docs/34-outbox.md#runbook"

- alert: OutboxBacklogCritical
  expr: outbox_backlog > 1000
  for: 5m
  labels: { severity: critical }

- alert: OutboxStalled            # le backlog ne redescend pas → relais mort
  expr: min_over_time(outbox_backlog[10m]) > 50 and deriv(outbox_backlog[10m]) >= 0
  for: 10m
  labels: { severity: critical }

- alert: OutboxDeadLetters
  expr: outbox_dead_letters > 0
  for: 15m
  labels: { severity: warning }
```

> Pourquoi `outbox_backlog` est **l'alerte n°1** : si elle grimpe et ne
> redescend pas, **plus aucun événement ne part** — pas d'e-mail de
> présélection, pas de scoring, pas d'ingestion analytics.

## 5. Runbook

**`OutboxBacklogHigh` / `OutboxStalled`**
1. Le relais tourne-t-il ? Logs `OutboxRelayJob` (`… relayé(s)` toutes les 5 s).
2. Redis joignable ? (le relais prend un verrou Redis + publie sur BullMQ).
3. Le verrou est-il bloqué ? Clé `ig:lock:outbox:relay` — TTL 30 s, doit
   tourner. En dernier recours : `DEL` la clé (un seul pod redémarrera la passe).
4. Postgres saturé ? (`SELECT ... FOR UPDATE` lent).
5. Pic légitime (import massif) ? Surveiller la **pente** : elle doit redescendre.

**`OutboxDeadLetters > 0`**
1. `SELECT id, event_name, last_error, attempts FROM outbox_messages
   WHERE processed_at IS NULL AND attempts >= 10;`
2. Corriger la cause (souvent : payload invalide, file inexistante).
3. Rejouer : `UPDATE outbox_messages SET attempts = 0, last_error = NULL
   WHERE id = ...;` → le relais le reprend à la passe suivante.
4. Ou abandonner explicitement : `UPDATE ... SET processed_at = NOW()` (l'événement
   ne sera jamais publié — à tracer).

## 6. Checklist de revue

- [ ] Une écriture métier + un événement → **dans un seul `uow.execute()`**
      (jamais `repo.save()` puis `eventBus.publish()` hors transaction).
- [ ] L'agrégat émet ses `DomainEvent` ; le use-case fait `ctx.collect(aggregate)`.
- [ ] Le consommateur de l'événement (processor BullMQ) est **idempotent**.
- [ ] Rien d'externe (e-mail, SMS, appel tiers) dans un **listener synchrone**
      (`DomainEventBus`) — ça passe par l'outbox.

## 7. Où c'est testé

| | Test |
|---|---|
| Rollback → 0 ligne ; commit → 1 ligne ; `execute()` imbriqué → l'event interne est inséré ; relais publie, isole à `attempts>=10`, `processed_at`, métriques | `test/integration/outbox.spec.ts` |
| UoW : réutilise la transaction, dépose les events, partage le sink imbriqué | `src/infrastructure/tests/prisma-unit-of-work.spec.ts` |
| Relais : `jobId` = id outbox, `attempts++` sur échec, backlog/dead exposés, rien si verrou pris | `src/infrastructure/tests/outbox-relay.job.spec.ts` |
