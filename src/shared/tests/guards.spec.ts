import type { ExecutionContext } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { ForbiddenActionError } from '@shared/kernel/errors/domain.error';
import type { TenantContextPort } from '@shared/kernel/ports/tenant-context.port';
import type { AuthenticatedUser } from '@shared/kernel/types/authenticated-user';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { TenantMemberGuard } from '../guards/tenant-member.guard';

function contextWith(user?: Partial<AuthenticatedUser>): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({ name: 'TestController' }),
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

function user(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return { id: 'user-1', tenantId: 'tenant-1', email: null, roles: [], permissions: [], sessionId: 's1', ...overrides };
}

describe('JwtAuthGuard', () => {
  it('laisse passer une route publique sans vérifier le JWT', () => {
    const reflector = { getAllAndOverride: () => true } as unknown as Reflector;
    const guard = new JwtAuthGuard(reflector);
    expect(guard.canActivate(contextWith())).toBe(true);
  });

  it('renvoie l’utilisateur authentifié', () => {
    const guard = new JwtAuthGuard({} as Reflector);
    expect(guard.handleRequest(null, user())).toEqual(user());
  });

  it('lève une UnauthorizedException sans utilisateur ni erreur explicite', () => {
    const guard = new JwtAuthGuard({} as Reflector);
    expect(() => guard.handleRequest(null, null)).toThrow(UnauthorizedException);
  });

  it('relance l’erreur d’origine quand Passport en fournit une', () => {
    const guard = new JwtAuthGuard({} as Reflector);
    expect(() => guard.handleRequest(new Error('jeton expiré'), null)).toThrow('jeton expiré');
  });
});

describe('PermissionsGuard', () => {
  it('laisse passer une route publique', () => {
    const reflector = { getAllAndOverride: () => true } as unknown as Reflector;
    const guard = new PermissionsGuard(reflector);
    expect(guard.canActivate(contextWith())).toBe(true);
  });

  it('laisse passer une route sans permission ni rôle requis', () => {
    const reflector = { getAllAndOverride: () => undefined } as unknown as Reflector;
    const guard = new PermissionsGuard(reflector);
    expect(guard.canActivate(contextWith(user()))).toBe(true);
  });

  it('refuse un utilisateur non authentifié sur une route protégée', () => {
    let call = 0;
    const reflector = {
      getAllAndOverride: () => (call++ === 1 ? ['application:read'] : false),
    } as unknown as Reflector;
    const guard = new PermissionsGuard(reflector);
    expect(() => guard.canActivate(contextWith(undefined))).toThrow(ForbiddenActionError);
  });

  it('refuse un utilisateur sans le rôle requis', () => {
    const reflector = {
      getAllAndOverride: jest
        .fn()
        .mockReturnValueOnce(false) // IS_PUBLIC
        .mockReturnValueOnce(undefined) // PERMISSIONS
        .mockReturnValueOnce(['ADMIN']), // ROLES
    } as unknown as Reflector;
    const guard = new PermissionsGuard(reflector);
    try {
      guard.canActivate(contextWith(user({ roles: ['VIEWER'] })));
      fail('aurait dû lever');
    } catch (error) {
      expect((error as ForbiddenActionError).details.reason).toMatch(/rôle requis/);
    }
  });

  it('refuse un utilisateur sans toutes les permissions requises', () => {
    const reflector = {
      getAllAndOverride: jest
        .fn()
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(['application:read', 'application:write']),
    } as unknown as Reflector;
    const guard = new PermissionsGuard(reflector);
    try {
      guard.canActivate(contextWith(user({ permissions: ['application:read'] })));
      fail('aurait dû lever');
    } catch (error) {
      expect((error as ForbiddenActionError).details.reason).toMatch(/permission requise/);
    }
  });

  it('autorise un utilisateur qui a le rôle et les permissions requis', () => {
    const reflector = {
      getAllAndOverride: jest
        .fn()
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(['application:read'])
        .mockReturnValueOnce(['ADMIN']),
    } as unknown as Reflector;
    const guard = new PermissionsGuard(reflector);
    expect(
      guard.canActivate(contextWith(user({ roles: ['ADMIN'], permissions: ['application:read'] }))),
    ).toBe(true);
  });
});

describe('TenantMemberGuard', () => {
  it('laisse passer une route publique (pas d’utilisateur)', () => {
    const tenantContext = { get: () => ({ tenantId: 'tenant-1' }) } as unknown as TenantContextPort;
    const guard = new TenantMemberGuard(tenantContext);
    expect(guard.canActivate(contextWith(undefined))).toBe(true);
  });

  it('autorise un utilisateur dont le tenant correspond au contexte', () => {
    const tenantContext = { get: () => ({ tenantId: 'tenant-1' }) } as unknown as TenantContextPort;
    const guard = new TenantMemberGuard(tenantContext);
    expect(guard.canActivate(contextWith(user({ tenantId: 'tenant-1' })))).toBe(true);
  });

  it('refuse une incohérence entre le tenant du token et celui de la requête', () => {
    const tenantContext = { get: () => ({ tenantId: 'tenant-2' }) } as unknown as TenantContextPort;
    const guard = new TenantMemberGuard(tenantContext);
    expect(() => guard.canActivate(contextWith(user({ tenantId: 'tenant-1' })))).toThrow(ForbiddenActionError);
  });
});
