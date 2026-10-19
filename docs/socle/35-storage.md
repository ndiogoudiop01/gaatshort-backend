# Stockage objet S3 & URLs signées

> **Aucun binaire ne transite par l'API.** Le client téléverse et télécharge
> directement depuis S3, via des URLs signées de courte durée. L'API ne voit
> que des métadonnées JSON.

| Élément | Fichier |
|---|---|
| Port | `src/shared/kernel/ports/storage.port.ts` (`StoragePort`) |
| Adaptateur S3 (AWS / Scaleway / MinIO) | `src/infrastructure/storage/adapters/s3-storage.adapter.ts` |
| Fabrique de clés | `src/infrastructure/storage/storage-key.factory.ts` |

Pourquoi : un PDF de 15 Mo sur 3G, c'est 40 s. Ces 40 s occupent le
**navigateur du candidat**, pas une worker thread Node ni une connexion du
load balancer. C'est ce qui rend US-IG-009 tenable à l'échelle d'une cohorte.

---

## 1. Téléversement — en deux temps

```
1. POST /applications/{id}/documents/request-upload   (JSON)
   API : vérifie type + taille + pièce attendue
        → StorageKeyFactory : clé  tenants/{tenantId}/applications/{id}/{uuid}.pdf
        → S3 : createPresignedPost (URL + fields, TTL 15 min)
        → DB : storedFile en statut PENDING
   ← { url, fields, storageKey, expiresAt, fileId }

2. POST {url}   multipart, directement vers S3       (le binaire, JAMAIS via l'API)
   fields + Content-Type + file

3. POST /applications/{id}/documents/confirm-upload   (JSON)
   API : headObject(storageKey) → l'objet existe vraiment
        → DB : applicationDocument (versionné) + job d'analyse antivirus
   ← { documentId }
```

Le `storedFile` en `PENDING` permet de **purger** les téléversements jamais
confirmés (un client qui obtient une URL et ne s'en sert pas).

## 2. Taille & type contraints **par S3**, pas seulement par l'API

`createPresignedPost` pose des `Conditions` que **S3 lui-même** fait respecter :

```ts
Conditions: [
  ['content-length-range', 1, maxSizeBytes],   // ni vide, ni > la limite
  ['eq', '$Content-Type', mimeType],           // exactement ce type
]
```

Un client malveillant qui bricole le formulaire ne peut **pas** déposer un
fichier de 2 Go ni un exécutable : S3 rejette le POST. L'API valide **aussi**
en amont (message d'erreur clair), mais la contrainte dure est côté S3.

## 3. Nommage des objets — préfixé par tenant

```
tenants/{tenantId}/{scope}/{uuid}{.ext}
        └─ applications/{applicationId}
        └─ partners/{partnerLeadId}
        └─ exports/{kind}
```

- **`tenants/{tenantId}/`** : politique IAM par tenant, purge RGPD par
  suppression de préfixe, facturation par client.
- **`{uuid}`** : le nom d'origine n'est **jamais** réutilisé comme clé — c'est
  un vecteur de *path traversal*. L'extension est assainie (`[^.a-z0-9]`
  retiré, 10 car. max).
- `tenantContext.tenantId` **jette** (`MissingTenantContextError`) hors de tout
  contexte tenant → impossible de fabriquer une clé « orpheline ».

## 4. Consultation — aucune URL publique

- Le bucket est **privé**. Aucun objet n'est accessible par URL directe.
- `GetDownloadUrlQuery` : vérifie le **droit d'accès** (propriétaire du dossier ;
  refus si l'antivirus a marqué le fichier `INFECTED`), **puis** signe une URL
  `GET` de **15 minutes**.
- TTL de téléchargement **dédié** (`STORAGE_DOWNLOAD_TTL_SECONDS`, défaut 900) et
  **plafonné** : `createPresignedDownload` n'émet jamais un lien plus long, même
  si l'appelant en demande plus. Un lien de téléchargement n'est pas
  partageable durablement.

## 5. Surface de l'adaptateur (`StoragePort`)

| Méthode | Rôle |
|---|---|
| `createPresignedUpload({ storageKey, mimeType, maxSizeBytes })` | URL POST signée + `Conditions` S3 |
| `createPresignedDownload(storageKey, ttlSeconds?)` | URL GET signée, TTL plafonné à 15 min |
| `delete(storageKey)` | supprime l'objet |
| `headObject(storageKey)` | `{ sizeBytes, mimeType }` ou `null` |
| `exists(storageKey)` | booléen (via `headObject`) |

`createPresignedUpload`, `createPresignedDownload` et `delete` **refusent** une
clé hors `tenants/{id}/…` (garde `assertScopedKey`) : on ne signe / ne supprime
jamais un objet arbitraire. `headObject`/`exists` restent des sondes de
métadonnées sans garde (l'appelant lit toujours la clé depuis une ligne
`storedFile` déjà filtrée par la RLS).

## 6. Configuration

| Variable | Défaut | Rôle |
|---|---|---|
| `STORAGE_DRIVER` | `s3` | `s3` \| `local` |
| `STORAGE_ENDPOINT` | — | non vide pour Scaleway / MinIO |
| `STORAGE_BUCKET` | — | **privé** |
| `STORAGE_FORCE_PATH_STYLE` | `false` | `true` pour MinIO |
| `STORAGE_PRESIGN_TTL_SECONDS` | `900` | TTL de l'URL POST d'**upload** (allongeable pour le mobile) |
| `STORAGE_DOWNLOAD_TTL_SECONDS` | `900` | TTL de l'URL GET de **consultation**, ≤ 3600 |
| `STORAGE_MAX_FILE_SIZE_MB` | `15` | borne globale, croisée avec la limite par pièce |
| `STORAGE_ALLOWED_MIME` | — | liste blanche globale, croisée avec `document_requirements.allowed_mime` |

## 7. Checklist de revue

- [ ] Un fichier utilisateur → passe par une URL signée, **jamais** un `multipart`
      reçu par un contrôleur Nest.
- [ ] Toute clé S3 vient de `StorageKeyFactory` (jamais construite à la main,
      jamais le nom de fichier client).
- [ ] Un nouvel usage de `createPresignedDownload` → TTL court (≤ 15 min) et
      contrôle d'accès **avant** la signature.
- [ ] Bucket privé, pas de `public-read`, pas d'URL directe exposée.

## 8. Où c'est testé

| Aspect | Test |
|---|---|
| URL POST signée ; `Conditions` (taille + type) transmises à S3 ; garde de clé | `src/infrastructure/tests/s3-storage.adapter.spec.ts` |
| Download : `expiresIn` 15 min, TTL **plafonné**, TTL court respecté, garde de clé | idem |
| `delete` / `headObject` / `exists` | idem |
| Clé préfixée `tenants/{tenantId}/`, extension assainie, UUID unique, **jette sans contexte tenant**, préfixes distincts entre tenants | `src/infrastructure/tests/storage-key.factory.spec.ts` |
