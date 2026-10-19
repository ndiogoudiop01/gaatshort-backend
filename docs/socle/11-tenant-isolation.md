# Isolation multi-tenant — les deux remparts

> Aucune donnée ne franchit la frontière d'un tenant, **ni par oubli applicatif,
> ni par requête SQL brute.**

À lire après [docs/01-multi-tenancy.md](01-multi-tenancy.md) (le concept) et
[ADR-0002](adr/0002-multi-tenancy.md) (la décision). Ce document décrit le
**mécanisme** et sert de référence à la revue de code.

---

## 1. Pourquoi deux remparts indépendants

| | Rempart 1 — **applicatif** | Rempart 2 — **base (RLS)** |
|---|---|---|
| Où | Extension Prisma (`tenant-prisma.service.ts`) | Politiques Postgres (`prisma/sql/rls-policies.sql`) |
| Fait quoi | Injecte `tenantId` dans chaque `where` (lecture) et `data` (création) | Filtre chaque ligne : `tenant_id = app_current_tenant()` |
| Coût | Nul (aucun aller-retour réseau) | Nul (dans le plan de requête) |
| Tombe si… | `$queryRaw`, un `$executeRaw`, un oubli | l'app se connecte en superuser / `BYPASSRLS` |
| Tenu par… | le développeur ne **peut pas** oublier le filtre | même du SQL brut mal écrit ne peut pas lire un autre tenant |

Un seul ne suffit pas. Les deux ensemble : une faille doit franchir **les deux**
pour fuiter, et ils ont des modes de défaillance disjoints.

---

## 2. Le contexte de tenant : `app.current_tenant_id`

Porté par une variable de session Postgres, positionnée **par transaction** :

```sql
SELECT set_config('app.current_tenant_id', '<uuid>', TRUE);  -- TRUE = portée transaction
```

- `set_config(..., TRUE)` équivaut à `SET LOCAL` : la valeur disparaît au
  `COMMIT`/`ROLLBACK`. Impossible qu'elle « bave » sur la requête suivante ou
  sur une autre connexion du pool.
- La fonction SQL `app_current_tenant()` renvoie `NULL` si la variable est
  absente ou vide → `tenant_id = NULL` ne matche **aucune** ligne → **fail-closed**.

### Couplage `set_config` + requête (indispensable)

Les deux instructions **doivent** partir sur la **même connexion, dans la même
transaction**. Deux chemins, tous deux corrects :

