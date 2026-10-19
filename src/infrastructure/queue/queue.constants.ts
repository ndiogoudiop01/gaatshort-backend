/**
 * Une file par domaine de préoccupation, avec des priorités distinctes :
 * un envoi d'e-mail massif ne doit jamais retarder une notification
 * transactionnelle « paiement confirmé, crédits ajoutés ».
 */
export const QUEUES = {
  OUTBOX: 'outbox',            // relais des événements de domaine
  NOTIFICATIONS: 'notifications',
  DOCUMENTS: 'documents',      // antivirus, extraction de métadonnées, vignettes
  ANALYTICS: 'analytics',      // ingestion d'événements + agrégats
  EXPORTS: 'exports',          // exports RGPD, rapports de reversement
  MAINTENANCE: 'maintenance',  // purges, rétention, rotation de partitions
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export const JOBS = {
  OUTBOX_RELAY: 'outbox.relay',
  SEND_NOTIFICATION: 'notification.send',
  INGEST_ANALYTICS_EVENT: 'analytics.ingest',
  ROLLUP_METRICS: 'analytics.rollup',
  EXPORT_GDPR_BUNDLE: 'export.gdpr-bundle',
  PURGE_EXPIRED_DATA: 'maintenance.purge',
  ROTATE_PARTITIONS: 'maintenance.rotate-partitions',
} as const;

/**
 * Options par défaut de TOUS les jobs, câblées à la racine de BullMQ
 * (`queue.module.ts`) : chaque `queue.add(...)` en hérite sans rien répéter.
 *   - `attempts` + `backoff exponential` : le critère « réessai en backoff
 *     exponentiel ». 5 tentatives, délai 2 s → 2 s, 4 s, 8 s, 16 s.
 *   - `removeOn*` : on garde les échecs 7 jours (post-mortem), les succès 1 h.
 */
export const DEFAULT_JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: 'exponential' as const, delay: 2_000 },
  removeOnComplete: { age: 3_600, count: 1_000 },
  removeOnFail: { age: 7 * 24 * 3_600 },
};

/**
 * Priorité par file (BullMQ : 1 = la plus haute, plus le nombre est grand,
 * plus c'est bas). Posée en `defaultJobOptions` de chaque file dans
 * `queue.module.ts`. Ordonne les jobs À L'INTÉRIEUR d'une file (utile quand
 * une file porte du transactionnel ET du bulk) et matérialise l'intention.
 * Entre files, la priorité effective vient AUSSI de la concurrence ci-dessous
 * et du nombre de replicas worker par file au déploiement (cf. docs/13).
 */
export const QUEUE_PRIORITY: Record<QueueName, number> = {
  [QUEUES.OUTBOX]: 1, // le relais alimente tout le reste
  [QUEUES.NOTIFICATIONS]: 2, // transactionnel : « paiement confirmé, crédits ajoutés »
  [QUEUES.DOCUMENTS]: 4, // antivirus : bloque la validation d'une pièce
  [QUEUES.ANALYTICS]: 6, // agrégats : tolère du retard
  [QUEUES.EXPORTS]: 8, // exports RGPD et rapports : longs, jamais urgents
  [QUEUES.MAINTENANCE]: 9, // purges, rotation de partitions : la nuit
};

/**
 * Concurrence par file (nombre de jobs traités en parallèle par un worker).
 * Source unique : les `@Processor` lisent `QUEUE_CONCURRENCY[QUEUES.X]`.
 */
export const QUEUE_CONCURRENCY: Record<QueueName, number> = {
  [QUEUES.OUTBOX]: 1, // relais sérialisé (verrou distribué en amont)
  [QUEUES.NOTIFICATIONS]: 10, // plafonné par le débit du fournisseur d'e-mail
  [QUEUES.DOCUMENTS]: 3, // l'analyse antivirus est coûteuse
  [QUEUES.ANALYTICS]: 8,
  [QUEUES.EXPORTS]: 2, // gros, gourmand en mémoire
  [QUEUES.MAINTENANCE]: 2,
};
