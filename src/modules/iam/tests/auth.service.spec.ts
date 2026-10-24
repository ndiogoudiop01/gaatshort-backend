import { UnauthorizedException } from '@nestjs/common';
import { fakeTenantPrisma } from '@shared/tests/test-utils/fake-tenant-prisma';
import type { AppConfigService } from '@config/app-config.service';
import type { ClockPort } from '@shared/kernel/ports/clock.port';
import type { MailerPort } from '@shared/kernel/ports/mailer.port';
import type { SmsPort } from '@shared/kernel/ports/sms.port';
import type { TenantContextPort } from '@shared/kernel/ports/tenant-context.port';
import { PasswordHasher } from '@infra/security/password-hasher.service';
import { TokenHasher } from '@infra/security/token-hasher.service';
import { BusinessRuleViolationError } from '@shared/kernel/errors/domain.error';
import { ErrorCode } from '@shared/kernel/errors/error-catalog';
import { AuthService } from '../application/services/auth.service';

const catchError = async (promise: Promise<unknown>): Promise<UnauthorizedException> => {
  try {
    await promise;
    throw new Error('la promesse aurait dû rejeter');
  } catch (error) {
    return error as UnauthorizedException;
  }
};

const NOW = new Date('2026-09-01T00:00:00.000Z');
const CLOCK: ClockPort = {
  now: () => NOW,
  today: () => NOW,
  addDays: (d, n) => new Date(d.getTime() + n * 86_400_000),
  addSeconds: (d, n) => new Date(d.getTime() + n * 1000),
};

const CONFIG = {
  auth: {
    accessSecret: 'test-access-secret',
    accessTtl: '900s',
    refreshSecret: 'test-refresh-secret',
    magicLinkTtlSeconds: 900,
    otpTtlSeconds: 300,
    otpLength: 6,
    otpMaxAttempts: 5,
    testPhones: { '+221700000001': '111111' },
    argon2: { memoryCost: 4096, timeCost: 2 },
  },
  app: { frontendUrl: 'https://gaatshort.com' },
} as unknown as AppConfigService;

function hasher(): TokenHasher {
  return new TokenHasher(CONFIG);
}

function buildService(overrides: {
  prismaClient?: Record<string, unknown>;
  mailer?: Partial<MailerPort>;
  sms?: Partial<SmsPort>;
  tenantContext?: Partial<TenantContextPort>;
  jwt?: { signAsync: () => Promise<string> };
}) {
  const mailer: MailerPort = { send: jest.fn(async () => ({ providerId: 'mail-1' })), ...overrides.mailer };
  const sms: SmsPort = { send: jest.fn(async () => ({ providerId: 'sms-1' })), ...overrides.sms };
  const tenantContext: TenantContextPort = {
    get: () => ({ tenantId: 'tenant-1' }) as never,
    getOrNull: () => null,
    tenantId: 'tenant-1',
    runWith: (_t, fn) => fn(),
    runPrivileged: (_r, fn) => fn(),
    isPrivileged: () => false,
    ...overrides.tenantContext,
  };
  const jwt = overrides.jwt ?? { signAsync: async () => 'signed.jwt.token' };

  return new AuthService(
    fakeTenantPrisma(overrides.prismaClient ?? {}),
    jwt as never,
    CONFIG,
    hasher(),
    new PasswordHasher(CONFIG),
    CLOCK,
    mailer,
    sms,
    tenantContext,
  );
}

