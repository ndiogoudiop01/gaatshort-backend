import { Global, Module } from '@nestjs/common';
import { UNIT_OF_WORK } from '@shared/kernel/ports/unit-of-work.port';
import { PrismaUnitOfWork } from '../transaction/prisma-unit-of-work';
import { PrismaService } from './prisma.service';
import { TenantPrismaService } from './tenant-prisma.service';
import { TransactionHost } from './transaction-host.service';

@Global()
@Module({
  providers: [
    PrismaService,
    TransactionHost,
    TenantPrismaService,
    PrismaUnitOfWork,
    { provide: UNIT_OF_WORK, useExisting: PrismaUnitOfWork },
  ],
  exports: [PrismaService, TenantPrismaService, TransactionHost, UNIT_OF_WORK],
})
export class PrismaModule {}
