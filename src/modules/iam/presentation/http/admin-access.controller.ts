import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { RequirePermissions } from '@shared/decorators/permissions.decorator';
import { countryScopeOf } from '@shared/kernel/access/country-scope';
import type { AuthenticatedUser } from '@shared/kernel/types/authenticated-user';
import { ManageAccessUseCase } from '../../application/commands/manage-access.usecase';
import { AdminAccessQuery } from '../../application/queries/admin-access.query';
import type { Actor } from '../../domain/services/access-admin-rules';
import {
  CreateRoleDto,
  CreateUserDto,
  ListUsersDto,
  SetRolePermissionsDto,
  SetUserCountriesDto,
  SetUserRolesDto,
  SetUserStatusDto,
  UpdateRoleDto,
  UpdateUserDto,
} from './dto/admin-access.dto';

/** L'acteur tel que le JETON le décrit : ce sont ces droits-là qui s'appliquent. */
function actorOf(user: AuthenticatedUser): Actor {
  return { id: user.id, roles: user.roles, permissions: user.permissions, countries: countryScopeOf(user) };
}

/**
 * BSG-12 — comptes du back-office. Toutes les routes exigent `user:manage`.
 *
 * Authentification sans mot de passe : aucune route ne touche un mot de passe
 * (ni création, ni « réinitialisation »). L'identité se prouve par
 * `POST /auth/challenge` puis `/auth/verify`.
 */
@ApiTags('Back-office — Utilisateurs')
@ApiBearerAuth('access-token')
@Controller({ path: 'admin/users', version: '1' })
export class AdminUsersController {
  constructor(
    private readonly query: AdminAccessQuery,
    private readonly manage: ManageAccessUseCase,
  ) {}

  @Get()
  @RequirePermissions('user:manage')
  @ApiOperation({ summary: 'Comptes — offset (perPage ≤ 100), tri whitelisté, limités au périmètre pays de l’appelant' })
  public list(@Query() q: ListUsersDto, @CurrentUser() user: AuthenticatedUser) {
    return this.query.listUsers(actorOf(user), {
      roles: q.roles,
      statuses: q.statuses,
      search: q.search,
      countryCode: q.countryCode,
      page: q.page,
      perPage: q.perPage,
      sortBy: q.sortBy,
      sortDir: q.sortDir,
    });
  }

  @Get('countries')
  @RequirePermissions('user:manage')
  @ApiOperation({ summary: 'Pays du tenant (rattachement et périmètre)' })
  public countries() {
    return this.query.tenantCountries();
  }

  @Get(':id')
  @RequirePermissions('user:manage')
  @ApiOperation({ summary: 'Compte : rôles, permissions effectives (calculées par l’API), périmètre, sessions actives' })
  public detail(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.query.userDetail(actorOf(user), id);
  }

  @Post()
  @RequirePermissions('user:manage')
  @ApiOperation({ summary: 'Créer un compte (sans mot de passe : connexion par lien ou code)' })
  public create(@Body() dto: CreateUserDto, @CurrentUser() user: AuthenticatedUser) {
    return this.manage.createUser(actorOf(user), {
      email: dto.email,
      firstName: dto.firstName ?? null,
      lastName: dto.lastName ?? null,
      phoneE164: dto.phoneE164 ?? null,
      countryCode: dto.countryCode ?? null,
      roleKeys: dto.roleKeys,
    });
  }

