# ADR-0006 — Prisma, mais derrière des ports

**Statut** : accepté · **Date** : 2026-09-02

## Contexte

Il faut un accès aux données typé, avec des migrations fiables, et un modèle
lisible par toute l'équipe. Trois candidats sérieux : Prisma, TypeORM, Drizzle.

## Décision

**Prisma**, pour :
- un schéma déclaratif unique qui sert aussi de documentation du modèle ;
- des migrations versionnées et reproductibles ;
- une inférence de types de bout en bout ;
- des **client extensions** qui permettent d'injecter le scope tenant de
  façon transparente et non contournable.

Mais **jamais exposé au domaine** : chaque module définit son port
(`ApplicationRepository`), l'infrastructure fournit l'adaptateur
(`PrismaApplicationRepository`), et le module câble les deux.

## Le point délicat : RLS et Prisma

Prisma ne pose pas de variable de session par défaut. La solution retenue,
issue de la documentation officielle, est de coupler `set_config` et la
requête dans le **même** `$transaction([...])`, ce qui garantit qu'ils
partagent la connexion :

```ts
const [, result] = await base.$transaction([
  base.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenantId}::text, TRUE)`,
  query(scopedArgs),
]);
```

Coût : une instruction supplémentaire par requête, pipelinée dans le même
aller-retour. Bénéfice : la RLS s'applique réellement, y compris au SQL brut.

## Conséquences

**Positives**
- Le domaine ignore Prisma ; les tests unitaires n'ont pas besoin de base.
- L'isolation tenant est appliquée en un seul point.
- Remplacer Prisma = réécrire les adaptateurs, pas le métier.

**Négatives**
- Prisma reste limité sur certaines constructions SQL (fenêtrage,
  partitionnement, index GIN). On assume le `$queryRaw` ciblé, **avec filtre
  explicite sur `tenant_id`** — et la RLS comme filet.
- Le DDL partitionné est écrit à la main (`prisma/sql/partitions.sql`).

## Alternatives écartées

- **TypeORM** — les *subscribers* offrent un scoping comparable, mais son
  typage est plus faible et ses migrations plus fragiles.
- **Drizzle** — excellent en SQL et en performance, mais écosystème plus
  jeune et courbe d'entrée plus raide pour une équipe qui doit livrer.
- **Prisma nu, sans ports** — le domaine deviendrait dépendant du client
  généré, et les tests exigeraient une base.
