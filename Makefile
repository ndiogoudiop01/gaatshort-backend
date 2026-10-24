.DEFAULT_GOAL := help
SHELL := /bin/bash

help: ## Affiche cette aide
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2}'

install: ## Installe les dépendances
	pnpm install

up: ## Démarre l'infrastructure locale (pg, redis, minio, mailpit)
	docker compose up -d postgres redis  mailpit

down: ## Arrête l'infrastructure locale
	docker compose down

# Purge le cache d'annuaire des tenants (slug|domaine|id -> contexte), que
# `TenantRegistryService` garde en Redis pendant TENANCY_CACHE_TTL_SECONDS.
#
# POURQUOI C'EST OBLIGATOIRE APRÈS UN SEED : l'extension multi-tenant injecte
# le `tenantId` résolu dans le `where` de TOUTE lecture. Si le seed a recréé
# les tenants avec d'autres UUID (base réinitialisée, IDs figés modifiés),
# l'API continue de résoudre `gaatshort` vers l'ANCIEN id, cherche
# l'utilisateur dans un tenant disparu, et répond INVALID_CREDENTIALS sur un
# mot de passe parfaitement valide. Symptôme vécu : `pnpm diagnose:login`
# voit le compte (client Prisma nu, sans injection) mais `POST /auth/login`
# renvoie 401.
#
# Suppression CIBLÉE plutôt que FLUSHALL : les files BullMQ vivent dans le même
# Redis (préfixe `ig:bull`), et vider les jobs en attente n'a aucun rapport
# avec le problème qu'on corrige.
#
# Le pipe tourne dans le `sh` du conteneur, pas dans le shell de l'hôte : c'est
# ce qui rend la commande identique sous Git Bash, PowerShell et cmd.exe.
# `-T` désactive le TTY (indispensable quand make ou la CI appelle la cible).
# `-` en préfixe : Redis éteint ne doit pas faire échouer `make reset`.
cache-flush: ## Purge le cache d'annuaire des tenants (après un seed)
	@echo "► Purge du cache d'annuaire des tenants…"
	-@docker compose exec -T redis sh -c 'redis-cli --scan --pattern "*tenant:lookup:*" | xargs -r redis-cli del' >/dev/null 2>&1 \
	  || echo "  ⚠ Redis injoignable — purge ignorée. Pensez à redémarrer l'API."
	@echo "  ⚠ Redémarrez l'API : elle garde aussi un cache EN MÉMOIRE"
	@echo "    (clientCache de TenantPrismaService, indexé par tenantId)."

# Ordre imposé : generate -> migrate -> rls -> indexes -> seed.
#  - `prisma/migrations/` est versionné ; `db:migrate` le rejoue sur la base vierge.
#  - `db:indexes` (prisma/sql/indexes.sql) crée les index trigram/partiels que le DSL
#    Prisma ne sait pas exprimer (CONCURRENTLY, expressions). Idempotent (`IF NOT EXISTS`).
#  - `db:seed` passe APRÈS `db:rls` uniquement parce qu'il tourne en super-utilisateur
#    local (`gaatshort`, propriétaire), qui contourne la RLS. En CI / recette, on utilise
#    `db:migrate:deploy` (non interactif, sans shadow DB) — cf. docs/operations/migrations.md.
setup: install up ## Bootstrap complet d'un poste de développement
	cp -n .env.example .env || true
	pnpm db:generate && pnpm db:migrate && pnpm db:rls && pnpm db:indexes && pnpm db:seed
	$(MAKE) cache-flush

dev: ## Lance l'API en watch mode
	pnpm start:dev

worker: ## Lance le worker BullMQ en watch mode
	pnpm start:worker:dev

seed: ## Amorçage (dev) — idempotent, IDs stables
	pnpm db:seed
	$(MAKE) cache-flush

seed-prod: ## Amorçage d'un environnement de PRODUCTION neuf (garde explicite)
	@echo "⚠ Amorçage en production. Le tenant et le compte admin reçoivent des IDs"
	@echo "  stables (prisma/seed/fixed-ids.ts) ; le paramétrage existant n'est pas"
	@echo "  écrasé (tous les upsert ont un update vide), SAUF le mot de passe admin"
	@echo "  qui est réinitialisé à la valeur de SEED_ADMIN_PASSWORD."
	pnpm db:seed:prod

test: ## Tests unitaires
	pnpm test

db-generate: ## Régénère le client Prisma depuis prisma/schema.prisma
	pnpm db:generate

# Chaque commande est CELLE que lance .github/workflows/ci.yml, pas une variante locale
# « équivalente » — `pnpm lint` corrige (--fix), `pnpm test:cov`/`test:integration`
# n'ont pas les options CI (--ci, --runInBand, reporters JUnit). Un `make verify`
# vert localement avec les mauvaises commandes peut très bien échouer une fois
# poussé : ce n'était plus « identique à la CI ».
#
# Prérequis `db-generate` : sur un checkout où `node_modules/.prisma/` n'existe
# pas encore (poste neuf, `pnpm install` sans `make setup` préalable, ou schéma
# modifié depuis la dernière génération), `tsc` échoue sur tout champ Prisma
# récent avec `TS2353: ... does not exist in type ...` — pas un bug de code,
# juste un client Prisma pas à jour. `.github/workflows/ci.yml` le fait déjà avant son
# équivalent de `verify` ; ce prérequis aligne le local sur la CI.
verify: db-generate ## Barrière qualité complète (identique à la CI)
	pnpm lint:ci
	pnpm depcruise
	pnpm exec tsc --noEmit -p tsconfig.json
	pnpm test:ci
	pnpm test:integration:ci
	pnpm openapi:diff

migrate: ## Nouvelle migration Prisma
	pnpm db:migrate

# `--skip-seed` : `migrate reset` lance sinon AUTOMATIQUEMENT le seed lui-même
# (`package.json#prisma.seed`) — AVANT `db:rls` et `db:indexes`, donc dans le
# mauvais ordre, ET une seconde fois en plus du `pnpm db:seed` explicite
# ci-dessous. Le seed est idempotent (aucune donnée en double), donc ce n'était
# pas un bug de CORRECTION — juste un amorçage exécuté deux fois pour rien à
# chaque `make reset`. Vérifié : sans `--skip-seed`, la sortie affiche deux fois
# « ✓ Amorçage terminé ».
#
# `--skip-seed` ne désactive QUE l'auto-seed interne de Prisma : le seed est
# toujours joué, une seule fois, dans le même ordre que `setup`.
reset: ## Reset complet de la base locale
	pnpm prisma migrate reset --force --skip-seed && pnpm db:rls && pnpm db:indexes && pnpm db:seed
	$(MAKE) cache-flush
