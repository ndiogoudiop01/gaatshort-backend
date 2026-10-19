# Sécurité, authentification et autorisations

## 1. Authentification sans mot de passe (US-IG-007)

Trois canaux, un seul mécanisme :

| Canal | Usage |
|---|---|
| `EMAIL_MAGIC_LINK` | Confort desktop |
| `EMAIL_OTP` | Code à 6 chiffres, utile quand le lien est filtré |
| `PHONE_OTP` | **Chemin de première classe** — en Afrique de l'Ouest, le téléphone est souvent plus fiable que l'e-mail |

Aucun mot de passe stocké par défaut : pas de fuite de mots de passe
possible, pas de réinitialisation à gérer, pas de réutilisation entre sites.
Argon2id reste disponible pour les comptes back-office qui l'exigent.

```
POST /auth/challenge  { channel, identifier }   → { sent: true, expiresInSeconds }
POST /auth/verify     { identifier, secret }    → { accessToken, refreshToken, expiresIn }
POST /auth/refresh    { refreshToken }          → { accessToken, refreshToken, expiresIn }
POST /auth/logout     (Bearer)                  → 204
```

### Décisions de sécurité assumées

- **Anti-énumération** — `/auth/challenge` répond « code envoyé » même si le
  compte n'existe pas. Sinon l'endpoint devient un oracle qui révèle qui est
  inscrit. Même logique sur `/auth/verify` : « identifiant sans défi actif »
  et « secret erroné » renvoient exactement le même code, `CHALLENGE_INVALID`.
- **Verrouillage** — 5 tentatives par défi (`AuthChallengeRules.assertUsable`).
  Un OTP à 6 chiffres se force en 10⁶ essais, ce qu'un script fait en
  quelques minutes.
- **Jetons hachés, HMAC-SHA256, sans exception** — magic link, OTP **et**
  refresh token sont hachés par `TokenHasher` avant stockage, jamais en
  clair, comparaison à temps constant (`timingSafeEqual`). Aucun de ces
  secrets n'emprunte un autre algorithme.
- **Séparation des clés** — `TokenHasher` utilise `auth.refreshSecret` comme
  pepper HMAC, **jamais** `auth.accessSecret` (celle qui signe les JWT).
  Réutiliser la clé de signature comme pepper de hachage coderait deux
  usages sur la même clé : la faire tourner (rotation planifiée ou incident)
  invaliderait silencieusement tous les hachages déjà en base. Le nom de la
  variable d'environnement (`JWT_REFRESH_SECRET`) est un vestige — le refresh
  token est une chaîne aléatoire opaque, pas un JWT — mais son rôle réel de
  pepper dédié est correct et documenté ici.
- **Rotation des refresh tokens** — chaque rafraîchissement invalide le
  précédent et écrit `replacedById` dessus : depuis n'importe quelle session
  d'une famille, on retrouve celle qui l'a remplacée (chaîne d'audit
  complète). La présentation d'un token déjà consommé révoque **toute la
  famille** (`SESSION_REVOKED`) : c'est la signature d'un vol.
- **Révocation effective** — la stratégie JWT vérifie que la session existe
  toujours en base (`authSession.revokedAt IS NULL AND expiresAt > now()`).
  Sans ce contrôle, une déconnexion ne déconnecte rien pendant la durée de
  vie du token d'accès.
- **Tenant scellé** — le JWT porte `tid`. `TenantMemberGuard` compare
  `tid` au tenant résolu pour la requête à **chaque** appel ; une divergence
  est journalisée en `error` (incident, pas une erreur de saisie) et refusée.
  Un token émis pour un tenant ne peut donc pas servir sur un autre, quel
  que soit le sous-domaine appelé.
- **Quotas dédiés** — `/auth/challenge` (5 / 15 min, plus serré : il envoie
  des e-mails/SMS facturés) et `/auth/verify` (10 / 15 min) ont leur propre
  limiteur nommé `auth`, cloisonné par tenant + identité
  (`TenantThrottlerGuard`), pas seulement par IP.

