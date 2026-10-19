# Montée en charge — goulots identifiés et parades

Ce document ne parle pas de « scalabilité » en général. Il liste les points
qui **casseront en premier** sur ce système précis, dans l'ordre où ils
casseront, et ce qui est déjà en place pour chacun.

## Palier 0 — ce qui est déjà fait

| Goulot | Parade en place |
|---|---|
| Résolution du tenant à chaque requête | Annuaire en cache Redis, TTL 300 s |
| Catalogue lu à chaque visite | Cache 120 s + protection anti-stampede |
| Calculs du simulateur | Fonction **pure**, zéro I/O, persistance optionnelle |
| Téléversement de PDF | URLs S3 signées — le binaire ne touche jamais l'API |
| E-mails et SMS | Files BullMQ, jamais dans le cycle requête/réponse ([docs/13](13-queues-workers.md)) |
| Exports CSV | Asynchrones (202 + job) |
| Charge CPU des jobs vs latence API | Process **worker** séparé, dimensionné sur la profondeur des files |
| KPIs du dashboard | Snapshots pré-agrégés, pas d'agrégation à la volée |
| Requêtes qui traînent | Timeout global 15 s |
| Déploiements | Arrêt propre, drainage des requêtes en vol |

## Palier 1 — 1 000 candidatures / mois

**Ce qui casse en premier : le pool de connexions Postgres.**

Node est mono-thread ; chaque instance ouvre 20 connexions. À 10 instances,
200 connexions — Postgres plafonne autour de 300 par défaut, et chaque
connexion coûte ~10 Mo.

- ✅ Introduire **PgBouncer** en mode `transaction`.
  ⚠️ Attention : les transactions interactives de Prisma exigent un
  `directUrl` qui court-circuite le pooler. Le schéma le prévoit déjà.
- ✅ Surveiller `pg_stat_activity` : si `idle in transaction` grimpe, une
  transaction est laissée ouverte quelque part.

**Deuxième goulot : les scans sur `applications`.**
Les index composites `(tenant_id, status, created_at DESC)` et l'index
partiel `applications_open_idx` couvrent les écrans du CRM.

## Palier 2 — 10 000 candidatures / mois, 50 000 profils au vivier

**Séparer lectures et écritures.**
`DATABASE_READ_REPLICA_URL` est déjà dans la configuration : les
read-models (CRM, vivier, dashboard) basculent sur la réplique, les
commandes restent sur le primaire.

> C'est ici que le découpage CQRS-lite paie : les requêtes de lecture sont
> déjà des classes distinctes, sans effet de bord. Le routage est un
> changement d'injection, pas une réécriture.

**Partitionner `analytics_events`.**
La table grossit linéairement avec le trafic. `prisma/sql/partitions.sql`
fournit le partitionnement mensuel ; purger un mois devient un
`DROP TABLE` instantané au lieu d'un `DELETE` de plusieurs millions de lignes.

**Dimensionner les workers séparément.**
L'API scale sur la latence p95 ; les workers sur la profondeur des files.
Deux déploiements, deux signaux d'autoscaling.

## Palier 3 — 100 000+ / multi-pays

| Levier | Détail |
|---|---|
| Cache HTTP en périphérie | CDN sur `/content/*`, `/activities`, `/news` — `Cache-Control` + purge à la publication |
| Recherche dédiée | Le CRM en `ILIKE` + trigram atteint sa limite → Meilisearch ou Typesense derrière un port `SearchPort` |
| Tenants « silo » | Un client à volumétrie exceptionnelle passe en `isolation = SCHEMA` sans changement de code |
| Extraction de service | Le simulateur d'abord : sans état, profil de charge divergent, extraction triviale |
| Partitionnement par tenant | `applications` et `partner_leads` partitionnables par hachage de `tenant_id` |

## Anti-patterns bannis dans ce dépôt

| ❌ Interdit | Pourquoi | ✅ À la place |
|---|---|---|
| `Scope.REQUEST` sur un provider | Reconstruit tout l'arbre d'injection à chaque requête | `AsyncLocalStorage` |
| `SELECT *` puis filtrage en JS | Transfert et mémoire inutiles | `select` explicite, `WHERE` en base |
| `COUNT(*)` sur chaque page | Coûteux et rarement utile | Curseur, ou `COUNT` mis en cache |
| Boucle de requêtes (N+1) | Explosion des allers-retours | `getManyByIds`, `include` |
| `KEYS *` sur Redis | Bloque le serveur | `SCAN` (`delByPattern` l'utilise) |
| E-mail envoyé dans la transaction | Envoi pour un commit avorté | Outbox → file |
| Export synchrone | Timeout de la passerelle | Job + URL signée |
| `tenantId` dans un label Prometheus | Explosion de cardinalité | Le tenant reste dans les logs et les traces |

## Ce qu'on surveille

| Métrique | Seuil d'alerte | Ce que ça révèle |
|---|---|---|
| `outbox_backlog` | > 1 000 | **Alerte n°1** : le relais est bloqué, des événements ne partent plus |
| `http_request_duration_seconds` p95 | > 1 s | Requête ou index à revoir |
| `queue_depth` | > 5 000 | Workers sous-dimensionnés |
| `tenant_resolution_failures_total` | pic soudain | Erreur de configuration DNS ou tentative d'intrusion |
| Connexions Postgres | > 80 % du max | Fuite de connexion ou pooler à installer |

Détail des trois piliers (logs corrélés, métriques, traces) et des sondes :
[docs/37-observability.md](37-observability.md).
