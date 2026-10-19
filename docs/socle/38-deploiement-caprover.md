# 38 — Déploiement continu sur CapRover (GitLab CI/CD)

Méthode retenue : **CLI officielle**, `caprover deploy --imageName`, authentifiée
par **jeton d'application** (pas par le mot de passe admin).

CapRover **ne construit rien** : il tire l'image déjà testée et poussée par le
job `build:image` dans le Container Registry GitLab, taguée par SHA de commit.

```
push main ─▶ install · quality · test ─▶ build:image ─▶ deploy:api ─▶ smoke:api ─▶ deploy:worker
                                         (registry,     (migrations   (bonne        (même image,
                                          tag = SHA)     + RLS puis    version ET    APP_ROLE=worker)
                                                         l'API)        ready = 200)
```

**Le smoke test vérifie la VERSION**, pas seulement la santé : l'image embarque
`APP_VERSION` = SHA du commit (`--build-arg` de `build:image`), renvoyé par
`GET /health/live` (`{"status":"ok","version":"<sha>"}`). Sans cela, après un
rollback automatique de Swarm, l'ancienne version répondrait 200 et le pipeline
serait vert alors que rien n'a été déployé.

| Fichier | Rôle |
|---|---|
| `.gitlab-ci.yml` | jobs `.caprover`, `deploy:api`, `smoke:api`, `deploy:worker` |
| `docker/entrypoint.sh` | choisit le process selon `APP_ROLE` ; applique migrations + RLS pour l'API |
| `docker/Dockerfile` | `ENTRYPOINT tini -- entrypoint.sh` (docker-compose inchangé : sa `command:` est exécutée telle quelle) |
| `deploy/caprover/api.service-update-override.yml` | healthcheck, arrêt 35 s, mise à jour start-first + rollback |
| `deploy/caprover/worker.service-update-override.yml` | arrêt 35 s (drainage BullMQ), stop-first |

## 1. Une seule image, quatre rôles

| `APP_ROLE` | Ce que fait le conteneur |
|---|---|
| `api` (défaut) | `prisma migrate deploy` → `rls-policies.sql` (sous verrou consultatif) → `node dist/main.js`. `RUN_MIGRATIONS=false` saute l'étape. |
| `worker` | attend que `prisma migrate status` soit à jour (max `WAIT_FOR_MIGRATIONS_SECONDS`, 300 s par défaut ; `0` = pas d'attente), puis `node dist/worker.main.js`. Le worker ne migre jamais. |
| `migrate` | migrations + RLS puis sortie (usage ponctuel, ex. `docker run`) |
| `seed` | migrations + RLS + amorçage (`node dist/seed/index.js --allow-production`) puis sortie (usage ponctuel, ex. `docker run`) |

`RUN_SEED=true` sur l'app API : l'amorçage est joué après les migrations et
avant le démarrage de l'API (un échec est journalisé sans bloquer l'API).
Le seed est idempotent mais réinitialise le mot de passe admin : retirer la
variable une fois l'amorçage passé.

Pourquoi les migrations dans l'API et pas dans un service séparé ? Un service
Swarm qui se termine est **redémarré en boucle** : CapRover n'a pas d'équivalent
de `service_completed_successfully` (docker-compose). En revanche, avec
`start-first` + healthcheck, une migration en échec fait échouer la NOUVELLE
tâche : Swarm annule la mise à jour et **l'ancienne version continue de servir**.
Plusieurs réplicas qui démarrent ensemble sont sérialisés : `migrate deploy`
prend son propre verrou, et l'entrypoint en prend un (`pg_advisory_lock`) autour
de la RLS.

> **Règle d'équipe (expand / contract)** : pendant un déploiement, l'ancienne
> version tourne quelques secondes sur le nouveau schéma. Une migration ne doit
> donc jamais supprimer ou renommer une colonne encore lue par la version en
> production : on ajoute d'abord, on supprime dans une livraison suivante.

## 2. Mise en place — une seule fois

### 2.1 Postgres et Redis dans CapRover

1. *Apps → One-Click Apps* : **PostgreSQL 16** (app `impact-postgres`) et
   **Redis 7** (app `impact-redis`), avec des mots de passe forts.
   Nom DNS interne : `srv-captain--impact-postgres`, `srv-captain--impact-redis`.
2. Une seule fois, en tant que propriétaire de la base, exécuter
   `prisma/sql/00-bootstrap-roles.sql` (rôle `sooba_app`, extensions).
   **Changez le mot de passe de `sooba_app`** codé en dur dans ce fichier.
3. Postgres ne doit **pas** être exposé publiquement (pas de port mappé).

### 2.2 Accès de CapRover au registry GitLab (image privée)

1. GitLab → *Settings → Repository → Deploy tokens* : créer un jeton
   `caprover-pull`, portée **`read_registry`** uniquement.
2. CapRover → *Cluster → Docker Registry Configuration → Add Remote Registry* :
   - Username : nom du deploy token · Password : sa valeur
   - Domain : `registry.gitlab.com` · Image prefix : `sooba-group`
3. **Désactiver « Default Push Registry »** (CapRover ne pousse rien, il tire).

Sans cette étape : `pull access denied` au déploiement.

### 2.3 Les deux applications CapRover

**`sooba-api`**
- *HTTP Settings* : Container HTTP Port **3000**, domaine `api.<votre-domaine>`,
  **Enable HTTPS** + **Force HTTPS**, *Websocket Support* si besoin.
- *App Configs → Environment Variables* : voir 2.4, plus `APP_ROLE=api`.
- *App Configs → Service Update Override* : coller
  `deploy/caprover/api.service-update-override.yml`.
