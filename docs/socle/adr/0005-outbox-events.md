# ADR-0005 — Outbox transactionnel + BullMQ

**Statut** : accepté · **Date** : 2026-09-02

## Le problème

« Le statut passe à *présélectionné* **et** le candidat reçoit un e-mail. »
Deux systèmes, une seule intention. Deux façons de se tromper :

- **Publier avant le commit** → l'e-mail part, la transaction échoue. Le
  candidat est informé d'un état qui n'existe pas.
- **Publier après le commit** → le process meurt entre les deux. L'événement
  est perdu, silencieusement.

## Décision

**Outbox pattern.** L'événement est inséré dans `outbox_messages` **dans la
même transaction** que le changement d'état. Un relais planifié (5 s, protégé
par un verrou distribué) le publie ensuite sur BullMQ.

```
UnitOfWork.execute()
  ├─ SET LOCAL app.current_tenant_id
  ├─ UPDATE applications SET status = 'PRESELECTED'
  ├─ INSERT INTO outbox_messages (...)     ← même transaction
  └─ COMMIT                                 ← atomique

OutboxRelayJob (5 s, verrou distribué)
  ├─ SELECT ... FOR UPDATE SKIP LOCKED
  ├─ queue.add(event, { jobId: outbox.id })  ← jobId = dédoublonnage BullMQ
  └─ UPDATE outbox_messages SET processed_at = NOW()
```

> **Précision** : la garantie « une seule instance relaie » repose sur le
> **verrou distribué Redis** (`outbox:relay`), pas sur `FOR UPDATE SKIP LOCKED`.
> Ce dernier est posé pour une parallélisation future : aujourd'hui les lignes
> sont lues dans une micro-transaction qui commite aussitôt, donc les verrous de
> ligne tombent avant la boucle `queue.add`. Un double-relais éventuel (TTL du
> verrou dépassé) reste sans effet grâce au `jobId` déterministe.

## Conséquences

**Positives**
- Zéro événement perdu, zéro événement fantôme.
- Le relais rejoue automatiquement en cas d'échec (10 tentatives).
- `jobId = id outbox` : BullMQ dédoublonne nativement.

**Négatives**
- Latence de publication : jusqu'à 5 s. Acceptable pour un e-mail, pas pour
  une réponse synchrone — les réactions immédiates passent par le bus
  in-process.
- Une table de plus à surveiller. `outbox_backlog` est **l'alerte n°1** du
  système : si elle grimpe, plus rien ne part. Un message à `attempts >= 10`
  est **isolé** (plus réessayé) et compté par `outbox_dead_letters`.
  Mécanisme, seuils et runbook : [docs/34-outbox.md](../34-outbox.md).

**Contrainte imposée à toute l'équipe**
La livraison est « **au moins une fois** ». Tout consommateur d'événement
**doit** être idempotent : vérifier l'état avant d'agir, jamais appliquer un
delta aveugle. C'est vérifié en revue de code.

## Alternatives écartées

- **Publication directe après commit** — perte d'événement en cas de crash.
- **CDC / Debezium** — solide, mais ajoute Kafka et un connecteur à exploiter
  pour un volume qui ne le justifie pas encore.
- **Transaction distribuée (2PC)** — non supporté par Redis, et complexité
  hors de proportion.
