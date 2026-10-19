# Le multi-tenant, en détail

> Document à lire **avant** d'écrire la première ligne de code sur ce projet.

## 1. Ce qu'on isole, et pourquoi

Sooba Group est conçu pour héberger plusieurs entités du groupe (HQ, SOOBA,
programmes déployés avec des collectivités) et, à terme, des programmes
opérés en marque blanche pour des institutions partenaires. Chacune est un
**tenant** : ses candidatures, son vivier, ses partenaires, ses contenus.

Une fuite entre deux tenants n'est pas un bug fonctionnel — c'est une
violation de données personnelles, avec obligation de notification.
L'architecture est donc bâtie autour de cette contrainte.

## 2. Trois stratégies possibles, une retenue

| Stratégie | Isolation | Coût d'exploitation | Verdict |
|---|---|---|---|
| Base par tenant | Maximale | N bases à migrer, sauvegarder, superviser | ❌ ingérable au-delà de ~10 tenants |
| Schéma par tenant | Forte | N schémas, migrations multipliées, pool saturé | ⚠️ gardé en option « silo » |
| **Base + schéma partagés, `tenant_id` + RLS** | **Forte si bien faite** | **Une base, une migration** | ✅ **retenu** |

Le choix est encodé dans le modèle : `Tenant.isolation` vaut `SHARED_RLS`
par défaut et peut passer à `SCHEMA` pour un client qui l'exige
contractuellement. Le code applicatif ne change pas — seule la résolution
de connexion diffère.

## 3. Les deux remparts

### Rempart 1 — applicatif (`TenantPrismaService`)

Une extension Prisma intercepte **toutes** les opérations et injecte
`tenantId` dans le `where` des lectures et dans le `data` des écritures.

- **Ce qu'il apporte** : un développeur ne PEUT pas oublier le filtre.
  Zéro coût réseau supplémentaire.
- **Sa limite** : il ne couvre pas `$queryRaw`. Un `$queryRaw` mal écrit
  passe à travers.

### Rempart 2 — base de données (Row Level Security)

Chaque table porte une politique :

```sql
CREATE POLICY tenant_isolation ON applications
  USING (app_bypass_rls() OR tenant_id = app_current_tenant())
  WITH CHECK (app_bypass_rls() OR tenant_id = app_current_tenant());
```

`app.current_tenant_id` est posé par `set_config(..., TRUE)` sur la **même
connexion**, dans la **même transaction** que la requête.

- **Ce qu'il apporte** : même du SQL brut ne peut pas traverser les tenants.
- **Sa condition de validité** : l'application doit se connecter avec un
  rôle **non superuser et sans `BYPASSRLS`** (`sooba_app`). Avec le rôle
  propriétaire, Postgres ignorerait les politiques — d'où le
  `FORCE ROW LEVEL SECURITY` posé sur chaque table.

La liste des tables protégées n'est **pas** maintenue à la main : `rls-policies.sql`
l'applique à toute table portant une colonne `tenant_id`.

### Pourquoi les deux ?

Le premier tombe sur du SQL brut. Le second tombe si quelqu'un déploie avec
une mauvaise chaîne de connexion. Les deux ensemble tiennent, et le test
`test/integration/tenant-isolation.spec.ts` vérifie le second **sans passer
par le premier**.

