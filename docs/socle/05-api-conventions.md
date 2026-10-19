# Conventions d'API

> **À partager au développeur frontend.** Contrat unique pour 100 % des
> endpoints : un seul intercepteur côté client, aucune surprise par route.
> Version courte : [resume-api-conventions.md](resume-api-conventions.md).

## 1. Enveloppe de réponse

Toutes les réponses ont la même forme, appliquée **globalement** par
`ResponseEnvelopeInterceptor` (succès) et `AllExceptionsFilter` (erreur). Le
frontend écrit **un** intercepteur.

```jsonc
// Succès
{ "success": true, "data": { }, "requestId": "01JBQ…", "timestamp": "2026-09-02T10:12:00.000Z" }

// Succès paginé — offset (back-office)
{ "success": true, "data": [ ], "meta": { "total": 142, "page": 1, "perPage": 20, "totalPages": 8, "hasMore": true }, "requestId": "…", "timestamp": "…" }

// Succès paginé — curseur (flux publics)
{ "success": true, "data": [ ], "meta": { "nextCursor": "eyJpZCI6…", "hasMore": true }, "requestId": "…", "timestamp": "…" }

// Erreur
{ "success": false, "error": { "code": "INVALID_STATE_TRANSITION", "message": "Transition interdite sur Application : SUBMITTED → PRESELECTED", "details": { "allowedTransitions": ["RECEIVED", "WITHDRAWN"] } }, "requestId": "…", "timestamp": "…" }
```

- `requestId` est aussi renvoyé dans l'en-tête `x-request-id` (repris de la
  requête s'il était fourni) — à joindre à tout ticket de support.
- `message` est une **aide au développeur**, jamais un texte d'interface : le
  front localise à partir de `code`.
- Les erreurs de validation listent les champs fautifs dans
  `error.details.issues` (tableau de chaînes), pas dans `message`.
- `data` d'un endpoint « brut » (redirection, fichier, webhook) : décorer le
  handler avec `@RawResponse()` pour désactiver l'enveloppe.

## 2. Codes d'erreur

Le champ `code` est un **contrat public** : il ne se renomme pas, il se
déprécie. Le frontend s'y branche pour afficher un message localisé ;
`message` est une aide au développeur, pas un texte d'interface. La source de
vérité est `src/shared/kernel/errors/error-catalog.ts`.

Comment un `code` est choisi (`AllExceptionsFilter`) :

1. **erreur du domaine** (`DomainError` & sous-classes) → son `code` propre + le
   statut HTTP associé ;
2. **`HttpException` avec un `code` explicite** — `new ConflictException({ code,
   message })` — → ce `code` fait foi ;
3. **`HttpException` sans `code`** → dérivé du statut (table ci-dessous) ;
4. **tout le reste** → `500 INTERNAL_ERROR` + log `error` avec la stack. C'est
   le seul cas non catalogué, et il est traité comme un bug.

| HTTP | Code | Sens |
|---|---|---|
| 400 | `VALIDATION_FAILED` | Payload invalide (`details.issues` liste les champs) |
| 400 | `TENANT_NOT_RESOLVED` | Aucun tenant identifiable |
| 401 | `UNAUTHENTICATED` / `TOKEN_EXPIRED` | Session absente ou expirée |
| 403 | `FORBIDDEN_ACTION` / `TENANT_SUSPENDED` | Droits insuffisants |
| 404 | `RESOURCE_NOT_FOUND` | Introuvable **dans le tenant courant** |
| 409 | `INVALID_STATE_TRANSITION` | Transition refusée par la machine à états |
| 409 | `DUPLICATE_RESOURCE` | Contrainte d'unicité |
| 409 | `CONCURRENCY_CONFLICT` | 409 générique sans code explicite |
| 409 | `IDEMPOTENCY_PAYLOAD_MISMATCH` | Clé d'idempotence réutilisée avec un autre contenu |
| 409 | `IDEMPOTENCY_IN_PROGRESS` | Requête d'origine encore en cours de traitement |
| 413 / 415 | `FILE_TOO_LARGE` / `UNSUPPORTED_MEDIA_TYPE` | Upload refusé |
| 422 | `CONSENT_REQUIRED`, `APPLICATION_INCOMPLETE`, … | Règle métier violée |
| 429 | `RATE_LIMIT_EXCEEDED` | Quota dépassé (`Retry-After` fourni) |
| 502 / 503 / 504 | `UPSTREAM_UNAVAILABLE` | Dépendance externe indisponible (≠ bug interne) |
| 500 | `INTERNAL_ERROR` | Non catalogué — traité comme un bug, jamais exposé en détail en prod |