describe('AuthService.requestChallenge', () => {
  it('envoie un lien magique par e-mail', async () => {
    const create = jest.fn(async () => undefined);
    const sendMail = jest.fn(async () => ({ providerId: 'mail-1' }));
    const service = buildService({ prismaClient: { authChallenge: { create } }, mailer: { send: sendMail } });

    const result = await service.requestChallenge({ channel: 'EMAIL_MAGIC_LINK', identifier: 'AWA@Example.com' });

    expect(result.sent).toBe(true);
    expect(create).toHaveBeenCalledTimes(1);
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ template: 'auth.magic-link' }));
  });

  it('envoie un OTP par SMS pour un canal téléphone', async () => {
    const sendSms = jest.fn(async () => ({ providerId: 'sms-1' }));
    const service = buildService({
      prismaClient: { authChallenge: { create: async () => undefined } },
      sms: { send: sendSms },
    });

    await service.requestChallenge({ channel: 'PHONE_OTP', identifier: '+221771234567' });

    expect(sendSms).toHaveBeenCalledWith(expect.objectContaining({ to: '+221771234567' }));
  });

  it('numéro de test : code fixe, aucun SMS, empreinte du code fixe enregistrée', async () => {
    const sendSms = jest.fn(async () => ({ providerId: 'sms-1' }));
    const create = jest.fn(async (_args: { data: { secretHash: string } }) => undefined);
    const service = buildService({ prismaClient: { authChallenge: { create } }, sms: { send: sendSms } });

    await expect(service.requestChallenge({ channel: 'PHONE_OTP', identifier: '+221700000001' })).resolves.toMatchObject({ sent: true });

    expect(sendSms).not.toHaveBeenCalled();
    expect(create.mock.calls[0]?.[0].data.secretHash).toBe(hasher().hash('111111'));
  });

  it('envoie un OTP par e-mail pour le canal EMAIL_OTP', async () => {
    const sendMail = jest.fn(async () => ({ providerId: 'mail-1' }));
    const service = buildService({
      prismaClient: { authChallenge: { create: async () => undefined } },
      mailer: { send: sendMail },
    });

    await service.requestChallenge({ channel: 'EMAIL_OTP', identifier: 'awa@example.com' });

    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ template: 'auth.otp' }));
  });
});

describe('AuthService.verifyChallenge', () => {
  it('refuse un identifiant sans défi actif, avec un code du catalogue', async () => {
    const service = buildService({ prismaClient: { authChallenge: { findFirst: async () => null } } });
    const error = await catchError(
      service.verifyChallenge({ identifier: 'awa@example.com', secret: '123456' }),
    );
    expect(error).toBeInstanceOf(UnauthorizedException);
    expect(error.getResponse()).toMatchObject({ code: ErrorCode.CHALLENGE_INVALID });
  });

  it('refuse un défi expiré', async () => {
    const service = buildService({
      prismaClient: {
        authChallenge: {
          findFirst: async () => ({
            id: 'challenge-1',
            channel: 'EMAIL_OTP',
            secretHash: hasher().hash('123456'),
            attempts: 0,
            maxAttempts: 5,
            expiresAt: new Date('2020-01-01'),
            consumedAt: null,
          }),
        },
      },
    });
    await expect(service.verifyChallenge({ identifier: 'awa@example.com', secret: '123456' })).rejects.toThrow(
      BusinessRuleViolationError,
    );
  });

  it('incrémente les tentatives sur un mauvais secret', async () => {
    const update = jest.fn(async () => undefined);
    const service = buildService({
      prismaClient: {
        authChallenge: {
          findFirst: async () => ({
            id: 'challenge-1',
            channel: 'EMAIL_OTP',
            secretHash: hasher().hash('123456'),
            attempts: 0,
            maxAttempts: 5,
            expiresAt: new Date('2026-09-01T00:10:00.000Z'),
            consumedAt: null,
          }),
          update,
        },
      },
    });

    const error = await catchError(
      service.verifyChallenge({ identifier: 'awa@example.com', secret: 'mauvais' }),
    );
    expect(error).toBeInstanceOf(UnauthorizedException);
    expect(error.getResponse()).toMatchObject({ code: ErrorCode.CHALLENGE_INVALID });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { attempts: { increment: 1 } } }),
    );
  });

  it('ouvre une session pour un secret valide et crée l’utilisateur au besoin', async () => {
    const updateChallenge = jest.fn(async () => undefined);
    const createSession = jest.fn(async () => undefined);
    const updateUser = jest.fn(async () => undefined);
    const service = buildService({
      prismaClient: {
        authChallenge: {
          findFirst: async () => ({
            id: 'challenge-1',
            channel: 'EMAIL_OTP',
            secretHash: hasher().hash('123456'),
            attempts: 0,
            maxAttempts: 5,
            expiresAt: new Date('2026-09-01T00:10:00.000Z'),
            consumedAt: null,
          }),
          update: updateChallenge,
        },
        user: {
          findFirst: async () => null,
          create: async () => ({
            id: 'user-1',
            status: 'ACTIVE',
            roles: [],
            update: updateUser,
          }),
          findUniqueOrThrow: async () => ({ id: 'user-1', status: 'ACTIVE', roles: [] }),
          update: updateUser,
        },
        role: { findFirst: async () => null },
        authSession: { create: createSession },
      },
    });

    const tokens = await service.verifyChallenge({ identifier: 'awa@example.com', secret: '123456' });

    expect(tokens.accessToken).toBe('signed.jwt.token');
    expect(createSession).toHaveBeenCalledTimes(1);
  });
});

