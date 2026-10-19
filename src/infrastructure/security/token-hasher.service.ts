import { Injectable } from '@nestjs/common';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { AppConfigService } from '@config/app-config.service';

/**
 * Jetons opaques (magic link, refresh token, confirmation newsletter, OTP).
 *
 * On ne stocke JAMAIS le jeton en clair : une fuite de la base rendrait
 * tous les liens actifs utilisables. On stocke un HMAC-SHA256, et la
 * comparaison est à temps constant pour éviter les attaques temporelles.
 *
 * SÉPARATION DES CLÉS : la clé HMAC est `auth.refreshSecret`, PAS
 * `auth.accessSecret` (celle qui signe les JWT). Réutiliser la clé de
 * signature comme pepper de hachage couplerait deux usages qui n'ont ni le
 * même cycle de vie ni la même procédure de rotation — faire tourner le
 * secret JWT casserait silencieusement tous les hachages déjà en base.
 * `JWT_REFRESH_SECRET` n'est pas utilisé pour signer un JWT ici (le refresh
 * token est une chaîne aléatoire opaque, pas un JWT) : le nom de la variable
 * d'environnement est conservé pour ne pas casser le provisionnement
 * existant, mais son rôle réel est celui de pepper HMAC dédié.
 */
@Injectable()
export class TokenHasher {
  constructor(private readonly config: AppConfigService) {}

  public generate(bytes = 32): string {
    return randomBytes(bytes).toString('base64url');
  }

  public generateNumericCode(length: number): string {
    const max = 10 ** length;
    return (randomBytes(4).readUInt32BE(0) % max).toString().padStart(length, '0');
  }

  public hash(token: string): string {
    return createHmac('sha256', this.config.auth.refreshSecret).update(token).digest('hex');
  }

  public compare(token: string, storedHash: string): boolean {
    const computed = Buffer.from(this.hash(token));
    const stored = Buffer.from(storedHash);
    return computed.length === stored.length && timingSafeEqual(computed, stored);
  }
}
