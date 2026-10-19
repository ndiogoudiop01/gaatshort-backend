-- ═══════════════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY — deuxième rempart de l'isolation multi-tenant.
--
-- Rempart 1 (applicatif) : l'extension Prisma injecte `tenantId` dans chaque
--                          where/create. Rapide, mais faillible (oubli, raw SQL).
-- Rempart 2 (base)       : ces politiques. Même une requête brute mal écrite
--                          ne peut PAS lire les données d'un autre tenant.
--
-- Le contexte est porté par `app.current_tenant_id`, positionné par
-- TenantPrismaService via `set_config(..., TRUE)` (portée transaction) à
-- l'ouverture de chaque transaction.
--
-- Rôles Postgres (cf. prisma/sql/00-bootstrap-roles.sql) :
--   • `gaatshort` — propriétaire du schéma, joue les migrations. NON utilisé
--                     par l'application à l'exécution.
--   • `gaatshort_app`  — rôle de connexion de l'application. NOSUPERUSER,
--                     NOBYPASSRLS. `FORCE ROW LEVEL SECURITY` fait qu'il subit
--                     les politiques même sur les tables dont il ne serait
--                     pas propriétaire.
--
-- IDEMPOTENT : rejouable après chaque `prisma migrate deploy` (`pnpm db:rls`).
-- La liste des tables n'est PAS codée en dur : toute table `public` portant une
-- colonne `tenant_id` est protégée automatiquement — impossible d'en oublier une.
-- ═══════════════════════════════════════════════════════════════════════════

-- Tenant courant (NULL si non positionné → aucune ligne ne matche : fail-closed).
CREATE OR REPLACE FUNCTION app_current_tenant() RETURNS uuid AS $$
  SELECT NULLIF(current_setting('app.current_tenant_id', true), '')::uuid;
$$ LANGUAGE sql STABLE;

-- Échappatoire explicite et auditée pour les jobs plateforme cross-tenant
-- (relais outbox, purges RGPD, agrégations, annuaire des tenants).
-- Activée par PrismaService.$privileged() via set_config('app.bypass_rls','on').
CREATE OR REPLACE FUNCTION app_bypass_rls() RETURNS boolean AS $$
  SELECT COALESCE(current_setting('app.bypass_rls', true), 'off') = 'on';
$$ LANGUAGE sql STABLE;

-- ── Politique générique sur toute table métier (colonne tenant_id) ──────────
DO $$
DECLARE
  t text;
  n int := 0;
BEGIN
  FOR t IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables tb
      ON tb.table_schema = c.table_schema
     AND tb.table_name   = c.table_name
    WHERE c.table_schema = 'public'
      AND c.column_name  = 'tenant_id'
      AND tb.table_type  = 'BASE TABLE'
    ORDER BY c.table_name
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    -- FORCE : la politique s'applique même au propriétaire de la table.
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON public.%I
        USING      (app_bypass_rls() OR tenant_id = app_current_tenant())
        WITH CHECK (app_bypass_rls() OR tenant_id = app_current_tenant())
    $f$, t);
    -- Le rôle applicatif obtient le DML ; la RLS le filtre malgré tout.
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO gaatshort_app', t);
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'RLS : % table(s) métier protégée(s) (colonne tenant_id)', n;
  IF n = 0 THEN
    RAISE EXCEPTION 'RLS : aucune table tenant_id trouvée — migrations non appliquées ?';
  END IF;
END
$$;

-- ── `roles` : tenant_id NULLABLE (rôles système partagés) ──────────────────
-- Politique élargie en lecture ; l'écriture d'un rôle système passe par $privileged.
DO $$
BEGIN
  IF to_regclass('public.roles') IS NOT NULL THEN
    DROP POLICY IF EXISTS tenant_isolation ON public.roles;
    CREATE POLICY tenant_isolation ON public.roles
      USING      (app_bypass_rls() OR tenant_id IS NULL OR tenant_id = app_current_tenant())
      WITH CHECK (app_bypass_rls() OR tenant_id = app_current_tenant());
  END IF;
END
$$;

-- ── Référentiels globaux : lecture seule pour l'application, pas de RLS ─────
-- (currencies, countries, permissions, role_permissions, tenants — aucune
--  colonne tenant_id, donc hors de la boucle ci-dessus.)
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['countries','currencies','permissions','role_permissions','tenants'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('GRANT SELECT ON public.%I TO gaatshort_app', t);
    ELSE
      RAISE NOTICE 'Table de référence % absente, GRANT ignoré', t;
    END IF;
  END LOOP;

END
$$;

-- ── `tenants` : le registre — lu par tous, écrit SEULEMENT en $privileged ───
-- Avant : `REVOKE INSERT, UPDATE, DELETE ON tenants FROM gaatshort_app`. Or
-- l'administration des organisations par le SUPER_ADMIN (BSG-13 : PATCH ;
-- puis création / suppression) écrit ce registre depuis l'API, connectée en
-- `gaatshort_app` → « permission denied for table tenants » (500).
--
-- Désormais le DML est accordé, mais une politique RLS le borne : lecture
-- libre (l'annuaire résout le tenant AVANT tout contexte), écriture
-- uniquement dans une transaction `PrismaService.$privileged()`
-- (`app.bypass_rls = on`). Une requête applicative ordinaire — même brute —
-- ne peut toujours ni créer, ni modifier, ni supprimer un tenant.
--
-- ENABLE sans FORCE, à dessein : le propriétaire `gaatshort` (migrations,
-- seed) n'est pas soumis à la politique — une future migration qui met à
-- jour `tenants` n'a pas à positionner `app.bypass_rls`.
DO $$
BEGIN
  IF to_regclass('public.tenants') IS NOT NULL THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenants TO gaatshort_app';
    EXECUTE 'ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.tenants NO FORCE ROW LEVEL SECURITY';

    EXECUTE 'DROP POLICY IF EXISTS tenants_read ON public.tenants';
    EXECUTE 'DROP POLICY IF EXISTS tenants_insert_privileged ON public.tenants';
    EXECUTE 'DROP POLICY IF EXISTS tenants_update_privileged ON public.tenants';
    EXECUTE 'DROP POLICY IF EXISTS tenants_delete_privileged ON public.tenants';

    EXECUTE 'CREATE POLICY tenants_read ON public.tenants FOR SELECT USING (true)';
    EXECUTE 'CREATE POLICY tenants_insert_privileged ON public.tenants FOR INSERT WITH CHECK (app_bypass_rls())';
    EXECUTE 'CREATE POLICY tenants_update_privileged ON public.tenants FOR UPDATE '
         || 'USING (app_bypass_rls()) WITH CHECK (app_bypass_rls())';
    EXECUTE 'CREATE POLICY tenants_delete_privileged ON public.tenants FOR DELETE USING (app_bypass_rls())';
  END IF;
END
$$;
