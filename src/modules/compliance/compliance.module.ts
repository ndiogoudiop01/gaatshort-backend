import { Module } from '@nestjs/common';
import { SecurityModule } from '@infra/security/security.module';
import { CONSENT_FACADE } from './compliance.facade';
import { ConsentService } from './application/services/consent.service';
import { ConsentsController } from './presentation/http/consents.controller';
import { DataRetentionJob } from './infrastructure/jobs/data-retention.job';

@Module({
  imports: [SecurityModule],
  controllers: [ConsentsController],
  providers: [ConsentService, { provide: CONSENT_FACADE, useExisting: ConsentService }, DataRetentionJob],
  exports: [CONSENT_FACADE],
})
export class ComplianceModule {}
