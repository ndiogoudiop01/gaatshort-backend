# ADR-0001 — Monolithe modulaire plutôt que microservices

**Statut** : accepté · **Date** : 2026-09-02

## Contexte

30 user stories, une équipe de taille réduite, un produit encore en phase de
lancement dont les frontières fonctionnelles bougeront. La tentation des
microservices est forte parce que le vocabulaire du domaine s'y prête
(candidatures, partenaires, simulateur, contenus).

## Décision

Un **monolithe modulaire** : un seul déployable, mais des frontières internes
aussi strictes que celles de services distincts.

- 15 modules, chacun avec son domaine, ses ports et sa façade publique ;
- aucun accès direct aux entrailles d'un autre module (vérifié en CI) ;
- communication inter-contextes par façade ou par événement ;
- aucune requête SQL ne traverse deux contextes.

## Conséquences

**Positives**
- Une transaction, une base : la cohérence est acquise, pas à construire.
- Un pipeline, un déploiement, un jeu de logs.
- Refactoring de frontière possible sans coordination inter-équipes —
  décisif quand le découpage n'est pas encore stabilisé.

**Négatives**
- Discipline collective indispensable : sans les garde-fous automatiques,
  un monolithe modulaire devient un monolithe tout court en six mois.
- Scaling homogène de l'API — atténué par le process worker séparé.

**Mitigations**
- ESLint `boundaries` + `dependency-cruiser` bloquants en CI.
- Façades explicites, revue de code attentive aux imports croisés.

## Quand reconsidérer

Trois signaux, cumulatifs de préférence :
1. un module a un profil de charge radicalement divergent ;
2. son rythme de livraison souffre du déploiement commun ;
3. il exige une technologie que le monolithe ne peut pas héberger.

Le simulateur est le premier candidat : sans état, calcul pur, trafic
potentiellement 100× supérieur au reste.

## Alternatives écartées

- **Microservices d'emblée** — coût d'exploitation (réseau, traçage
  distribué, cohérence éventuelle, N pipelines) disproportionné au stade actuel.
- **Monolithe en couches classiques** (`controllers/`, `services/`,
  `entities/`) — aucune frontière métier ; à 30 US, `services/` devient un
  fourre-tout que plus personne ne navigue.
