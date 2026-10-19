-- ═══════════════════════════════════════════════════════════════════════════
-- Partitionnement de `analytics_events` (table la plus volumineuse).
-- Cf. docs/adr/0007-analytics-partitionning.md : à appliquer AVANT la mise
-- en production, ou dès que la table dépasse ~10 millions de lignes — PAS
-- avant, un `make setup` de développement ne l'exécute donc jamais
-- automatiquement (contrairement à indexes.sql / rls-policies.sql). À lancer
-- explicitement via `pnpm db:partitions` le moment venu.
--
-- Idempotent dans son ensemble : rejouer ce script sur une base déjà migrée
-- ne fait rien (la fonction se recrée à l'identique, et chaque étape de
-- migration vérifie l'état avant d'agir).
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION create_monthly_partition(base_table text, month_start date)
RETURNS void AS $$
DECLARE
  partition_name text := format('%s_%s', base_table, to_char(month_start, 'YYYY_MM'));
BEGIN
  IF to_regclass('public.' || partition_name) IS NOT NULL THEN RETURN; END IF;
  EXECUTE format(
    'CREATE TABLE public.%I PARTITION OF public.%I FOR VALUES FROM (%L) TO (%L)',
    partition_name, base_table, month_start, month_start + interval '1 month'
  );
  -- Pas de RLS ici : sur une table partitionnée, ce sont les politiques du
  -- PARENT qui s'appliquent aux accès faits via le parent — et l'application
  -- ne requête jamais une partition directement. Activer la RLS partition par
  -- partition n'apporte rien et laisse croire à une protection indépendante.
END;
$$ LANGUAGE plpgsql;

-- 1. Convertir `analytics_events` (créée non partitionnée par Prisma) en
--    table partitionnée : renommer l'originale, recréer en parent
--    partitionné avec le MÊME schéma, recopier les lignes existantes.
--    `IF EXISTS` / le test sur `partitioned` rendent ce bloc rejouable sans
--    effet si la conversion a déjà eu lieu.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'analytics_events')
     AND NOT EXISTS (
       SELECT 1 FROM pg_partitioned_table pt
       JOIN pg_class c ON c.oid = pt.partrelid
       WHERE c.relname = 'analytics_events'
     )
  THEN
    ALTER TABLE public.analytics_events RENAME TO analytics_events_unpartitioned;

    -- Un RENAME CONSERVE les politiques RLS : la table renommée porte encore
    -- `tenant_isolation` et `FORCE ROW LEVEL SECURITY`. Ce script tourne hors
    -- transaction UoW, donc sans `app.current_tenant_id` : la politique étant
    -- fail-closed, le SELECT de recopie plus bas ne verrait AUCUNE ligne —
    -- même sous le rôle propriétaire, que `FORCE` soumet aussi aux politiques.
    -- On désarme donc la RLS sur cette table source, qui est détruite ensuite.
    ALTER TABLE public.analytics_events_unpartitioned NO FORCE ROW LEVEL SECURITY;
    ALTER TABLE public.analytics_events_unpartitioned DISABLE ROW LEVEL SECURITY;

    CREATE TABLE public.analytics_events (
      id           uuid NOT NULL DEFAULT gen_random_uuid(),
      tenant_id    uuid NOT NULL,
      name         text NOT NULL,
      occurred_at  timestamptz NOT NULL DEFAULT now(),
      session_id   text,
      user_id      uuid,
      country_code char(2),
      properties   jsonb NOT NULL DEFAULT '{}'::jsonb,
      PRIMARY KEY (id, occurred_at)
    ) PARTITION BY RANGE (occurred_at);

    ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;

    -- Partitions couvrant tout l'historique déjà présent, puis mois courant
    -- et suivant : après cette étape, `RotatePartitionsJob` prend le relais.
    PERFORM create_monthly_partition('analytics_events', d::date)
    FROM generate_series(
      date_trunc('month', COALESCE((SELECT MIN(occurred_at) FROM public.analytics_events_unpartitioned), NOW())),
      date_trunc('month', NOW()) + INTERVAL '1 month',
      INTERVAL '1 month'
    ) AS d;

    INSERT INTO public.analytics_events
    SELECT id, tenant_id, name, occurred_at, session_id, user_id, country_code, properties
    FROM public.analytics_events_unpartitioned;

    -- Garde-fou : un `INSERT ... SELECT` qui ne copie RIEN est un SUCCÈS pour
    -- Postgres. Sans ce contrôle, la moindre ligne manquante à la copie serait
    -- définitivement perdue au `DROP` suivant, sans le moindre message. Lever
    -- une exception ici annule tout le bloc : la table d'origine est intacte.
    IF (SELECT COUNT(*) FROM public.analytics_events)
       <> (SELECT COUNT(*) FROM public.analytics_events_unpartitioned) THEN
      RAISE EXCEPTION 'Copie incomplète : % lignes copiées sur % — migration annulée',
        (SELECT COUNT(*) FROM public.analytics_events),
        (SELECT COUNT(*) FROM public.analytics_events_unpartitioned);
    END IF;

    DROP TABLE public.analytics_events_unpartitioned;

    -- L'ancienne table portait `FORCE`, la politique `tenant_isolation` et le
    -- `GRANT` à `gaatshort_app` : le `DROP` ci-dessus les emporte. Sans ces trois
    -- lignes, le parent reste « RLS activée SANS politique » (= refus de toutes
    -- les lignes) et le rôle applicatif perd tout privilège — l'ingestion
    -- échouerait sur chaque job. Formulation identique à rls-policies.sql.
    ALTER TABLE public.analytics_events FORCE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS tenant_isolation ON public.analytics_events;
    CREATE POLICY tenant_isolation ON public.analytics_events
      USING      (app_bypass_rls() OR tenant_id = app_current_tenant())
      WITH CHECK (app_bypass_rls() OR tenant_id = app_current_tenant());
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.analytics_events TO gaatshort_app;
  END IF;
