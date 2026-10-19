import type { TenantAwareJobService } from '@infra/queue/tenant-aware-job.service';
import type { TenantPrismaService } from '@infra/persistence/prisma/tenant-prisma.service';
import type { MailerPort } from '@shared/kernel/ports/mailer.port';
import type { SmsPort } from '@shared/kernel/ports/sms.port';
import { SendNotificationProcessor } from '../infrastructure/jobs/send-notification.processor';

interface SendNotificationData {
  readonly userId?: string;
  readonly recipient?: string;
  readonly channel: 'EMAIL' | 'SMS' | 'PUSH' | 'IN_APP';
  readonly templateKey: string;
  readonly locale?: string;
  readonly variables: Record<string, unknown>;
  readonly dedupeWindowMs?: number;
}

function fakePrisma(overrides: Record<string, unknown>): TenantPrismaService {
  return { client: overrides } as unknown as TenantPrismaService;
}

function callHandle(
  processor: SendNotificationProcessor,
  data: SendNotificationData,
  job: { attemptsMade: number } = { attemptsMade: 0 },
) {
  return (
    processor as unknown as { handle(d: SendNotificationData, j: typeof job): Promise<unknown> }
  ).handle(data, job);
}

describe('SendNotificationProcessor', () => {
  it('envoie un e-mail et journalise l’envoi', async () => {
    const create = jest.fn(async () => ({ id: 'notif-1' }));
    const update = jest.fn(async () => undefined);
    const mailer: MailerPort = { send: jest.fn(async () => ({ providerId: 'mail-1' })) };
    const processor = new SendNotificationProcessor(
      {} as TenantAwareJobService,
      fakePrisma({ notification: { findFirst: async () => null, create, update } }),
      mailer,
      {} as SmsPort,
    );

    const result = await callHandle(processor, {
      recipient: 'awa@example.com',
      channel: 'EMAIL',
      templateKey: 'application.submitted',
      variables: { reference: 'IG-2026-000001' },
    });

    expect(result).toEqual({ notificationId: 'notif-1', providerId: 'mail-1' });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'SENT' }) }));
  });

  it('envoie un SMS en sérialisant le corps du message', async () => {
    const create = jest.fn(async () => ({ id: 'notif-2' }));
    const sendSms = jest.fn(async () => ({ providerId: 'sms-1' }));
    const sms: SmsPort = { send: sendSms };
    const processor = new SendNotificationProcessor(
      {} as TenantAwareJobService,
      fakePrisma({ notification: { findFirst: async () => null, create, update: async () => undefined } }),
      {} as MailerPort,
      sms,
    );

    await callHandle(processor, {
      recipient: '+221771234567',
      channel: 'SMS',
      templateKey: 'auth.otp',
      variables: { body: 'Votre code : 123456' },
    });

    expect(sendSms).toHaveBeenCalledWith({ to: '+221771234567', body: 'Votre code : 123456' });
  });

  it('résout le destinataire depuis le profil utilisateur quand il n’est pas fourni', async () => {
    const create = jest.fn(async () => ({ id: 'notif-3' }));
    const findUnique = jest.fn(async () => ({ email: 'depuis-profil@example.com', phoneE164: null }));
    const processor = new SendNotificationProcessor(
      {} as TenantAwareJobService,
      fakePrisma({
        notification: { findFirst: async () => null, create, update: async () => undefined },
        user: { findUnique },
      }),
      { send: jest.fn(async () => ({ providerId: 'mail-1' })) },
      {} as SmsPort,
    );

    await callHandle(processor, { userId: 'user-1', channel: 'EMAIL', templateKey: 'x', variables: {} });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ recipient: 'depuis-profil@example.com' }) }),
    );
  });

  it('ignore l’envoi quand aucun destinataire ne peut être résolu', async () => {
    const processor = new SendNotificationProcessor(
      {} as TenantAwareJobService,
      fakePrisma({ user: { findUnique: async () => null } }),
      {} as MailerPort,
      {} as SmsPort,
    );

    const result = await callHandle(processor, { userId: 'user-1', channel: 'EMAIL', templateKey: 'x', variables: {} });

    expect(result).toEqual({ skipped: 'NO_RECIPIENT' });
  });

  it('ne renvoie pas un message déjà envoyé dans les dernières 24h (idempotence)', async () => {
    const processor = new SendNotificationProcessor(
      {} as TenantAwareJobService,
      fakePrisma({ notification: { findFirst: async () => ({ id: 'notif-existing' }) } }),
      {} as MailerPort,
      {} as SmsPort,
    );

    const result = await callHandle(processor, {
      recipient: 'awa@example.com',
      channel: 'EMAIL',
      templateKey: 'x',
      variables: {},
    });

    expect(result).toEqual({ skipped: 'ALREADY_SENT', notificationId: 'notif-existing' });
  });

  it('compare AUSSI la charge utile : deux messages différents ne sont pas un doublon', async () => {
    // Sans ce prédicat, (destinataire, gabarit, 24 h) suffisait à avaler la
    // seconde notification — silencieusement, et sans que l'émetteur le sache.
    const findFirst = jest.fn(async () => null);
    const processor = new SendNotificationProcessor(
      {} as TenantAwareJobService,
      fakePrisma({
        notification: { findFirst, create: async () => ({ id: 'notif-6' }), update: async () => undefined },
      }),
      { send: jest.fn(async () => ({ providerId: 'mail-3' })) },
      {} as SmsPort,
    );

    await callHandle(processor, {
      recipient: 'awa@example.com',
      channel: 'EMAIL',
      templateKey: 'application.status-changed',
      variables: { status: 'PRESELECTED' },
    });

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ payload: { equals: { status: 'PRESELECTED' } } }),
      }),
    );
  });

  it('envoie quand même si l’appelant désactive la déduplication (dedupeWindowMs: 0)', async () => {
    // Une notification du même gabarit est déjà partie au même destinataire
    // dans les 24 h — mais un second export à la demande porte un AUTRE lien,
    // ce n'est pas un doublon : l'e-mail doit partir.
    const findFirst = jest.fn(async () => ({ id: 'notif-existing' }));
    const create = jest.fn(async () => ({ id: 'notif-5' }));
    const send = jest.fn(async () => ({ providerId: 'mail-2' }));
    const processor = new SendNotificationProcessor(
      {} as TenantAwareJobService,
      fakePrisma({ notification: { findFirst, create, update: async () => undefined } }),
      { send },
      {} as SmsPort,
    );

    const result = await callHandle(processor, {
      recipient: 'admin@example.com',
      channel: 'EMAIL',
      templateKey: 'pool.export-ready',
      variables: { url: 'https://s3.example/export-tier-b.csv' },
      dedupeWindowMs: 0,
    });

    expect(findFirst).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ notificationId: 'notif-5', providerId: 'mail-2' });
  });

  it('marque la notification en échec et relance l’erreur au worker', async () => {
    const create = jest.fn(async () => ({ id: 'notif-4' }));
    const update = jest.fn(async () => undefined);
    const mailer: MailerPort = { send: jest.fn(async () => { throw new Error('SMTP indisponible'); }) };
    const processor = new SendNotificationProcessor(
      {} as TenantAwareJobService,
      fakePrisma({ notification: { findFirst: async () => null, create, update } }),
      mailer,
      {} as SmsPort,
    );

    await expect(
      callHandle(processor, { recipient: 'awa@example.com', channel: 'EMAIL', templateKey: 'x', variables: {} }),
    ).rejects.toThrow('SMTP indisponible');

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) }),
    );
  });
});
