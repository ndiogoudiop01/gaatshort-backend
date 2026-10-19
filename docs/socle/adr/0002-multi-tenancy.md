# ADR-0002 — Isolation multi-tenant : base partagée + RLS

**Statut** : accepté · **Date** : 2026-09-02

## Contexte

Le système héberge plusieurs entités du groupe et, à terme, des programmes
opérés pour des institutions partenaires. Une fuite entre tenants est une
violation de données personnelles, pas un simple bug.

## Options

| Option | Isolation | Exploitation | Verdict |
|---|---|---|---|
| Base par tenant | Maximale | N bases à migrer/sauvegarder/superviser | ❌ |
| Schéma par tenant | Forte | N schémas, pool saturé, migrations ×N | ⚠️ option « silo » |
| Base + schéma partagés, `tenant_id` + RLS | Forte si rigoureuse | Une base, une migration | ✅ |

## Décision

**Base et schéma partagés**, colonne `tenant_id` sur chaque table métier, et
**deux remparts indépendants** :

1. **Applicatif** — extension Prisma qui injecte `tenantId` dans tout `where`
   et tout `data`. Coût nul, mais aveugle au `$queryRaw`.
2. **Base** — Row Level Security Postgres avec `FORCE ROW LEVEL SECURITY`,
   pilotée par `set_config('app.current_tenant_id', …, TRUE)` sur la même
   connexion et la même transaction.

Le mode `SCHEMA` reste disponible par tenant (`Tenant.isolation`) pour un
client qui l'exigerait contractuellement, sans changement de code applicatif.

## Conséquences

**Positives**
- Le premier rempart empêche l'oubli humain ; le second empêche le
  contournement technique. Aucun des deux n'est suffisant seul.
- Une seule migration, un seul jeu de sauvegardes.
- Le mode silo reste ouvert sans réécriture.

**Négatives**
- L'application **doit** se connecter avec un rôle sans `BYPASSRLS`
  (`sooba_app`). Une mauvaise chaîne de connexion désactive silencieusement
  le second rempart — d'où le test d'intégration dédié.
- Un `set_config` supplémentaire par transaction (coût négligeable,
  pipeliné dans le même aller-retour).

**Garde-fou**
`test/integration/tenant-isolation.spec.ts` attaque la base en SQL brut et
échoue si la RLS ne tient pas. **Bloquant en CI.**
