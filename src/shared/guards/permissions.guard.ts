import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ForbiddenActionError } from '@shared/kernel/errors/domain.error';
import { PERMISSIONS_KEY, ROLES_KEY } from '@shared/decorators/permissions.decorator';
import { IS_PUBLIC_KEY } from '@shared/decorators/public.decorator';
import type { AuthenticatedUser } from '@shared/kernel/types/authenticated-user';

/**
 * RBAC grossier (« a-t-il le droit d'appeler cet endpoint ? »).
 * Le contrôle fin (« a-t-il le droit sur CETTE ressource ? ») relève des
 * policies ABAC du module — cf. ApplicationAccessPolicy.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  public canActivate(context: ExecutionContext): boolean {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()])) {
      return true;
    }

    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length && !requiredRoles?.length) return true;

    const user = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>().user;
    if (!user) throw new ForbiddenActionError('access', context.getClass().name, 'non authentifié');

    if (requiredRoles?.length && !requiredRoles.some((r) => user.roles.includes(r))) {
      throw new ForbiddenActionError('access', context.getClass().name, `rôle requis: ${requiredRoles.join('|')}`);
    }
    if (required?.length && !required.every((p) => user.permissions.includes(p))) {
      throw new ForbiddenActionError('access', context.getClass().name, `permission requise: ${required.join(', ')}`);
    }
    return true;
  }
}
