import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../pipes/zod-validation.pipe';

describe('ZodValidationPipe', () => {
  const schema = z.object({ name: z.string().min(1) });
  const pipe = new ZodValidationPipe(schema);

  it('renvoie la valeur analysée quand elle est valide', () => {
    expect(pipe.transform({ name: 'Awa' })).toEqual({ name: 'Awa' });
  });

  it('rejette une valeur invalide avec le détail des erreurs Zod', () => {
    try {
      pipe.transform({ name: '' });
      fail('aurait dû lever');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      const response = (error as BadRequestException).getResponse() as { details: { issues: unknown[] } };
      expect(response.details.issues).toHaveLength(1);
    }
  });
});
