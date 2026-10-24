import { ValidationPipe, VersioningType, type INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { execSync } from 'node:child_process';
import request from 'supertest';
import { SMS_SENDER } from '@shared/kernel/ports/sms.port';
import { AllExceptionsFilter } from '@shared/filters/all-exceptions.filter';
import { ResponseEnvelopeInterceptor } from '@shared/interceptors/response-envelope.interceptor';
import { TenantTestContext } from '../utils/tenant-test-context';

/**
 * Parcours complet du spectateur contre un PostgreSQL réel (rôle applicatif
 * NOBYPASSRLS, RLS active) : vitrine → épisode gratuit → épisode verrouillé →
 * connexion OTP → achat simulé (notification signée, chemin réel) → crédit
 * unique → déblocage idempotent → lecture → progression, favoris ; puis
 * portefeuille COMMUN sur une seconde marque (Q-02) et back-office.
 */
jest.setTimeout(240_000);

describe('Parcours spectateur (de bout en bout)', () => {
  const ctx = new TenantTestContext();
  let app: INestApplication;
  let owner: PrismaClient;
  const sms: { to: string; body: string }[] = [];
  const PHONE = '+221770000001';

  beforeAll(async () => {
    const env = await ctx.start();
    Object.assign(process.env, {
      NODE_ENV: 'test',
      SEED_ADMIN_EMAIL: 'admin@gaatshort.test',
      SEED_ADMIN_PASSWORD: 'Admin-Test-2026!',
      ARGON2_MEMORY_COST: '4096',
    });
    execSync('pnpm db:seed', { env: { ...process.env, DATABASE_URL: env.databaseUrl }, stdio: 'inherit' });
    owner = new PrismaClient({ datasources: { db: { url: env.databaseUrl } } });

    Object.assign(process.env, {
      DATABASE_URL: env.appDatabaseUrl,
      DATABASE_DIRECT_URL: env.appDatabaseUrl,
      REDIS_URL: env.redisUrl,
      APP_PUBLIC_URL: 'http://api.test',
      FRONTEND_URL: 'http://web.test',
      CORS_ORIGINS: 'http://web.test',
      TENANCY_ROOT_DOMAIN: 'gaatshort.test',
      TENANCY_DEFAULT_SLUG: 'gaatshort',
      JWT_ACCESS_SECRET: 'a'.repeat(40),
      JWT_REFRESH_SECRET: 'b'.repeat(40),
      STORAGE_BUCKET: 'test', STORAGE_ACCESS_KEY: 'x', STORAGE_SECRET_KEY: 'x', STORAGE_ALLOWED_MIME: 'image/png',
      MAIL_DRIVER: 'log', MAIL_FROM: 'test@gaatshort.test', SMS_DRIVER: 'log',
      VIDEO_DRIVER: 'fake', PAYMENT_DRIVER: 'fake', LOG_LEVEL: 'error', METRICS_ENABLED: 'false',
    });

    // Import tardif : la configuration est validée à l'import du module.
    const { AppModule } = await import('../../src/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SMS_SENDER)
      .useValue({ send: async (m: { to: string; body: string }) => { sms.push(m); return { providerId: 'test' }; } })
      .compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } }));
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor(app.get(Reflector)));
    app.useGlobalFilters(new AllExceptionsFilter(false));
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await owner?.$disconnect();
    await ctx.stop();
  });

  const http = (tenant = 'gaatshort') => {
    const srv = app.getHttpServer();
    return {
      get: (p: string, token?: string) => withAuth(request(srv).get(`/api/v1${p}`).set('x-tenant-id', tenant), token),
      post: (p: string, body: object = {}, token?: string) => withAuth(request(srv).post(`/api/v1${p}`).set('x-tenant-id', tenant).send(body), token),
      put: (p: string, body: object = {}, token?: string) => withAuth(request(srv).put(`/api/v1${p}`).set('x-tenant-id', tenant).send(body), token),
    };
  };
  const withAuth = (r: request.Test, token?: string) => (token ? r.set('authorization', `Bearer ${token}`) : r);

  async function login(tenant = 'gaatshort'): Promise<string> {
    await http(tenant).post('/auth/challenge', { channel: 'PHONE_OTP', identifier: PHONE }).expect(200);
    const code = /(\d{6})/.exec(sms[sms.length - 1]?.body ?? '')?.[1];
    expect(code).toBeDefined();
    const res = await http(tenant).post('/auth/verify', { identifier: PHONE, secret: code }).expect(200);
    return res.body.data.accessToken as string;
  }

  let token: string;
  let episodes: { id: string; number: number; isFree: boolean; priceCoins: number }[];

  it('vitrine publique : séries de démonstration, 5 épisodes gratuits', async () => {
    const home = await http().get('/storefront/home').expect(200);
    expect(home.body.data.featured.length).toBeGreaterThan(0);
    const detail = await http().get('/storefront/series/le-pacte-de-ngor').expect(200);
    episodes = detail.body.data.episodes;
    expect(episodes).toHaveLength(12);
    expect(episodes.filter((e) => e.isFree).map((e) => e.number)).toEqual([1, 2, 3, 4, 5]);
    expect(episodes[5]).toMatchObject({ isFree: false, priceCoins: 15 });
    await http().get('/billing/packs').expect(200).expect((r) => expect(r.body.data).toHaveLength(4));
  });

  it('épisode gratuit lisible sans compte ; payant verrouillé', async () => {
    const free = await http().get(`/episodes/${episodes[0].id}/playback`).expect(200);
    expect(free.body.data.hlsUrl).toMatch(/^https:\/\//);
    const locked = await http().get(`/episodes/${episodes[5].id}/playback`).expect(403);
    expect(locked.body.error).toMatchObject({ code: 'EPISODE_LOCKED' });
  });

  it('connexion OTP puis solde insuffisant', async () => {
    token = await login();
    await http().get('/wallet', token).expect(200).expect((r) => expect(r.body.data.total).toBe(0));
    const r = await http().post(`/episodes/${episodes[5].id}/unlock`, {}, token).expect(409);
    expect(r.body.error.code).toBe('INSUFFICIENT_BALANCE');
  });

  let reference: string;

  it('achat simulé : la commande n’est créditée qu’une fois, sur notification signée', async () => {
    const packs = await http().get('/billing/packs').expect(200);
    const pack = (packs.body.data as { id: string; code: string }[]).find((p) => p.code === 'pack-220');
    expect(pack).toBeDefined();
    if (!pack) return;
    await http().post('/billing/orders', { packId: pack.id }, token).expect(400); // sans Idempotency-Key
    const order = await http().post('/billing/orders', { packId: pack.id }, token).set('idempotency-key', 'achat-test-0001').expect(201);
    reference = order.body.data.reference;
    expect(order.body.data).toMatchObject({ status: 'PENDING', amountMinor: 2000 });
    const again = await http().post('/billing/orders', { packId: pack.id }, token).set('idempotency-key', 'achat-test-0001').expect(201);
    expect(again.body.data.reference).toBe(reference);

    await http().get(`/billing/fake-checkout/${reference}`).expect(200);
    await http().post(`/billing/fake-checkout/${reference}/PAID`).expect(201);
    await http().post(`/billing/fake-checkout/${reference}/PAID`).expect(201); // rejouée
    const paid = await http().get(`/billing/orders/${reference}`, token).expect(200);
    expect(paid.body.data.status).toBe('SUCCEEDED');
    await http().get('/wallet', token).expect(200).expect((r) => expect(r.body.data).toEqual({ paidBalance: 200, bonusBalance: 20, total: 220 }));
  });

  it('déblocage idempotent puis lecture ; le grand livre est immuable', async () => {
    const u = await http().post(`/episodes/${episodes[5].id}/unlock`, {}, token).expect(200);
    expect(u.body.data).toMatchObject({ chargedCoins: 15, alreadyUnlocked: false, balance: { total: 205, bonusBalance: 5 } });
    const twice = await http().post(`/episodes/${episodes[5].id}/unlock`, {}, token).expect(200);
    expect(twice.body.data).toMatchObject({ chargedCoins: 0, alreadyUnlocked: true });
    await http().get(`/episodes/${episodes[5].id}/playback`, token).expect(200);
    const ledger = await http().get('/wallet/ledger', token).expect(200);
    expect((ledger.body.data.items as { kind: string }[]).map((i) => i.kind)).toEqual(['UNLOCK_DEBIT', 'PURCHASE_CREDIT']);
    await expect(owner.$executeRawUnsafe('UPDATE wallet_ledger_entries SET reason = $1', 'x')).rejects.toThrow(/ajout seul/);
  });

  it('progression, reprise, favoris', async () => {
    await http().put(`/episodes/${episodes[5].id}/progress`, { positionSeconds: 33 }, token).expect(200);
    const cw = await http().get('/me/continue-watching', token).expect(200);
    expect(cw.body.data[0]).toMatchObject({ episodeId: episodes[5].id, positionSeconds: 33 });
    await http().post('/me/favorites/le-pacte-de-ngor', {}, token).expect(200);
    const fav = await http().get('/me/favorites', token).expect(200);
    expect(fav.body.data[0].slug).toBe('le-pacte-de-ngor');
    const d = await http().get('/storefront/series/le-pacte-de-ngor', token).expect(200);
    expect(d.body.data).toMatchObject({ isFavorite: true, resume: { episodeId: episodes[5].id } });
    expect(d.body.data.episodes[5].unlocked).toBe(true);
  });

  it('portefeuille commun : même solde et mêmes droits sur une autre marque, progression séparée', async () => {
    const t2 = await owner.tenant.create({ data: { slug: 'kaay-drama', name: 'Kaay Drama', status: 'ACTIVE' } });
    const series = await owner.series.findUniqueOrThrow({ where: { slug: 'le-pacte-de-ngor' } });
    const viewer = await owner.role.findFirstOrThrow({ where: { key: 'VIEWER' } });
    await owner.role.create({ data: { tenantId: t2.id, key: 'VIEWER', name: viewer.name, isSystem: true } });
    await owner.tenantSeries.create({ data: { tenantId: t2.id, seriesId: series.id, status: 'LIVE' } });
    const token2 = await login('kaay-drama');
    await http('kaay-drama').get('/wallet', token2).expect(200).expect((r) => expect(r.body.data.total).toBe(205));
    await http('kaay-drama').get(`/episodes/${episodes[5].id}/playback`, token2).expect(200);
    await http('kaay-drama').get('/me/continue-watching', token2).expect(200).expect((r) => expect(r.body.data).toEqual([]));
    const cfg = await http('kaay-drama').get('/storefront/config').expect(200);
    expect(cfg.body.data.accountNotice).toBe('Connexion avec votre compte Gaatshort');
    // Isolation : le jeton de la marque A est REFUSÉ sur la marque B (le middleware de tenancy
    // du socle répond 400 TENANT_NOT_RESOLVED et journalise une tentative de traversée).
    const crossed = await http('kaay-drama').get('/wallet', token);
    expect([400, 403, 404]).toContain(crossed.status);
    expect(crossed.body.success).toBe(false);
  });

  it('back-office : tableau de bord, catalogue, commandes, spectateurs', async () => {
    const res = await http().post('/auth/login', { email: 'admin@gaatshort.test', password: 'Admin-Test-2026!' }).expect(200);
    const admin = res.body.data.accessToken as string;
    const dash = await http().get('/admin/dashboard', admin).expect(200);
    expect(dash.body.data).toMatchObject({ paidOrders30d: 1, revenue30d: [{ currencyCode: 'XOF', amountMinor: 2000 }], liveSeries: 3 });
    await http().get('/admin/series', admin).expect(200).expect((r) => expect(r.body.meta.total).toBe(3));
    const orders = await http().get('/admin/orders', admin).expect(200);
    expect(orders.body.data[0]).toMatchObject({ reference, status: 'SUCCEEDED' });
    const viewers = await http().get('/admin/viewers', admin).expect(200);
    const accountId = viewers.body.data[0].accountId as string;
    const adj = await http().post(`/admin/viewers/${accountId}/wallet/adjust`, { delta: 10, reason: 'geste commercial test' }, admin).expect(200);
    expect(adj.body.data.total).toBe(215);
    // Le spectateur n'a aucun droit back-office.
    await http().get('/admin/dashboard', token).expect(403);

    // Création d'une série, d'un épisode, vidéo factice, publication.
    const g = await http().get('/admin/genres', admin).expect(200);
    const created = await http().post('/admin/series', { titleFr: 'Série de test', genreIds: [g.body.data[0].id] }, admin).expect(201);
    const sid = created.body.data.id as string;
    const ep = await http().post(`/admin/series/${sid}/episodes`, { titleFr: 'Pilote' }, admin).expect(201);
    await http().post(`/admin/episodes/${ep.body.data.id}/video/upload`, {}, admin).expect(201);
    await http().post(`/admin/episodes/${ep.body.data.id}/publish`, {}, admin).expect(200);
    await http().post(`/admin/series/${sid}/publish`, {}, admin).expect(422); // pas de licence
  });
});
