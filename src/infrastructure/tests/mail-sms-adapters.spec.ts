import { Logger } from '@nestjs/common';
import type { AppConfigService } from '@config/app-config.service';
import type { TemplateRenderer } from '../mail/template-renderer.service';
import { SmtpMailerAdapter } from '../mail/adapters/smtp-mailer.adapter';
import { LogMailerAdapter } from '../mail/adapters/log-mailer.adapter';
import { LogSmsAdapter } from '../sms/adapters/log-sms.adapter';

const fakeRenderer = (over: Partial<Record<'subject' | 'body', string>> = {}): TemplateRenderer =>
  ({
    render: jest.fn(async () => ({ subject: over.subject ?? 'Sujet', body: over.body ?? '<p>Corps</p>' })),
  }) as unknown as TemplateRenderer;

const fakeConfig = (): AppConfigService =>
  ({ mail: { from: 'no-reply@x', smtp: { host: 'smtp.x', port: 587 } } }) as unknown as AppConfigService;

describe('SmtpMailerAdapter', () => {
  it('rend le gabarit (canal EMAIL) puis renvoie un identifiant fournisseur', async () => {
    const render = jest.fn(async () => ({ subject: 'Sujet', body: '<p>Corps</p>' }));
    const adapter = new SmtpMailerAdapter({ render } as unknown as TemplateRenderer, fakeConfig());

    const result = await adapter.send({ to: 'awa@example.com', template: 'auth.otp', variables: { code: '123456' } });

    expect(render).toHaveBeenCalledWith('auth.otp', 'EMAIL', 'fr', { code: '123456' });
    expect(result.providerId).toMatch(/^smtp-/);
  });

  it('un `subject` explicite surcharge le sujet du gabarit', async () => {
    const renderer = fakeRenderer({ subject: 'Sujet du gabarit' });
    const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const adapter = new SmtpMailerAdapter(renderer, fakeConfig());

    await adapter.send({ to: 'x', template: 't', variables: {}, subject: 'Sujet forcé' });

    expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({ subject: 'Sujet forcé' }));
    logSpy.mockRestore();
  });
});

describe('LogMailerAdapter', () => {
  it('renvoie un identifiant simulé sans serveur SMTP', async () => {
    const adapter = new LogMailerAdapter(fakeRenderer());
    const result = await adapter.send({ to: 'awa@example.com', template: 'auth.otp', variables: {} });
    expect(result.providerId).toMatch(/^log-/);
  });
});

describe('LogSmsAdapter', () => {
  it('renvoie un identifiant de fournisseur simulé', async () => {
    const result = await new LogSmsAdapter().send({ to: '+221771234567', body: 'Votre code : 123456' });
    expect(result.providerId).toMatch(/^log-/);
  });
});
