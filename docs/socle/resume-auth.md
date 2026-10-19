# Résumé express — Authentification sans mot de passe

*À lire en 5 min. Détail complet : [docs/03-security-rbac.md](03-security-rbac.md).*

---

## En une phrase

Un candidat crée son compte **en se connectant**, jamais en s'inscrivant :
il demande un lien magique ou un code (`/auth/challenge`), le saisit
(`/auth/verify`), et le compte existe déjà à ce moment-là s'il n'existait pas.

## Les 4 étapes

```
1. POST /auth/challenge  { channel, identifier }
   → un secret (code 6 chiffres ou jeton de lien) est généré, HACHÉ (HMAC-SHA256),
     stocké ; le secret EN CLAIR part par e-mail ou SMS.
   → réponse : { sent: true } — TOUJOURS, même si l'identifiant n'existe pas.

2. POST /auth/verify  { identifier, secret }
   → compare le secret au hash (temps constant) ; échec = code CHALLENGE_INVALID,
     que le défi n'existe pas OU que le secret soit faux (même réponse).
   → succès : compte créé s'il n'existait pas, session ouverte.
   → réponse : { accessToken, refreshToken, expiresIn }

3. POST /auth/refresh  { refreshToken }
   → fait tourner le refresh token : l'ancien est révoqué, un nouveau est émis.
   → si l'ancien (déjà révoqué) revient : TOUTE la famille de sessions est
     révoquée d'un coup — c'est la signature d'un vol de token.

4. POST /auth/logout  (Bearer <accessToken>)
   → révoque la session en base. Le prochain appel avec CE access token
     échoue immédiatement (JwtStrategy vérifie la session à chaque requête).
```

## Les 5 règles à ne jamais casser

1. **`/auth/challenge` répond toujours pareil.** Ne jamais faire
   `if (!user) return 404` — ça dit à un attaquant qui est inscrit.

2. **Un seul algorithme de hachage pour tous les secrets : `TokenHasher`
   (HMAC-SHA256 + comparaison à temps constant).** OTP, lien magique, refresh
   token — jamais de `crypto.createHash` à la main ailleurs dans le module IAM.

3. **`TokenHasher` utilise `auth.refreshSecret`, pas `auth.accessSecret`.**
   Le premier signe les JWT, le second hache les secrets stockés — deux clés,
   deux rôles, deux cycles de rotation. Ne jamais les fusionner.

4. **Le rejeu d'un refresh token déjà consommé n'est jamais traité comme un
   simple échec.** C'est un signal de compromission : toute la famille de
   sessions est révoquée (`SESSION_REVOKED`), pas seulement ce token.

5. **`JwtStrategy` vérifie la session en base à chaque requête, `tid` du JWT
   contre le tenant résolu à chaque requête.** Un access token n'est jamais
   « juste vérifié cryptographiquement » — la révocation et l'étanchéité
   tenant passent par une requête, pas seulement par la signature.

## Où ça vit

```
src/modules/iam/application/services/auth.service.ts       les 4 étapes
src/modules/iam/domain/services/auth-challenge.service.ts   règles de validité d'un défi (pure, sans I/O)
src/modules/iam/infrastructure/jwt.strategy.ts              validation JWT + session vivante
src/modules/iam/presentation/http/auth.controller.ts        endpoints + quotas
src/infrastructure/security/token-hasher.service.ts         HMAC-SHA256 + comparaison à temps constant
src/shared/guards/tenant-member.guard.ts                    tid du JWT == tenant de la requête
```

## Tests

```bash
npx jest src/modules/iam/tests/auth.service.spec.ts \
         src/modules/iam/tests/auth-challenge.service.spec.ts \
         src/modules/iam/tests/jwt.strategy.spec.ts \
         src/modules/iam/tests/auth.controller.spec.ts \
         src/infrastructure/tests/token-hasher.service.spec.ts
```
