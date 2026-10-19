import type { PrismaClient } from '@prisma/client';

/**
 * Matrice RBAC.
 *
 * On raisonne en PERMISSIONS granulaires, pas en rôles : un rôle est un
 * simple paquet de permissions. Créer « Gestionnaire régional » demain ne
 * touche donc aucun contrôleur — seulement cette table.
 *
 * Noter la distinction `:any` / `:assigned` : un gestionnaire ne voit que
 * les dossiers qui lui sont attribués, un administrateur voit tout.
 */
export const PERMISSIONS = [
  // Candidatures
  ['application:read:own', 'application', 'read:own'],
  ['application:write:own', 'application', 'write:own'],
  // Permissions « passerelle » : ouvrent le contrôleur (RBAC). La portée
  // réelle sur LA ressource (:any vs :assigned) est tranchée ensuite par
  // ApplicationAccessPolicy (ABAC) — cf. docs/03-security-rbac.md §2.
  ['application:read', 'application', 'read'],
  ['application:read:any', 'application', 'read:any'],
  ['application:read:assigned', 'application', 'read:assigned'],
  ['application:transition', 'application', 'transition'],
  ['application:transition:any', 'application', 'transition:any'],
  ['application:transition:assigned', 'application', 'transition:assigned'],
  ['application:preselect', 'application', 'preselect'],
  ['application:assign', 'application', 'assign'],
  ['application:note:write', 'application', 'note:write'],
  // Entretiens & pièces
  ['interview:schedule', 'interview', 'schedule'],
  ['interview:complete', 'interview', 'complete'],
  ['document:review', 'document', 'review'],
  // Vivier
  ['pool:read', 'pool', 'read'],
  ['pool:export', 'pool', 'export'],
  // Partenaires
  ['partner:read', 'partner', 'read'],
  ['partner:write', 'partner', 'write'],
  ['partner:transition', 'partner', 'transition'],
  // Catalogue & simulateur
  ['activity:write', 'activity', 'write'],
  ['activity:publish', 'activity', 'publish'],
  ['simulation:config:read', 'simulation', 'config:read'],
  ['simulation:config:write', 'simulation', 'config:write'],
  // Contenus & pilotage
  ['content:write', 'content', 'write'],
  ['news:write', 'news', 'write'],
  ['metrics:read', 'metrics', 'read'],
  ['tenant:manage', 'tenant', 'manage'],
  ['user:manage', 'user', 'manage'],

  // ── Process 01 — admission (au-delà de la présélection) ──────────────────
  ['application:prequalify', 'application', 'prequalify'],
  ['application:admit', 'application', 'admit'],
  ['application:redflag:review', 'application', 'redflag:review'],

  // ── Dossier entrepreneur unique (Impact ID, frise P01 → P08) ─────────────
  ['entrepreneur:read:own', 'entrepreneur', 'read:own'],
  ['entrepreneur:read', 'entrepreneur', 'read'],
  ['entrepreneur:read:any', 'entrepreneur', 'read:any'],
  ['entrepreneur:read:assigned', 'entrepreneur', 'read:assigned'],

  // ── Suivi transverse : tâches, SLA, seuils, contrôle qualité ─────────────
  ['task:read', 'task', 'read'],
  ['task:manage', 'task', 'manage'],
  ['threshold:write', 'threshold', 'write'],
  ['quality:audit', 'quality', 'audit'],

  // ── Process 02 — Impact Academy ──────────────────────────────────────────
  ['academy:learn', 'academy', 'learn'],
  ['academy:program:read', 'academy', 'program:read'],
  ['academy:program:write', 'academy', 'program:write'],
  ['academy:program:publish', 'academy', 'program:publish'],
  ['academy:lesson:write', 'academy', 'lesson:write'],
  ['academy:cohort:write', 'academy', 'cohort:write'],
  ['academy:schedule:write', 'academy', 'schedule:write'],
  ['academy:learner:read', 'academy', 'learner:read'],
  ['academy:learner:read:any', 'academy', 'learner:read:any'],
  ['academy:learner:read:assigned', 'academy', 'learner:read:assigned'],
  ['academy:attendance:write', 'academy', 'attendance:write'],
  ['academy:assessment:write', 'academy', 'assessment:write'],
  ['academy:assessment:grade', 'academy', 'assessment:grade'],
  ['academy:decision:propose', 'academy', 'decision:propose'],
  ['academy:certification:decide', 'academy', 'certification:decide'],
  ['academy:certificate:revoke', 'academy', 'certificate:revoke'],
  ['academy:trainer:manage', 'academy', 'trainer:manage'],
  ['academy:metrics:read', 'academy', 'metrics:read'],

  // ── Process 03 — formalisation ───────────────────────────────────────────
  ['formalization:read', 'formalization', 'read'],
  ['formalization:write', 'formalization', 'write'],
  ['formalization:validate', 'formalization', 'validate'],
  ['country-rules:write', 'country-rules', 'write'],

  // ── Process 04 — financement ─────────────────────────────────────────────
  ['financing:read', 'financing', 'read'],
  ['financing:write', 'financing', 'write'],
  ['financing:agreement:write', 'financing', 'agreement:write'],
  ['financing:purchase:authorize', 'financing', 'purchase:authorize'],

  // ── Process 05 & 07 — SORO : mise en service et cycle de vie de l'actif ──
  ['fleet:read', 'fleet', 'read'],
  ['fleet:write', 'fleet', 'write'],
  ['asset:read', 'asset', 'read'],
  ['asset:write', 'asset', 'write'],
  ['asset:incident:report:own', 'asset', 'incident:report:own'],

  // ── Process 06 & 08 — activation et exploitation du réseau ───────────────
  ['activation:read', 'activation', 'read'],
  ['activation:write', 'activation', 'write'],
  ['network:read', 'network', 'read'],
  ['network:write', 'network', 'write'],
  ['performance:read:own', 'performance', 'read:own'],
] as const;

