# Notifications e-mail & SMS derrière des ports

> **Un message transactionnel part une fois, dans le bon gabarit du bon
> tenant, quel que soit le fournisseur.** Le code métier publie un job ; il
> ignore SMTP, l'API SMS, le rendu HTML et l'idempotence.

| Élément | Fichier |
|---|---|
| Port e-mail | `src/shared/kernel/ports/mailer.port.ts` (`MailerPort`, `MAILER`) |
| Port SMS | `src/shared/kernel/ports/sms.port.ts` (`SmsPort`, `SMS_SENDER`) |
| Rendu des gabarits (cascade) | `src/infrastructure/mail/template-renderer.service.ts` |
| Adaptateur e-mail SMTP | `src/infrastructure/mail/adapters/smtp-mailer.adapter.ts` |
| Adaptateur e-mail journal | `src/infrastructure/mail/adapters/log-mailer.adapter.ts` |
| Adaptateur SMS journal | `src/infrastructure/sms/adapters/log-sms.adapter.ts` |
| Sélection d'adaptateur par config | `src/infrastructure/mail/mail.module.ts` |
| Envoi + journal + idempotence | `src/modules/notifications/infrastructure/jobs/send-notification.processor.ts` |

---

## 1. Le chemin d'un message

```
Use case métier
  └─ queue.add(QUEUES.NOTIFICATIONS, { channel, templateKey, variables, userId|recipient, locale })

SendNotificationProcessor  (worker, concurrence plafonnée)
  1. résout le destinataire (recipient fourni, sinon email/phoneE164 du user)
  2. IDEMPOTENCE : un envoi identique (recipient + templateKey + MÊME payload)
     déjà SENT/DELIVERED dans les 24 h  →  on ne rejoue pas
  3. écrit une ligne `notifications` (statut QUEUED, payload, attempts)
  4. EMAIL → mailer.send({ to, template, variables, locale })
             l'adaptateur rend le gabarit (canal EMAIL) puis transmet au transport
     SMS   → renderer.render(templateKey, 'SMS', locale, variables)  puis sms.send({ to, body })
  5. succès → notifications.status = SENT (+ providerId, sentAt)
     échec  → notifications.status = FAILED (+ error) ; l'erreur remonte à BullMQ (backoff)
```

Le job ne connaît **ni** le fournisseur **ni** le HTML : il passe des données,
récupère un `providerId`.

## 2. Cascade des gabarits — `tenant → défaut`, par canal

`TemplateRenderer.render(key, channel, locale, variables)` :

1. **gabarit du tenant** — `notification_templates` filtré sur
   `(key, channel, locale, isActive)`. La table porte `tenant_id` et subit
   `FORCE ROW LEVEL SECURITY` : la lecture passe **obligatoirement** par
   `TenantPrismaService` (rempart applicatif + `set_config('app.current_tenant_id')`).
   Avec un `PrismaClient` brut, `app.current_tenant_id` n'est pas posé →
   **0 ligne** → la surcharge du tenant serait ignorée sans erreur. C'était le
   bug corrigé par ce ticket.
2. **gabarit par défaut de la plateforme** — maps `DEFAULT_EMAIL` /
   `DEFAULT_SMS` dans `template-renderer.service.ts`.
3. **repli ultime** — sujet `Sooba Group` (EMAIL) / `''` (SMS), corps `''`.

`channel` fait partie de la clé : le gabarit EMAIL et le gabarit SMS d'une
même `key` sont **deux lignes distinctes**, résolus indépendamment. Un tenant
peut personnaliser l'un sans toucher l'autre.

Interpolation : `{{ variable }}` et chemins pointés `{{ user.firstName }}`.
Une variable absente devient `''` ; un objet est sérialisé en JSON (jamais
`[object Object]`).

## 3. SMS — canal de première classe, pas un repli

- Port **dédié** (`SmsPort`), file de gabarits **dédiée** (`DEFAULT_SMS`, texte
  brut, messages courts), branche **dédiée** dans le processor (`sendSms`).
- Un SMS n'a **pas de sujet** (`subject: ''`).
- Le corps SMS n'est **jamais** dérivé du gabarit e-mail (pas de `striptags`
  sur du HTML). `DEFAULT_SMS['auth.otp']` est écrit à la main :
  `Sooba Group : code {{code}} (valable {{ttlMinutes}} min). Ne le partagez pas.`
- `resolveRecipient` lit `phoneE164` (et non `email`) quand `channel === 'SMS'`.

## 4. Idempotence — le journal `notifications` EST le garde-fou

Avant tout envoi, le processor cherche une notification **identique** déjà
partie :

```ts
where: {
  recipient,
  templateKey: data.templateKey,
  payload: { equals: data.variables },          // ← égalité JSONB, pas juste recipient+template
  status: { in: ['SENT', 'DELIVERED'] },
  createdAt: { gte: <il y a 24 h> },
}
```

- **Le payload compte.** Deux OTP successifs (codes différents) partent tous
  les deux. Un **rejeu du même job** (même code) ne double pas le message.
- Fenêtre **24 h** : au-delà, un même contenu peut légitimement repartir
  (relance).
- Pas de table ni de clé d'idempotence séparée : le journal qu'on écrit de
  toute façon (audit, statut, `providerId`) sert aussi de déduplication.

Statuts : `QUEUED → SENT → DELIVERED` / `FAILED` / `SKIPPED`.

