import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { AppConfigService } from '@config/app-config.service';
import type { TenantResolver } from './tenant-resolver.interface';

/**
 * Repli pour les appels serveur-à-serveur, les tests et le développement local.
 * ATTENTION : en production, cet en-tête n'est accepté QUE sur les routes
 * publiques non authentifiées ; dès qu'un JWT est présent, le tenant du token
 * fait foi et un désaccord lève une alerte de sécurité (cf. TenantMiddleware).
 */
@Injectable()
export class HeaderTenantResolver implements TenantResolver {
  public readonly name = 'header';

  constructor(private readonly config: AppConfigService) {}

  public resolve(request: Request): string | null {
    const value = request.headers[this.config.tenancy.headerName.toLowerCase()];
    return typeof value === 'string' && value.length > 0 ? value : null;
  }
}
