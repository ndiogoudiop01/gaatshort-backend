# Frontières entre modules

## 1. La règle

> Un module ne lit **jamais** les entrailles d'un autre module.

Concrètement, ces trois lignes sont interdites et rejetées en CI :

```ts
import { PrismaApplicationRepository } from '@modules/applications/infrastructure/…'; // ❌
import { Application } from '@modules/applications/domain/entities/…';                // ❌
await this.prisma.client.partnerLead.findMany();  // ❌ depuis un autre module
```

## 2. Les deux voies de communication autorisées

### A. La façade — quand j'ai besoin d'une réponse maintenant

Chaque module expose un contrat étroit à sa racine :

```ts
// catalog/catalog.facade.ts
export interface ActivityFacade {
  getById(id: string): Promise<ActivitySummary | null>;
  getManyByIds(ids: string[]): Promise<ActivitySummary[]>;
  existsAndActive(id: string): Promise<boolean>;
}
```

Le consommateur injecte le **symbole**, pas la classe :

```ts
constructor(@Inject(ACTIVITY_FACADE) private readonly activities: ActivityFacade) {}
```

Le jour où `catalog` devient un service distant, on remplace
l'implémentation par un client HTTP. Rien d'autre ne bouge.

### B. L'événement — quand je notifie un fait accompli

```
applications ──[application.preselected]──▶ talent-pool  (crée la fiche vivier)
                                        └─▶ notifications (envoie l'e-mail)
                                        └─▶ analytics     (incrémente l'entonnoir)
```

Le module `applications` **ignore** qui l'écoute. Ajouter une quatrième
réaction (inscrire à l'Academy, alerter un financeur) = ajouter un écouteur,
sans rouvrir le cas d'usage de présélection.

## 3. L'anti-corruption layer

Quand un agrégat a besoin de faits venus d'ailleurs, il déclare un **port**
dans son propre domaine :

```ts
// applications/domain/ports/application-context.provider.ts
export interface ApplicationContextProvider {
  getMinimumContribution(activityId: string, currency: string): Promise<Money | null>;
  hasAllRequiredDocuments(applicationId: string): Promise<boolean>;
  hasGrantedRequiredConsents(userId: string): Promise<boolean>;
}
```

Une seule classe (`CompositeApplicationContextProvider`) l'implémente en
appelant les façades de `catalog`, `documents` et `compliance`. Toute la
dépendance externe du module tient dans **un fichier**.

## 4. Carte des dépendances autorisées

```
                    ┌──────────────────────────────┐
                    │      shared/kernel           │  ◀── tout le monde
                    └──────────────────────────────┘
                    ┌──────────────────────────────┐
                    │      infrastructure/         │  ◀── modules (adaptateurs)
                    └──────────────────────────────┘

  iam ◀── (aucun module ne dépend d'iam : l'identité arrive par le JWT)

  applications ──▶ catalog.facade
               ──▶ documents.facade
               ──▶ compliance.facade

  talent-pool  ──[événement]──▶ applications
  notifications ──[événement]──▶ *
  analytics     ──[événement]──▶ *

  catalog, simulation, cms, news, marketing, localization : autonomes
```

Aucun cycle. `dependency-cruiser` le vérifie à chaque PR.

## 5. Ajouter un module — la procédure

```bash
mkdir -p src/modules/mon-module/{domain/{entities,value-objects,events,ports,services},\
application/{commands,queries,policies,listeners},infrastructure/persistence,presentation/http/dto,tests}
```

1. **Domaine d'abord.** Écrire les entités, les VO et les *ports* — sans
   penser à la base ni à HTTP.
2. **Tests du domaine ensuite.** Ils doivent tourner sans conteneur.
3. **Cas d'usage.** Un fichier = une intention métier.
4. **Adaptateurs.** Implémenter les ports avec Prisma.
5. **Contrôleurs.** Valider, déléguer, répondre. Rien d'autre.
6. **Façade** si d'autres modules doivent consommer ce module.
7. **Câblage** dans `<module>.module.ts` : uniquement des
   `{ provide: PORT, useClass: Adapter }`.

## 6. Quand extraire un module en service autonome ?

Trois signaux, pas avant :

1. le module a un **profil de charge divergent** (le simulateur encaisse
   100× le trafic du back-office) ;
2. il a un **rythme de livraison** propre qui souffre du déploiement commun ;
3. il a besoin d'une **techno différente** (moteur de recherche, calcul lourd).

L'extraction consiste alors à : remplacer la façade par un client HTTP,
déplacer les tables, brancher les événements sur un bus externe. Le domaine
et les cas d'usage ne bougent pas — c'est tout l'intérêt d'avoir tenu la
discipline dès le début.
