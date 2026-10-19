import { BadRequestException, Injectable, type PipeTransform } from '@nestjs/common';
import type { ZodSchema } from 'zod';
import { ErrorCode } from '@shared/kernel/errors/error-catalog';

/**
 * Utilisé là où class-validator montre ses limites : payloads polymorphes
 * (profils partenaires discriminés sur `type`, US-IG-016 → 019) et
 * paramètres de simulation à bornes dynamiques (US-IG-005).
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodSchema<T>) {}

  public transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message: 'Données invalides',
        details: {
          issues: result.error.issues.map((i) => ({
            path: i.path.join('.'),
            message: i.message,
            code: i.code,
          })),
        },
      });
    }
    return result.data;
  }
}
