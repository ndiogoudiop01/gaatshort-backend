import { Global, Module } from '@nestjs/common';
import { LocalizationService } from './application/services/localization.service';
import { LocalizationController } from './presentation/http/localization.controller';

/**
 * Global : la normalisation téléphonique et le formatage monétaire sont
 * utilisés par IAM, candidatures, partenaires et notifications.
 */
@Global()
@Module({
  controllers: [LocalizationController],
  providers: [LocalizationService],
  exports: [LocalizationService],
})
export class LocalizationModule {}
