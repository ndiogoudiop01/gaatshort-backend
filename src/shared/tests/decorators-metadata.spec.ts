/* eslint-disable @typescript-eslint/unbound-method -- les méthodes sont passées à Reflect.getMetadata
   pour inspection, jamais appelées : aucun risque de perte de `this`. */
import 'reflect-metadata';
import { Idempotent, IDEMPOTENT_KEY } from '../decorators/idempotent.decorator';
import { PERMISSIONS_KEY, RequirePermissions, RequireRoles, ROLES_KEY } from '../decorators/permissions.decorator';
import { IS_PUBLIC_KEY, Public } from '../decorators/public.decorator';

class Dummy {
  @Idempotent(3600)
  public withCustomTtl(): void {}

  @Idempotent()
  public withDefaultTtl(): void {}

  @RequirePermissions('application:read', 'application:write')
  public restricted(): void {}

  @RequireRoles('ADMIN')
  public adminOnly(): void {}

  @Public()
  public open(): void {}
}

describe('Décorateurs de métadonnées', () => {
  it('@Idempotent pose la durée de vie personnalisée demandée', () => {
    expect(Reflect.getMetadata(IDEMPOTENT_KEY, Dummy.prototype.withCustomTtl)).toEqual({ ttlSeconds: 3600 });
  });

  it('@Idempotent retombe sur 24h par défaut', () => {
    expect(Reflect.getMetadata(IDEMPOTENT_KEY, Dummy.prototype.withDefaultTtl)).toEqual({ ttlSeconds: 86_400 });
  });

  it('@RequirePermissions pose la liste des permissions requises', () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, Dummy.prototype.restricted)).toEqual([
      'application:read',
      'application:write',
    ]);
  });

  it('@RequireRoles pose la liste des rôles requis', () => {
    expect(Reflect.getMetadata(ROLES_KEY, Dummy.prototype.adminOnly)).toEqual(['ADMIN']);
  });

  it('@Public marque la route comme accessible sans authentification', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, Dummy.prototype.open)).toBe(true);
  });
});