### Codes d'erreur (catalogue)

| Code | HTTP | Sens |
|---|---|---|
| `CHALLENGE_INVALID` | 401 | Identifiant sans défi actif, ou secret erroné — même code pour les deux (anti-énumération) |
| `CHALLENGE_EXPIRED` | 422 | Le défi a dépassé son délai |
| `CHALLENGE_LOCKED` | 422 | 5 tentatives dépassées, il faut redemander un défi |
| `CHALLENGE_ALREADY_USED` | 422 | Le défi a déjà servi à ouvrir une session |
| `TOKEN_EXPIRED` | 401 | Refresh token introuvable ou expiré — reconnexion simple |
| `SESSION_REVOKED` | 401 | Rejeu d'un refresh token déjà consommé — la famille entière est révoquée, reconnexion sur tous les appareils |

Détail du choix du code (explicite vs dérivé du statut) :
[docs/05-api-conventions.md](05-api-conventions.md).

## 2. Deux niveaux d'autorisation

### RBAC — « ce rôle peut-il appeler cet endpoint ? »

`PermissionsGuard`, déclaratif :

```ts
@RequirePermissions('application:preselect')
```

On raisonne en **permissions granulaires**, jamais en rôles dans le code.
Aucun `if (user.role === 'ADMIN')` ne doit exister : créer « Gestionnaire
régional » demain ne doit toucher aucun contrôleur.

### ABAC — « peut-il toucher CETTE ressource-ci ? »

`ApplicationAccessPolicy`, contextuel :

```ts
this.policy.assertCanRead(user, { userId, assignedToId, countryCode });
```

Sans ce second niveau, tout gestionnaire lit tous les dossiers — y compris
ceux d'un autre pays ou d'un autre programme.

> **Passerelle vs portée.** `application:read` / `application:transition`
> n'ouvrent QUE le contrôleur (RBAC) : un MANAGER et un ADMIN les possèdent
> tous les deux. C'est ensuite `application:read:assigned` /
> `application:transition:assigned` (MANAGER) contre `:any` (ADMIN) qui
> tranche, via la policy, la portée réelle sur la ressource. Donner `:any`
> à un MANAGER annulerait le contrôle ABAC — c'est délibérément exclu de
> la matrice (`prisma/seed/permissions.seed.ts`).

## 3. Matrice des rôles

| Permission | CANDIDATE | PARTNER | MANAGER | ADMIN | SUPER_ADMIN |
|---|:-:|:-:|:-:|:-:|:-:|
| `application:read:own` / `write:own` | ✅ | | | | ✅ |
| `application:read` (passerelle contrôleur) | | | ✅ | ✅ | ✅ |
| `application:read:assigned` | | | ✅ | | ✅ |
| `application:read:any` | | | | ✅ | ✅ |
| `application:transition` (passerelle contrôleur) | | | ✅ | ✅ | ✅ |
| `application:transition:assigned` | | | ✅ | | ✅ |
| `application:transition:any` | | | | ✅ | ✅ |
| `application:preselect` | | | | ✅ | ✅ |
| `interview:schedule` / `document:review` | | | ✅ | ✅ | ✅ |
| `pool:read` | | | ✅ | ✅ | ✅ |
| `pool:export` | | | | ✅ | ✅ |
| `partner:read` / `write` / `transition` | | | ✅ | ✅ | ✅ |
| `activity:write` / `publish` | | | | ✅ | ✅ |
| `simulation:config:write` | | | | ✅ | ✅ |
| `metrics:read` | | | | ✅ | ✅ |
| `tenant:manage` | | | | | ✅ |

> `application:preselect` est volontairement réservé : la présélection
> engage le groupe vis-à-vis du candidat et des partenaires.

### 3 bis. Rôles de l'Academy et des Process 01 à 08

Ajoutés par `chore/rbac-roles-academy-processus` (note de cadrage Impact
Academy). Les permissions sont **déclarées** dès maintenant ; chaque route
les vérifiera au fil des branches qui les implémentent.

