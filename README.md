# Gaatshort — Backend API

API de la plateforme de mini-séries en streaming **Gaatshort** (marque blanche, Sénégal et Gambie).
**NestJS 11 · TypeScript · PostgreSQL 16 · Redis 7 · BullMQ**, en monolithe modulaire multi-tenant.

> **État : Phase 3 — socle technique.** Ce dépôt contient le socle repris de SOOBA (multi-tenant,
> IAM, outbox, idempotence, observabilité, CI/CD), sans aucun module métier. Les modules streaming
> (`catalog`, `media`, `storefront`, `playback`, `library`, `wallet`, `billing`) sont développés
> phase par phase selon [`docs/architecture/06-IMPLEMENTATION-PLAN.md`](docs/architecture/06-IMPLEMENTATION-PLAN.md).

## Spécification de référence

| Document | Contenu |
|---|---|
| [01-PRD](docs/architecture/01-PRD.md) | Produit, exigences `FR-*` / `NFR-*`, décisions validées |
| [02-TRD](docs/architecture/02-TRD.md) | Architecture, paiements, streaming, stratégie stores |
| [03-APPFLOW](docs/architecture/03-APPFLOW.md) | Parcours |
| [04-UI-UX-Design](docs/architecture/04-UI-UX-Design.md) | Design system et écrans |
| [05-BACKEND-SCHEMA](docs/architecture/05-BACKEND-SCHEMA.md) | Modèle de données cible |
| [06-IMPLEMENTATION-PLAN](docs/architecture/06-IMPLEMENTATION-PLAN.md) | Phases, tâches, traçabilité |

## Démarrer en local

Prérequis : Node 22, pnpm 9 (`corepack enable`), Docker.

```bash
cp .env.example .env
make setup     # dépendances + Postgres, Redis, MinIO, Mailpit + migrations + RLS + seed
make dev       # API sur http://localhost:3000/api/v1
make worker    # second terminal : workers BullMQ
```

| Service | URL |
|---|---|
| API | http://localhost:3000/api/v1 |
| OpenAPI | http://localhost:3000/docs |
| Santé | http://localhost:3000/health/live · /health/ready |
| Métriques | http://localhost:3000/metrics |
| Mails de test | http://localhost:8025 |
| Console MinIO | http://localhost:9001 |

Le seed crée la **marque maison** `gaatshort` (Sénégal, Gambie), les référentiels XOF / GMD / USD
et un compte administrateur (`SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` du `.env`).

Procédure détaillée et dépannage : [`docs/operations/lancement-local.md`](docs/operations/lancement-local.md).

## Barrière qualité

```bash
make verify    # identique à la CI
```

| Étape | Commande | Bloquant |
|---|---|---|
| Lint + frontières de couches | `pnpm lint:ci` | ✅ |
| Graphe de dépendances | `pnpm depcruise` | ✅ |
| Types | `pnpm exec tsc --noEmit -p tsconfig.json` | ✅ |
| Tests unitaires + couverture | `pnpm test:ci` | ✅ |
| **Isolation multi-tenant (RLS)** | `pnpm test:integration` | ✅ critique |
| Contrat OpenAPI à jour | `pnpm openapi:diff` | ✅ |

CI : [`.github/workflows/ci.yml`](.github/workflows/ci.yml) sur chaque pull request.
Déploiement : [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) — `develop` → staging,
tag `vX.Y.Z` → production après approbation. Voir [`docs/operations/deploiement.md`](docs/operations/deploiement.md).

## Carte du dépôt

```
src/
├── main.ts · worker.main.ts      API HTTP · process worker (même image, APP_ROLE)
├── config/                        configuration typée, validée au boot (Zod)
├── shared/                        noyau : domaine, ports, erreurs, guards, intercepteurs
├── infrastructure/                tenancy, Prisma + RLS, cache, verrous, files, outbox,
│                                  stockage S3, mail/SMS, observabilité, idempotence
└── modules/
    ├── iam/            OTP SMS/e-mail, sessions, RBAC          (à adapter : T1.4)
    ├── tenancy/        administration des marques
    ├── localization/   pays, devises, E.164
    ├── notifications/  e-mail / SMS idempotents
    └── compliance/     consentements, droits des personnes
prisma/
├── schema.prisma                  socle (22 modèles)
├── migrations/                    migration initiale 20261019180000_gaatshort_init
├── sql/                           rôles, RLS, index d'expression, partitions
└── seed/                          marque maison + référentiels + admin
docs/
├── architecture/                  les 6 documents de spécification validés
├── operations/                    lancement local, déploiement, rollback, migrations
└── socle/                         documentation technique héritée du socle (ADR inclus)
```

## Conventions non négociables

1. Aucun `process.env` hors `config/` — on injecte `AppConfigService`.
2. Aucun `PrismaClient` brut dans un module — `TenantPrismaService`.
3. Aucune règle métier dans un contrôleur.
4. Aucun `new Date()` dans le domaine — `ClockPort`.
5. **Aucun montant en `number` flottant** — VO `Money` en entiers d'unités mineures (NFR-MONEY-001).
6. Aucun accès direct aux entrailles d'un autre module — façade ou événement.
7. Tout consommateur d'événement est idempotent.
8. Tout endpoint public a un quota ; toute création a une clé d'idempotence.
9. **Aucun crédit ni droit de visionnage sans paiement vérifié côté serveur** (FR-PAY-006).

Contribuer : [`CONTRIBUTING.md`](CONTRIBUTING.md).