1. **Hors Unit of Work** — `TenantPrismaService` exécute, pour chaque opération :
   ```ts
   base.$transaction([
     base.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenantId}::text, TRUE)`,
     query(scoped),          // la vraie requête, tenantId déjà injecté
   ]);
   ```
   La forme *array* de `$transaction` garantit une seule connexion.

2. **Dans une Unit of Work** — `PrismaUnitOfWork.execute()` pose le `set_config`
   en tête de la transaction ; toutes les requêtes du cas d'usage en héritent.
   `TenantPrismaService.client` renvoie alors la transaction courante telle
   quelle (via `TransactionHost`), sans réouvrir de transaction.

---

## 3. Les rôles Postgres

| Rôle | Usage | Privilèges |
|---|---|---|
| `sooba` | **propriétaire** du schéma, joue les migrations (`prisma migrate deploy`) | superuser côté conteneur / owner |
| `sooba_app` | **connexion de l'application à l'exécution** (`DATABASE_URL`) | `LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS` |

`FORCE ROW LEVEL SECURITY` fait que les politiques s'appliquent **même au
propriétaire d'une table** — donc l'app ne peut pas y échapper même si un jour
elle se connectait avec un rôle owner. Mais la ligne de défense réelle reste :
**l'app se connecte avec `sooba_app`, qui n'a pas `BYPASSRLS`.**

Création des rôles : `prisma/sql/00-bootstrap-roles.sql` (monté en
`docker-entrypoint-initdb.d` par `docker-compose.yml`). En intégration,
`test/utils/tenant-test-context.ts` recrée `sooba_app` à l'identique sur le
conteneur jetable.

---

## 4. Les politiques RLS — `prisma/sql/rls-policies.sql`

**Idempotent**, rejoué après chaque migration : `pnpm db:rls` (ou `db:deploy`).

La liste des tables **n'est pas codée en dur**. Le script la dérive :

```sql
SELECT table_name FROM information_schema.columns
WHERE table_schema = 'public' AND column_name = 'tenant_id'
```

→ toute table `public` portant une colonne `tenant_id` reçoit :

```sql
ALTER TABLE public.<t> ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.<t> FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.<t>;
CREATE POLICY tenant_isolation ON public.<t>
  USING      (app_bypass_rls() OR tenant_id = app_current_tenant())
  WITH CHECK (app_bypass_rls() OR tenant_id = app_current_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON public.<t> TO sooba_app;
```

**Conséquence structurante : ajouter une table métier ne demande RIEN.** Dès
qu'elle porte `tenant_id` (règle 1 de `docs/04-data-model.md`), elle est
protégée au prochain `db:rls`. Un test d'intégration
(`« chaque table portant tenant_id a RLS + FORCE + policy »`) échoue si ce
n'est pas le cas — filet contre une base pas re-`rls`-ée.

Cas particuliers, traités après la boucle :

- **`roles`** — `tenant_id` NULLABLE (rôles système partagés). Politique
  élargie en **lecture** (`tenant_id IS NULL OR …`) ; l'écriture d'un rôle
  système passe par `$privileged`.
- **Référentiels globaux** (`currencies`, `countries`, `permissions`,
  `role_permissions`) — pas de colonne `tenant_id`, donc hors de la boucle.
  `GRANT SELECT` seulement.
- **`tenants`** (le registre) — DML accordé à `sooba_app`, mais RLS activée
  (sans `FORCE`) avec quatre politiques : lecture libre (`tenants_read`,
  l'annuaire résout le tenant avant tout contexte) ; `INSERT`, `UPDATE` et
  `DELETE` seulement si `app_bypass_rls()`, c'est-à-dire dans une transaction
  `$privileged()`. Hors de ce cadre, une modification touche 0 ligne et une
  insertion est rejetée. L'ancien `REVOKE INSERT/UPDATE/DELETE` rendait
  impossible l'administration des organisations par le SUPER_ADMIN
  (`permission denied for table tenants`). Sans `FORCE` : le propriétaire
  `sooba` (migrations, seed) n'est pas soumis à ces politiques.

`USING` filtre les lignes **lues** (SELECT/UPDATE/DELETE voient un sous-ensemble) ;
`WITH CHECK` filtre les lignes **écrites** (INSERT/UPDATE rejetés si la ligne
résultante n'appartient pas au tenant courant).

---

## 5. L'échappatoire `$privileged()`

`PrismaService.$privileged(fn)` ouvre une transaction et pose
`set_config('app.bypass_rls', 'on', TRUE)` → `app_bypass_rls()` devient vrai →
les politiques laissent tout passer, **le temps de cette transaction**.

Réservé aux **traitements plateforme cross-tenant**, qui par nature parcourent
tous les tenants :

| Appelant | Raison |
|---|---|
| `infrastructure/events/outbox/outbox-relay.job.ts` | le relais publie l'outbox de **tous** les tenants |
| `infrastructure/tenancy/registry/tenant-registry.service.ts` | résout le tenant **avant** qu'un contexte existe |
| `modules/analytics/infrastructure/jobs/rollup-metrics.job.ts` | agrégats plateforme |
| `modules/analytics/infrastructure/jobs/rotate-partitions.job.ts` | rotation des partitions mensuelles (US-IG-022, ADR-0007) |
| `modules/compliance/infrastructure/jobs/data-retention.job.ts` | purge RGPD planifiée |
| `modules/tenancy/presentation/http/tenants.controller.ts` | administration des tenants (SUPER_ADMIN plateforme) |

**Restriction outillée** : la règle dependency-cruiser `no-raw-prisma-in-modules`
(`.dependency-cruiser.cjs`) fait échouer `pnpm depcruise` si un fichier sous
`src/modules/` importe `PrismaService`, **sauf** :
`src/modules/tenancy/**` et les deux jobs plateforme ci-dessus (allowlist
explicite dans la règle). Un 6ᵉ appelant force donc une décision consciente :
soit l'ajouter à l'allowlist avec justification, soit le déplacer dans
`src/infrastructure/`.

`src/infrastructure/**` a un accès libre à `PrismaService` : c'est là que vit
l'infrastructure de persistance.

---

## 6. Les six chemins d'attaque et où ils sont couverts

| # | Attaque | Couvert par | Résultat attendu |
|---|---|---|---|
| 1 | Lecture normale — le filtre est-il posé sans action du dev ? | `tenant-prisma.service.spec.ts` (unit) | `where.tenantId` toujours injecté |
| 2 | `SELECT` en SQL brut **sans tenant en session** | `tenant-isolation.spec.ts` | 0 ligne (fail-closed) |
| 3 | `SELECT` par **UUID exact** d'une ligne d'un autre tenant | `tenant-isolation.spec.ts` | 0 ligne |
| 4 | `INSERT` pour le compte d'un autre `tenant_id` | `tenant-isolation.spec.ts` | rejeté (`WITH CHECK`) |
| 5 | `UPDATE` d'une ligne d'un autre tenant | `tenant-isolation.spec.ts` | 0 ligne touchée |
| 6 | `DELETE` d'une ligne d'un autre tenant | `tenant-isolation.spec.ts` | 0 ligne touchée |

Plus deux garde-fous structurels dans le même fichier :
« chaque table `tenant_id` a RLS+FORCE+policy » et « la policy couvre ≥ 40 tables ».

Ces tests s'exécutent avec le rôle **`sooba_app`** (jamais le superuser du
conteneur, qui contournerait tout silencieusement) et sont **bloquants en CI** :
job `test:integration` dans `.gitlab-ci.yml` (pas de `allow_failure`), et
`build:image` en dépend. `make verify` les inclut aussi.

---

## 7. Checklist de revue de code

- [ ] Un repository / service touche une table `tenant_id` → il passe par
      `TenantPrismaService.client`, **jamais** `PrismaService`.
- [ ] Nouvelle table métier → elle porte `tenant_id` (le reste est automatique).
- [ ] Nouvel appel à `$privileged()` → c'est un traitement plateforme
      cross-tenant, ajouté à l'allowlist `no-raw-prisma-in-modules` avec un
      commentaire de justification.
- [ ] `$queryRaw` / `$executeRaw` sur une table métier → uniquement dans une
      transaction où `app.current_tenant_id` est posé (UoW, ou `$privileged`
      assumé).
