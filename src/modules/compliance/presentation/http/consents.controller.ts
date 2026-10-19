import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '@shared/decorators/public.decorator';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import type { AuthenticatedUser } from '@shared/kernel/types/authenticated-user';
import { TenantPrismaService } from '@infra/persistence/prisma/tenant-prisma.service';
import { TokenHasher } from '@infra/security/token-hasher.service';
import { ConsentService } from '../../application/services/consent.service';
import { RecordConsentsDto } from './dto/record-consents.dto';

/** US-IG-028 — consentements explicites et journalisés. */
@ApiTags('Compte')
@Controller({ path: 'consents', version: '1' })
export class ConsentsController {
  constructor(
    private readonly consents: ConsentService,
    private readonly prisma: TenantPrismaService,
    private readonly hasher: TokenHasher,
  ) {}

  @Public()
  @Get('definitions')
  @ApiOperation({ summary: 'Libellés et versions des consentements à afficher' })
  public definitions() {
    return this.prisma.client.consentDefinition.findMany({
      where: { isActive: true },
      orderBy: { isRequired: 'desc' },
      select: { key: true, version: true, label: true, purpose: true, isRequired: true, policyUrl: true },
    });
  }

  @Post()
  @ApiOperation({ summary: 'Enregistrer les consentements de l’utilisateur' })
  public record(
    @Body() dto: RecordConsentsDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    return this.consents.record({
      subjectType: 'USER',
      subjectId: user.id,
      consents: dto.consents,
      // L'IP est une donnée personnelle : on en conserve un condensat,
      // jamais l'adresse en clair. `TokenHasher.hash()` (HMAC-SHA256 avec un
      // pepper dédié), pas un SHA256 nu : l'espace des adresses IPv4 est
      // assez petit (~4,3 milliards) pour qu'un condensat non salé/pepé se
      // retrouve en clair hors ligne par force brute — même méthode que
      // partout ailleurs dans ce projet où une valeur sensible est hachée.
      ipHash: request.ip ? this.hasher.hash(request.ip) : undefined,
      userAgent: request.headers['user-agent'],
    });
  }
}