> **Mécanisme détaillé** (rôles Postgres, dérivation des politiques,
> échappatoire `$privileged`, les 6 chemins d'attaque) :
> [docs/11-tenant-isolation.md](11-tenant-isolation.md).

## 4. Comment le tenant est résolu

Ordre de priorité configurable (`TENANCY_RESOLVERS=jwt,subdomain,header`) :

| # | Résolveur | Source | Usage |
|---|---|---|---|
| 1 | `jwt` | Revendication `tid` du token | Utilisateur authentifié — **fait autorité** |
| 2 | `subdomain` | `sooba.sooba-group.com` | Trafic navigateur public |
| 3 | `header` | `x-tenant-id` | Serveur-à-serveur, tests, développement |

**Résolveur `subdomain` — l'hôte vient de `request.hostname`.** Jamais de
l'en-tête `X-Forwarded-Host` brut : `request.hostname` est filtré par
`trust proxy` (`bootstrap/security.ts`, réglé sur `1`), donc l'en-tête forgé
d'un client direct est ignoré. Corollaire : l'ingress **doit** poser ou
supprimer `X-Forwarded-Host` — sinon un client pourrait se déclarer sur
`<tenant>.sooba-group.com` sur une route publique, ce résolveur étant
prioritaire sur `x-tenant-id`.

**Résolveur `subdomain` — ce qui n'est PAS un tenant.** L'hôte est traité
comme un domaine personnalisé (`candidatures.partenaire.com` → `tenant_domains`)
seulement s'il ressemble à un vrai FQDN. Un hôte **sans point** (`localhost`,
un nom de service Docker) ou une **IP littérale** (`127.0.0.1`) renvoie `null`.
Sans cette garde, le résolveur `subdomain` produirait `localhost` comme
identifiant et **masquerait l'en-tête `x-tenant-id`** en développement et en
test (la résolution s'arrête au premier résolveur qui répond).

**Détection d'intrusion** : si le JWT porte un tenant et qu'un en-tête en
réclame un autre, la requête est refusée et l'incident journalisé en `warn`.
C'est la signature d'une tentative de traversée de tenant. Verrouillé par
`tenant.middleware.spec.ts` (« … et journalise en warn »).

Ajouter un mode de résolution (clé d'API partenaire, chemin `/t/{slug}/…`)
= créer une classe implémentant `TenantResolver`. Aucun code existant à modifier.

## 5. Le contexte, sans provider REQUEST-scoped

Le tenant est porté par un `AsyncLocalStorage` (`TenantContextService`),
ouvert par le middleware et disponible dans toute la pile d'appels.

**Pourquoi pas `scope: Scope.REQUEST` ?** Parce que NestJS reconstruit alors
toute la chaîne d'injection à chaque requête. Sur un dashboard qui instancie
une trentaine de providers, c'est ~30 % de latence supplémentaire et une
pression GC inutile. ALS donne le même isolement, en singleton, à coût
quasi nul.

Cette contrainte est **vérifiée** : `no-request-scoped-providers.spec.ts`
échoue si un fichier de `src/` (commentaires exclus) introduit
`Scope.REQUEST`. `Scope.TRANSIENT` reste autorisé.

## 6. Le cas des workers

Un job BullMQ n'a **ni sous-domaine, ni JWT**. Le `tenantId` voyage donc
dans le payload du job, et `BaseTenantProcessor` restaure le contexte avant
tout accès base :

```ts
await this.tenantJobs.runInTenant(tenantId, async () => { /* … */ });
```

Oublier cette étape est le piège numéro un : le job échoue avec
`MissingTenantContextError` — ce qui est le comportement voulu (fail-closed),
plutôt qu'une écriture silencieuse hors périmètre.

## 7. Sortir de l'isolation, volontairement

Trois traitements légitimes traversent les tenants :

1. le **relais outbox** (parcourt toutes les files d'événements),
2. les **purges RGPD** planifiées,
3. l'**annuaire des tenants** lui-même.

Ils passent par `prisma.$privileged()`, qui active `app.bypass_rls` le temps
d'une transaction. **Tout autre appel à `$privileged()` doit être refusé en
revue de code.**

## 8. Cache, files et fichiers : l'isolation ne s'arrête pas à la base

| Ressource | Mécanisme |
|---|---|
| Cache Redis | Clés préfixées `t:{tenantId}:` par `RedisCacheService` |
| Files BullMQ | `tenantId` dans le payload, restauré par le processor |
| Objets S3 | Préfixe `tenants/{tenantId}/…` — IAM et purge par tenant ([docs/35](35-storage.md)) |
| Gabarits de notification | `notification_templates` sous RLS ; cascade tenant→défaut lue via `TenantPrismaService` ([docs/36](36-notifications.md)) |
| Logs | `tenantId` sur chaque ligne, jamais dans les labels Prometheus (cardinalité) |

Cache, verrous distribués et limitation de débit en détail :
[docs/12-cache-lock-ratelimit.md](12-cache-lock-ratelimit.md)
(version courte : [resume-cache-verrous-ratelimit.md](resume-cache-verrous-ratelimit.md)).

Le bug de cache multi-tenant le plus fréquent — et le plus grave — est la
clé partagée : `activities:list` qui renvoie le catalogue d'un autre client.
Ici, aucune clé n'échappe au préfixe.

## 9. Checklist de revue de code

- [ ] La nouvelle table porte-t-elle `tenantId` ? (si oui, la RLS la couvre
      automatiquement au prochain `pnpm db:rls` — rien à ajouter à la main)
- [ ] Ses contraintes d'unicité commencent-elles par `tenantId` ?
- [ ] Ses index de lecture commencent-ils par `tenantId` ?
- [ ] Aucun `$queryRaw` sans filtre explicite sur `tenant_id` ?
- [ ] Aucun nouvel appel à `$privileged()` sans justification écrite ?
- [ ] Le job introduit restaure-t-il le contexte tenant ?
