import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '@shared/decorators/public.decorator';
import { CurrentTenant } from '@shared/decorators/current-tenant.decorator';
import type { TenantContextData } from '@shared/kernel/ports/tenant-context.port';
import { LocalizationService } from '../../application/services/localization.service';

/** US-IG-029 — sélecteur pays / devise / indicatif du frontend. */
@ApiTags('Public — Contenu')
@Controller({ path: 'localization', version: '1' })
export class LocalizationController {
  constructor(private readonly localization: LocalizationService) {}

  @Public()
  @Get('countries')
  @ApiOperation({ summary: 'Pays activés, indicatifs téléphoniques et devises' })
  public countries() {
    return this.localization.availableCountries();
  }

  @Public()
  @Get('currencies')
  @ApiOperation({ summary: 'Devises supportées (FCFA, EUR, MAD…)' })
  public currencies() {
    return this.localization.currencies();
  }

  @Public()
  @Get('context')
  @ApiOperation({ summary: 'Contexte par défaut du tenant courant' })
  public context(@CurrentTenant() tenant: TenantContextData) {
    return {
      locale: tenant?.defaultLocale ?? 'fr',
      countryCode: tenant?.defaultCountry ?? 'SN',
      currencyCode: tenant?.defaultCurrency ?? 'XOF',
      timezone: tenant?.timezone ?? 'Africa/Dakar',
    };
  }
}
