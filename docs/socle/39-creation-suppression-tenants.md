# Création et suppression des organisations (tenants) — SUPER_ADMIN

Complète BSG-13 (liste, détail, modification). Règle produit : **un pays = un
tenant** (`sooba-group` pour le Sénégal, `sooba-maroc`, `sooba-gambie`…).

| Route | Rôle | Effet |
| --- | --- | --- |
| `POST /v1/admin/tenants` | SUPER_ADMIN | Crée une organisation et rattache ses pays |
| `GET /v1/admin/tenants/:id/deletion-check` | SUPER_ADMIN | Dit si l'organisation est supprimable et ce qui bloque |
| `DELETE /v1/admin/tenants/:id?confirm=<slug>` | SUPER_ADMIN | Supprime **définitivement** une organisation sans données |

Protection par **rôle** (`@RequireRoles('SUPER_ADMIN')`), comme le reste du
contrôleur : la permission `tenant:manage` n'est vérifiée nulle part.

## Création

Corps (liste blanche stricte, tout autre champ → 400) :

```json
{
  "slug": "sooba-cote-ivoire",
  "name": "Sooba Group Côte d’Ivoire",
  "defaultCountry": "CI",
  "countries": ["BF"],
  "defaultLocale": "fr",
  "status": "SUSPENDED",
  "featureFlags": { "simulator": true, "academy": false }
}
```

- `slug` : sous-domaine, **immuable**, 3–63 caractères `a-z 0-9 -`, sans tiret
  en tête, en fin ni doublé. Mots réservés refusés (`www`, `api`, `admin`,
  `backoffice`…). Un slug ne se recycle pas, même après archivage.
- `defaultCurrency` : par défaut la devise du pays (`countries.currency_code`).
- `timezone` : par défaut le fuseau connu du pays (`COUNTRY_DEFAULT_TIMEZONES`) ;
  obligatoire pour un pays hors de cette table.
- `status` : `ACTIVE` (défaut) ou `SUSPENDED` pour préparer une ouverture.
- Aucune donnée métier n'est provisionnée (consentements, pièces, contenus) :
  elles se saisissent au back-office, ou via le seed pour les marchés connus.

Trace : `audit_logs.action = 'tenant.created'` dans le tenant **créé**.

Erreurs 422 : `TENANT_SLUG_TAKEN`, `TENANT_INVALID` (slug, pays inactif, devise
inconnue, fuseau manquant ou invalide, plus de 20 pays).

## Suppression

Une organisation n'est supprimable que si elle **n'a aucune donnée**. Sinon on
l'archive : `PATCH /v1/admin/tenants/:id { "status": "ARCHIVED" }`.

« Données » = toute ligne, pour ce tenant, dans une table `public` portant une
colonne `tenant_id` — liste lue dans le **catalogue Postgres**, comme le fait
`prisma/sql/rls-policies.sql`. Une table ajoutée demain (Academy, Process 03 à
08) est donc prise en compte sans modifier ce code.

Exceptions (`TENANT_TECHNICAL_TABLES`) :

| Table | Bloque ? | Sort |
| --- | --- | --- |
| `tenant_countries`, `tenant_domains` | non | supprimées avec le tenant (paramétrage) |
| `idempotency_keys`, `outbox_messages`, `auth_challenges` | non | supprimées (technique) |
| `audit_logs` | non | **conservées** (pas de clé étrangère) |

Déroulé, dans **une** transaction `$privileged()` (15 s) :

1. `SELECT … FROM tenants WHERE id = :id FOR UPDATE` — la création concurrente
   d'un compte (clé étrangère `users → tenants`) attend ce verrou puis échoue ;
2. préconditions : pas l'organisation de sa session (`TENANT_SELF_DELETE`),
   `confirm` égal au slug (`TENANT_DELETE_CONFIRMATION`), aucune donnée
   (`TENANT_HAS_DATA`, la réponse liste `details.tables`) ;
3. purge des tables techniques, `DELETE FROM tenants` ;
4. `audit_logs.action = 'tenant.deleted'` dans le tenant de **l'appelant**.

Après la transaction : invalidation du cache de l'annuaire (id, slug, domaines).

## Prérequis base de données

Le rôle applicatif `sooba_app` doit pouvoir écrire `tenants` en `$privileged`
(branche `fix/rls-ecriture-registre-tenants`, rejouer `pnpm db:rls`). Sans ce
correctif, `PATCH`, `POST` et `DELETE` échouent en 500
« permission denied for table tenants ».
