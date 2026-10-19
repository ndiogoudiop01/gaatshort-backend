import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { AppConfigService } from '@config/app-config.service';

/** Argon2id : recommandation OWASP 2024, préféré à bcrypt sur du neuf. */
@Injectable()
export class PasswordHasher {
  constructor(private readonly config: AppConfigService) {}

  public hash(plain: string): Promise<string> {
    return argon2.hash(plain, {
      type: argon2.argon2id,
      memoryCost: this.config.auth.argon2.memoryCost,
      timeCost: this.config.auth.argon2.timeCost,
      parallelism: 1,
    });
  }

  public async verify(hash: string, plain: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plain);
    } catch {
      return false;
    }
  }
}
