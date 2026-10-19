import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { createHash } from 'node:crypto';
import type { Request } from 'express';
import { Public } from '@shared/decorators/public.decorator';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import type { AuthenticatedUser } from '@shared/kernel/types/authenticated-user';
import { AuthService } from '../../application/services/auth.service';
import { LoginDto, RequestChallengeDto, VerifyChallengeDto } from './dto/auth.dto';

/** US-IG-007 — création de compte et connexion. */
@ApiTags('Compte')
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('challenge')
  @HttpCode(HttpStatus.OK)
  // Quota serré : cet endpoint envoie des e-mails et des SMS facturés.
  @Throttle({ auth: { limit: 5, ttl: 900_000 } })
  @ApiOperation({ summary: 'Demander un lien magique ou un code OTP (US-IG-007)' })
  public request(@Body() dto: RequestChallengeDto, @Req() req: Request) {
    return this.auth.requestChallenge({
      channel: dto.channel,
      identifier: dto.identifier,
      ipHash: this.hashIp(req),
    });
  }

  @Public()
  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @Throttle({ auth: { limit: 10, ttl: 900_000 } })
  @ApiOperation({ summary: 'Valider le code et ouvrir la session' })
  public verify(@Body() dto: VerifyChallengeDto, @Req() req: Request) {
    return this.auth.verifyChallenge({
      identifier: dto.identifier,
      secret: dto.secret,
      userAgent: req.headers['user-agent'],
      ipHash: this.hashIp(req),
    });
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ auth: { limit: 10, ttl: 900_000 } })
  @ApiOperation({ summary: 'Connexion du back-office par e-mail et mot de passe' })
  public login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.auth.loginWithPassword({
      email: dto.email,
      password: dto.password,
      userAgent: req.headers['user-agent'],
      ipHash: this.hashIp(req),
    });
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rafraîchir la session (rotation du refresh token)' })
  public refresh(@Body() dto: { refreshToken: string }, @Req() req: Request) {
    return this.auth.refresh(dto.refreshToken, req.headers['user-agent']);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Fermer la session courante' })
  public logout(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.logout(user.sessionId);
  }

  @Get('me')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Profil, rôles et permissions de l’utilisateur connecté' })
  public me(@CurrentUser() user: AuthenticatedUser) {
    return user;
  }

  private hashIp(req: Request): string | undefined {
    return req.ip ? createHash('sha256').update(req.ip).digest('hex') : undefined;
  }
}
