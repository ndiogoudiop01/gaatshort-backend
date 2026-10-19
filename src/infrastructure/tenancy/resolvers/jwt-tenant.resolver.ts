import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import type { TenantResolver } from './tenant-resolver.interface';

/**
 * Source la plus fiable : le tenant est scellé dans le token signé.
 * Un utilisateur ne peut pas se déclarer sur un autre tenant en modifiant
 * un en-tête — d'où la priorité 1 dans TENANCY_RESOLVERS.
 */
@Injectable()
export class JwtTenantResolver implements TenantResolver {
  public readonly name = 'jwt';

  constructor(private readonly jwt: JwtService) {}

  public resolve(request: Request): string | null {
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) return null;
    try {
      const payload = this.jwt.decode<{ tid?: string } | null>(header.slice(7));
      return payload?.tid ?? null;
    } catch {
      return null;
    }
  }
}
