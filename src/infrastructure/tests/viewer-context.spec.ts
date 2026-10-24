import type { Request } from 'express';
import { prismaMock, tenantContext } from '@shared/tests/test-utils/prisma-mock';
import { countryFromPhone, ViewerContextService } from '../viewer/viewer-context.service';

const req = (headers: Record<string, string> = {}, query: Record<string, string> = {}) => ({ headers, query }) as unknown as Request;

describe('ViewerContextService', () => {
  it('pays depuis l’indicatif', () => {
    expect(countryFromPhone('+221771234567')).toBe('SN');
    expect(countryFromPhone('+2207012345')).toBe('GM');
    expect(countryFromPhone('+33600000000')).toBeNull();
    expect(countryFromPhone(null)).toBeNull();
  });

  it('anonyme : pays du CDN sinon de la marque ; langue de la requête', async () => {
    const { prisma } = prismaMock();
    const s = new ViewerContextService(prisma, tenantContext() as never);
    await expect(s.resolve(req({ 'cf-ipcountry': 'GM', 'accept-language': 'en-GB' }))).resolves.toEqual({ accountId: null, country: 'GM', locale: 'en' });
    await expect(s.resolve(req({ 'cf-ipcountry': 'XX1' }, { locale: 'fr' }))).resolves.toEqual({ accountId: null, country: 'SN', locale: 'fr' });
  });

  it('connecté : pays et langue du compte priment', async () => {
    const { prisma, client } = prismaMock();
    client.account.findUnique.mockResolvedValueOnce({ countryCode: 'GM', locale: 'en' });
    const s = new ViewerContextService(prisma, tenantContext() as never);
    await expect(s.resolve(req({ 'cf-ipcountry': 'SN' }), { accountId: 'a' } as never)).resolves.toEqual({ accountId: 'a', country: 'GM', locale: 'en' });
  });
});
