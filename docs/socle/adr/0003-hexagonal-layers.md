# ADR-0003 — Architecture hexagonale par module

**Statut** : accepté · **Date** : 2026-09-02

## Contexte

Le cœur de valeur du produit est un ensemble de règles : qui peut être
présélectionné, quel apport minimum, quelle transition d'état est légale,
comment se calcule un point mort. Ces règles vont changer souvent et doivent
rester lisibles et testables.

## Décision

Quatre couches par module, avec une direction de dépendance stricte :

```
presentation ──▶ application ──▶ domain ◀── infrastructure
                                   │
                                   └──▶ shared/kernel
```

| Couche | Contenu | Interdits |
|---|---|---|
| `domain/` | Entités, VO, événements, ports, services métier | NestJS, Prisma, HTTP, `new Date()` |
| `application/` | Cas d'usage, requêtes, policies, listeners | SQL, détails techniques |
| `infrastructure/` | Repositories Prisma, jobs, adaptateurs | Règles métier |
| `presentation/` | Contrôleurs, DTO | Règles métier, accès direct à la persistance |

## Comment c'est appliqué

Ce n'est pas une convention orale : ESLint `boundaries` refuse les imports
qui remontent la flèche, et `dependency-cruiser` interdit au domaine
d'importer `@nestjs/*`, `@prisma/*`, `ioredis`, `bullmq`, `express`, `argon2`.
Une PR qui viole la règle échoue en CI.

## Conséquences

**Positives**
- La suite de tests du domaine tourne en quelques centaines de
  millisecondes, sans base ni conteneur.
- Changer d'ORM, de fournisseur d'e-mail ou de stockage ne touche pas une
  ligne de métier.
- Un nouvel arrivant lit `application.aggregate.ts` et comprend le produit
  sans connaître NestJS.

**Négatives**
- Plus de fichiers, et des mappers entre modèle de persistance et modèle de
  domaine.
- Surcoût réel sur les modules purement CRUD.

**Nuance assumée** : les modules sans invariant (`cms`, `news`,
`localization`) n'ont pas d'agrégat. On ne modélise pas un `NewsArticle`
comme une racine d'agrégat pour la forme — la couche hexagonale est un outil,
pas un rituel.
