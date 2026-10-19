import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AppConfigService } from '@config/app-config.service';
import type { AuthenticatedUser, JwtAccessPayload } from '@shared/kernel/types/authenticated-user';
import { TenantPrismaService } from '@infra/persistence/prisma/tenant-prisma.service';

/**
 * Validation du JWT.
 *
 * On vérifie que la SESSION est toujours active en base : sans ce contrôle,
 * une déconnexion ne déconnecte rien pendant la durée de vie du token
 * d'accès. Le coût est un SELECT indexé, largement absorbé par le cache
 * de Postgres, et c'est le prix d'une révocation qui fonctionne vraiment.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: AppConfigService,
    private readonly prisma: TenantPrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.auth.accessSecret,
    });
  }

  public async validate(payload: JwtAccessPayload): Promise<AuthenticatedUser> {
    const session = await this.prisma.client.authSession.findFirst({
      where: { id: payload.sid, revokedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true },
    });
    if (!session) throw new UnauthorizedException('Session révoquée');

    return {
      id: payload.sub,
      tenantId: payload.tid,
      email: payload.email,
      roles: payload.roles,
      permissions: payload.perms,
      sessionId: payload.sid,
      countries: payload.cty ?? null,
    };
  }
}
