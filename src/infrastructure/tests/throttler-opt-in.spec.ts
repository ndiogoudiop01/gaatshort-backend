import type { ExecutionContext } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { onlyWhereDeclared } from '../security/security.module';

class AdminController {
  public list(): void {}
}

class PublicController {
  @Throttle({ 'public-form': { limit: 5, ttl: 3_600_000 } })
  public submit(): void {}
}

@Throttle({ auth: { limit: 10, ttl: 900_000 } })
class AuthController {
  public login(): void {}
}

function contextFor(cls: new () => object, method: string): ExecutionContext {
  return {
    getClass: () => cls,
    getHandler: () => (cls.prototype as Record<string, unknown>)[method],
  } as unknown as ExecutionContext;
}

describe('onlyWhereDeclared — throttlers nommés opt-in', () => {
  it('saute les quotas serrés sur une route qui ne les déclare pas (back-office)', () => {
    const ctx = contextFor(AdminController, 'list');
    expect(onlyWhereDeclared('public-form')(ctx)).toBe(true);
    expect(onlyWhereDeclared('auth')(ctx)).toBe(true);
  });

  it('applique le quota déclaré sur la méthode, et seulement celui-là', () => {
    const ctx = contextFor(PublicController, 'submit');
    expect(onlyWhereDeclared('public-form')(ctx)).toBe(false);
    expect(onlyWhereDeclared('auth')(ctx)).toBe(true);
  });

  it('applique le quota déclaré sur la classe', () => {
    expect(onlyWhereDeclared('auth')(contextFor(AuthController, 'login'))).toBe(false);
  });
});
