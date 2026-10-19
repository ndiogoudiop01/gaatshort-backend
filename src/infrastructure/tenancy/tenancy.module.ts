import { Global, Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TENANT_CONTEXT } from '@shared/kernel/ports/tenant-context.port';
import { TenantContextService } from './context/tenant-context.service';
import { TenantMiddleware } from './middleware/tenant.middleware';
import { TenantRegistryService } from './registry/tenant-registry.service';
import { HeaderTenantResolver } from './resolvers/header-tenant.resolver';
import { JwtTenantResolver } from './resolvers/jwt-tenant.resolver';
import { SubdomainTenantResolver } from './resolvers/subdomain-tenant.resolver';
import { TENANT_RESOLVERS } from './resolvers/tenant-resolver.interface';

@Global()
@Module({
  imports: [JwtModule.register({})],
  providers: [
    TenantContextService,
    { provide: TENANT_CONTEXT, useExisting: TenantContextService },
    TenantRegistryService,
    JwtTenantResolver,
    SubdomainTenantResolver,
    HeaderTenantResolver,
    {
      provide: TENANT_RESOLVERS,
      inject: [JwtTenantResolver, SubdomainTenantResolver, HeaderTenantResolver],
      useFactory: (...resolvers: unknown[]) => resolvers,
    },
  ],
  exports: [TenantContextService, TENANT_CONTEXT, TenantRegistryService],
})
export class TenancyModule implements NestModule {
  public configure(consumer: MiddlewareConsumer): void {
    // Toutes les routes sauf la sonde de santé et les métriques,
    // qui doivent répondre même si Postgres est injoignable.
    //
    // Ces chemins doivent correspondre mot pour mot à ceux exclus du préfixe
    // global dans main.ts : `MiddlewareConsumer.exclude()` ne retire le préfixe
    // (`/api`) d'un chemin d'exclusion que s'il figure à l'identique dans
    // `setGlobalPrefix({ exclude })`. Un motif générique (`health/{*path}`)
    // serait réécrit en `/api/health/...` et ne filtrerait jamais `/health/live`.
    consumer
      .apply(TenantMiddleware)
      .exclude('health/live', 'health/ready', 'metrics')
      .forRoutes('*');
  }
}
