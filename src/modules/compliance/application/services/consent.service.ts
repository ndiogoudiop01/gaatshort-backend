import { Injectable } from '@nestjs/common';
import { BusinessRuleViolationError } from '@shared/kernel/errors/domain.error';
import { TenantPrismaService } from '@infra/persistence/prisma/tenant-prisma.service';
import type { ConsentFacade, ConsentSubjectType } from '../../compliance.facade';

export const CONSENT_KEYS = {
  PERSONAL_DATA: 'personal_data_processing',
  PARTNER_SHARING: 'partner_sharing',
  MARKETING: 'marketing_communications',
} as const;

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  CONSENTEMENTS RGPD — US-IG-028
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Trois principes qui structurent l'implémentation :
 *
 * 1. GRANULARITÉ — « traitement des données personnelles » et « partage avec
 *    les partenaires » sont deux consentements SÉPARÉS. Une case unique
 *    couvrant les deux est nulle au sens du RGPD, et le partage à un
 *    financeur est précisément ce que le candidat doit pouvoir refuser.
 *
 * 2. IMMUABILITÉ — on n'UPDATE jamais un consentement. Retirer son accord
 *    écrit une NOUVELLE ligne `granted = false`. L'historique complet est la
 *    seule preuve opposable en cas de contrôle.
 *
 * 3. PREUVE — chaque enregistrement conserve le libellé EXACT affiché et sa
 *    version. « Nous avions modifié le texte depuis » n'est pas une défense.
 */
@Injectable()
export class ConsentService implements ConsentFacade {
  constructor(private readonly prisma: TenantPrismaService) {}

  public async record(params: {
    subjectType: ConsentSubjectType;
    subjectId: string;
    consents: { key: string; granted: boolean }[];
    ipHash?: string;
    userAgent?: string;
  }): Promise<void> {
    // Une même clé deux fois dans UNE requête rendrait « seul le dernier
    // enregistrement fait foi » non déterministe : `createMany` insère les
    // deux lignes dans le même lot, avec potentiellement le même
    // `occurredAt` — impossible de départager laquelle est réellement « la
    // dernière ». On refuse plutôt que de laisser une preuve légale ambiguë.
    const duplicateKeys = params.consents
      .map((c) => c.key)
      .filter((key, index, keys) => keys.indexOf(key) !== index);
    if (duplicateKeys.length) {
      throw new BusinessRuleViolationError('DUPLICATE_CONSENT_KEY', 'Un consentement ne peut être soumis qu’une fois par requête', {
        keys: [...new Set(duplicateKeys)],
      });
    }

    const definitions = await this.prisma.client.consentDefinition.findMany({
      where: { key: { in: params.consents.map((c) => c.key) }, isActive: true },
    });

    const missing = params.consents.filter((c) => !definitions.some((d) => d.key === c.key));
    if (missing.length) {
      throw new BusinessRuleViolationError('UNKNOWN_CONSENT', 'Consentement inconnu', {
        keys: missing.map((m) => m.key),
      });
    }

    await this.prisma.client.consentRecord.createMany({
      // `tenantId` est injecté par l'extension Prisma tenant-scopée.
      data: params.consents.map((consent) => {
        const definition = definitions.find((d) => d.key === consent.key)!;
        return {
          definitionId: definition.id,
          subjectType: params.subjectType,
          subjectId: params.subjectId,
          consentKey: consent.key,
          consentVersion: definition.version,
          granted: consent.granted,
          ipHash: params.ipHash,
          userAgent: params.userAgent,
          // Preuve : on fige ce qui était affiché à l'écran.
          evidence: { label: definition.label, purpose: definition.purpose, policyUrl: definition.policyUrl },
        } as never;
      }),
    });
  }

  public async hasGrantedRequired(subjectType: ConsentSubjectType, subjectId: string): Promise<boolean> {
    const required = await this.prisma.client.consentDefinition.findMany({
      where: { isRequired: true, isActive: true },
      select: { key: true },
      distinct: ['key'],
    });
    if (required.length === 0) return true;

    const states = await Promise.all(
      required.map((r) => this.latestState(subjectType, subjectId, r.key)),
    );
    return states.every(Boolean);
  }

  public canShareWithPartners(subjectType: ConsentSubjectType, subjectId: string): Promise<boolean> {
    return this.latestState(subjectType, subjectId, CONSENT_KEYS.PARTNER_SHARING);
  }

  /** Seul le DERNIER enregistrement fait foi : un retrait annule un accord. */
  private async latestState(
    subjectType: ConsentSubjectType,
    subjectId: string,
    key: string,
  ): Promise<boolean> {
    const last = await this.prisma.client.consentRecord.findFirst({
      where: { subjectType, subjectId, consentKey: key },
      orderBy: { occurredAt: 'desc' },
      select: { granted: true },
    });
    return last?.granted ?? false;
  }
}
