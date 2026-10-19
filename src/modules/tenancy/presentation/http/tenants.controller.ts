import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentTenant } from '@shared/decorators/current-tenant.decorator';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { RequireRoles } from '@shared/decorators/permissions.decorator';
import type { TenantContextData } from '@shared/kernel/ports/tenant-context.port';
import type { AuthenticatedUser } from '@shared/kernel/types/authenticated-user';
import { AdminTenantsService } from '../../application/admin-tenants.service';
import { CreateTenantDto, DeleteTenantQueryDto, ListTenantsDto, UpdateTenantDto } from './dto/admin-tenant.dto';

/**
 * Administration des tenants — réservée au SUPER_ADMIN de la plateforme.
 *
 * RÔLE, pas permission : `tenant:manage` existe au catalogue mais n'est
 * vérifiée nulle part ; c'est `@RequireRoles('SUPER_ADMIN')` qui protège.
 *
 * BSG-13 : `PATCH` prend un DTO validé (liste blanche) au lieu d'un
 * `Record<string, unknown>` écrit tel quel en `$privileged()`. Toute écriture
 * est tracée et INVALIDE le cache de l'annuaire (sinon un tenant suspendu
 * continuerait d'être servi pendant le TTL).
 */
@ApiTags('Back-office — Pilotage')
@ApiBearerAuth('access-token')
@Controller({ path: 'admin/tenants', version: '1' })
export class TenantsController {
  constructor(private readonly tenants: AdminTenantsService) {}

  @Get('current')
  @ApiOperation({ summary: 'Contexte du tenant courant (branding, options, devise)' })
  public current(@CurrentTenant() tenant: TenantContextData) {
    return tenant;
  }

  @Get('reference')
  @RequireRoles('SUPER_ADMIN')
  @ApiOperation({ summary: 'Pays actifs et devises : valeurs acceptées pour un tenant (BSG-13)' })
  public reference() {
    return this.tenants.reference();
  }

  @Get()
  @RequireRoles('SUPER_ADMIN')
  @ApiOperation({ summary: 'Lister les tenants — offset (perPage ≤ 100), tri whitelisté (BSG-13)' })
  public list(@Query() q: ListTenantsDto, @CurrentUser() user: AuthenticatedUser) {
    return this.tenants.list(user.tenantId, {
      statuses: q.statuses,
      search: q.search,
      page: q.page,
      perPage: q.perPage,
      sortBy: q.sortBy,
      sortDir: q.sortDir,
    });
  }

  @Post()
  @RequireRoles('SUPER_ADMIN')
  @ApiOperation({
    summary: 'Créer une organisation (un pays = un tenant)',
    description:
      'Slug immuable (sous-domaine). Devise et fuseau déduits du pays s’ils sont omis. ' +
      '422 TENANT_SLUG_TAKEN : slug déjà utilisé. 422 TENANT_INVALID : slug réservé ou mal formé, ' +
      'pays inactif, devise inconnue, fuseau manquant ou invalide.',
  })
  public create(@Body() dto: CreateTenantDto, @CurrentUser() user: AuthenticatedUser) {
    // Traduction CHAMP PAR CHAMP : jamais de spread du corps.
    return this.tenants.create({ tenantId: user.tenantId, userId: user.id }, {
      slug: dto.slug,
      name: dto.name,
      legalName: dto.legalName,
      status: dto.status,
      defaultLocale: dto.defaultLocale,
      defaultCountry: dto.defaultCountry,
      defaultCurrency: dto.defaultCurrency,
      timezone: dto.timezone,
      countries: dto.countries,
      branding: dto.branding
        ? { primaryColor: dto.branding.primaryColor, logoUrl: dto.branding.logoUrl }
        : undefined,
      featureFlags: dto.featureFlags,
    });
  }

  @Get(':id/deletion-check')
  @RequireRoles('SUPER_ADMIN')
  @ApiOperation({
    summary: 'L’organisation peut-elle être supprimée ? (tables qui la bloquent)',
    description: 'Lecture seule. `deletable` est faux pour l’organisation de la session ou dès qu’une table métier contient une ligne.',
  })
  public deletionCheck(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.tenants.deletionCheck(user.tenantId, id);
  }

  @Get(':id')
  @RequireRoles('SUPER_ADMIN')
  @ApiOperation({ summary: 'Un tenant (domaines, options, nombre de comptes)' })
  public detail(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.tenants.detail(user.tenantId, id);
  }

  @Patch(':id')
  @RequireRoles('SUPER_ADMIN')
  @ApiOperation({
    summary: 'Modifier un tenant — DTO validé, liste blanche (BSG-13)',
    description:
      'Champs acceptés : name, legalName, status, defaultLocale, defaultCountry, defaultCurrency, timezone, ' +
      'branding { primaryColor, logoUrl }, featureFlags { clé: booléen }. Tout autre champ → 400. ' +
      '422 TENANT_SELF_LOCKOUT : suspendre ou archiver l’organisation de sa propre session.',
  })
  public update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTenantDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    // Traduction CHAMP PAR CHAMP : jamais de spread du corps.
    return this.tenants.update({ tenantId: user.tenantId, userId: user.id }, id, {
      name: dto.name,
      legalName: dto.legalName,
      status: dto.status,
      defaultLocale: dto.defaultLocale,
      defaultCountry: dto.defaultCountry,
      defaultCurrency: dto.defaultCurrency,
      timezone: dto.timezone,
      branding: dto.branding
        ? { primaryColor: dto.branding.primaryColor, logoUrl: dto.branding.logoUrl }
        : undefined,
      featureFlags: dto.featureFlags,
    });
  }

  @Delete(':id')
  @RequireRoles('SUPER_ADMIN')
  @ApiOperation({
    summary: 'Supprimer DÉFINITIVEMENT une organisation sans données',
    description:
      '`confirm` doit recopier le slug. 422 TENANT_HAS_DATA : des données existent (tables listées) — ' +
      'archiver via PATCH { status: "ARCHIVED" }. 422 TENANT_SELF_DELETE : organisation de la session. ' +
      '422 TENANT_DELETE_CONFIRMATION : confirmation absente ou différente du slug.',
  })
  public remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: DeleteTenantQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tenants.remove({ tenantId: user.tenantId, userId: user.id }, id, q.confirm);
  }
}
