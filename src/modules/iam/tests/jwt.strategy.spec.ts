import { UnauthorizedException } from '@nestjs/common';
import type { AppConfigService } from '@config/app-config.service';
import type { TenantPrismaService } from '@infra/persistence/prisma/tenant-prisma.service';
import type { JwtAccessPayload } from '@shared/kernel/types/authenticated-user';
import { JwtStrategy } from '../infrastructure/jwt.strategy';

const CONFIG = { auth: { accessSecret: 'test-secret' } } as unknown as AppConfigService;

const PAYLOAD: JwtAccessPayload = {
  sub: 'user-1',
  tid: 'tenant-1',
  email: 'awa@example.com',
  roles: ['CANDIDATE'],
  perms: ['application:read:own'],
  sid: 'session-1',
  iat: 0,
  exp: 0,
};

function fakePrisma(overrides: Record<string, unknown>): TenantPrismaService {
  return { client: overrides } as unknown as TenantPrismaService;
}

describe('JwtStrategy', () => {
  it('authentifie un jeton dont la session est toujours active', async () => {
    const strategy = new JwtStrategy(
      CONFIG,
      fakePrisma({ authSession: { findFirst: async () => ({ id: 'session-1' }) } }),
    );

    const user = await strategy.validate(PAYLOAD);

    expect(user).toEqual({
      id: 'user-1',
      tenantId: 'tenant-1',
      email: 'awa@example.com',
      roles: ['CANDIDATE'],
      permissions: ['application:read:own'],
      sessionId: 'session-1',
      // BSG-12 : jeton sans revendication `cty` → aucun filtre pays.
      countries: null,
    });
  });

  it('refuse un jeton dont la session a été révoquée', async () => {
    const strategy = new JwtStrategy(
      CONFIG,
      fakePrisma({ authSession: { findFirst: async () => null } }),
    );
    await expect(strategy.validate(PAYLOAD)).rejects.toThrow(UnauthorizedException);
  });
});
