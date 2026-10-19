import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import {
  type TenantContextData,
  type TenantContextPort,
} from '@shared/kernel/ports/tenant-context.port';
import { MissingTenantContextError } from '../tenancy.errors';

interface Store {
  tenant: TenantContextData | null;
  privileged: boolean;
  privilegeReason?: string;
}

/**
 * Implémentation AsyncLocalStorage du contexte de tenant.
 *
 * POURQUOI PAS un provider `scope: Scope.REQUEST` ?
 * Parce que NestJS reconstruit alors toute la chaîne d'injection à chaque
 * requête (contrôleur → use case → repository → …). Sur un dashboard qui
 * instancie 30 providers, c'est ~30 % de latence en plus et un GC qui souffre.
 * ALS donne le même isolement, en singleton, à coût quasi nul.
 */
@Injectable()
export class TenantContextService implements TenantContextPort {
  private readonly als = new AsyncLocalStorage<Store>();

  public get(): TenantContextData {
    const tenant = this.als.getStore()?.tenant;
    if (!tenant) throw new MissingTenantContextError();
    return tenant;
  }

  public getOrNull(): TenantContextData | null {
    return this.als.getStore()?.tenant ?? null;
  }

  public get tenantId(): string {
    return this.get().tenantId;
  }

  public runWith<T>(tenant: TenantContextData, fn: () => Promise<T>): Promise<T> {
    return this.als.run({ tenant, privileged: false }, fn);
  }

  /**
   * Sortie de l'isolation, volontaire et tracée. Utilisé uniquement par :
   *   - le relais outbox (parcourt tous les tenants),
   *   - les purges RGPD planifiées,
   *   - l'agrégation de métriques plateforme.
   * Toute autre utilisation doit être refusée en revue de code.
   */
  public runPrivileged<T>(reason: string, fn: () => Promise<T>): Promise<T> {
    return this.als.run({ tenant: null, privileged: true, privilegeReason: reason }, fn);
  }

  public isPrivileged(): boolean {
    return this.als.getStore()?.privileged === true;
  }

  public get privilegeReason(): string | undefined {
    return this.als.getStore()?.privilegeReason;
  }
}
