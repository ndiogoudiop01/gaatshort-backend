# ADR-0007 — Partitionnement de `analytics_events`

**Statut** : proposé · **Date** : 2026-09-02

## Contexte

`analytics_events` reçoit chaque vue de page, chaque simulation, chaque
étape de tunnel. C'est la table qui grossit le plus vite, de très loin, et
dont l'historique perd rapidement de la valeur opérationnelle.

## Décision

Partitionnement **par mois** sur `occurred_at` (`PARTITION BY RANGE`).

- Les partitions du mois suivant sont créées à l'avance par un cron.
- Chaque partition hérite de la politique RLS.
- La purge d'un mois devient un `DROP TABLE` instantané, au lieu d'un
  `DELETE` de plusieurs millions de lignes qui gonfle la table et déclenche
  un autovacuum coûteux.

Prisma ne génère pas de DDL partitionnée : cette migration est manuelle et
vit dans `prisma/sql/partitions.sql`.

## Conséquences

**Positives**
- Les requêtes filtrées sur une période ne balayent que les partitions utiles.
- La rétention devient une opération instantanée.
- Chaque partition reste indexable et vacuumable indépendamment.

**Négatives**
- Une étape de migration hors Prisma, à documenter et à ne pas oublier lors
  d'un `migrate reset`.
- Si une partition manque, l'insertion échoue — le cron de rotation doit
  être supervisé au même titre que le relais outbox.

## Quand l'appliquer

Avant la mise en production, ou dès que la table dépasse ~10 millions de
lignes. Pas avant : sur un volume faible, le partitionnement ajoute de la
complexité sans bénéfice mesurable.
