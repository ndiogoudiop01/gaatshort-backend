-- ═══════════════════════════════════════════════════════════════════════════
-- Rôles Postgres — exécuté à l'initialisation du conteneur.
--
-- POINT CRITIQUE : la RLS est IGNORÉE pour un superuser et pour le
-- propriétaire de la table (sauf FORCE ROW LEVEL SECURITY). L'application
-- DOIT donc se connecter avec un rôle non privilégié : `gaatshort_app`.
-- Les migrations, elles, tournent avec le rôle propriétaire `gaatshort`.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gaatshort_app') THEN
    CREATE ROLE gaatshort_app LOGIN PASSWORD 'gaatshort_app' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;

GRANT CONNECT ON DATABASE gaatshort TO gaatshort_app;
GRANT USAGE ON SCHEMA public TO gaatshort_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO gaatshort_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO gaatshort_app;

CREATE EXTENSION IF NOT EXISTS "pg_trgm";      -- recherche full-text CRM
CREATE EXTENSION IF NOT EXISTS "unaccent";     -- "Sénégal" == "Senegal"
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