/**
 * BSG-12 — libellé de chaque permission, renvoyé par `GET /admin/permissions`
 * et affiché par la matrice du back-office (qui ne l'invente pas).
 */
export const DESCRIPTIONS: Record<string, string> = {
  'application:read:own': 'Lire sa propre candidature',
  'application:write:own': 'Rédiger et déposer sa propre candidature',
  'application:read': 'Ouvrir le CRM des candidatures (passerelle)',
  'application:read:any': 'Lire toutes les candidatures',
  'application:read:assigned': 'Lire les candidatures qui lui sont assignées',
  'application:transition': 'Changer le statut d’une candidature (passerelle)',
  'application:transition:any': 'Changer le statut de toute candidature',
  'application:transition:assigned': 'Changer le statut des candidatures assignées',
  'application:preselect': 'Présélectionner une candidature (entrée au vivier)',
  'application:assign': 'Attribuer une candidature à un gestionnaire',
  'application:note:write': 'Écrire des notes internes sur un dossier',
  'interview:schedule': 'Planifier des entretiens',
  'interview:complete': 'Clore un entretien',
  'document:review': 'Valider ou refuser les pièces justificatives',
  'pool:read': 'Consulter le vivier d’entrepreneurs',
  'pool:export': 'Exporter le vivier en CSV',
  'partner:read': 'Consulter les partenaires',
  'partner:write': 'Créer et modifier les partenaires',
  'partner:transition': 'Faire avancer un partenaire dans le pipeline',
  'activity:write': 'Rédiger les activités du catalogue',
  'activity:publish': 'Publier ou retirer une activité',
  'simulation:config:read': 'Consulter les barèmes du simulateur',
  'simulation:config:write': 'Modifier les barèmes du simulateur',
  'content:write': 'Modifier les pages et envoyer la newsletter',
  'news:write': 'Rédiger et publier les actualités',
  'metrics:read': 'Consulter le tableau de bord',
  'tenant:manage': 'Administrer l’organisation (non vérifiée par l’API : routes réservées au SUPER_ADMIN)',
  'user:manage': 'Gérer les comptes, rôles et permissions',
  'application:prequalify': 'Préqualifier une candidature (fiche P01-F02)',
  'application:admit': 'Prononcer la décision d’admission (P01-F05) — validation du responsable',
  'application:redflag:review': 'Lever ou confirmer un red flag critique (revue managériale)',
  'entrepreneur:read:own': 'Consulter son propre dossier et sa frise de parcours',
  'entrepreneur:read': 'Ouvrir les dossiers entrepreneurs (passerelle)',
  'entrepreneur:read:any': 'Lire tous les dossiers entrepreneurs',
  'entrepreneur:read:assigned': 'Lire les dossiers entrepreneurs qui lui sont assignés',
  'task:read': 'Consulter ses actions du jour et les dépassements de SLA',
  'task:manage': 'Créer, réattribuer et clore les tâches de suivi',
  'threshold:write': 'Modifier les seuils versionnés (scores, certification, alertes)',
  'quality:audit': 'Conduire les campagnes de contrôle qualité (lecture seule des dossiers)',
  'academy:learn': 'Suivre sa formation : emploi du temps, cours, examens, certificat',
  'academy:program:read': 'Consulter les programmes de formation',
  'academy:program:write': 'Rédiger les programmes, blocs et modules',
  'academy:program:publish': 'Publier une version de programme ou un support de cours',
  'academy:lesson:write': 'Proposer des supports de cours (soumis à validation)',
  'academy:cohort:write': 'Créer les cohortes et gérer les inscriptions',
  'academy:schedule:write': 'Planifier les séances, salles et intervenants',
  'academy:learner:read': 'Ouvrir le suivi des apprenants (passerelle)',
  'academy:learner:read:any': 'Lire tous les apprenants',
  'academy:learner:read:assigned': 'Lire les apprenants de ses cohortes',
  'academy:attendance:write': 'Faire l’appel et traiter les justificatifs',
  'academy:assessment:write': 'Rédiger les questions et programmer les évaluations',
  'academy:assessment:grade': 'Saisir le diagnostic, les grilles et les notes',
  'academy:decision:propose': 'Proposer une décision de certification',
  'academy:certification:decide': 'Certifier, programmer un rattrapage ou reporter',
  'academy:certificate:revoke': 'Révoquer un certificat',
  'academy:trainer:manage': 'Gérer les fiches formateurs et leurs disponibilités',
  'academy:metrics:read': 'Consulter les indicateurs de l’Academy',
  'formalization:read': 'Consulter les dossiers de formalisation',
  'formalization:write': 'Instruire un dossier de formalisation',
  'formalization:validate': 'Valider une formalisation et transmettre au financement',
  'country-rules:write': 'Maintenir le référentiel juridique et documentaire d’un pays',
  'financing:read': 'Consulter les dossiers de financement',
  'financing:write': 'Instruire un dossier de financement (orientation, soumissions, décisions)',
  'financing:agreement:write': 'Gérer les conventions financeurs',
  'financing:purchase:authorize': 'Autoriser l’ordre de commande après sécurisation du financement',
  'fleet:read': 'Consulter les commandes et mises en service SORO',
  'fleet:write': 'Piloter commande, réception, livraison et activation d’un outil',
  'asset:read': 'Consulter le parc d’actifs SORO',
  'asset:write': 'Gérer maintenance, incidents, assurance, GPS et publicité d’un actif',
  'asset:incident:report:own': 'Signaler un incident sur son propre outil',
  'activation:read': 'Consulter le suivi d’activation J0–J90',
  'activation:write': 'Saisir les checks J+7/J+30/J+90 et les plans d’amélioration',
  'network:read': 'Consulter la performance du réseau',
  'network:write': 'Qualifier les alertes, plans correctifs et revues trimestrielles',
  'performance:read:own': 'Consulter son propre tableau de bord d’activité',
};

