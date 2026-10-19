# Déploiement et retour arrière

Mécanique reprise du socle (docs/socle/38-deploiement-caprover.md), portée de GitLab vers
**GitHub Actions + GitHub Container Registry (GHCR)**.

## 1. Chaîne de déploiement

```
PR → develop ─▶ ci.yml (qualité, unitaires, intégration, OpenAPI)
                 └▶ deploy.yml : build image ghcr.io/<owner>/gaatshort-backend:<sha>
                      └▶ STAGING : api (migrations + RLS) ─▶ smoke (version) ─▶ worker

tag vX.Y.Z sur main ─▶ même chaîne ─▶ APPROBATION (environnement « production ») ─▶ PRODUCTION
```

- **Une seule image** pour l'API et le worker ; le rôle est choisi par `APP_ROLE` (`api`, `worker`,
  `migrate`, `seed`) — `docker/entrypoint.sh`.
- L'API applique `prisma migrate deploy` puis la RLS **avant** de démarrer, sous verrou consultatif.
- Le **smoke test vérifie la version** (`/health/live` renvoie le SHA de l'image) : un rollback
  automatique de Swarm ne peut pas passer pour un succès.
- Le worker n'est déployé qu'une fois l'API nouvelle version saine (schéma déjà migré).
- L'image est analysée par Trivy (vulnérabilités critiques bloquantes).

## 2. Configuration initiale (une fois par environnement)

### 2.1 CapRover

Pour chaque environnement (`staging`, `production`), créer deux apps :

| App | Variables propres | Service Update Override |
|---|---|---|
| `gaatshort-api` (staging : `gaatshort-api-staging`) | `APP_ROLE=api`, `RUN_MIGRATIONS=true` + toutes les variables du `.env` | `deploy/caprover/api.service-update-override.yml` |
| `gaatshort-worker` (staging : `gaatshort-worker-staging`) | `APP_ROLE=worker` + mêmes variables | `deploy/caprover/worker.service-update-override.yml` |

Dans chaque app : **Deployment › App Token** → générer un jeton (il servira à GitHub).

Registre : **Cluster › Docker Registries › Add Remote Registry** — `ghcr.io`, utilisateur GitHub,
mot de passe = jeton GitHub (classic) avec **uniquement** la portée `read:packages`.

### 2.2 GitHub

**Settings › Environments** : créer `staging` et `production`.

| Environnement | Variables | Secrets | Protection |
|---|---|---|---|
| `staging` | `CAPROVER_URL`, `CAPROVER_API_APP`, `CAPROVER_WORKER_APP`, `API_PUBLIC_URL` | `CAPROVER_API_APP_TOKEN`, `CAPROVER_WORKER_APP_TOKEN` | branche `develop` uniquement |
| `production` | idem | idem | **reviewers obligatoires**, tags `v*.*.*` uniquement |

**Settings › Branches** : protéger `main` et `develop` — PR obligatoire, 1 revue, statuts requis :
`quality`, `unit`, `integration`, `openapi` ; pas de push direct ; pas de suppression.

### 2.3 Base de données

- Production : PostgreSQL 16 **géré** recommandé (sauvegardes et PITR) — 02-TRD §12.
- Créer le rôle applicatif sans privilège avant le premier déploiement :
  exécuter `prisma/sql/00-bootstrap-roles.sql` avec le rôle propriétaire (adapter le nom de la base).
- `DATABASE_URL` / `DATABASE_DIRECT_URL` : rôle **propriétaire** (migrations) ;
  `DATABASE_APP_ROLE=gaatshort_app` : rôle des requêtes applicatives (RLS effective).

### 2.4 Premier amorçage d'un environnement neuf

Une seule fois : déployer l'app API avec `RUN_SEED=true`, vérifier les logs (« ✓ Amorçage terminé »),
puis **retirer** `RUN_SEED` (sinon chaque redémarrage réinitialise le mot de passe admin).

## 3. Mettre en production

```bash
git switch main && git pull
git merge --no-ff develop          # via une PR develop → main de préférence
git tag -a v0.3.0 -m "MVP — phase 3"
git push origin main --tags
```

GitHub demande alors l'approbation de l'environnement `production`. Rien n'est déployé en
production sans cette approbation.

## 4. Retour arrière

| Situation | Action | Délai |
|---|---|---|
| La nouvelle version ne démarre pas (migration en échec, variable manquante) | Rien à faire : `start-first` + healthcheck font échouer la nouvelle tâche, **Swarm garde l'ancienne**. Le smoke test échoue et le worker n'est pas déployé. Corriger, puis nouveau tag. | automatique |
| La nouvelle version démarre mais régresse | Redéployer l'image précédente : **Actions › deploy › Re-run** du tag précédent, ou depuis un poste : `caprover deploy --caproverUrl … --appToken … --caproverApp gaatshort-api --imageName ghcr.io/<owner>/gaatshort-backend:<sha-précédent>` (puis le worker). | ~5 min |
| Une migration a été appliquée | Les migrations sont **additives** (expand/contract, docs/operations/migrations.md) : l'image précédente fonctionne sur le nouveau schéma. On ne défait **pas** une migration en production. | — |
| Données corrompues | Restauration **PITR sur une base parallèle**, comparaison, puis réparation ciblée. Jamais d'écrasement de la base de production sans accord explicite du porteur. | selon incident |
| Fournisseur de paiement défaillant | Changer la priorité du moyen de paiement dans le back-office (sans déploiement). | immédiat |

Chaque retour arrière en production fait l'objet d'une note d'incident (date, version, cause, action).
