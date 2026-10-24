import { type ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_OPTIONAL_AUTH_KEY, IS_PUBLIC_KEY } from '@shared/decorators/public.decorator';

/**
 * Guard global : tout est protégé par défaut, on ouvre explicitement avec
 * `@Public()`. L'inverse (protéger au cas par cas) finit toujours par laisser
 * une route ouverte par oubli.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  public override canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    const isOptional = this.reflector.getAllAndOverride<boolean>(IS_OPTIONAL_AUTH_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isOptional) {
      const header = context.switchToHttp().getRequest<{ headers: Record<string, unknown> }>().headers
        .authorization;
      if (typeof header !== 'string' || header.trim() === '') return true;
    }
    return super.canActivate(context);
  }

  public override handleRequest<TUser>(err: unknown, user: TUser): TUser {
    if (err || !user) {
      throw err instanceof Error ? err : new UnauthorizedException('Authentification requise');
    }
    return user;
  }
}
