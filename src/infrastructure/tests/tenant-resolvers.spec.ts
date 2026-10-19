import type { Request } from 'express';
import type { JwtService } from '@nestjs/jwt';
import type { AppConfigService } from '@config/app-config.service';
import { HeaderTenantResolver } from '../tenancy/resolvers/header-tenant.resolver';
import { SubdomainTenantResolver } from '../tenancy/resolvers/subdomain-tenant.resolver';
import { JwtTenantResolver } from '../tenancy/resolvers/jwt-tenant.resolver';

function req(overrides: Partial<Request>): Request {
  return { headers: {}, ...overrides } as Request;
}

describe('HeaderTenantResolver', () => {
  const config = { tenancy: { headerName: 'X-Tenant-Id' } } as unknown as AppConfigService;
  const resolver = new HeaderTenantResolver(config);

  it('lit le tenant depuis l’en-tête configuré', () => {
    expect(resolver.resolve(req({ headers: { 'x-tenant-id': 'gaatshort' } }))).toBe('gaatshort');
  });

  it('renvoie null en l’absence de l’en-tête', () => {
    expect(resolver.resolve(req({ headers: {} }))).toBeNull();
  });
});

describe('SubdomainTenantResolver', () => {
  const config = { tenancy: { rootDomain: 'gaatshort.com' } } as unknown as AppConfigService;
  const resolver = new SubdomainTenantResolver(config);

  it('extrait le slug du sous-domaine', () => {
    expect(resolver.resolve(req({ hostname: 'kaay.gaatshort.com' }))).toBe('kaay');
  });

  it('renvoie null sur le domaine racine', () => {
    expect(resolver.resolve(req({ hostname: 'gaatshort.com' }))).toBeNull();
    expect(resolver.resolve(req({ hostname: 'www.gaatshort.com' }))).toBeNull();
  });

  it('renvoie null pour les sous-domaines techniques www/api', () => {
    expect(resolver.resolve(req({ hostname: 'api.gaatshort.com' }))).toBeNull();
  });

  it('accepte un domaine personnalisé complet', () => {
    expect(resolver.resolve(req({ hostname: 'kaay.africa' }))).toBe('kaay.africa');
  });

  it('renvoie null pour un hôte qui ne peut pas être un domaine (dev/test)', () => {
    expect(resolver.resolve(req({ hostname: 'localhost' }))).toBeNull();
    expect(resolver.resolve(req({ hostname: '127.0.0.1' }))).toBeNull();
    expect(resolver.resolve(req({ hostname: 'api-gateway' }))).toBeNull();
  });

  it('ignore un x-forwarded-host forgé et s’en tient à request.hostname', () => {
    // `request.hostname` est déjà filtré par `trust proxy` en amont ; lire
    // l'en-tête brut ici serait un vecteur d'usurpation de tenant sur les
    // routes publiques.
    expect(
      resolver.resolve(req({ hostname: 'localhost', headers: { 'x-forwarded-host': 'kaay.gaatshort.com' } })),
    ).toBeNull();
    expect(
      resolver.resolve(req({ hostname: 'kaay.gaatshort.com', headers: { 'x-forwarded-host': 'intrus.gaatshort.com' } })),
    ).toBe('kaay');
  });

  it('ignore le port dans le host', () => {
    expect(resolver.resolve(req({ hostname: 'kaay.gaatshort.com:3000' }))).toBe('kaay');
  });
});

describe('JwtTenantResolver', () => {
  it('extrait le tenant scellé dans un jeton Bearer valide', () => {
    const jwt = { decode: () => ({ tid: 'tenant-1' }) } as unknown as JwtService;
    const resolver = new JwtTenantResolver(jwt);
    expect(resolver.resolve(req({ headers: { authorization: 'Bearer abc.def.ghi' } }))).toBe('tenant-1');
  });

  it('renvoie null sans en-tête Authorization', () => {
    const resolver = new JwtTenantResolver({} as JwtService);
    expect(resolver.resolve(req({ headers: {} }))).toBeNull();
  });

  it('renvoie null pour un schéma d’autorisation non-Bearer', () => {
    const resolver = new JwtTenantResolver({} as JwtService);
    expect(resolver.resolve(req({ headers: { authorization: 'Basic xyz' } }))).toBeNull();
  });

  it('renvoie null si le décodage du jeton échoue', () => {
    const jwt = {
      decode: () => {
        throw new Error('jeton malformé');
      },
    } as unknown as JwtService;
    const resolver = new JwtTenantResolver(jwt);
    expect(resolver.resolve(req({ headers: { authorization: 'Bearer invalide' } }))).toBeNull();
  });

  it('renvoie null si le jeton ne porte aucun tenant', () => {
    const jwt = { decode: () => ({}) } as unknown as JwtService;
    const resolver = new JwtTenantResolver(jwt);
    expect(resolver.resolve(req({ headers: { authorization: 'Bearer abc' } }))).toBeNull();
  });
});
