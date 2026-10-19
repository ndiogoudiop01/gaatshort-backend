-- ═══════════════════════════════════════════════════════════════════════════
-- Index qui ne s'expriment VRAIMENT PAS dans le DSL Prisma :
-- index d'EXPRESSION (f_unaccent(...), concaténations) et index PARTIELS
-- (clause WHERE). Prisma ne sait ni les générer ni les introspecter — il les
-- ignore, ils ne provoquent donc aucun écart de schéma.
--
-- RÈGLE À NE PAS ENFREINDRE : un index que le DSL sait exprimer — tout GIN
-- mono-colonne sur un tableau ou un jsonb, par exemple — se déclare dans
-- `schema.prisma`, JAMAIS ici. Prisma l'introspecterait, ne le trouverait pas
-- dans l'historique des migrations, et `prisma migrate dev` conclurait à un
-- « Drift detected » en proposant de réinitialiser la base.
--
-- Créés en CONCURRENTLY : aucun verrou en production.
-- Les index de la recherche catalogue (séries, FR-CAT-003) seront ajoutés ici
-- avec le module `catalog` (tâche T3.2).
-- ═══════════════════════════════════════════════════════════════════════════

-- `f_unaccent()` et NON `unaccent()` : la forme à un argument est déclarée
-- STABLE, et Postgres refuse une fonction STABLE dans une expression d'index.
-- Le wrapper IMMUTABLE et les extensions `unaccent` / `pg_trgm` sont créés par
-- la migration initiale 20261019180000_gaatshort_init.

-- Back-office : recherche d'utilisateurs par nom et e-mail, tolérante aux accents.
CREATE INDEX CONCURRENTLY IF NOT EXISTS users_search_trgm
  ON users USING gin (
    (f_unaccent(coalesce(first_name,'') || ' ' || coalesce(last_name,'') || ' ' || coalesce(email,''))) gin_trgm_ops
  );

-- Relais outbox : index partiel, ne balaye que le backlog non traité.
CREATE INDEX CONCURRENTLY IF NOT EXISTS outbox_pending_idx
  ON outbox_messages (occurred_at) WHERE processed_at IS NULL;