describe('AuthService.refresh', () => {
  it('refuse une session expirée, avec le code TOKEN_EXPIRED', async () => {
    const service = buildService({
      prismaClient: {
        authSession: { findUnique: async () => ({ expiresAt: new Date('2020-01-01'), revokedAt: null }) },
      },
    });
    const error = await catchError(service.refresh('token'));
    expect(error).toBeInstanceOf(UnauthorizedException);
    expect(error.getResponse()).toMatchObject({ code: ErrorCode.TOKEN_EXPIRED });
  });

  it('révoque toute la famille sur un rejeu de token déjà consommé, code SESSION_REVOKED', async () => {
    const updateMany = jest.fn(async () => undefined);
    const service = buildService({
      prismaClient: {
        authSession: {
          findUnique: async () => ({
            expiresAt: new Date('2027-01-01'),
            revokedAt: new Date(),
            familyId: 'family-1',
          }),
          updateMany,
        },
      },
    });
    const error = await catchError(service.refresh('token'));
    expect(error).toBeInstanceOf(UnauthorizedException);
    expect(error.getResponse()).toMatchObject({ code: ErrorCode.SESSION_REVOKED });
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { familyId: 'family-1', revokedAt: null } }),
    );
  });

  it('effectue une rotation de session valide et referme la chaîne d’audit (replacedById)', async () => {
    const updateSession = jest.fn(async () => undefined);
    const service = buildService({
      prismaClient: {
        authSession: {
          findUnique: async () => ({
            id: 'session-1',
            userId: 'user-1',
            expiresAt: new Date('2027-01-01'),
            revokedAt: null,
            familyId: 'family-1',
            ipHash: null,
          }),
          create: async () => undefined,
          update: updateSession,
        },
        user: {
          findUniqueOrThrow: async () => ({ id: 'user-1', status: 'ACTIVE', roles: [] }),
          update: async () => undefined,
        },
      },
    });

    const tokens = await service.refresh('old-token');

    expect(tokens.accessToken).toBe('signed.jwt.token');
    expect(tokens).not.toHaveProperty('sessionId'); // sessionId est un détail interne, pas exposé au client
    expect(updateSession).toHaveBeenCalledWith({
      where: { id: 'session-1' },
      data: expect.objectContaining({ replacedById: expect.any(String) }),
    });
  });
});

describe('AuthService.logout', () => {
  it('révoque la session courante', async () => {
    const update = jest.fn(async () => undefined);
    const service = buildService({ prismaClient: { authSession: { update } } });
    await service.logout('session-1');
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'session-1' } }),
    );
  });
});

describe('AuthService — comptes suspendus', () => {
  it('refuse d’émettre un jeton pour un compte suspendu', async () => {
    const service = buildService({
      prismaClient: {
        authChallenge: {
          findFirst: async () => ({
            id: 'challenge-1',
            channel: 'EMAIL_OTP',
            secretHash: hasher().hash('123456'),
            attempts: 0,
            maxAttempts: 5,
            expiresAt: new Date('2026-09-01T00:10:00.000Z'),
            consumedAt: null,
          }),
          update: async () => undefined,
        },
        user: {
          findFirst: async () => ({ id: 'user-1', status: 'SUSPENDED', roles: [] }),
          findUniqueOrThrow: async () => ({ id: 'user-1', status: 'SUSPENDED', roles: [] }),
        },
      },
    });

    await expect(service.verifyChallenge({ identifier: 'awa@example.com', secret: '123456' })).rejects.toThrow(
      BusinessRuleViolationError,
    );
  });
});