/**
 * Rôles système. Les cinq premiers existaient (BSG-12) ; les suivants
 * outillent l'Academy et les Process 01 à 08 (note de cadrage).
 *
 * Mêmes règles que pour MANAGER : un rôle « de terrain » reçoit la variante
 * `:assigned`, jamais `:any`, sinon le contrôle ABAC devient un no-op ; et
 * aucun rôle ne cumule « proposer » et « décider » quand le dossier exige
 * une validation par un responsable (P01-F05, P02-F06, P04-F06).
 */
export const ROLES: Record<string, string[]> = {
  CANDIDATE: ['application:read:own', 'application:write:own', 'entrepreneur:read:own'],
  PARTNER: [],
  // Un gestionnaire ne voit et ne fait transitionner QUE les dossiers qui
  // lui sont assignés : il n'a jamais les variantes `:any` — sinon le
  // contrôle ABAC de ApplicationAccessPolicy devient un no-op pour lui.
  MANAGER: [
    'application:read', 'application:read:assigned',
    'application:transition', 'application:transition:assigned',
    'application:note:write', 'interview:schedule', 'interview:complete', 'document:review',
    'pool:read', 'partner:read', 'partner:write', 'partner:transition',
  ],
  ADMIN: [
    'application:read', 'application:read:any',
    'application:transition', 'application:transition:any',
    'application:preselect', 'application:assign',
    'application:note:write', 'interview:schedule', 'interview:complete', 'document:review',
    'pool:read', 'pool:export', 'partner:read', 'partner:write', 'partner:transition',
    'activity:write', 'activity:publish', 'simulation:config:read', 'simulation:config:write',
    'content:write', 'news:write', 'metrics:read', 'user:manage',
    'application:prequalify', 'application:admit', 'application:redflag:review',
    'entrepreneur:read', 'entrepreneur:read:any', 'task:read', 'task:manage', 'threshold:write',
    'academy:program:read', 'academy:learner:read', 'academy:learner:read:any', 'academy:metrics:read',
    'formalization:read', 'financing:read', 'fleet:read', 'asset:read', 'activation:read', 'network:read',
  ],
  SUPER_ADMIN: PERMISSIONS.map(([key]) => key),

  // ── Parcours entrepreneur ────────────────────────────────────────────────
  /** Candidat admis (P01-F06 → P02-F01) : garde l'accès à sa candidature. */
  LEARNER: ['application:read:own', 'entrepreneur:read:own', 'academy:learn'],
  /** Entrepreneur certifié puis équipé (P03 → P08). */
  ENTREPRENEUR: [
    'application:read:own', 'entrepreneur:read:own', 'academy:learn',
    'asset:incident:report:own', 'performance:read:own',
  ],

  // ── Impact Academy (P02) ─────────────────────────────────────────────────
  /** Formateur : ses cohortes, son bloc ; propose, ne certifie pas. */
  TRAINER: [
    'academy:program:read', 'academy:lesson:write',
    'academy:learner:read', 'academy:learner:read:assigned',
    'academy:attendance:write', 'academy:assessment:write', 'academy:assessment:grade',
    'academy:decision:propose', 'task:read',
  ],
  /** Responsable Academy : décisions, exceptions, qualité et KPI de l'école. */
  ACADEMY_MANAGER: [
    'academy:program:read', 'academy:program:write', 'academy:program:publish', 'academy:lesson:write',
    'academy:cohort:write', 'academy:schedule:write',
    'academy:learner:read', 'academy:learner:read:any',
    'academy:attendance:write', 'academy:assessment:write', 'academy:assessment:grade',
    'academy:certification:decide', 'academy:certificate:revoke',
    'academy:trainer:manage', 'academy:metrics:read',
    'entrepreneur:read', 'entrepreneur:read:any', 'task:read', 'task:manage', 'quality:audit',
  ],

  // ── Entrepreneur Operations (P01, P03) ───────────────────────────────────
  /** Chargé : préqualifie, interviewe, score, instruit la formalisation — dossiers assignés. */
  ENTREPRENEUR_OFFICER: [
    'application:read', 'application:read:assigned',
    'application:transition', 'application:transition:assigned',
    'application:prequalify', 'application:note:write',
    'interview:schedule', 'interview:complete', 'document:review', 'pool:read',
    'entrepreneur:read', 'entrepreneur:read:assigned',
    'formalization:read', 'formalization:write', 'task:read',
  ],
  /** Responsable : valide l'admission, traite les red flags et les exceptions. */
  ENTREPRENEUR_OPS_LEAD: [
    'application:read', 'application:read:any',
    'application:transition', 'application:transition:any',
    'application:prequalify', 'application:admit', 'application:redflag:review',
    'application:preselect', 'application:assign', 'application:note:write',
    'interview:schedule', 'interview:complete', 'document:review', 'pool:read', 'pool:export',
    'entrepreneur:read', 'entrepreneur:read:any',
    'formalization:read', 'formalization:write', 'formalization:validate',
    'task:read', 'task:manage', 'quality:audit', 'metrics:read',
  ],
  /** Référent juridique : maintient le référentiel pays (statuts, obligations, pièces). */
  LEGAL_REFERENT: ['country-rules:write', 'formalization:read', 'entrepreneur:read', 'entrepreneur:read:assigned'],

  // ── Financement (P04) ────────────────────────────────────────────────────
  /** Financing Officer : dossiers individuels, relances ; n'autorise pas la commande. */
  FINANCING_OFFICER: [
    'financing:read', 'financing:write',
    'entrepreneur:read', 'entrepreneur:read:assigned', 'task:read',
  ],
  /** Direction Financement & Partenariats : conventions et ordre de commande. */
  FINANCING_DIRECTOR: [
    'financing:read', 'financing:write', 'financing:agreement:write', 'financing:purchase:authorize',
    'partner:read', 'partner:write', 'partner:transition',
    'entrepreneur:read', 'entrepreneur:read:any', 'task:read', 'task:manage', 'metrics:read',
  ],

  // ── SORO (P05, P07) ──────────────────────────────────────────────────────
  FLEET_OPERATIONS: [
    'fleet:read', 'fleet:write', 'asset:read', 'asset:write',
    'entrepreneur:read', 'entrepreneur:read:any', 'task:read', 'task:manage',
  ],

  // ── Réseau ZERO'EAU / BARAQ (P06, P08) ───────────────────────────────────
  NETWORK_MANAGER: [
    'activation:read', 'activation:write', 'network:read', 'network:write',
    'asset:read', 'entrepreneur:read', 'entrepreneur:read:assigned', 'task:read', 'task:manage',
  ],

  // ── Contrôle ─────────────────────────────────────────────────────────────
  /** Auditeur : campagnes de contrôle qualité, lecture seule de tous les dossiers. */
  QUALITY_AUDITOR: [
    'quality:audit', 'application:read', 'application:read:any',
    'entrepreneur:read', 'entrepreneur:read:any', 'academy:learner:read', 'academy:learner:read:any',
    'formalization:read', 'financing:read', 'fleet:read', 'asset:read', 'activation:read', 'network:read',
    'metrics:read',
  ],
};