## 5. Changer de fournisseur ne touche aucun code métier

`MAIL_DRIVER` / `SMS_DRIVER` choisissent l'adaptateur **dans `mail.module.ts`**
via `useFactory` ; les `@Inject(MAILER)` / `@Inject(SMS_SENDER)` en aval ne
changent pas.

| Variable | Valeurs (enum Zod) | Défaut si absente | Effet |
|---|---|---|---|
| `MAIL_DRIVER` | `smtp` \| `ses` \| `resend` \| `log` | `log` (le `.env.example` livré force `smtp`) | `log` : `LogMailerAdapter` — rend le gabarit, journalise, `providerId` `log-…`. Aucun serveur SMTP requis (dev, tests, CI). `ses`/`resend` : acceptés par Zod mais pas encore implémentés → warning + repli `smtp`. |
| `SMS_DRIVER` | `twilio` \| `orange` \| `log` | `log` | `LogSmsAdapter` — journalise, `providerId` `log-…`. `twilio`/`orange` : pas encore implémentés → warning + repli `log`. |

Une valeur acceptée par l'enum mais non câblée → warning au démarrage + repli
sur l'adaptateur sûr (`smtp` pour l'e-mail, `log` pour le SMS), jamais un
crash silencieux.

Ajouter un vrai fournisseur SMS :

1. `class TwilioSmsAdapter implements SmsPort` dans `src/infrastructure/sms/adapters/`.
2. Le déclarer dans `mail.module.ts` + une branche `case 'twilio'` dans la factory `SMS_SENDER`.
3. Étendre l'enum `SMS_DRIVER` dans `src/config/env.schema.ts`.
4. Zéro ligne touchée dans `src/modules/**`.

## 6. Surface des ports

```ts
interface MailerPort { send(m: MailMessage): Promise<{ providerId: string }>; }
// MailMessage : { to, template, variables, locale?, subject?, replyTo?, attachments? }
//   subject est OPTIONNEL : s'il est absent, c'est le sujet résolu par le gabarit qui s'applique.

interface SmsPort  { send(m: { to: string; body: string }): Promise<{ providerId: string }>; }
//   body déjà rendu — le SMS n'a pas d'adaptateur de templating.
```

L'adaptateur e-mail rend le gabarit lui-même (il reçoit `template` +
`variables`) ; le processor lui laisse ce soin. Le SMS est rendu par le
processor puis passé « prêt à émettre ». Cette asymétrie est volontaire :
elle garde `MailMessage` compatible avec les appelants existants
(`auth.service`, `subscribe-newsletter.usecase`) sans big-bang.

## 7. Configuration

| Variable | Défaut | Rôle |
|---|---|---|
| `MAIL_DRIVER` | `log` | `smtp` \| `ses` \| `resend` \| `log` (`.env.example` : `smtp`) |
| `MAIL_FROM` | — | expéditeur par défaut |
| `MAIL_SMTP_HOST` / `MAIL_SMTP_PORT` | — | serveur SMTP (driver `smtp`) |
| `SMS_DRIVER` | `log` | `twilio` \| `orange` \| `log` (seul `log` câblé) |

## 8. Checklist de revue

- [ ] Un nouvel envoi → un job sur `QUEUES.NOTIFICATIONS`, **jamais** un appel
      `mailer`/`sms` direct depuis un use case.
- [ ] Toute lecture de `notification_templates` passe par `TenantPrismaService`
      (`.client`), **jamais** `PrismaService` brut.
- [ ] Un nouveau gabarit par défaut est ajouté aux **deux** maps si le message
      a un sens en SMS (`DEFAULT_EMAIL` **et** `DEFAULT_SMS`).
- [ ] Le `where` d'idempotence garde `payload: { equals: … }` — ne jamais
      revenir à `recipient + templateKey` seuls.
- [ ] Un nouveau fournisseur = un adaptateur + une branche de factory + l'enum
      d'env. Aucun `import` d'un SDK fournisseur hors de `src/infrastructure/`.

## 9. Où c'est testé

| Aspect | Test |
|---|---|
| Cascade `tenant → défaut` (EMAIL + SMS), canal dans la clé, repli, interpolation, JSON, chemin pointé | `src/infrastructure/tests/template-renderer.service.spec.ts` |
| SMTP rend le gabarit (canal EMAIL) + `providerId` ; `subject` explicite prioritaire ; `LogMailerAdapter` / `LogSmsAdapter` renvoient un `providerId` simulé | `src/infrastructure/tests/mail-sms-adapters.spec.ts` |
| E-mail via adaptateur + journal ; **SMS première classe** (rendu SMS + `sms.send`) ; idempotence **payload-aware** ; rejeu 24 h bloqué ; destinataire depuis le profil ; `NO_RECIPIENT` ; `FAILED` + rethrow | `src/modules/notifications/tests/send-notification.processor.spec.ts` |
| **Cascade réellement prise contre un vrai Postgres + RLS** : gabarit tenant prioritaire (EMAIL + SMS), tenant sans surcharge → défaut, un tenant ne voit jamais le gabarit d'un autre | `test/integration/notifications.spec.ts` |

Voir aussi : [docs/11-tenant-isolation.md](11-tenant-isolation.md) (les deux
remparts), [docs/13-queues-workers.md](13-queues-workers.md) (files & workers).

> Le résumé express `resume-notifications.md` que la plupart des fiches de
> cette série possèdent n'a pas été écrit. Reste à produire.
