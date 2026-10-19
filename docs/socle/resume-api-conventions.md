# Résumé express — Conventions d'API

*À lire en 5 min. Détail complet : [docs/05-api-conventions.md](05-api-conventions.md).*

---

## En une phrase

**Un seul contrat pour 100 % des endpoints** → le frontend écrit **un seul**
intercepteur. Enveloppe identique, codes d'erreur stables, deux paginations,
idempotence sur les créations publiques.

## 1. L'enveloppe — tu n'écris jamais `res.json(...)` toi-même

Tu retournes ta donnée métier depuis le contrôleur. `ResponseEnvelopeInterceptor`
l'emballe :

```jsonc
{ "success": true, "data": <ta donnée>, "requestId": "01JBQ…", "timestamp": "…" }
```

Une liste paginée (`PaginatedResult`) est dépliée en `data` + `meta`
automatiquement. Besoin d'une réponse **non** emballée (fichier, redirection) ?
`@RawResponse()` sur le handler.

## 2. Les erreurs — tu `throw`, tu ne traduis pas

```ts
// ✅ le domaine lève une erreur typée
throw new ResourceNotFoundError('Application', id);
throw new InvalidStateTransitionError('Application', from, to, allowed);
// ✅ ou une HttpException AVEC un code du catalogue
throw new ConflictException({ code: ErrorCode.DUPLICATE_RESOURCE, message: '…' });
```

`AllExceptionsFilter` produit :

```jsonc
{ "success": false,
  "error": { "code": "RESOURCE_NOT_FOUND", "message": "…(aide dev)…", "details": { } },
  "requestId": "…", "timestamp": "…" }
```

Règles :

- **`code` vient toujours du catalogue** (`error-catalog.ts`). Jamais un message
  libre comme contrat. Le front localise depuis `code`, pas depuis `message`.
- **Aucune 500 non gérée** : tout ce qui n'est ni une `DomainError` ni une
  `HttpException` cataloguée devient `500 INTERNAL_ERROR` + log avec stack →
  c'est un bug à corriger, pas un cas nominal.
- **Ressource d'un autre tenant → `404 RESOURCE_NOT_FOUND`, jamais 403.**
  Confirmer l'existence serait une fuite. (Avec la RLS, elle est juste
  « introuvable » ; `TenantMismatchError` est aussi traduit en 404 + alerte.)
- Erreurs de validation : les champs fautifs sont dans `error.details.issues`.

## 3. Pagination — deux mécanismes, ne les mélange pas

| | Offset | Curseur |
|---|---|---|
| **Pour** | back-office (« page 7 / 42 ») | flux publics, scroll infini |
| **Query** | `?page=1&perPage=20&sortBy=…&sortDir=…` | `?cursor=<opaque>&limit=20` |
| **`meta`** | `total, page, perPage, totalPages, hasMore` | `nextCursor, hasMore` |
| **Construit avec** | `PaginatedResult.offset(items, total, page, perPage)` | `PaginatedResult.cursor(items, nextCursor)` |

Offset **interdit** sur les grosses tables (`OFFSET 100000` = scan de 100 000
lignes). Actualités + catalogue = curseur obligatoire.

## 4. Idempotence — sur les créations publiques

Décore le handler avec `@Idempotent()`. Le client **doit** envoyer un en-tête
`Idempotency-Key` (UUID) :

```http
POST /api/v1/partners/leads
Idempotency-Key: 5f9c2f7a-3a1e-4b2f-9f2c-8a1d3e4f5b6c
```

- clé absente / trop courte → `400 VALIDATION_FAILED`
- même clé + même corps → **la réponse d'origine est rejouée** (hash SHA-256 du corps)
- même clé + corps différent → `409 IDEMPOTENCY_PAYLOAD_MISMATCH`
- requête d'origine encore en cours → `409 IDEMPOTENCY_IN_PROGRESS`
- requête d'origine en échec → clé libérée, nouvel essai permis

Concernés : `POST /partners/leads`, `POST /newsletter/subscribe`,
`POST /applications/me/submit`. Auth et simulateur exclus (pas des créations).

## 5. Chaque endpoint est documenté

`@ApiOperation({ summary, description })` sur **chaque** handler → visible dans
`/docs` (Swagger, hors prod) et publié en CI (`openapi.json`). Une route sans
`@ApiOperation` ne passe pas la revue.

## Où ça vit

```
src/shared/interceptors/response-envelope.interceptor.ts   l'enveloppe succès
src/shared/filters/all-exceptions.filter.ts                domaine → HTTP + enveloppe erreur
src/shared/kernel/errors/error-catalog.ts                  LE catalogue de codes
src/shared/kernel/errors/domain.error.ts                   erreurs typées du domaine
src/shared/kernel/application/pagination.ts                PaginatedResult (offset | cursor)
src/infrastructure/idempotency/idempotency.interceptor.ts  rejeu + hash du corps
src/shared/decorators/{idempotent,raw-response}.decorator.ts
```

## Tests

```bash
npx jest src/shared/tests/all-exceptions.filter.spec.ts \
         src/shared/tests/http-interceptors.spec.ts \
         src/shared/tests/pagination.spec.ts \
         src/infrastructure/tests/idempotency.interceptor.spec.ts
```