/** Libellé affiché au back-office à la CRÉATION du rôle (jamais réécrit ensuite). */
export const ROLE_NAMES: Record<string, string> = {
  CANDIDATE: 'CANDIDATE',
  PARTNER: 'PARTNER',
  MANAGER: 'MANAGER',
  ADMIN: 'ADMIN',
  SUPER_ADMIN: 'SUPER_ADMIN',
  LEARNER: 'Apprenant',
  ENTREPRENEUR: 'Entrepreneur',
  TRAINER: 'Formateur',
  ACADEMY_MANAGER: 'Responsable Academy',
  ENTREPRENEUR_OFFICER: 'Chargé Entrepreneur Operations',
  ENTREPRENEUR_OPS_LEAD: 'Responsable Entrepreneur Operations',
  LEGAL_REFERENT: 'Référent juridique pays',
  FINANCING_OFFICER: 'Financing Officer',
  FINANCING_DIRECTOR: 'Direction Financement & Partenariats',
  FLEET_OPERATIONS: 'SORO Fleet Operations',
  NETWORK_MANAGER: 'Responsable réseau ZERO’EAU / BARAQ',
  QUALITY_AUDITOR: 'Auditeur qualité',
};

export async function seedPermissions(prisma: PrismaClient, tenantId: string): Promise<void> {
  // 1. Permissions globales
  for (const [key, resource, action] of PERMISSIONS) {
    const description = DESCRIPTIONS[key] ?? null;
    await prisma.permission.upsert({
      where: { key },
      create: { key, resource, action, description },
      update: { resource, action, description },
    });
  }
  // 2. Rôles système du tenant
  for (const [roleKey, permissionKeys] of Object.entries(ROLES)) {
    const role = await prisma.role.upsert({
      where: { tenantId_key: { tenantId, key: roleKey } },   // ← plus de null as never
      create: { tenantId, key: roleKey, name: ROLE_NAMES[roleKey] ?? roleKey, isSystem: true },
      update: {},
    });
    // 3. Liaison rôle ↔ permissions
    const permissions = await prisma.permission.findMany({
      where: { key: { in: permissionKeys } },
    });
    for (const permission of permissions) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
        create: { roleId: role.id, permissionId: permission.id },
        update: {},
      });
    }
  }
}