> Une ressource appartenant à un autre tenant renvoie **404 `RESOURCE_NOT_FOUND`**,
> jamais 403 : confirmer son existence serait déjà une fuite d'information.
> (`TenantMismatchError` est traduit en 404 et **alerte** dans les logs.)

## 3. Pagination — deux mécanismes, deux usages

| Type | Quand | Paramètres |
|---|---|---|
| **Offset** | Back-office : « page 7 sur 42 » | `?page=1&perPage=20&sortBy=score&sortDir=desc` |
| **Curseur** | Flux publics, défilement infini | `?cursor=<opaque>&limit=20` |

L'offset est interdit sur les tables à forte volumétrie : `OFFSET 100000`
fait scanner 100 000 lignes à Postgres. Le flux d'actualités et le catalogue
utilisent donc le curseur.

## 4. Versionnement

URI : `/api/v1/…`. Une v2 cohabite avec la v1 (`@Controller({ version: '2' })`).

Règle : **on n'introduit jamais de rupture dans une version publiée.**
Ajouter un champ optionnel n'est pas une rupture ; changer le type d'un
champ, en retirer un, ou modifier la sémantique d'un `code` d'erreur en est une.

## 5. Idempotence

Toute création déclenchée par un formulaire public exige l'en-tête
`Idempotency-Key` (UUID généré par le client, conservé 24 h).

```http
POST /api/v1/partners/leads
Idempotency-Key: 5f9c2f7a-3a1e-4b2f-9f2c-8a1d3e4f5b6c
```

- Clé absente ou < 8 caractères → `400 VALIDATION_FAILED`.
- Même clé + même corps (hash SHA-256) → la réponse d'origine est rejouée.
- Même clé + corps différent → `409 IDEMPOTENCY_PAYLOAD_MISMATCH`.
- Requête d'origine encore en cours → `409 IDEMPOTENCY_IN_PROGRESS`.
- Requête d'origine en échec → la clé est libérée, un nouvel essai est permis.

Endpoints concernés (décorateur `@Idempotent()`) : `POST /partners/leads`,
`POST /newsletter/subscribe`, `POST /applications/me/submit`. Les endpoints
d'authentification et le simulateur en sont exclus : ce ne sont pas des
créations de ressource.

**Pourquoi c'est indispensable ici** : sur une connexion mobile instable, le
double-tap et le retry réseau sont la norme, pas l'exception. Sans clé
d'idempotence, le back-office se remplit de dossiers en double.

## 6. Quotas

| Portée | Limite |
|---|---|
| Défaut | 120 req / min |
| Formulaires publics (candidature, lead, newsletter) | 5 / heure |
| Authentification (`/auth/challenge`, `/auth/verify`) | 5–10 / 15 min |
| Simulateur (`/simulations/calculate`) | 300 / min |

La clé de comptage est `tenant:utilisateur` (ou `tenant:ip`). Une clé
purement IP bloquerait des milliers d'abonnés partageant une même IP NAT
chez un opérateur mobile.

## 7. Nommage des routes

```
/api/v1/<ressource-au-pluriel>              ressources publiques
/api/v1/<ressource>/me                      ressources de l'utilisateur courant
/api/v1/admin/<ressource>                   back-office (permission requise)
/api/v1/<ressource>/:id/<action-métier>     action non-CRUD (verbe explicite)
```

Exemple : `POST /admin/applications/:id/schedule-interview` plutôt qu'un
`PATCH` générique dont le corps déterminerait l'action.

## 8. Fichiers

Aucun binaire ne transite par l'API. Le flux est systématiquement :

1. `POST /applications/me/documents/upload-url` → URL S3 signée + `fileId`
2. le client `POST` le fichier **directement vers S3**
3. `POST /applications/me/documents/confirm` → l'API vérifie l'objet et
   rattache la pièce

En lecture, `GET …/download-url` renvoie une URL signée valable 15 minutes,
après contrôle des droits.
