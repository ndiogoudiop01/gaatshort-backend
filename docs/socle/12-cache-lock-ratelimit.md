# Cache, verrous distribués, limitation de débit

Ce qui vit **hors de Postgres** doit être cloisonné par tenant avec le même
sérieux que la base (cf. [docs/11-tenant-isolation.md](11-tenant-isolation.md)).
Trois mécanismes, trois fichiers.

| Besoin | Port (kernel) | Implémentation |
|---|---|---|
| Cache | `CachePort` (`@shared/kernel/ports/cache.port`) | `src/infrastructure/cache/redis-cache.service.ts` |
| Verrou distribué | `LockPort` (`@shared/kernel/ports/lock.port`) | `src/infrastructure/lock/redis-lock.service.ts` |
| Limitation de débit | — (guard NestJS) | `src/infrastructure/ratelimit/tenant-throttler.guard.ts` |

Le client Redis (`redis.provider.ts`) est créé avec `keyPrefix: "ig:"` :
**toute** clé écrite par l'application est déjà sous ce préfixe applicatif.

---

## 1. Cache — `RedisCacheService`

### 1.1 Préfixage par tenant (critère : « toute clé est préfixée »)

```ts
private scoped(key: string): string {
  const tenant = this.tenantContext.getOrNull();
  return tenant ? `t:${tenant.tenantId}:${key}` : `global:${key}`;
}
```

`get` / `set` / `del` / `delByPattern` / `remember` passent **tous** par
`scoped()`. Une clé écrite depuis le contexte du tenant A devient
`ig:t:A:activities:list` sur le fil ; le tenant B ne peut pas la lire, il
demande `ig:t:B:activities:list`.

Hors contexte tenant (bootstrap, job plateforme), le préfixe est `global:` —
volontairement distinct, jamais mélangé avec un tenant.

> **Règle de revue** : ne jamais appeler `redis.*` directement depuis un
> service métier. Injecter `CachePort`.

### 1.2 Anti-stampede — `remember(key, ttl, factory)`

Problème : une clé chaude expire, 500 requêtes arrivent dans la même
milliseconde, 500 requêtes SQL identiques partent. C'est le *cache stampede*
(ou *thundering herd*).

Parade : une `Map inFlight` (clé = clé de cache scopée). Le premier appelant
lance la `factory` ; les suivants **attendent la même promesse** ; le résultat
est écrit en cache puis la Map est nettoyée.

**Portée : intra-process.** La `Map` vit dans **une** instance d'API. Avec N
instances, la `factory` tourne au pire **N fois** (une par instance), jamais
N × 500. C'est suffisant contre le thundering herd. Un verrou distribué
(§2) donnerait « exactement une fois » sur toute la flotte, au prix d'un
aller-retour Redis + d'une latence d'attente à chaque *miss* : **non retenu**
(décision, découpage « anti-stampede 2 pt »).

Si la `factory` échoue, la clé en vol est libérée (`.finally`) → l'appel
suivant réessaie.

### 1.3 Invalidation par motif — `delByPattern(pattern)` (critère : SCAN, jamais KEYS)

`KEYS *` parcourt tout l'espace de clés en bloquant le thread Redis — interdit
(cf. [docs/06 §Anti-patterns](06-scalability-playbook.md)). `delByPattern`
utilise `SCAN` en boucle sur le curseur (`COUNT 200`), puis `DEL` par lot.

Deux subtilités ioredis 5.x, gérées dans le code (et **couvertes par
`test/integration/cache-lock.spec.ts`**) :

1. le `keyPrefix` du client **n'est pas** ajouté au `MATCH` de SCAN → on le
   préfixe à la main : `ig:` + `scoped(pattern)` ;
2. SCAN renvoie les clés **complètes** (préfixe inclus) → on retire `ig:` avant
   `DEL`, qui le réappliquera.

Usage typique : `registry.invalidate()` purge `t:{id}:*` à la mutation d'un
tenant ; `delByPattern('activities:*')` après publication du catalogue.

