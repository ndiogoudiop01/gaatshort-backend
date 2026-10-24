import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { IS_OPTIONAL_AUTH_KEY, IS_PUBLIC_KEY } from '@shared/decorators/public.decorator';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';

const ctx = (authorization?: string) =>
  ({
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => ({ headers: authorization ? { authorization } : {} }) }),
  }) as unknown as ExecutionContext;

const reflector = (keys: string[]) => ({ getAllAndOverride: (key: string) => keys.includes(key) }) as unknown as Reflector;

describe('JwtAuthGuard — @OptionalAuth', () => {
  it('sans jeton : anonyme, sans passer par Passport', () => {
    const guard = new JwtAuthGuard(reflector([IS_OPTIONAL_AUTH_KEY]));
    expect(guard.canActivate(ctx())).toBe(true);
  });

  it('avec jeton : la validation complète s’applique (jeton invalide ⇒ 401, pas anonyme)', () => {
    const guard = new JwtAuthGuard(reflector([IS_OPTIONAL_AUTH_KEY]));
    const parent = Object.getPrototypeOf(JwtAuthGuard.prototype) as { canActivate: (c: ExecutionContext) => unknown };
    const spy = jest.spyOn(parent, 'canActivate').mockReturnValue(true);
    expect(guard.canActivate(ctx('Bearer abc'))).toBe(true);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('@Public reste prioritaire', () => {
    const guard = new JwtAuthGuard(reflector([IS_PUBLIC_KEY]));
    expect(guard.canActivate(ctx('Bearer abc'))).toBe(true);
  });
});
