# Modèle de données

Source de vérité : [`prisma/schema.prisma`](../prisma/schema.prisma).
Ce document en donne la lecture et les règles transverses.

## Règles applicables à toute nouvelle table

1. **`tenantId` obligatoire** sur toute table métier, plus une politique RLS
   déclarée dans `prisma/sql/rls-policies.sql`.
   **Seules exceptions — les référentiels globaux**, sans `tenantId` ni RLS, en
   lecture seule pour l'application : `currencies`, `countries`, `permissions`,
   `role_permissions` et `tenants` (le registre lui-même). `permissions` /
   `role_permissions` : le catalogue RBAC est figé et le câblage des rôles
   système est identique pour tous les tenants ; une ligne `role_permissions`
   n'est atteignable que via un `role_id` déjà protégé par RLS. Toute **autre**
   table sans `tenantId` est un défaut à corriger.
2. **Unicité préfixée par le tenant** : `@@unique([tenantId, slug])`, jamais
   `@@unique([slug])`.
3. **Index de lecture préfixés par le tenant** : `@@index([tenantId, status, createdAt])`.
   Un index qui ne commence pas par `tenantId` est presque toujours inutile ici.
4. **Suppression logique** (`deletedAt`) sur les agrégats métier — la
   traçabilité prime, et le RGPD se traite par anonymisation.
5. **Montants en unité mineure** (`BigInt`), jamais en flottant.
   ⚠️ `BigInt` n'est pas sérialisable en JSON : convertir en chaîne dans le mapper.
6. **Enums de workflow** dupliquées entre Prisma et le domaine — la **source
   de vérité est le domaine**, la base ne fait qu'enregistrer un état atteint.

## Les huit groupes de tables

| Groupe | Tables | US |
|---|---|---|
| **Tenancy** | `tenants`, `tenant_domains`, `tenant_countries` | socle |
| **IAM** | `users`, `roles`, `permissions`, `role_permissions`, `user_roles`, `auth_sessions`, `auth_challenges`, `audit_logs` | 007 |
| **Contenu** | `pages`, `content_blocks`, `process_steps`, `ecosystem_entities`, `roadmap_phases`, `news_articles` | 001, 002, 004, 020, 030 |
| **Catalogue** | `activity_categories`, `activities`, `activity_zones` | 003, 026 |
| **Simulation** | `simulation_configs`, `simulation_runs` | 005, 027 |
| **Candidatures** | `applications`, `application_status_history`, `application_notes`, `document_requirements`, `stored_files`, `application_documents`, `interviews`, `pool_candidates` | 006, 008–012, 023, 024 |
| **Partenaires** | `partner_leads`, `partner_attachments`, `partner_interactions`, `partner_stage_history` | 013–019, 025 |
| **Transverse** | `newsletter_subscribers`, `consent_definitions`, `consent_records`, `data_subject_requests`, `analytics_events`, `metric_snapshots`, `notification_templates`, `notifications`, `outbox_messages`, `idempotency_keys` | 021, 022, 028 |

## Trois choix de modélisation à connaître

### 1. `partner_leads.profile` en JSONB

Cinq typologies, cinq formulaires très différents (US-016 → 019), mais **un
seul pipeline commercial** (US-025). Cinq tables auraient éclaté le CRM ;
soixante colonnes nullables auraient rendu toute cohérence impossible.

Le JSONB est validé par une **union Zod discriminée** sur `type`, indexé en
GIN pour rester filtrable. Ajouter une sixième typologie = ajouter un schéma.

### 2. `simulation_configs` versionné

On ne modifie **jamais** une version publiée : on en publie une nouvelle.
Une simulation archivée avec une candidature doit rester reproductible à
l'identique, y compris trois ans plus tard en cas de contestation.

### 3. `consent_records` en journal immuable

Retirer un consentement écrit une **nouvelle** ligne `granted = false`.
Chaque enregistrement conserve le libellé exact affiché et sa version :
« nous avions modifié le texte depuis » n'est pas une défense recevable.

## Index remarquables

| Index | Sert |
|---|---|
| `applications_open_idx` (partiel) | Le CRM ne balaye pas les dossiers clos |
| `applications_search_trgm` | Recherche tolérante aux accents (« Sénégal » ≡ « Senegal ») |
| `pool_candidates_segments_gin` | Segmentation multi-critères du vivier |
| `partner_leads_profile_gin` | Filtres sur les champs typologiques |
| `outbox_pending_idx` (partiel) | Le relais ne scanne que le backlog |

## Migrations

```bash
pnpm db:migrate           # développement UNIQUEMENT (prisma migrate dev)
pnpm db:migrate:deploy    # base vierge : CI, recette, production, onboarding
pnpm db:rls               # rejouer les politiques RLS — idempotent
```

> **`pnpm db:migrate` (`prisma migrate dev`) est réservé au travail de schéma en
> local.** Il exige une *shadow database* (droit `CREATEDB` sur le rôle de
> connexion) et devient **interactif** au moindre écart de schéma. Pour
> reconstruire une base à partir de zéro — CI, onboarding, recette — utiliser
> **`pnpm db:migrate:deploy`**, qui applique les migrations committées sans
> prompt ni shadow DB. Le dossier `prisma/migrations/` est versionné : c'est la
> source de vérité, `schema.prisma` seul ne suffit pas à créer la base.

> **Après chaque `migrate deploy`, rejouer `db:rls`.** Une nouvelle table
> sans politique est une table lisible par tous les tenants. C'est intégré
> au pipeline CI, ne pas le contourner en déploiement manuel.
>
> Ordre imposé : `db:migrate:deploy` → `db:rls` → `db:seed`. Le seed tourne
> **avant** que la RLS ne soit forcée, *ou* avec un rôle super-utilisateur
> (`postgres` / `sooba`) qui la contourne — sinon `FORCE ROW LEVEL SECURITY`
> rejette chaque `INSERT` tenant du seed, faute de `app.current_tenant_id`.