describe('AuthService.loginWithPassword', () => {
  const passwords = new PasswordHasher(CONFIG);

  function loginService(user: Record<string, unknown> | null) {
    const createSession = jest.fn(async () => undefined);
    const service = buildService({
      prismaClient: {
        user: {
          findFirst: async () => user,
          findUniqueOrThrow: async () => ({ ...user, roles: [] }),
          update: async () => undefined,
        },
        authSession: { create: createSession },
      },
    });
    return { service, createSession };
  }

  it('ouvre une session avec le bon mot de passe', async () => {
    const passwordHash = await passwords.hash('s3cret!');
    const { service, createSession } = loginService({ id: 'user-1', status: 'ACTIVE', passwordHash });

    const tokens = await service.loginWithPassword({ email: 'Admin@Example.com', password: 's3cret!' });

    expect(tokens.accessToken).toBe('signed.jwt.token');
    expect(tokens).not.toHaveProperty('sessionId');
    expect(createSession).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['un mot de passe erroné', async () => ({ id: 'user-1', status: 'ACTIVE', passwordHash: await passwords.hash('autre') })],
    ['un compte sans mot de passe', async () => ({ id: 'user-1', status: 'ACTIVE', passwordHash: null })],
    ['un e-mail inconnu', async () => null],
  ])('refuse %s avec INVALID_CREDENTIALS', async (_label, makeUser) => {
    const { service, createSession } = loginService(await makeUser());

    const error = await catchError(service.loginWithPassword({ email: 'admin@example.com', password: 's3cret!' }));

    expect(error).toBeInstanceOf(UnauthorizedException);
    expect(error.getResponse()).toMatchObject({ code: ErrorCode.INVALID_CREDENTIALS });
    expect(createSession).not.toHaveBeenCalled();
  });

  it('refuse un compte suspendu malgré le bon mot de passe', async () => {
    const passwordHash = await passwords.hash('s3cret!');
    const { service, createSession } = loginService({ id: 'user-1', status: 'SUSPENDED', passwordHash });

    await expect(service.loginWithPassword({ email: 'admin@example.com', password: 's3cret!' })).rejects.toBeInstanceOf(
      BusinessRuleViolationError,
    );
    expect(createSession).not.toHaveBeenCalled();
  });
});

describe('AuthService — compte global du spectateur (Q-02)', () => {
  function phoneService(existing: Record<string, unknown> | null, account = { id: 'acc-1', status: 'ACTIVE' }) {
    const upsertAccount = jest.fn(async () => account);
    const createUser = jest.fn(async (args: { data: Record<string, unknown> }) => ({ id: 'user-1', ...args.data }));
    const updateUser = jest.fn(async () => ({ id: 'user-1' }));
    const signAsync = jest.fn(async (_payload: Record<string, unknown>) => 'jwt');
    const service = buildService({
      jwt: { signAsync: signAsync as unknown as () => Promise<string> },
      tenantContext: { get: () => ({ tenantId: 'tenant-1', defaultLocale: 'fr' }) as never },
      prismaClient: {
        authChallenge: {
          findFirst: async () => ({
            id: 'c', channel: 'PHONE_OTP', secretHash: hasher().hash('123456'), attempts: 0, maxAttempts: 5,
            expiresAt: new Date('2026-09-01T00:10:00.000Z'), consumedAt: null,
          }),
          update: jest.fn(),
        },
        account: { upsert: upsertAccount },
        user: {
          findFirst: async () => existing,
          create: createUser,
          update: updateUser,
          findUniqueOrThrow: async () => ({ id: 'user-1', status: 'ACTIVE', roles: [], accountId: 'acc-1', allCountries: false, countryScope: [] }),
        },
        role: { findFirst: async () => ({ id: 'role-viewer' }) },
        authSession: { create: jest.fn() },
      },
    });
    return { service, upsertAccount, createUser, updateUser, signAsync };
  }

  it('premier passage : crée le compte global (pays et langue déduits de l’indicatif) et le rattachement', async () => {
    const { service, upsertAccount, createUser, signAsync } = phoneService(null);
    await service.verifyChallenge({ identifier: '+2207012345', secret: '123456' });
    expect(upsertAccount).toHaveBeenCalledWith(expect.objectContaining({
      where: { phoneE164: '+2207012345' },
      create: expect.objectContaining({ countryCode: 'GM', locale: 'en' }),
    }));
    expect(createUser.mock.calls[0][0].data).toMatchObject({ accountId: 'acc-1', phoneE164: '+2207012345' });
    expect(signAsync.mock.calls[0][0]).toMatchObject({ acc: 'acc-1' });
  });

  it('rattachement existant sans compte : le relie au compte global', async () => {
    const { service, updateUser } = phoneService({ id: 'user-1', accountId: null });
    await service.verifyChallenge({ identifier: '+221771234567', secret: '123456' });
    expect(updateUser).toHaveBeenCalledWith(expect.objectContaining({ data: { accountId: 'acc-1' } }));
  });

  it('compte global bloqué : connexion refusée', async () => {
    const { service } = phoneService(null, { id: 'acc-1', status: 'BLOCKED' });
    await expect(service.verifyChallenge({ identifier: '+221771234567', secret: '123456' })).rejects.toBeInstanceOf(BusinessRuleViolationError);
  });
});
