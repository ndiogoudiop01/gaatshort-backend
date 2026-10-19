# Lancement local

## Prérequis

| Outil | Version | Vérification |
|---|---|---|
| Node.js | 22 (`.nvmrc`) | `node -v` |
| pnpm | 9.12 (champ `packageManager`) | `corepack enable && pnpm -v` |
| Docker + Compose | récent | `docker compose version` |
| make | — | sous Windows : Git Bash ou WSL |

## Première installation

```bash
cp .env.example .env          # valeurs de développement, aucune donnée réelle
make setup
```

`make setup` enchaîne, dans cet ordre (l'ordre compte) :

1. `pnpm install` ;
2. `docker compose up -d postgres redis minio mailpit` — Postgres crée au premier démarrage le rôle
   applicatif `gaatshort_app` (`prisma/sql/00-bootstrap-roles.sql`) ;
3. `pnpm db:generate` — client Prisma ;
4. `pnpm db:migrate` — migration initiale `20261019180000_gaatshort_init` ;
5. `pnpm db:rls` — politiques de Row Level Security sur toutes les tables portant `tenant_id` ;
6. `pnpm db:indexes` — index d'expression et partiels ;
7. `pnpm db:seed` — marque maison `gaatshort`, pays SN / GM, devises XOF / GMD / USD, permissions, admin.

Puis, dans deux terminaux : `make dev` (API) et `make worker` (BullMQ).

## Vérifier que tout fonctionne

```bash
curl -s http://localhost:3000/health/live      # {"status":"ok","version":"dev"}
curl -s http://localhost:3000/health/ready     # 200 si Postgres et Redis répondent
curl -s -H "x-tenant-id: gaatshort" http://localhost:3000/api/v1/localization/countries
```

Connexion OTP : `POST /api/v1/auth/challenge` avec un numéro E.164 ; en local, `SMS_DRIVER=log`
écrit le code dans les logs de l'API et `MAIL_DRIVER=smtp` l'envoie à Mailpit (http://localhost:8025).

## Variables d'environnement

Toutes sont documentées et validées au démarrage par `src/config/env.schema.ts` (Zod) : une variable
manquante ou invalide arrête l'API avec un message explicite. `.env.example` donne des valeurs de
développement. **Aucun secret réel ne doit être commité** ; en staging et en production, les valeurs
sont saisies dans CapRover (App Configs › Environmental Variables).

| Groupe | Variables | Remarque |
|---|---|---|
| Application | `NODE_ENV`, `APP_*`, `FRONTEND_URL`, `CORS_ORIGINS` | |
| Multi-tenant | `TENANCY_*` | `TENANCY_ROOT_DOMAIN` = domaine racine des sous-domaines de marque |
| Base | `DATABASE_URL`, `DATABASE_DIRECT_URL`, `DATABASE_APP_ROLE` | `DATABASE_APP_ROLE` **doit** être un rôle sans `BYPASSRLS` |
| Cache / files | `REDIS_URL`, `REDIS_KEY_PREFIX` | |
| Auth | `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `OTP_*` | secrets distincts, ≥ 32 caractères en production |
| Stockage | `STORAGE_*` | S3 compatible (MinIO en local) |
| Mail / SMS | `MAIL_*`, `SMTP_*`, `SMS_*` | fournisseur SMS de production à choisir (T1.5) |
| Observabilité | `LOG_*`, `METRICS_ENABLED`, `OTEL_*`, `SENTRY_DSN` | |
| Quotas | `RATE_LIMIT_*` | |
| Conservation | `GDPR_*` | noms hérités du socle, revus en T8.5 |
| Seed | `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` | |

Les variables des fournisseurs de paiement (PayTech, Wave, PayDunya) et de Bunny Stream arrivent avec
leurs modules (P2, P6). Les identifiants des fournisseurs de paiement ne seront **pas** des variables
d'environnement : ils seront stockés chiffrés en base (`payment_provider_accounts`, 05-BACKEND-SCHEMA §4.3).

## Dépannage

| Symptôme | Cause probable | Correction |
|---|---|---|
| `TS2353 … does not exist in type` | client Prisma pas à jour | `pnpm db:generate` |
| L'API met ~90 s à écouter, `ECONNREFUSED` en boucle | Redis arrêté | `docker compose up -d redis` |
| Toutes les requêtes renvoient `TENANT_INVALID` | ni sous-domaine, ni en-tête `x-tenant-id`, ni JWT | ajouter `-H "x-tenant-id: gaatshort"` |
| Les tests d'isolation échouent en local | connexion avec le rôle propriétaire | vérifier `DATABASE_APP_ROLE=gaatshort_app` |
| Tenant introuvable juste après un seed | cache d'annuaire | `make cache-flush`, puis redémarrer l'API |

Réinitialiser la base locale : `make reset` (supprime toutes les données locales).