END $$;

-- 1 bis. Partition « fourre-tout ». Un `INSERT` dont `occurred_at` ne tombe
--    dans aucune partition est REJETÉ par Postgres (`no partition of relation
--    "analytics_events" found for row`) : il suffit que le worker soit arrêté
--    plus d'un mois, ou que le cron de rotation n'ait jamais tourné, pour que
--    l'ingestion s'arrête net.
--
--    SUPERVISION : cette partition doit rester VIDE. Un `SELECT count(*) FROM
--    analytics_events_default` qui renvoie autre chose que 0 signifie que le
--    cron de rotation ne tourne plus — à traiter comme une alerte, pas comme
--    un état normal. Les lignes, elles, ne sont jamais perdues.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_partitioned_table pt
    JOIN pg_class c ON c.oid = pt.partrelid
    WHERE c.relname = 'analytics_events'
  ) THEN
    CREATE TABLE IF NOT EXISTS public.analytics_events_default
      PARTITION OF public.analytics_events DEFAULT;
  END IF;
END $$;

-- 2. Index utilisés par le read-model — recréés car `CREATE TABLE ... PARTITION
--    BY` ne reprend pas les index de l'ancienne table. `CONCURRENTLY` est
--    incompatible avec une table partitionnée (Postgres < 14 ne le permet
--    pas au niveau parent) ; sur un volume qui justifie encore la conversion
--    initiale, le verrou est acceptable une fois, hors heures de trafic.
CREATE INDEX IF NOT EXISTS analytics_events_tenant_name_occurred_idx
  ON public.analytics_events (tenant_id, name, occurred_at DESC);
CREATE INDEX IF NOT EXISTS analytics_events_tenant_occurred_idx
  ON public.analytics_events (tenant_id, occurred_at DESC);
