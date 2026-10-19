# ADR-0004 — CQRS-lite : agrégats en écriture, read-models en lecture

**Statut** : accepté · **Date** : 2026-09-02

## Contexte

Les besoins d'écriture et de lecture divergent fortement :

- **Écriture** — « présélectionner cette candidature » exige de charger
  l'agrégat entier pour valider les invariants ;
- **Lecture** — le CRM (US-023) affiche 50 lignes avec le nom du candidat,
  le nom de l'activité et le score. Charger 50 agrégats complets pour cela
  serait un gaspillage pur.

## Décision

Séparer les deux chemins **sans** aller jusqu'au CQRS complet (pas de bases
distinctes, pas d'event sourcing) :

| Chemin | Interface | Retour |
|---|---|---|
| Écriture | `ApplicationRepository` | Agrégat `Application` |
| Lecture | `ApplicationReadModel` | Projections plates typées par écran |

Les requêtes de lecture sont des classes distinctes, sans effet de bord.

## Conséquences

**Positives**
- Les lectures ne paient pas le coût de la reconstitution d'agrégat.
- Chaque écran a une projection taillée pour lui (`CandidateDashboardView`,
  `Application360View`) : pas de sur-fetch.
- **Le routage vers une réplique de lecture devient un simple changement
  d'injection** — c'est le bénéfice principal, et il ne se paie qu'une fois
  la discipline en place.

**Négatives**
- Deux interfaces à maintenir par module.
- Risque de divergence entre la projection et l'agrégat — contenu par les
  tests d'intégration.

## Limite explicite

On **ne** fait pas d'event sourcing. L'état courant reste la source de
vérité ; les événements servent à l'intégration inter-modules et à la
traçabilité, pas à reconstituer l'état.
