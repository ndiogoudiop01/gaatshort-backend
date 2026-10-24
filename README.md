# Gaatshort — Backend API

API de la plateforme de mini-séries en streaming **Gaatshort** (marque blanche, Sénégal et Gambie).
**NestJS 11 · TypeScript · PostgreSQL 16 · Redis 7 · BullMQ**, en monolithe modulaire multi-tenant.

> **État : v0 utilisable.** Catalogue de films et séries (épisodes, vidéos Bunny Stream, sous-titres,
> genres, licences), vitrine par marque, lecture HLS signée, 5 épisodes gratuits puis déblocage par
> crédits, portefeuille commun à toutes les marques (Q-02), commandes PayTech vérifiées, progression,
> favoris, back-office (tableau de bord, spectateurs, packs, commandes). Écarts assumés avec le
> modèle cible : [05-BACKEND-SCHEMA §13](docs/architecture/05-BACKEND-SCHEMA.md).

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

Le seed crée la **marque maison** `gaatshort` (Sénégal, Gambie), les référentiels XOF / GMD / USD,
un compte administrateur (`SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` du `.env`), six genres, quatre
packs de crédits (prix indicatifs du PRD) et — hors production — **trois séries FICTIVES** de
démonstration, avec une licence fictive SN/GM (`SEED_DEMO_CATALOG=false` pour s'en passer).

### Sans compte Bunny ni PayTech

Par défaut, `VIDEO_DRIVER=fake` et `PAYMENT_DRIVER=fake` (refusés en production) :

- la lecture renvoie un flux HLS public de démonstration ; un téléversement de vidéo au
  back-office rend l'épisode « prêt » immédiatement ;
- le paiement ouvre une page simulée servie par l'API (`/api/v1/billing/fake-checkout/:ref`) dont
  la notification suit exactement le chemin d'un IPN réel (signature, montant, crédit unique) ;
- le code SMS s'affiche dans les journaux de l'API (`SMS_DRIVER=log`).

Pour passer au réel : `VIDEO_DRIVER=bunny` (+ `BUNNY_*`, webhook d'encodage
`POST /api/v1/webhooks/bunny/<BUNNY_WEBHOOK_SECRET>`) et `PAYMENT_DRIVER=paytech`
(+ `PAYTECH_API_KEY`, `PAYTECH_API_SECRET`, IPN `POST /api/v1/webhooks/paytech`). **À valider en
staging** avant la production : jeton de lecture Bunny (HS256, mode répertoire) et vérification de
l'IPN PayTech (`hmac_compute`) avec un vrai paiement.

### Numéros de test (connexion sans SMS)

Définis par `AUTH_TEST_PHONES` (voir `.env.example`) ; le code est fixe, aucun SMS n'est envoyé, l'expiration et la limite d'essais s'appliquent.

| Numéro | Code |
|---|---|
| +221 70 000 00 01 | 111111 |
| +221 70 000 00 02 | 222222 |
| +221 70 000 00 03 | 333333 |

Interdits en production, sauf `AUTH_TEST_PHONES_IN_PRODUCTION=true` (comptes de relecture Apple / Google) — à retirer après la relecture.

## API (résumé)

Toutes les routes sont sous `/api/v1` ; la marque vient du domaine, du jeton, ou de l'en-tête
`x-tenant-id` (slug). Contrat complet : `openapi.json` et http://localhost:3000/docs.

| Côté | Routes principales |
|---|---|
| Compte | `POST /auth/challenge` (OTP SMS) · `POST /auth/verify` · `POST /auth/refresh` · `POST /auth/login` (back-office) |
| Vitrine | `GET /storefront/config` · `/storefront/home` · `/storefront/genres` · `/storefront/series` · `/storefront/series/:slug` |
| Lecture | `GET /episodes/:id/playback` (403 `EPISODE_LOCKED`) · `POST /episodes/:id/unlock` (409 `INSUFFICIENT_BALANCE`) · `PUT /episodes/:id/progress` |
| Bibliothèque | `GET /me/continue-watching` · `GET/POST/DELETE /me/favorites` |
| Crédits | `GET /wallet` · `GET /wallet/ledger` · `GET /billing/packs` · `POST /billing/orders` (`Idempotency-Key`) · `GET /billing/orders/:ref` |
| Back-office | `/admin/series`, `/admin/episodes`, `/admin/genres`, `/admin/catalog/import` (CSV, essai à blanc par défaut), `/admin/licenses`, `/admin/storefront/series`, `/admin/packs`, `/admin/orders`, `/admin/viewers`, `/admin/dashboard`, `/admin/users`, `/admin/roles`, `/admin/tenants` |

Rôles : `VIEWER` (spectateur), `CONTENT_MANAGER`, `SUPPORT`, `ADMIN` (marque), `SUPER_ADMIN`.

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
    ├── iam/            OTP SMS, compte global du spectateur, sessions, RBAC
    ├── tenancy/        administration des marques
    ├── catalog/        séries, épisodes, vidéos (Bunny / factice), licences, vitrine par marque
    ├── wallet/         portefeuille commun, grand livre immuable, déblocage, droits
    ├── library/        vitrine publique, lecture signée, progression, favoris
    ├── billing/        packs, commandes, PayTech (IPN vérifié), paiement simulé
    ├── audience/       spectateurs et tableau de bord du back-office
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
