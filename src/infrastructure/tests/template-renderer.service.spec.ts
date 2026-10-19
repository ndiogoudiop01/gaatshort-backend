import type { TenantPrismaService } from '@infra/persistence/prisma/tenant-prisma.service';
import { TemplateRenderer } from '../mail/template-renderer.service';

function fakePrisma(findFirst: () => Promise<unknown>): TenantPrismaService {
  return { client: { notificationTemplate: { findFirst } } } as unknown as TenantPrismaService;
}

describe('TemplateRenderer', () => {
  it('interpole un gabarit EMAIL par défaut quand le tenant n’en a pas de personnalisé', async () => {
    const renderer = new TemplateRenderer(fakePrisma(async () => null));
    const result = await renderer.render('auth.otp', 'EMAIL', 'fr', { code: '123456', ttlMinutes: 5 });
    expect(result.subject).toBe('Votre code de vérification');
    expect(result.body).toContain('123456');
  });

  it('préfère le gabarit personnalisé du tenant à celui par défaut', async () => {
    const findFirst = jest.fn(async () => ({ subject: 'Sujet perso {{code}}', body: 'Corps {{code}}' }));
    const renderer = new TemplateRenderer(fakePrisma(findFirst));
    const result = await renderer.render('auth.otp', 'EMAIL', 'fr', { code: '999' });
    expect(result.subject).toBe('Sujet perso 999');
    expect(result.body).toBe('Corps 999');
  });

  it('cherche le gabarit du BON canal (SMS ≠ EMAIL)', async () => {
    const findFirst = jest.fn(async () => null);
    const renderer = new TemplateRenderer(fakePrisma(findFirst));
    await renderer.render('auth.otp', 'SMS', 'fr', { code: '1', ttlMinutes: 5 });
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ channel: 'SMS', key: 'auth.otp' }) }),
    );
  });

  it('rend un gabarit SMS par défaut en texte brut (pas de HTML)', async () => {
    const renderer = new TemplateRenderer(fakePrisma(async () => null));
    const result = await renderer.render('auth.otp', 'SMS', 'fr', { code: '654321', ttlMinutes: 10 });
    expect(result.subject).toBe(''); // un SMS n'a pas de sujet
    expect(result.body).toBe('Code de vérification : 654321 (valable 10 min). Ne le partagez pas.');
    expect(result.body).not.toContain('<');
  });

  it('SMS : le gabarit personnalisé du tenant prime aussi', async () => {
    const renderer = new TemplateRenderer(fakePrisma(async () => ({ subject: null, body: 'Code {{code}} - MonAsso' })));
    const result = await renderer.render('auth.otp', 'SMS', 'fr', { code: '42' });
    expect(result.body).toBe('Code 42 - MonAsso');
  });

  it('retombe sur « Gaatshort » pour une clé EMAIL inconnue, sur "" pour un SMS inconnu', async () => {
    const renderer = new TemplateRenderer(fakePrisma(async () => null));
    expect((await renderer.render('inconnue', 'EMAIL', 'fr', {})).subject).toBe('Gaatshort');
    expect((await renderer.render('inconnue', 'SMS', 'fr', {})).body).toBe('');
  });

  it('remplace une variable absente par une chaîne vide', async () => {
    const renderer = new TemplateRenderer(fakePrisma(async () => ({ subject: '{{missing}}', body: '' })));
    expect((await renderer.render('x', 'EMAIL', 'fr', {})).subject).toBe('');
  });

  it('sérialise un objet en JSON plutôt qu’en « [object Object] »', async () => {
    const renderer = new TemplateRenderer(fakePrisma(async () => ({ subject: '{{payload}}', body: '' })));
    expect((await renderer.render('x', 'EMAIL', 'fr', { payload: { a: 1 } })).subject).toBe('{"a":1}');
  });

  it('accède aux variables imbriquées via un chemin pointé', async () => {
    const renderer = new TemplateRenderer(fakePrisma(async () => ({ subject: '{{user.firstName}}', body: '' })));
    expect((await renderer.render('x', 'EMAIL', 'fr', { user: { firstName: 'Awa' } })).subject).toBe('Awa');
  });
});
