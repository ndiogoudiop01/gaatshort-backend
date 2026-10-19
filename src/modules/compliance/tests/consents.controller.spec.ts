import type { Request } from 'express';
import type { AuthenticatedUser } from '@shared/kernel/types/authenticated-user';
import type { TenantPrismaService } from '@infra/persistence/prisma/tenant-prisma.service';
import type { AppConfigService } from '@config/app-config.service';
import { TokenHasher } from '@infra/security/token-hasher.service';
import { ConsentsController } from '../presentation/http/consents.controller';
import type { ConsentService } from '../application/services/consent.service';

const USER: AuthenticatedUser = {
  id: 'user-1',
  tenantId: 'tenant-1',
  email: null,
  roles: [],
  permissions: [],
  sessionId: 's1',
};

function fakeHasher(): TokenHasher {
  return new TokenHasher({
    auth: { accessSecret: 'test-secret', refreshSecret: 'test-refresh-secret' },
  } as unknown as AppConfigService);
}

describe('ConsentsController', () => {
  it('liste les définitions de consentement actives', async () => {
    const findMany = jest.fn(async () => []);
    const controller = new ConsentsController(
      {} as ConsentService,
      { client: { consentDefinition: { findMany } } } as unknown as TenantPrismaService,
      fakeHasher(),
    );

    await controller.definitions();

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { isActive: true } }));
  });

  it('condense l’IP du requérant (HMAC dédié) avant de journaliser le consentement', async () => {
    const record = jest.fn(async (_params: { ipHash?: string }) => {
      void _params;
      return undefined;
    });
    const controller = new ConsentsController(
      { record } as unknown as ConsentService,
      {} as TenantPrismaService,
      fakeHasher(),
    );

    await controller.record(
      { consents: [{ key: 'personal_data_processing', granted: true }] },
      USER,
      { ip: '203.0.113.4', headers: { 'user-agent': 'jest' } } as unknown as Request,
    );

    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ subjectType: 'USER', subjectId: 'user-1', ipHash: expect.any(String) }),
    );
    const call = record.mock.calls[0]?.[0];
    expect(call?.ipHash).not.toBe('203.0.113.4');
    // Même condensat que TokenHasher produirait pour la même IP — preuve que
    // le contrôleur passe bien par l'utilitaire dédié (HMAC + pepper), pas
    // par un SHA256 nu recalculé à la main.
    expect(call?.ipHash).toBe(fakeHasher().hash('203.0.113.4'));
  });

  it('ne condense aucune IP quand elle est absente de la requête', async () => {
    const record = jest.fn(async (_params: { ipHash?: string }) => {
      void _params;
      return undefined;
    });
    const controller = new ConsentsController(
      { record } as unknown as ConsentService,
      {} as TenantPrismaService,
      fakeHasher(),
    );

    await controller.record(
      { consents: [{ key: 'personal_data_processing', granted: true }] },
      USER,
      { ip: undefined, headers: {} } as unknown as Request,
    );

    const call = record.mock.calls[0]?.[0];
    expect(call?.ipHash).toBeUndefined();
  });
});
