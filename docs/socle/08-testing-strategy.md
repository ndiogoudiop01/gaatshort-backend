# Stratégie de test

## La pyramide, et ce qu'on met à chaque étage

```
        ╱ E2E ╲            ~10 tests   — parcours métier complets
       ╱───────╲
      ╱ Intégr. ╲          ~40 tests   — RLS, repositories, jobs (Testcontainers)
     ╱───────────╲
    ╱  Unitaires  ╲        ~300 tests  — domaine pur, aucune I/O
   ╱───────────────╲
```

## Étage 1 — tests unitaires (rapides, nombreux)

**Cible : le domaine.** Machine à états, agrégats, `Money`, moteur de
simulation, scoring, schémas de profils partenaires.

Ces tests tournent **sans base, sans conteneur, sans NestJS** — quelques
centaines de millisecondes pour la suite entière. C'est précisément l'intérêt
d'avoir gardé le domaine pur : la règle métier la plus critique du produit
(qui peut être présélectionné ?) se teste plus vite qu'elle ne se lit.

Couverture attendue : **≥ 90 % sur `src/modules/*/domain/`**.

Exemples présents :
- `applications/tests/application-status-machine.spec.ts` — toutes les transitions
- `applications/tests/application.aggregate.spec.ts` — invariants de soumission et de présélection
- `applications/tests/money.spec.ts` — pas d'erreur d'arrondi sur 1 000 additions
- `simulation/tests/simulation-engine.spec.ts` — annuité, point mort, taux nul
- `partners/tests/partner-profile.schema.spec.ts` — cohérence des 5 typologies

## Étage 2 — tests d'intégration (Testcontainers)

**Cible : tout ce qui touche vraiment Postgres et Redis.**

Le test le plus important du dépôt vit ici :
`test/integration/tenant-isolation.spec.ts`. Il attaque la base **en SQL
brut**, sans passer par l'extension Prisma, et vérifie que la RLS tient
seule. Il couvre :

- lecture filtrée par le tenant en session ;
- **zéro ligne** quand aucun tenant n'est positionné (fail-closed) ;
- lecture par UUID connu d'un autre tenant → invisible ;
- INSERT pour le compte d'un autre tenant → rejeté ;
- UPDATE sur un autre tenant → 0 ligne affectée.

> Si ce fichier échoue, **on ne livre pas**.

Y figurent aussi : les repositories (requêtes réelles), le relais outbox, et
les processors de jobs.

## Étage 3 — tests E2E

**Cible : les parcours, pas les endpoints.** Un test par parcours métier :

- visiteur → simulation → candidature → soumission ;
- gestionnaire → recherche → fiche 360 → entretien → présélection ;
- partenaire → choix de typologie → dépôt de dossier ;
- refus d'accès inter-tenants (chemin négatif).

## Ce qu'on ne teste pas

- Les getters et les DTO sans logique.
- Prisma lui-même.
- Les contrôleurs isolément — ils ne contiennent aucune règle, ils sont
  couverts par les E2E.

## Doublures de test

Le domaine ne dépendant que de ports, on écrit des **fakes** simples plutôt
que des mocks :

```ts
const clock: ClockPort = {
  now: () => new Date('2026-09-02T10:00:00Z'),
  today: () => new Date('2026-09-02T00:00:00Z'),
  addDays: (d, n) => new Date(d.getTime() + n * 86400000),
  addSeconds: (d, n) => new Date(d.getTime() + n * 1000),
};
```

Un fake lisible vaut mieux qu'un mock à quatre `expect(...).toHaveBeenCalledWith`.

## Commandes

```bash
pnpm test              # unitaires, en watch avec :watch
pnpm test:cov          # couverture (seuils bloquants)
pnpm test:integration  # Testcontainers — plus lent, en série
pnpm test:e2e          # parcours complets
make verify            # tout, comme en CI
```
