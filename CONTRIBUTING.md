# Contribuer

## Flux

```
main ──── protégée ; un tag vX.Y.Z déclenche la production (avec approbation)
 └── develop ──── protégée ; chaque fusion est déployée en staging
      └── feat/T5.2-deblocage-episode
      └── fix/paytech-ipn-hmac
      └── chore/upgrade-prisma
```

Convention de commit : `type(scope): sujet` — `feat(wallet): débloque un
épisode contre des crédits (FR-MON-003, T5.2)`. Le scope est le **module** ;
citer l'exigence (`docs/architecture/01-PRD.md`) et la tâche du plan
(`docs/architecture/06-IMPLEMENTATION-PLAN.md`).

Toute modification passe par une **pull request vers `develop`**, revue et CI
verte. Aucun push direct sur `develop` ni `main`.

## Avant d'ouvrir une PR

```bash
make verify   # lint + frontières + tests + intégration
```

## Checklist de revue

### Architecture
- [ ] La règle métier est-elle dans `domain/` et non dans le cas d'usage ou le contrôleur ?
- [ ] Le cas d'usage se contente-t-il d'orchestrer ?
- [ ] Les nouvelles dépendances passent-elles par un **port** ?
- [ ] Aucun import direct des entrailles d'un autre module ?

### Multi-tenant
- [ ] La nouvelle table porte `tenantId` et figure dans `rls-policies.sql` ?
- [ ] Ses contraintes d'unicité et ses index commencent par `tenantId` ?
- [ ] Aucun `$queryRaw` sans filtre explicite sur `tenant_id` ?
- [ ] Aucun nouvel appel à `$privileged()` sans justification écrite ?
- [ ] Les jobs introduits restaurent-ils le contexte tenant ?

### Sécurité
- [ ] La route est protégée par défaut, ou `@Public()` est justifié ?
- [ ] Permission déclarée avec `@RequirePermissions` ?
- [ ] Accès à la ressource vérifié par une policy quand c'est pertinent ?
- [ ] Aucune donnée personnelle nouvelle dans les logs ?

### Données
- [ ] Les montants passent-ils par `Money` (pas de flottant) ?
- [ ] Les `BigInt` sont-ils convertis en chaîne avant sérialisation JSON ?
- [ ] Migration réversible et testée sur une copie de recette ?

### Tests
- [ ] Chemin nominal **et** chemin refusé couverts ?
- [ ] Les tests du domaine tournent-ils sans base ?
- [ ] Les nouveaux consommateurs d'événements sont-ils idempotents ?

### API
- [ ] Endpoint documenté (`@ApiOperation`) ?
- [ ] Quota adapté sur un endpoint public ?
- [ ] `@Idempotent()` sur une création publique ?
- [ ] Aucune rupture de contrat sur une version publiée ?

## Implémenter une exigence — la procédure

1. Situer l'exigence dans un **module existant** (TRD §5). En créer un est une décision
   d'équipe, discutée, pas un réflexe.
2. Modéliser le domaine d'abord (entités, VO, ports) et écrire ses tests.
3. Écrire les cas d'usage.
4. Implémenter les adaptateurs.
5. Exposer les contrôleurs.
6. Mettre à jour la matrice de traçabilité (`06-IMPLEMENTATION-PLAN.md` §10).
7. Si une décision structurante a été prise : rédiger un ADR.

## Quand écrire un ADR

Dès qu'une décision est **coûteuse à défaire** : choix de bibliothèque
structurante, modèle de données central, stratégie de cache, découpage de
module, protocole d'intégration.

Format : contexte, options envisagées, décision, conséquences (positives
**et** négatives), conditions de réexamen. Court et honnête — un ADR qui ne
liste que des avantages n'a pas fait son travail.