  @Patch(':id')
  @RequirePermissions('user:manage')
  @ApiOperation({ summary: 'Modifier le profil (nom, téléphone, pays de rattachement)' })
  public update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserDto, @CurrentUser() user: AuthenticatedUser) {
    return this.manage.updateProfile(actorOf(user), id, {
      firstName: dto.firstName ?? null,
      lastName: dto.lastName ?? null,
      phoneE164: dto.phoneE164 ?? null,
      countryCode: dto.countryCode ?? null,
    });
  }

  @Put(':id/roles')
  @RequirePermissions('user:manage')
  @ApiOperation({
    summary: 'Remplacer les rôles — effet au PROCHAIN jeton',
    description: '422 SELF_LOCKOUT (se retirer user:manage), ROLE_NOT_GRANTABLE (rôle plus puissant que soi), LAST_SUPER_ADMIN.',
  })
  public roles(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetUserRolesDto, @CurrentUser() user: AuthenticatedUser) {
    return this.manage.setRoles(actorOf(user), id, dto.roleKeys);
  }

  @Patch(':id/status')
  @RequirePermissions('user:manage')
  @ApiOperation({ summary: 'Activer ou suspendre (la suspension révoque toutes les sessions)' })
  public status(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetUserStatusDto, @CurrentUser() user: AuthenticatedUser) {
    return this.manage.setStatus(actorOf(user), id, dto.status);
  }

  @Put(':id/countries')
  @RequirePermissions('user:manage')
  @ApiOperation({ summary: 'Périmètre pays — SUPER_ADMIN uniquement (403 sinon)' })
  public countriesOf(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetUserCountriesDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.manage.setCountries(actorOf(user), id, dto);
  }

  @Post(':id/sessions/revoke')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('user:manage')
  @ApiOperation({ summary: 'Déconnecter partout — applique immédiatement un changement de droits' })
  public revoke(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.manage.revokeSessions(actorOf(user), id);
  }
}

/**
 * BSG-12 — rôles (profils) et matrice de permissions. Le mapping rôle →
 * permissions vit ICI, en base : le back-office le lit, il ne le recalcule pas.
 */
@ApiTags('Back-office — Utilisateurs')
@ApiBearerAuth('access-token')
@Controller({ path: 'admin', version: '1' })
export class AdminRolesController {
  constructor(
    private readonly query: AdminAccessQuery,
    private readonly manage: ManageAccessUseCase,
  ) {}

  @Get('roles')
  @RequirePermissions('user:manage')
  @ApiOperation({ summary: 'Rôles du tenant avec leurs permissions, nb de comptes, `locked`, `assignable`' })
  public roles(@CurrentUser() user: AuthenticatedUser) {
    return this.query.listRoles(actorOf(user));
  }

  @Get('permissions')
  @RequirePermissions('user:manage')
  @ApiOperation({ summary: 'Catalogue des permissions vérifiées par l’API ; `grantable` = l’appelant la possède' })
  public permissions(@CurrentUser() user: AuthenticatedUser) {
    return this.query.permissionCatalog(actorOf(user));
  }

  @Post('roles')
  @RequirePermissions('user:manage')
  @ApiOperation({ summary: 'Créer un profil personnalisé (éventuellement copié d’un autre)' })
  public create(@Body() dto: CreateRoleDto, @CurrentUser() user: AuthenticatedUser) {
    return this.manage.createRole(actorOf(user), {
      key: dto.key,
      name: dto.name,
      description: dto.description ?? null,
      copyFrom: dto.copyFrom,
    });
  }

  @Patch('roles/:id')
  @RequirePermissions('user:manage')
  @ApiOperation({ summary: 'Renommer / décrire un profil' })
  public update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateRoleDto, @CurrentUser() user: AuthenticatedUser) {
    return this.manage.updateRole(actorOf(user), id, { name: dto.name, description: dto.description ?? null });
  }

  @Put('roles/:id/permissions')
  @RequirePermissions('user:manage')
  @ApiOperation({
    summary: 'Remplacer les permissions d’un profil — effet au PROCHAIN jeton des comptes concernés',
    description: '422 ROLE_LOCKED (SUPER_ADMIN), PERMISSION_NOT_GRANTABLE (anti-escalade), SELF_LOCKOUT.',
  })
  public setPermissions(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetRolePermissionsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.manage.setRolePermissions(actorOf(user), id, dto.permissionKeys);
  }

  @Delete('roles/:id')
  @RequirePermissions('user:manage')
  @ApiOperation({ summary: 'Supprimer un profil personnalisé sans compte rattaché' })
  public remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.manage.deleteRole(actorOf(user), id);
  }
}
