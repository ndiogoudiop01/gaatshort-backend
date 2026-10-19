import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsNotEmpty, IsString, ValidateNested } from 'class-validator';

/**
 * US-IG-028 — corps de `POST /consents`.
 *
 * Remplace un type TypeScript inline (`{ consents: { key: string; granted:
 * boolean }[] }`) qui était directement décoré par `@Body()` : ce genre
 * d'annotation s'efface à la compilation (`design:paramtypes` ne voit
 * qu'`Object`), donc `ValidationPipe` n'avait RIEN à valider. Sur un
 * endpoint qui journalise une PREUVE légale de consentement, un corps
 * malformé (`consents` absent, non-tableau, clé non-chaîne…) ne doit jamais
 * atteindre le domaine tel quel — `dto.consents.map(...)` lèverait une
 * `TypeError` non cataloguée, donc une 500 (interdite par le DoD).
 */
export class ConsentEntryDto {
  @ApiProperty({ example: 'personal_data_processing' })
  @IsString() @IsNotEmpty()
  public key: string;

  @ApiProperty()
  // `enableImplicitConversion: true` (main.ts) fait `Boolean(value)` AVANT que
  // `@IsBoolean()` ne s'exécute : `'false'` deviendrait `true` et serait
  // journalisé comme un ACCORD. On relit donc la valeur brute du corps, pour
  // que le validateur ait encore quelque chose à rejeter. C'est une preuve
  // légale : accepter silencieusement l'inverse de l'intention de
  // l'utilisateur est pire qu'une 500, qui au moins se verrait.
  @Transform(({ obj }) => (obj as { granted?: unknown }).granted)
  @IsBoolean()
  public granted: boolean;
}

export class RecordConsentsDto {
  @ApiProperty({ type: [ConsentEntryDto] })
  // Le catalogue ne compte que trois clés : rien ne justifie une liste non
  // bornée, qui partirait en `WHERE key IN (...)` avant d'être rejetée.
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => ConsentEntryDto)
  public consents: ConsentEntryDto[];
}