- *Instance Count* : 1 pour commencer (2+ pour la haute disponibilité).

**`sooba-worker`**
- *HTTP Settings* : cocher **Do not expose as web-app**.
- Mêmes variables d'environnement que l'API, avec `APP_ROLE=worker`.
- *Service Update Override* : `deploy/caprover/worker.service-update-override.yml`.
- *Instance Count* : 2 (comme `docker-compose.yml`).

Jetons d'application : dans chaque app, *Deployment → Method 1 → Enable App
Token*, puis copier le jeton.

### 2.4 Variables d'environnement des apps (CapRover, pas GitLab)

Partir de `.env.example`. Valeurs propres à la production :

```dotenv
NODE_ENV=production
LOG_PRETTY=false
APP_PUBLIC_URL=https://api.<votre-domaine>
FRONTEND_URL=https://<front>
CORS_ORIGINS=https://<front>,https://<backoffice>
DATABASE_URL=postgresql://<owner>:<mdp>@srv-captain--impact-postgres:5432/sooba_group?schema=public&connection_limit=20&pool_timeout=10
DATABASE_DIRECT_URL=postgresql://<owner>:<mdp>@srv-captain--impact-postgres:5432/sooba_group?schema=public
DATABASE_APP_ROLE=sooba_app
REDIS_URL=redis://:<mdp>@srv-captain--impact-redis:6379
JWT_ACCESS_SECRET=<openssl rand -base64 48>
JWT_REFRESH_SECRET=<openssl rand -base64 48, différent>
TENANCY_ALLOW_ANONYMOUS_FALLBACK=false
# STORAGE_*, SMTP_*, SMS_*, SENTRY_DSN : vos fournisseurs réels
```

`DATABASE_DIRECT_URL` doit exister même identique à `DATABASE_URL` (cf. docs/33 §3.5).
Ne jamais mettre `SEED_ADMIN_PASSWORD` en production une fois le premier admin créé.

### 2.5 Variables GitLab (Settings → CI/CD → Variables)

| Variable | Valeur | Protected | Masked |
|---|---|---|---|
| `CAPROVER_URL` | `https://captain.<domaine-racine>` | ✅ | — |
| `CAPROVER_API_APP_TOKEN` | jeton d'app de `sooba-api` | ✅ | ✅ |
| `CAPROVER_WORKER_APP_TOKEN` | jeton d'app de `sooba-worker` | ✅ | ✅ |
| `API_PUBLIC_URL` | `https://api.<votre-domaine>` (sans `/` final) | ✅ | — |
| `CAPROVER_API_APP` / `CAPROVER_WORKER_APP` | facultatif — défauts `sooba-api` / `sooba-worker` | — | — |

« Protected » exige que `main` soit une **branche protégée** (*Settings →
Repository → Protected branches*) : c'est le cas par défaut. Tant que
`CAPROVER_URL` n'existe pas, les jobs de déploiement ne sont pas créés — on peut
fusionner cette configuration avant d'avoir le serveur.

## 3. Premier déploiement — check-list

1. Variables GitLab et CapRover posées, registry ajouté, deux apps créées.
2. Fusionner sur `main` → pipeline : `build:image` → `deploy:api` → `smoke:api` → `deploy:worker`.
3. Dans CapRover, *sooba-api → Deployment → View App Logs* : on doit voir
   `migrations : terminées` puis le démarrage de Nest.
4. `curl -i https://api.<domaine>/health/ready` → `200`.
5. *sooba-worker → logs* : `Worker démarré — en écoute sur les files BullMQ`.
6. Facultatif, amorçage : `RUN_SEED=true` + `SEED_ADMIN_PASSWORD` sur l'app
   API, *Save & Restart*, vérifier `seed : terminé` dans les logs, puis retirer
   les deux variables (jamais automatique en production).

## 4. Exploitation

**Rollback** : GitLab → *Deploy → Environments → production* → **Re-deploy**
sur un déploiement précédent. Le job relance `caprover deploy` avec l'image de
ce commit (tags SHA immuables). Si GitLab refuse (« outdated deployment »),
cocher *Settings → CI/CD → General pipelines → Allow job retries for rollback
deployments*. Rollback du worker : environnement
`production-worker`. Attention : un rollback ne défait pas une migration —
d'où la règle expand / contract.

**Déployer à la main** (urgence, depuis un poste) :
```bash
npx caprover@2.4.4 deploy --caproverUrl https://captain.<domaine> \
  --appToken <jeton> --caproverApp sooba-api \
  --imageName registry.gitlab.com/sooba-group/sooba-impact-backend:<sha-court>
```

**Rendre le déploiement manuel** (validation humaine) : ajouter `when: manual`
à la règle de `deploy:api` dans `.caprover`.

**Pannes fréquentes**

| Symptôme | Cause probable |
|---|---|
| `pull access denied` | registry GitLab non ajouté dans CapRover (§2.2) ou deploy token expiré |
| `deploy:api` vert mais `smoke:api` rouge | migration en échec ou variable manquante → logs de l'app ; Swarm a gardé l'ancienne version |
| API redémarrée en boucle, `unhealthy` | `Container HTTP Port` ≠ 3000, ou override non collé |
| 502 pendant un déploiement | override absent (pas de start-first / healthcheck) |
| Jobs de déploiement absents | `CAPROVER_URL` non définie, ou `main` non protégée (variables protégées invisibles) |
| `Unauthorized` / `Invalid token` | jeton d'app régénéré dans CapRover sans mettre à jour GitLab |
