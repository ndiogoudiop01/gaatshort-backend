import { BusinessRuleViolationError } from '@shared/kernel/errors/domain.error';
import type { TenantPrismaService } from '@infra/persistence/prisma/tenant-prisma.service';
import { ConsentService, CONSENT_KEYS } from '../application/services/consent.service';

function fakePrisma(overrides: Record<string, unknown>): TenantPrismaService {
  return { client: overrides } as unknown as TenantPrismaService;
}

const DEFINITION = {
  id: 'def-1',
  key: CONSENT_KEYS.PERSONAL_DATA,
  version: 1,
  label: 'Traitement des données',
  purpose: 'Instruction du dossier',
  policyUrl: null,
  isRequired: true,
  isActive: true,
};

describe('ConsentService', () => {
  it('enregistre les consentements dont la définition existe', async () => {
    const createMany = jest.fn(async () => undefined);
    const service = new ConsentService(
      fakePrisma({
        consentDefinition: { findMany: async () => [DEFINITION] },
        consentRecord: { createMany },
      }),
    );

    await service.record({
      subjectType: 'APPLICATION',
      subjectId: 'app-1',
      consents: [{ key: CONSENT_KEYS.PERSONAL_DATA, granted: true }],
    });

    expect(createMany).toHaveBeenCalledTimes(1);
  });

  it('refuse un consentement sans définition connue', async () => {
    const service = new ConsentService(
      fakePrisma({ consentDefinition: { findMany: async () => [] } }),
    );
    await expect(
      service.record({
        subjectType: 'APPLICATION',
        subjectId: 'app-1',
        consents: [{ key: 'consentement_inconnu', granted: true }],
      }),
    ).rejects.toThrow(BusinessRuleViolationError);
  });

  /**
   * Sans ce garde-fou, deux lignes pour la même clé dans le même lot
   * `createMany` pourraient partager le même `occurredAt` — « seul le
   * dernier enregistrement fait foi » deviendrait non déterministe.
   */
  it('refuse une même clé soumise deux fois dans la même requête', async () => {
    const createMany = jest.fn();
    const service = new ConsentService(
      fakePrisma({
        consentDefinition: { findMany: async () => [DEFINITION] },
        consentRecord: { createMany },
      }),
    );
    await expect(
      service.record({
        subjectType: 'APPLICATION',
        subjectId: 'app-1',
        consents: [
          { key: CONSENT_KEYS.PERSONAL_DATA, granted: true },
          { key: CONSENT_KEYS.PERSONAL_DATA, granted: false },
        ],
      }),
    ).rejects.toThrow(BusinessRuleViolationError);
    expect(createMany).not.toHaveBeenCalled();
  });

  it('considère les consentements obligatoires accordés quand tous les derniers états le sont', async () => {
    const service = new ConsentService(
      fakePrisma({
        consentDefinition: { findMany: async () => [{ key: CONSENT_KEYS.PERSONAL_DATA }] },
        consentRecord: { findFirst: async () => ({ granted: true }) },
      }),
    );
    expect(await service.hasGrantedRequired('APPLICATION', 'app-1')).toBe(true);
  });

  it('considère les consentements manquants dès qu’un seul est refusé', async () => {
    const service = new ConsentService(
      fakePrisma({
        consentDefinition: { findMany: async () => [{ key: CONSENT_KEYS.PERSONAL_DATA }] },
        consentRecord: { findFirst: async () => ({ granted: false }) },
      }),
    );
    expect(await service.hasGrantedRequired('APPLICATION', 'app-1')).toBe(false);
  });

  it('n’exige rien quand aucun consentement n’est obligatoire', async () => {
    const service = new ConsentService(
      fakePrisma({ consentDefinition: { findMany: async () => [] } }),
    );
    expect(await service.hasGrantedRequired('APPLICATION', 'app-1')).toBe(true);
  });

  it('un retrait annule un accord précédent (seul le dernier état fait foi)', async () => {
    const findFirst = jest.fn(async () => ({ granted: false }));
    const service = new ConsentService(fakePrisma({ consentRecord: { findFirst } }));
    expect(await service.canShareWithPartners('APPLICATION', 'app-1')).toBe(false);
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { occurredAt: 'desc' } }),
    );
  });

  /**
   * DoD explicite du ticket : « le scénario accord puis retrait puis
   * nouvelle demande est couvert par un test ». Contrairement aux tests
   * ci-dessus (chaque appel mocké isolément avec une valeur figée), celui-ci
   * fait tourner un store en mémoire qui accumule VRAIMENT les lignes au fil
   * des appels à `record()`, pour prouver — pas seulement affirmer — que
   * rien n'est jamais écrasé et que seule la dernière ligne fait foi.
   */
  it('DoD — scénario accord puis retrait puis nouvelle demande : jamais d’écrasement, seul le dernier état fait foi', async () => {
    const PARTNER_SHARING_DEFINITION = {
      id: 'def-partner-sharing',
      key: CONSENT_KEYS.PARTNER_SHARING,
      version: 1,
      label: 'J’accepte que mon dossier soit transmis aux partenaires',
      purpose: 'Mise en relation avec les financeurs et fournisseurs',
      policyUrl: null,
      isRequired: false,
      isActive: true,
    };

    interface StoredRecord extends Record<string, unknown> {
      subjectType: string;
      subjectId: string;
      consentKey: string;
      granted: boolean;
      occurredAt: Date;
    }
    const records: StoredRecord[] = [];

    const createMany = jest.fn(async (args: { data: Record<string, unknown>[] }) => {
      // `occurredAt` croissant à chaque insertion, pour un tri déterministe.
      for (const row of args.data) records.push({ ...row, occurredAt: new Date(records.length) } as StoredRecord);
    });
    const findFirst = jest.fn(
      async (args: { where: { subjectType: string; subjectId: string; consentKey: string } }) => {
        const matches = records
          .filter(
            (r) =>
              r.subjectType === args.where.subjectType &&
              r.subjectId === args.where.subjectId &&
              r.consentKey === args.where.consentKey,
          )
          .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
        return matches[0] ?? null;
      },
    );

    const service = new ConsentService(
      fakePrisma({
        consentDefinition: { findMany: async () => [PARTNER_SHARING_DEFINITION] },
        consentRecord: { createMany, findFirst },
      }),
    );
    const subject = { subjectType: 'APPLICATION' as const, subjectId: 'app-1' };

    // 1. Accord initial.
    await service.record({ ...subject, consents: [{ key: CONSENT_KEYS.PARTNER_SHARING, granted: true }] });
    expect(await service.canShareWithPartners(subject.subjectType, subject.subjectId)).toBe(true);

    // 2. Retrait — DOIT annuler l'accord précédent.
    await service.record({ ...subject, consents: [{ key: CONSENT_KEYS.PARTNER_SHARING, granted: false }] });
    expect(await service.canShareWithPartners(subject.subjectType, subject.subjectId)).toBe(false);

    // 3. Nouvelle demande (ré-accord) — DOIT à nouveau faire foi.
    await service.record({ ...subject, consents: [{ key: CONSENT_KEYS.PARTNER_SHARING, granted: true }] });
    expect(await service.canShareWithPartners(subject.subjectType, subject.subjectId)).toBe(true);

    // Les 3 événements doivent tous exister — un retrait ÉCRIT, il n'écrase
    // jamais (AC : « on n'écrase jamais un consentement »).
    expect(records).toHaveLength(3);
    expect(records.map((r) => r.granted)).toEqual([true, false, true]);
    // Chaque ligne fige le libellé exact affiché et la version (AC preuve).
    for (const record of records) {
      expect(record.evidence).toEqual({
        label: PARTNER_SHARING_DEFINITION.label,
        purpose: PARTNER_SHARING_DEFINITION.purpose,
        policyUrl: PARTNER_SHARING_DEFINITION.policyUrl,
      });
      expect(record.consentVersion).toBe(1);
    }
  });
});
