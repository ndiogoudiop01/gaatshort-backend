import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { AppConfigService } from '@config/app-config.service';
import type { TenantResolver } from './tenant-resolver.interface';

const IPV4_LITERAL = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/**
 * kaay.gaatshort.com → slug « kaay ».
 * Mode nominal pour le trafic navigateur public (pages vitrine, simulateur).
 */
@Injectable()
export class SubdomainTenantResolver implements TenantResolver {
  public readonly name = 'subdomain';

  constructor(private readonly config: AppConfigService) {}

  public resolve(request: Request): string | null {
    // `request.hostname` est filtré par `trust proxy` (cf. bootstrap/security.ts) :
    // il ne prend `X-Forwarded-Host` en compte que si la requête vient d'un proxy
    // de confiance. Lire l'en-tête brut laisserait n'importe quel client se faire
    // passer pour `<tenant>.gaatshort.com` sur une route publique — le
    // résolveur `subdomain` étant prioritaire sur l'en-tête `x-tenant-id`.
    const host = request.hostname;
    if (!host) return null;

    const hostname = host.split(':')[0].toLowerCase();
    const root = this.config.tenancy.rootDomain.toLowerCase();

    if (hostname === root || hostname === `www.${root}`) return null;

    if (!hostname.endsWith(`.${root}`)) {
      // Domaine personnalisé (candidatures.partenaire.com → tenant via
      // tenant_domains). On écarte tout ce qui ne peut PAS en être un :
      // `localhost`, noms de service Docker, IP littérales. Sinon ce
      // résolveur renvoie « localhost » comme identifiant et masque
      // l'en-tête x-tenant-id en dev et en test (l'ordre des résolveurs
      // s'arrête au premier qui répond).
      if (!hostname.includes('.') || IPV4_LITERAL.test(hostname)) return null;
      return hostname;
    }

    const sub = hostname.slice(0, -(root.length + 1));
    if (!sub || sub === 'www' || sub === 'api') return null;
    return sub;
  }
}
