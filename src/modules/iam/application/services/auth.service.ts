import { Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import { AppConfigService } from '@config/app-config.service';
import { BusinessRuleViolationError } from '@shared/kernel/errors/domain.error';
import { ErrorCode } from '@shared/kernel/errors/error-catalog';
import { CLOCK, type ClockPort } from '@shared/kernel/ports/clock.port';
import { MAILER, type MailerPort } from '@shared/kernel/ports/mailer.port';
import { SMS_SENDER, type SmsPort } from '@shared/kernel/ports/sms.port';
import { TENANT_CONTEXT, type TenantContextPort } from '@shared/kernel/ports/tenant-context.port';
import type { JwtAccessPayload } from '@shared/kernel/types/authenticated-user';
import { TenantPrismaService } from '@infra/persistence/prisma/tenant-prisma.service';
import { PasswordHasher } from '@infra/security/password-hasher.service';
import { TokenHasher } from '@infra/security/token-hasher.service';
import { AuthChallengeRules } from '../../domain/services/auth-challenge.service';
import { effectiveCountryScope } from '@shared/kernel/access/country-scope';
import { countryFromPhone } from '@infra/viewer/viewer-context.service';

export interface TokenPair {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresIn: number;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  AUTHENTIFICATION — US-IG-007
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Trois canaux : lien magique e-mail, OTP e-mail, OTP téléphone. En Afrique
 * de l'Ouest, le téléphone est souvent plus fiable que l'e-mail : l'OTP SMS
 * n'est pas un repli, c'est un chemin de première classe.
 *
 * Décisions de sécurité :
 *  • ÉNUMÉRATION — « code envoyé » est renvoyé même si le compte n'existe
 *    pas. Sinon l'endpoint devient un oracle qui révèle qui est inscrit.
 *  • ROTATION — chaque rafraîchissement invalide l'ancien refresh token.
 *    Le rejeu d'un token déjà consommé révoque TOUTE la famille : c'est la
 *    signature d'un vol de jeton.
 *  • TENANT SCELLÉ — le JWT porte `tid`. Un token émis pour un tenant ne
 *    peut pas servir sur un autre, quel que soit le sous-domaine appelé.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: TenantPrismaService,
    private readonly jwt: JwtService,
    private readonly config: AppConfigService,
    private readonly hasher: TokenHasher,
    private readonly passwords: PasswordHasher,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(MAILER) private readonly mailer: MailerPort,
    @Inject(SMS_SENDER) private readonly sms: SmsPort,
    @Inject(TENANT_CONTEXT) private readonly tenantContext: TenantContextPort,
  ) {}

  /** Étape 1 : émettre un lien magique ou un code. */
  public async requestChallenge(params: {
    channel: 'EMAIL_MAGIC_LINK' | 'EMAIL_OTP' | 'PHONE_OTP';
    identifier: string;
    ipHash?: string;
  }): Promise<{ sent: true; expiresInSeconds: number }> {
    const identifier = params.identifier.toLowerCase().trim();
    const isMagicLink = params.channel === 'EMAIL_MAGIC_LINK';
    const ttl = isMagicLink ? this.config.auth.magicLinkTtlSeconds : this.config.auth.otpTtlSeconds;

    const secret = isMagicLink
      ? this.hasher.generate(32)
      : this.hasher.generateNumericCode(this.config.auth.otpLength);

    // `tenantId` est injecté par l'extension Prisma tenant-scopée.
    await this.prisma.client.authChallenge.create({
      data: {
        channel: params.channel,
        identifier,
        secretHash: this.hasher.hash(secret),
        purpose: 'login',
        expiresAt: this.clock.addSeconds(this.clock.now(), ttl),
        maxAttempts: this.config.auth.otpMaxAttempts,
        ipHash: params.ipHash,
      } as never,
    });

    if (params.channel === 'PHONE_OTP') {
      await this.sms.send({
        to: identifier,
        body: `Gaatshort : votre code est ${secret} (valable ${Math.round(ttl / 60)} min).`,
      });
    } else {
      await this.mailer.send({
        to: identifier,
        subject: '',
        template: isMagicLink ? 'auth.magic-link' : 'auth.otp',
        variables: {
          code: secret,
          link: `${this.config.app.frontendUrl}/auth/verify?token=${secret}&email=${encodeURIComponent(identifier)}`,
          ttlMinutes: Math.round(ttl / 60),
        },
      });
    }

    // Réponse identique que le compte existe ou non.
    return { sent: true, expiresInSeconds: ttl };
  }

  /** Étape 2 : vérifier le secret et ouvrir la session. */
  public async verifyChallenge(params: {
    identifier: string;
    secret: string;
    userAgent?: string;
    ipHash?: string;
  }): Promise<TokenPair> {
    const identifier = params.identifier.toLowerCase().trim();

    const challenge = await this.prisma.client.authChallenge.findFirst({
      where: { identifier, purpose: 'login', consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    // Même code, que l'identifiant n'ait aucun défi ou que le secret soit
    // faux : distinguer les deux confirmerait qu'un identifiant est inscrit.
    if (!challenge) {
      throw new UnauthorizedException({ code: ErrorCode.CHALLENGE_INVALID, message: 'Code invalide ou expiré' });
    }

    AuthChallengeRules.assertUsable(challenge, this.clock.now());

    if (!this.hasher.compare(params.secret, challenge.secretHash)) {
      await this.prisma.client.authChallenge.update({
        where: { id: challenge.id },
        data: { attempts: { increment: 1 } },
      });
      throw new UnauthorizedException({ code: ErrorCode.CHALLENGE_INVALID, message: 'Code invalide ou expiré' });
    }

    await this.prisma.client.authChallenge.update({
      where: { id: challenge.id },
      data: { consumedAt: this.clock.now() },
    });

    const isPhone = challenge.channel === 'PHONE_OTP';
    const user = await this.findOrCreateUser(identifier, isPhone);
    return this.issueTokens(user.id, params.userAgent, params.ipHash);
  }

  /**
   * Connexion du back-office par e-mail et mot de passe. Seuls les comptes
   * dotés d'un `passwordHash` peuvent l'utiliser : les candidats, créés par
   * OTP ou lien magique, n'en ont pas.
   */
  public async loginWithPassword(params: {
    email: string;
    password: string;
    userAgent?: string;
    ipHash?: string;
  }): Promise<TokenPair> {
    const email = params.email.toLowerCase().trim();
    const user = await this.prisma.client.user.findFirst({ where: { email, deletedAt: null } });

    // Sans compte, on vérifie quand même contre un hash factice : la durée
    // d'Argon2 révélerait sinon quels e-mails sont inscrits.
    const hash = user?.passwordHash ?? (await this.dummyHash());
    const valid = (await this.passwords.verify(hash, params.password)) && !!user?.passwordHash;

    if (!user || !valid) {
      throw new UnauthorizedException({
        code: ErrorCode.INVALID_CREDENTIALS,
        message: 'E-mail ou mot de passe incorrect',
      });
    }

    const { sessionId: _sessionId, ...pair } = await this.issueTokens(user.id, params.userAgent, params.ipHash);
    return pair;
  }

  private dummyHashPromise?: Promise<string>;

  private dummyHash(): Promise<string> {
    this.dummyHashPromise ??= this.passwords.hash(randomUUID());
    return this.dummyHashPromise;
  }

  /**
   * Rotation du refresh token, avec détection de rejeu.
   * Un token déjà remplacé qui se présente = vol probable → on révoque la
   * famille entière et l'utilisateur doit se reconnecter.
   */
  public async refresh(refreshToken: string, userAgent?: string): Promise<TokenPair> {
    // Même HMAC-SHA256 que l'OTP et le lien magique : aucun secret ne doit
    // être haché différemment selon son type.
    const hash = this.hasher.hash(refreshToken);
    const session = await this.prisma.client.authSession.findUnique({
      where: { refreshTokenHash: hash },
    });

    if (!session || session.expiresAt <= this.clock.now()) {
      throw new UnauthorizedException({ code: ErrorCode.TOKEN_EXPIRED, message: 'Session expirée' });
    }

    if (session.revokedAt) {
      // Un token déjà consommé qui revient = vol probable (copie interceptée,
      // appareil volé...). On ne se contente pas de refuser CE token : toute
      // la famille est révoquée, l'utilisateur devra se reconnecter partout.
      this.logger.warn(`Rejeu de refresh token détecté — famille ${session.familyId} révoquée`);
      await this.prisma.client.authSession.updateMany({
        where: { familyId: session.familyId, revokedAt: null },
        data: { revokedAt: this.clock.now() },
      });
      throw new UnauthorizedException({
        code: ErrorCode.SESSION_REVOKED,
        message: 'Session compromise, reconnexion requise',
      });
    }

    const { sessionId: newSessionId, ...pair } = await this.issueTokens(
      session.userId,
      userAgent,
      session.ipHash ?? undefined,
      session.familyId,
    );
    // `replacedById` referme la chaîne d'audit de la rotation : depuis
    // n'importe quelle session de la famille, on peut retrouver celle qui l'a
    // remplacée — utile pour reconstituer une compromission a posteriori.
    await this.prisma.client.authSession.update({
      where: { id: session.id },
      data: { revokedAt: this.clock.now(), replacedById: newSessionId },
    });
    return pair;
  }

  public async logout(sessionId: string): Promise<void> {
    await this.prisma.client.authSession.update({
      where: { id: sessionId },
      data: { revokedAt: this.clock.now() },
    });
  }

  private async issueTokens(
    userId: string,
    userAgent?: string,
    ipHash?: string,
    familyId?: string,
  ): Promise<TokenPair & { sessionId: string }> {
    const tenant = this.tenantContext.get();
    const user = await this.prisma.client.user.findUniqueOrThrow({
      where: { id: userId },
      include: { roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } },
    });

    if (user.status === 'SUSPENDED' || user.status === 'DELETED') {
      throw new BusinessRuleViolationError('ACCOUNT_SUSPENDED', 'Ce compte est suspendu');
    }

    const roles = user.roles.map((ur) => ur.role.key);
    const permissions = [
      ...new Set(user.roles.flatMap((ur) => ur.role.permissions.map((rp) => rp.permission.key))),
    ];

    const sessionId = randomUUID();
    const payload: Omit<JwtAccessPayload, 'iat' | 'exp'> = {
      sub: user.id,
      tid: tenant.tenantId, // ← le tenant est scellé dans le token
      acc: user.accountId ?? null, // compte global du spectateur (Q-02)
      email: user.email,
      roles,
      perms: permissions,
      sid: sessionId,
      // BSG-12 — périmètre pays, figé comme les permissions : une modification
      // ne prend effet qu'au prochain jeton (reconnexion ou rafraîchissement).
      cty: effectiveCountryScope({
        roles,
        allCountries: user.allCountries,
        countryCode: user.countryCode,
        countryScope: user.countryScope,
      }) as string[] | null,
    };

    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.config.auth.accessSecret,
      expiresIn: this.config.auth.accessTtl as never,
    });

    const refreshToken = this.hasher.generate(48);
    // `tenantId` est injecté par l'extension Prisma tenant-scopée.
    await this.prisma.client.authSession.create({
      data: {
        id: sessionId,
        userId: user.id,
        familyId: familyId ?? randomUUID(),
        refreshTokenHash: this.hasher.hash(refreshToken),
        userAgent,
        ipHash,
        expiresAt: this.clock.addDays(this.clock.now(), 30),
      } as never,
    });

    await this.prisma.client.user.update({
      where: { id: user.id },
      data: { lastLoginAt: this.clock.now() },
    });

    return { accessToken, refreshToken, expiresIn: 900, sessionId };
  }

  /**
   * Création implicite au premier accès : pas d'étape « inscription » séparée.
   *
   * Q-02 (portefeuille commun) : un numéro = UN compte global (`accounts`),
   * rattaché à chaque marque visitée par une ligne `users` (le rattachement).
   * Le portefeuille et les épisodes débloqués suivent le compte, pas la marque.
   */
  private async findOrCreateUser(identifier: string, isPhone: boolean) {
    const now = this.clock.now();
    const account = isPhone
      ? await this.prisma.client.account.upsert({
          where: { phoneE164: identifier },
          create: {
            phoneE164: identifier,
            countryCode: countryFromPhone(identifier),
            // Gambie anglophone (PRD §3) ; sinon la langue de la marque.
            locale: countryFromPhone(identifier) === 'GM' ? 'en' : (this.tenantContext.get().defaultLocale ?? 'fr'),
          },
          update: {},
        })
      : null;
    if (account && account.status !== 'ACTIVE') {
      throw new BusinessRuleViolationError('ACCOUNT_SUSPENDED', 'Ce compte est suspendu');
    }

    const where = isPhone ? { phoneE164: identifier } : { email: identifier };
    const existing = await this.prisma.client.user.findFirst({ where });
    if (existing) {
      if (account && existing.accountId !== account.id) {
        return this.prisma.client.user.update({ where: { id: existing.id }, data: { accountId: account.id } });
      }
      return existing;
    }

    const viewerRole = await this.prisma.client.role.findFirst({ where: { key: 'VIEWER' } });

    // `tenantId` est injecté par l'extension Prisma tenant-scopée.
    return this.prisma.client.user.create({
      data: {
        ...(isPhone ? { phoneE164: identifier } : { email: identifier }),
        ...(account ? { accountId: account.id } : {}),
        status: 'ACTIVE',
        ...(isPhone ? { phoneVerifiedAt: now } : { emailVerifiedAt: now }),
        ...(viewerRole
          ? { roles: { create: { roleId: viewerRole.id, tenantId: this.tenantContext.get().tenantId } } }
          : {}),
      } as never,
    });
  }
}
