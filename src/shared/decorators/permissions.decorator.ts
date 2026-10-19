import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'auth:permissions';
export const ROLES_KEY = 'auth:roles';

/**
 * RBAC à granularité fine. On raisonne en permissions (`application:transition`),
 * pas en rôles, pour éviter les `if (user.role === 'ADMIN')` disséminés :
 * un nouveau rôle ne doit jamais demander de modifier un contrôleur.
 */
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

export const RequireRoles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
