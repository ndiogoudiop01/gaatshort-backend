# Documentation héritée du socle

Ces documents décrivent les mécanismes techniques repris du socle SOOBA : multi-tenant et RLS,
frontières de modules, sécurité, conventions d'API, cache et verrous, files et workers, outbox,
stockage, notifications, observabilité, déploiement CapRover, ADR 0001 à 0007.

Ils restent la **référence technique** de ces mécanismes. En revanche, leurs exemples métier
(candidatures, vivier, partenaires, Process 01…) renvoient à l'ancien produit : ils ne décrivent pas
Gaatshort. Pour le produit, la seule référence est `docs/architecture/`.

Écarts déjà connus avec Gaatshort :
- la CI décrite dans le socle (GitLab) est remplacée par GitHub Actions (`docs/operations/deploiement.md`) ;
- l'utilisateur deviendra **global** avec des rattachements par marque (02-TRD §4.2, tâche T1.4) ;
- la colonne `currencies.rate_to_xof` sera supprimée (T1.2).
