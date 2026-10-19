#!/bin/sh
# ==============================================================================
#  Point d'entrée unique de l'image : API, worker et migrations partagent la
#  MÊME image (« seule la commande change », cf. docs/33).
#
#  1. Des arguments sont passés (docker-compose `command:`, `docker run … cmd`)
#     → ils sont exécutés tels quels. Le comportement local est inchangé.
#  2. Aucun argument (cas CapRover : l'image est déployée sans commande) →
#     le rôle est choisi par la variable `APP_ROLE` de l'application :
#       api      migrations + RLS (si RUN_MIGRATIONS=true), puis l'API
#       worker   attend que le schéma soit à jour (migrations appliquées
#                par l'API), puis le process BullMQ (dist/worker.main.js)
#       migrate  migrations + RLS, puis sortie (exécution ponctuelle)
#       seed     migrations + RLS + amorçage (dist/seed), puis sortie
#
#  `RUN_SEED=true` sur l'app API : amorçage après les migrations, AVANT le
#  démarrage de l'API. Idempotent (upsert). À retirer une fois le seed passé :
#  chaque redémarrage le rejouerait (et réinitialiserait le mot de passe admin).
#
#  `exec` remplace le shell par Node : `tini` (PID 1) transmet SIGTERM
#  directement à Node, et l'arrêt propre (graceful-shutdown.ts) s'applique.
# ==============================================================================
set -eu

PRISMA="node_modules/.bin/prisma"
SCHEMA="prisma/schema.prisma"
# Clé arbitraire mais FIXE : sérialise l'application des politiques RLS entre
# plusieurs réplicas qui démarrent en même temps (le script fait DROP puis
# CREATE POLICY : deux exécutions entrelacées se marcheraient dessus).
# `prisma migrate deploy` prend déjà son propre verrou consultatif.
RLS_LOCK_KEY="7270736901"

log() {
  printf '{"level":"%s","context":"Entrypoint","role":"%s","msg":"%s"}\n' "$1" "${APP_ROLE:-api}" "$2"
}

run_migrations() {
  log info "migrations : prisma migrate deploy"
  "$PRISMA" migrate deploy --schema "$SCHEMA"

  log info "migrations : politiques RLS (verrou consultatif ${RLS_LOCK_KEY})"
  {
    echo "SELECT pg_advisory_lock(${RLS_LOCK_KEY});"
    cat prisma/sql/rls-policies.sql
    echo
    echo "SELECT pg_advisory_unlock(${RLS_LOCK_KEY});"
  } | "$PRISMA" db execute --stdin --schema "$SCHEMA"

  log info "migrations : terminées"
}

# Le seed est compilé dans l'image (`pnpm build:seed`) : ts-node n'y est pas.
# `--allow-production` : la garde de prisma/seed/index.ts refuse sinon de
# tourner sous NODE_ENV=production.
run_seed() {
  log info "seed : node dist/seed/index.js --allow-production"
  # `|| return 1` explicite : appelée dans un `||`, `set -e` ne s'applique pas.
  node dist/seed/index.js --allow-production || return 1
  log info "seed : terminé"
}

# Le worker ne migre jamais : il attend que l'API l'ait fait. Sans cela, un
# worker de la version N+1 démarré avant la fin des migrations écrirait sur
# un schéma N. `prisma migrate status` sort en erreur tant qu'une migration
# reste à appliquer. WAIT_FOR_MIGRATIONS_SECONDS=0 désactive l'attente.
wait_for_schema() {
  budget="${WAIT_FOR_MIGRATIONS_SECONDS:-300}"
  [ "$budget" -gt 0 ] || return 0
  waited=0
  until "$PRISMA" migrate status --schema "$SCHEMA" >/dev/null 2>&1; do
    if [ "$waited" -ge "$budget" ]; then
      log error "schéma toujours pas à jour après ${budget} s : arrêt (Swarm redémarrera la tâche)"
      exit 1
    fi
    log info "migrations en attente (appliquées par l'API) : nouvel essai dans 5 s"
    sleep 5
    waited=$((waited + 5))
  done
  log info "schéma à jour"
}

if [ "$#" -gt 0 ]; then
  exec "$@"
fi

case "${APP_ROLE:-api}" in
  api)
    if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
      run_migrations
    else
      log info "RUN_MIGRATIONS=${RUN_MIGRATIONS:-} : migrations ignorées"
    fi
    if [ "${RUN_SEED:-false}" = "true" ]; then
      # Un seed en échec ne doit pas empêcher l'API de démarrer : on journalise
      # l'erreur (visible dans les logs CapRover) et on continue.
      run_seed || log error "seed en échec : API démarrée sans amorçage (voir l'erreur ci-dessus)"
    fi
    exec node dist/main.js
    ;;
  worker)
    wait_for_schema
    exec node dist/worker.main.js
    ;;
  migrate)
    run_migrations
    ;;
  seed)
    run_migrations
    run_seed
    ;;
  *)
    log error "APP_ROLE inconnu : '${APP_ROLE}' (attendu : api | worker | migrate | seed)"
    exit 64
    ;;
esac
