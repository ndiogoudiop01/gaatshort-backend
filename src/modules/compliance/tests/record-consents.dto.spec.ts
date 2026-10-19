import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RecordConsentsDto } from '../presentation/http/dto/record-consents.dto';

/**
 * US-IG-028 — `POST /consents` utilisait un type TypeScript inline
 * (`{ consents: { key: string; granted: boolean }[] }`) directement sur
 * `@Body()`. Ce genre d'annotation s'efface à la compilation
 * (`design:paramtypes` ne voit qu'`Object`), donc `ValidationPipe` n'avait
 * RIEN à valider. Ce test vérifie EMPIRIQUEMENT que la classe qui la
 * remplace est bien validée à l'exécution — important ici : ce endpoint
 * journalise une preuve légale, un corps malformé ne doit jamais l'atteindre.
 */
describe('RecordConsentsDto (US-IG-028)', () => {
  /**
   * Les MÊMES options que le `ValidationPipe` global (main.ts). Sans elles, ces
   * tests exercent un chemin qui n'existe pas en production : c'est exactement
   * ce qui a laissé passer `granted: 'false'` journalisé comme un accord.
   */
  const PIPE_OPTIONS = { enableImplicitConversion: true };

  it('accepte une liste de consentements valide', async () => {
    const dto = plainToInstance(
      RecordConsentsDto,
      {
        consents: [
          { key: 'personal_data_processing', granted: true },
          { key: 'partner_sharing', granted: false },
        ],
      },
      PIPE_OPTIONS,
    );
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rejette un corps sans consents', async () => {
    const dto = plainToInstance(RecordConsentsDto, {});
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'consents')).toBe(true);
  });

  it('rejette une liste vide', async () => {
    const dto = plainToInstance(RecordConsentsDto, { consents: [] });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'consents')).toBe(true);
  });

  it('rejette un élément sans clé', async () => {
    const dto = plainToInstance(RecordConsentsDto, { consents: [{ granted: true }] });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'consents')).toBe(true);
  });

  // `'false'` et `0` sont les deux cas qui comptent : `Boolean('false')` vaut
  // `true` et `Boolean(0)` vaut `false`, donc sans garde-fou la preuve
  // enregistrée est l'INVERSE de ce que l'utilisateur a exprimé.
  it.each([['oui'], ['false'], ['true'], [0], [1], [{}]])(
    'rejette un granted non booléen (%p), avec les options de production',
    async (granted) => {
      const dto = plainToInstance(
        RecordConsentsDto,
        { consents: [{ key: 'personal_data_processing', granted }] },
        PIPE_OPTIONS,
      );
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'consents')).toBe(true);
    },
  );
});
