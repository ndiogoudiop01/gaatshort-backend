# Première semaine sur le projet

## Jour 1 — comprendre avant de coder

1. `make setup` puis `make dev` — l'API doit répondre sur `/health/ready`.
2. Ouvrir `/docs` et parcourir les endpoints.
3. Lire **dans cet ordre** :
   - [01-multi-tenancy.md](01-multi-tenancy.md) ← le plus important
   - [02-modules-and-boundaries.md](02-modules-and-boundaries.md)
   - [05-api-conventions.md](05-api-conventions.md)

## Jour 2 — lire du code, dans cet ordre précis

| # | Fichier | Ce qu'on y apprend |
|---|---|---|
| 1 | `infrastructure/tenancy/context/tenant-context.service.ts` | Comment le tenant voyage dans la pile |
| 2 | `infrastructure/persistence/prisma/tenant-prisma.service.ts` | Les deux remparts d'isolation |
| 3 | `modules/applications/domain/value-objects/application-status.ts` | Une règle métier isolée et testable |
| 4 | `modules/applications/domain/entities/application.aggregate.ts` | Un agrégat riche, sans framework |
| 5 | `modules/applications/application/commands/submit-application.usecase.ts` | Un cas d'usage qui orchestre sans décider |
| 6 | `infrastructure/persistence/transaction/prisma-unit-of-work.ts` | Outbox transactionnel |
| 7 | `modules/simulation/domain/services/simulation-engine.ts` | Une fonction pure et son test |

Lancer `pnpm test` : la suite complète (plus de 120 fichiers, environ 850
tests, et ça monte à chaque ticket) demande de l'ordre de **deux minutes** —
pas « quelques secondes ». La quasi-totalité des specs prennent quelques
millisecondes chacune ; deux suites structurelles (`modules-smoke`,
`dependency-direction-lint`) expliquent à elles seules l'essentiel du temps
total — c'est normal, pas un signe de lenteur à corriger.

(Les chiffres ci-dessus sont un ordre de grandeur volontairement approximatif :
un compte exact serait périmé dès le ticket suivant.)

## Jour 3 — première contribution

Prendre un ticket de **lecture** (une requête, un filtre supplémentaire).
Cela oblige à traverser toutes les couches sans risquer d'invariant.

Parcours type : contrôleur → query → port → repository Prisma.

## Jour 4 — première écriture

Un ticket qui modifie l'état. Points de vigilance :

- la règle va-t-elle dans le **domaine** (et pas dans le cas d'usage) ?
- le cas d'usage passe-t-il par `UnitOfWork` ?
- l'agrégat est-il enrôlé (`tx.collect(aggregate)`) pour publier ses événements ?
- un test unitaire couvre-t-il le chemin nominal **et** le chemin refusé ?

## Jour 5 — les pièges du projet

| Piège | Symptôme | Correction |
|---|---|---|
| Oublier le contexte tenant dans un job | `MissingTenantContextError` | Étendre `BaseTenantProcessor` |
| Utiliser `PrismaService` dans un module | Fuite potentielle inter-tenants | Utiliser `TenantPrismaService` |
| Renvoyer un `BigInt` en JSON | `TypeError: Do not know how to serialize a BigInt` | `.toString()` dans le mapper |
| Envoyer un e-mail dans une transaction | E-mail parti pour un commit avorté | Passer par l'outbox |
| `new Date()` dans le domaine | Test non déterministe | Injecter `ClockPort` |
| Additionner des montants en `number` | Centimes fantômes | Utiliser `Money` |
| Clé de cache sans tenant | Données d'un autre client servies | `RedisCacheService` préfixe déjà — ne pas contourner |
| Import direct d'un autre module | Échec ESLint `boundaries` | Passer par la façade ou un événement |

## Questions fréquentes

**Où je mets ma logique ?**
Si elle décide → `domain/`. Si elle orchestre → `application/`. Si elle
parle à une techno → `infrastructure/`. Si elle traduit du HTTP →
`presentation/`. En cas de doute, elle va dans le domaine.

**Je dois lire une donnée d'un autre module.**
Sa façade. Elle n'existe pas ? On l'ajoute — c'est une décision d'équipe,
pas un contournement individuel.

**Ma requête est lente.**
`EXPLAIN ANALYZE` d'abord. Neuf fois sur dix, c'est un index manquant qui ne
commence pas par `tenant_id`.

**J'ai besoin de lire tous les tenants.**
Presque certainement non. Si vraiment si (job plateforme), `$privileged()`
avec une justification écrite dans la PR.
