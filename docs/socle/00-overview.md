# Vue d'ensemble

## Le système en une page

```
                    ┌─────────────────────────────────────────┐
   Navigateur ─────▶│  CDN / WAF  (contenus publics en cache) │
                    └──────────────────┬──────────────────────┘
                                       ▼
                    ┌─────────────────────────────────────────┐
                    │       Load balancer / Ingress           │
                    └──────────────────┬──────────────────────┘
                     ┌─────────────────┴─────────────────┐
                     ▼                                   ▼
        ┌───────────────────────┐            ┌───────────────────────┐
        │   API  (N instances)  │            │ Workers (M instances) │
        │  main.ts              │            │  worker.main.ts       │
        │  ─ middleware tenant  │            │  ─ contexte restauré  │
        │  ─ guards             │            │    depuis le job      │
        │  ─ contrôleurs        │            │  ─ processors BullMQ  │
        └───┬─────────┬─────────┘            └────┬────────┬─────────┘
            │         │                            │        │
            │         └────────┐         ┌─────────┘        │
            ▼                  ▼         ▼                  ▼
    ┌──────────────┐   ┌──────────────────────┐    ┌────────────────┐
    │ PostgreSQL   │   │       Redis          │    │   S3 / MinIO   │
    │ + RLS        │   │ cache · files ·      │    │ documents,     │
    │ (+ réplique) │   │ verrous · quotas     │    │ exports        │
    └──────────────┘   └──────────────────────┘    └────────────────┘
            ▲
            │  outbox_messages  ──▶ relais (toutes les 5 s) ──▶ files BullMQ
            └──────────────────────────────────────────────────────────────
```

## Le chemin d'une requête

```
1. Middleware tenant   résout le tenant (JWT > sous-domaine > en-tête)
                       ouvre le contexte AsyncLocalStorage
2. Throttler           quota par tenant:utilisateur
3. JwtAuthGuard        authentifie (ou @Public)
4. TenantMemberGuard   le tenant du token == celui de la requête ?
5. PermissionsGuard    RBAC de route
6. ValidationPipe      DTO (class-validator) ou schéma Zod
7. Idempotency         rejoue la réponse si la clé est déjà connue
8. Contrôleur          valide, délègue
9. Cas d'usage         ouvre l'Unit of Work, orchestre le domaine
10. Domaine            DÉCIDE — invariants, machine à états, calculs
11. Repository         SQL scopé (extension Prisma) + SET LOCAL (RLS)
12. Outbox             événements écrits DANS la transaction
13. COMMIT
14. Relais outbox      publie sur BullMQ (au moins une fois)
15. Workers            e-mails, scoring, analytics, exports — idempotents
16. Intercepteur       enveloppe la réponse { success, data, requestId }
```

## Le chemin d'un événement

```
Application.preselect()
   └─▶ record(ApplicationPreselectedEvent)
        └─▶ tx.collect(aggregate)          [dans la transaction]
             └─▶ INSERT outbox_messages    [même transaction — atomique]
                  └─▶ COMMIT
                       └─▶ OutboxRelayJob (5 s, verrou distribué)
                            └─▶ BullMQ, jobId = id outbox (dédoublonnage)
                                 ├─▶ talent-pool  : crée la fiche vivier
                                 ├─▶ notifications: e-mail au candidat
                                 └─▶ analytics    : incrémente l'entonnoir
```

Aucun événement perdu, aucun e-mail envoyé pour une transaction avortée.
En contrepartie, la livraison est « au moins une fois » : **tout consommateur
doit être idempotent**. C'est la règle, pas une recommandation.
