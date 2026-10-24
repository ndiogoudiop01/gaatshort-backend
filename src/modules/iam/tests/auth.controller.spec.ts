import type { Request } from 'express';
import type { AuthenticatedUser } from '@shared/kernel/types/authenticated-user';
import { AuthController } from '../presentation/http/auth.controller';
import type { AuthService } from '../application/services/auth.service';

function fakeRequest(overrides: Partial<Request> = {}): Request {
  return { ip: '203.0.113.4', headers: {}, ...overrides } as Request;
}

describe('AuthController', () => {
  it('condense l’IP avant de demander un défi d’authentification', async () => {
    const requestChallenge = jest.fn(
      async (_params: { channel: string; identifier: string; ipHash?: string }) => ({
        sent: true as const,
        expiresInSeconds: 300,
      }),
    );
    const controller = new AuthController({ requestChallenge } as unknown as AuthService);

    await controller.request({ channel: 'EMAIL_OTP', identifier: 'awa@example.com' } as never, fakeRequest());

    const call = requestChallenge.mock.calls[0]?.[0];
    expect(call?.ipHash).toBeDefined();
    expect(call?.ipHash).not.toBe('203.0.113.4');
  });

  it('transmet le user-agent à la vérification du défi', async () => {
    const verifyChallenge = jest.fn(async () => ({ accessToken: 'a', refreshToken: 'b', expiresIn: 900 }));
    const controller = new AuthController({ verifyChallenge } as unknown as AuthService);

    await controller.verify(
      { identifier: 'awa@example.com', secret: '123456' },
      fakeRequest({ headers: { 'user-agent': 'jest' } }),
    );

    expect(verifyChallenge).toHaveBeenCalledWith(
      expect.objectContaining({ identifier: 'awa@example.com', userAgent: 'jest' }),
    );
  });

  it('transmet e-mail, mot de passe, user-agent et IP condensée à la connexion', async () => {
    const loginWithPassword = jest.fn(
      async (_params: { email: string; password: string; userAgent?: string; ipHash?: string }) => ({
        accessToken: 'a',
        refreshToken: 'b',
        expiresIn: 900,
      }),
    );
    const controller = new AuthController({ loginWithPassword } as unknown as AuthService);

    await controller.login(
      { email: 'admin@kaay.test', password: 'secret' },
      fakeRequest({ headers: { 'user-agent': 'jest' } }),
    );

    const call = loginWithPassword.mock.calls[0]?.[0];
    expect(call).toMatchObject({ email: 'admin@kaay.test', password: 'secret', userAgent: 'jest' });
    expect(call?.ipHash).toBeDefined();
    expect(call?.ipHash).not.toBe('203.0.113.4');
  });

  it('délègue le rafraîchissement de session', async () => {
    const refresh = jest.fn(async () => ({ accessToken: 'a', refreshToken: 'b', expiresIn: 900 }));
    const controller = new AuthController({ refresh } as unknown as AuthService);
    await controller.refresh({ refreshToken: 'old-token' }, fakeRequest());
    expect(refresh).toHaveBeenCalledWith('old-token', undefined);
  });

  it('déconnecte la session courante', async () => {
    const logout = jest.fn(async () => undefined);
    const controller = new AuthController({ logout } as unknown as AuthService);
    const user: AuthenticatedUser = {
      id: 'user-1',
      tenantId: 'tenant-1',
      email: null,
      roles: [],
      permissions: [],
      sessionId: 'session-1',
    };
    await controller.logout(user);
    expect(logout).toHaveBeenCalledWith('session-1');
  });

  it('renvoie le profil de l’utilisateur connecté', () => {
    const controller = new AuthController({} as AuthService);
    const user: AuthenticatedUser = {
      id: 'user-1',
      tenantId: 'tenant-1',
      email: 'awa@example.com',
      roles: ['VIEWER'],
      permissions: [],
      sessionId: 'session-1',
    };
    expect(controller.me(user)).toBe(user);
  });
});