---

## 2. Verrou distribué — `RedisLockService`

```ts
SET lock:{key} {uuid-aléatoire} PX {ttlMs} NX     -- acquisition
```

- **`NX`** : pose le verrou seulement s'il est libre → un seul détenteur.
- **`PX ttl`** : expiration → aucun verrou orphelin si le process meurt.
- **Jeton aléatoire** : identifie *notre* détention.

Libération = script Lua **compare-and-delete atomique** :

```lua
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
```

Sans ce test, un process lent qui déborde son TTL supprimerait le verrou
**repris entre-temps par un autre** — le bug classique du verrou Redis.

### Conséquences à connaître
- Le TTL doit **majorer** la durée d'exécution attendue. S'il déborde quand
  même, deux process peuvent exécuter `fn` en parallèle → les traitements
  protégés (**relais outbox, crons**) sont écrits **idempotents**. C'est la
  règle, pas une rustine.
- **Pas de watchdog / renouvellement automatique** : simple et prévisible.
- Clé `lock:{key}` — **non** préfixée par tenant : les verrous sont plateforme.
  Un verrou par tenant se code en mettant l'id dans `key`.
- `withLock(key, ttl, fn)` renvoie `null` (sans exécuter `fn`) si le verrou est
  pris ; sinon exécute `fn` et **libère toujours** (succès comme exception).

---

## 3. Limitation de débit — `TenantThrottlerGuard`

`@nestjs/throttler` identifie chaque client via `getTracker()`. Par défaut :
l'IP. Insuffisant : derrière une IP NAT d'opérateur mobile, des milliers
d'abonnés partagent l'adresse et **s'entre-bloquent**.

```ts
protected override getTracker(req) {
  const tenant   = this.tenantContext.getOrNull()?.tenantId ?? 'anon';
  const identity = req.user?.id ?? req.ip ?? 'unknown';
  return `${tenant}:${identity}`;
}
```

- **Authentifié** → `tenant:userId` : le quota est propre à l'utilisateur.
- **Anonyme** → `tenant:ip` : pas mieux possible sans identité, mais **jamais
  l'IP seule** — toujours cloisonné par tenant.
- `req.ip` est fiable grâce à `trust proxy` (cf. `bootstrap/security.ts`).

Trois barèmes (`security.module.ts`) : `default` (120 / 60 s), `public-form`
(5 / h — candidature, lead, newsletter : la cible des bots), `auth` (10 / 15 min).
Le guard est global (`APP_GUARD` dans `app.module.ts`).

---

## 4. Checklist de revue

- [ ] Un service lit/écrit Redis → il passe par `CachePort` / `LockPort`, jamais
      le client `ioredis` brut.
- [ ] Une clé de cache construite à la main contient-elle déjà un id de tenant ?
      (ne pas doubler — `scoped()` s'en charge)
- [ ] Une invalidation « en masse » utilise `delByPattern` (SCAN), jamais une
      boucle sur `KEYS`.
- [ ] Un nouveau traitement sous `withLock` est-il **idempotent** (le TTL peut
      déborder) ?
- [ ] Un nouvel endpoint public a-t-il un barème (`@Throttle` / groupe
      `public-form`) ?

## 5. Où c'est testé

| Aspect | Test |
|---|---|
| Préfixage tenant, sérialisation, `remember` (unitaire) | `src/infrastructure/tests/redis-cache.service.spec.ts` |
| `delByPattern` via **vrai** Redis (SCAN multi-curseur, isolation tenant) | `test/integration/cache-lock.spec.ts` |
| `remember` anti-stampede sous concurrence réelle | `test/integration/cache-lock.spec.ts` |
| Verrou : contention, expiration TTL, compare-and-delete, `withLock` | `test/integration/cache-lock.spec.ts` (+ unitaires `redis-lock.service.spec.ts`) |
| Tracker `tenant:identité` | `src/infrastructure/tests/tenant-throttler.guard.spec.ts` |
