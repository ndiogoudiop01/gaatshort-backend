import { type CanActivate, type ExecutionContext, Inject, Injectable, Logger } from '@nestjs/common';
import { TENANT_CONTEXT, type TenantContextPort } from '@shared/kernel/ports/tenant-context.port';
import { ForbiddenActionError } from '@shared/kernel/errors/domain.error';
import type { AuthenticatedUser } from '@shared/kernel/types/authenticated-user';

/**
 * Dernier contrôle avant le contrôleur : le tenant du token correspond-il
 * au tenant résolu pour la requête ? Une divergence est un incident de
 * sécurité, pas une erreur de saisie — d'où le log en `error`.
 */
@Injectable()
export class TenantMemberGuard implements CanActivate {
  private readonly logger = new Logger(TenantMemberGuard.name);

  constructor(@Inject(TENANT_CONTEXT) private readonly tenantContext: TenantContextPort) {}

  public canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>().user;
    if (!user) return true; // route publique : le guard JWT a déjà tranché

    const current = this.tenantContext.get();
    if (user.tenantId !== current.tenantId) {
      this.logger.error(
        `INCIDENT: user=${user.id} token.tenant=${user.tenantId} request.tenant=${current.tenantId}`,
      );
      throw new ForbiddenActionError('access', 'tenant', 'incohérence de tenant');
    }
    return true;
  }
}
