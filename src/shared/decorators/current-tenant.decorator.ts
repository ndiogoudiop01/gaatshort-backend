import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { TenantContextData } from '@shared/kernel/ports/tenant-context.port';

/**
 * Confort de lecture : le tenant reste disponible partout via ALS,
 * ce décorateur ne sert qu'à le rendre explicite en signature de contrôleur.
 */
export const CurrentTenant = createParamDecorator(
  (field: keyof TenantContextData | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<{ tenant?: TenantContextData }>();
    return field ? request.tenant?.[field] : request.tenant;
  },
);