| Rôle | Libellé | Portée | Permissions clés |
|---|---|---|---|
| `LEARNER` | Apprenant | ses données | `academy:learn`, `entrepreneur:read:own` |
| `ENTREPRENEUR` | Entrepreneur | ses données | + `asset:incident:report:own`, `performance:read:own` |
| `TRAINER` | Formateur | ses cohortes (`:assigned`) | appel, évaluations, notes, `academy:decision:propose` |
| `ACADEMY_MANAGER` | Responsable Academy | toute l'Academy | programmes, cohortes, planning, `academy:certification:decide` |
| `ENTREPRENEUR_OFFICER` | Chargé Entrepreneur Operations | dossiers assignés | `application:prequalify`, formalisation |
| `ENTREPRENEUR_OPS_LEAD` | Responsable Entrepreneur Operations | tous | `application:admit`, `application:redflag:review`, `formalization:validate` |
| `LEGAL_REFERENT` | Référent juridique pays | son pays | `country-rules:write` |
| `FINANCING_OFFICER` | Financing Officer | dossiers assignés | `financing:write` |
| `FINANCING_DIRECTOR` | Direction Financement & Partenariats | tous | `financing:agreement:write`, `financing:purchase:authorize` |
| `FLEET_OPERATIONS` | SORO Fleet Operations | tous | `fleet:*`, `asset:*` |
| `NETWORK_MANAGER` | Responsable réseau ZERO'EAU / BARAQ | son réseau (`:assigned`) | `activation:*`, `network:*` |
| `QUALITY_AUDITOR` | Auditeur qualité | tous, lecture seule | `quality:audit` + lectures |

Règles garanties par `src/modules/iam/tests/rbac-matrix.spec.ts` :

- toute permission d'un rôle existe au catalogue et est décrite ;
- les rôles système du seed = `SYSTEM_ROLE_KEYS` (clés refusées pour un rôle personnalisé) ;
- une passerelle (`*:read`, `*:transition`) va toujours avec une portée `:any` ou `:assigned` ;
- aucun rôle de terrain n'a de portée `:any` ;
- candidat, apprenant et entrepreneur n'ont que des droits `:own` (et `academy:learn`) ;
- proposer et décider sont séparés : formateur / responsable Academy (P02-F06),
  chargé / responsable (P01-F05), Financing Officer / direction (P04-F06) ;
- l'auditeur qualité ne peut rien écrire ; `tenant:manage` reste au SUPER_ADMIN.

> Les rôles sont **par tenant** et amorcés par le seed : en production,
> `pnpm db:seed:prod` (idempotent, n'écrase aucun rôle existant) les crée
> dans chaque tenant.

## 4. Ordre des guards globaux

Il est significatif :

1. `TenantThrottlerGuard` — rejeter l'abus **avant** de dépenser du CPU
2. `JwtAuthGuard` — qui es-tu ?
3. `TenantMemberGuard` — es-tu bien dans ce tenant ?
4. `PermissionsGuard` — as-tu le droit d'appeler cette route ?

Tout est protégé par défaut ; on ouvre explicitement avec `@Public()`.
L'inverse — protéger au cas par cas — finit toujours par laisser une route
ouverte par oubli.

## 5. Données personnelles

| Donnée | Traitement |
|---|---|
| Adresse IP | Stockée en SHA-256, jamais en clair |
| E-mail, téléphone, état civil | Expurgés des logs (`redact` Pino) |
| Documents | Jamais servis directement — URL signée 15 min, après contrôle des droits |
| Fichiers déposés | Analyse antivirus avant toute mise à disposition |
| Consentements | Journal immuable, avec copie du libellé affiché |
| Rétention | Purge automatique (`DataRetentionJob`), anonymisation plutôt que suppression |

## 6. En-têtes et transport

`helmet` (HSTS 1 an, `includeSubDomains`, `preload`), CORS validant le
suffixe de domaine pour accepter les sous-domaines de tenants,
`trust proxy` activé pour que la limitation de débit voie la vraie IP client.
