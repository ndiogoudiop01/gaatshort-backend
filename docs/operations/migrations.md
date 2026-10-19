# Stratégie de migrations

## Règles

1. **Prisma Migrate** pour la structure (`prisma/migrations/`). Fichiers SQL versionnés pour ce que
   Prisma n'exprime pas : RLS (`prisma/sql/rls-policies.sql`), index d'expression et partiels
   (`indexes.sql`), partitions (`partitions.sql`), triggers d'immuabilité, vues `security_invoker`.
2. **Une migration publiée n'est jamais modifiée.** Une correction = une nouvelle migration.
3. **Expand / contract** pour tout changement incompatible, parce que l'ancienne et la nouvelle
   version de l'API coexistent pendant un déploiement `start-first` :
   - *expand* (version N) : ajouter la colonne ou la table, nullable ou avec valeur par défaut ;
     écrire dans l'ancien et le nouveau ;
   - *migrate* : reprise des données par un job idempotent ;
   - *contract* (version N+1 au plus tôt) : retirer l'ancien.
4. Toute nouvelle table portant `tenant_id` est couverte automatiquement par `rls-policies.sql`
   **et** par la suite de tests d'isolation (`test/integration/tenant-isolation.spec.ts`).
5. Index sur une grosse table : `CREATE INDEX CONCURRENTLY` dans `indexes.sql`, jamais dans une
   migration (qui s'exécute dans une transaction).

## Créer une migration

```bash
# 1. modifier prisma/schema.prisma
pnpm db:migrate --name <verbe_objet>      # ex. add_wallet_ledger_entries
# 2. relire le SQL généré (prisma/migrations/<horodatage>_<nom>/migration.sql)
# 3. si besoin : compléter rls-policies.sql / indexes.sql
pnpm db:rls && pnpm db:indexes
pnpm test:integration                     # isolation RLS comprise
```

## Point de départ du dépôt

`20261019180000_gaatshort_init` est la migration initiale. Elle a été produite en rejouant les
12 migrations du socle SOOBA sur PostgreSQL 16, puis en supprimant les 27 tables métier SOOBA ;
une comparaison `pg_dump --schema-only` a confirmé qu'appliquée seule sur une base vide, elle donne
exactement le même schéma. L'historique de migrations SOOBA n'est pas repris.

Les prochaines migrations structurantes sont prévues par le plan : identité globale et rattachements
aux marques (T1.4), suppression de `currencies.rate_to_xof` (T1.2), puis les tables de
05-BACKEND-SCHEMA module par module.

## En CI et en production

- CI : `prisma migrate deploy` sur un Postgres neuf, puis RLS, puis `openapi:diff` et tests d'intégration.
- Staging / production : l'entrypoint de l'API exécute `prisma migrate deploy` + RLS avant de démarrer.
- **Test de restauration** mensuel d'une sauvegarde de production sur staging (NFR-DATA-001).
