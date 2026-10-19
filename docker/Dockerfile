# syntax=docker/dockerfile:1.7
# ─── Stage 1 : dépendances ────────────────────────────────────────────────
FROM node:22-alpine AS deps
RUN corepack enable && apk add --no-cache libc6-compat openssl
WORKDIR /app
COPY package.json pnpm-lock.yaml* ./
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile

# ─── Stage 2 : build ──────────────────────────────────────────────────────
FROM node:22-alpine AS build
RUN corepack enable && apk add --no-cache openssl
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# `build:seed` compile le seed dans dist/seed/ : l'image runtime n'a pas
# ts-node, c'est ce qui permet `APP_ROLE=seed` / `RUN_SEED=true` sur CapRover.
RUN pnpm db:generate && pnpm build && pnpm build:seed && pnpm prune --prod

# ─── Stage 3 : runtime ────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
RUN apk add --no-cache openssl tini && addgroup -S app && adduser -S app -G app
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/dist ./dist
COPY --from=build --chown=app:app /app/prisma ./prisma
COPY --from=build --chown=app:app /app/package.json ./package.json
COPY --chmod=0755 docker/entrypoint.sh /usr/local/bin/entrypoint.sh
# SHA du commit (passé par `build:image`), exposé par GET /health/live : le
# smoke test du déploiement vérifie que c'est bien cette image qui répond.
# Déclaré APRÈS les COPY : il ne casse pas le cache des couches précédentes.
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION
USER app
EXPOSE 3000
# Pas de HEALTHCHECK ici : cette image sert À LA FOIS l'API et le worker
# (« seule la commande change », cf. CMD ci-dessous). Une sonde HTTP inscrite
# dans l'image s'appliquerait aussi au worker, qui n'ouvre aucun port
# (`createApplicationContext`, pas `listen()`, cf. src/worker.main.ts) : il
# serait déclaré "unhealthy" en permanence, et recyclé en boucle par toute
# politique de redémarrage adossée à la santé du conteneur.
#
# La neutraliser côté `docker-compose.yml` ne suffit pas : ce fichier est
# l'environnement de développement local, il est exclu du contexte de build
# par `.dockerignore`, et CapRover / Docker Swarm — la cible de déploiement,
# cf. docs/33-conteneurisation-deploiement-sib55.md — ne le lisent pas.
#
# La sonde décrit donc le SERVICE, pas l'image : elle est déclarée sur le
# service `api` (`docker-compose.yml` en local, définition du service côté
# CapRover en déploiement). Son URL est `/health/live` et NON
# `/api/health/live` : `main.ts` exclut explicitement les sondes du préfixe
# global (`setGlobalPrefix('api', { exclude: ['health/live', 'health/ready',
# 'metrics'] })`) et elles ne sont pas versionnées.
# L'API et le worker partagent la même image ; seule la commande change.
# Sans commande (déploiement CapRover), `entrypoint.sh` choisit le process
# selon `APP_ROLE` (api | worker | migrate) — cf. docs/38-deploiement-caprover.md.
# Avec une commande (docker-compose), elle est exécutée telle quelle.
ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/entrypoint.sh"]
CMD []
