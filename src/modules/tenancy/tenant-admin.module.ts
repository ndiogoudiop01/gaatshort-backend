import { Module } from '@nestjs/common';
import { AdminTenantsService } from './application/admin-tenants.service';
import { TENANT_DATA_INVENTORY } from './domain/ports/tenant-data-inventory.port';
import { PrismaTenantDataInventory } from './infrastructure/persistence/tenant-data-inventory';
import { TenantsController } from './presentation/http/tenants.controller';

@Module({
  controllers: [TenantsController],
  providers: [
    // BSG-13 — lecture paginée et écriture bornée (DTO + liste blanche) des tenants ;
    // création et suppression (sans données) par le SUPER_ADMIN.
    AdminTenantsService,
    { provide: TENANT_DATA_INVENTORY, useClass: PrismaTenantDataInventory },
  ],
})
export class TenantAdminModule {}
