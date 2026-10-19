import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsString, Length, MaxLength, MinLength } from 'class-validator';

export class RequestChallengeDto {
  @ApiProperty({ enum: ['EMAIL_MAGIC_LINK', 'EMAIL_OTP', 'PHONE_OTP'] })
  @IsEnum(['EMAIL_MAGIC_LINK', 'EMAIL_OTP', 'PHONE_OTP'])
  public channel: 'EMAIL_MAGIC_LINK' | 'EMAIL_OTP' | 'PHONE_OTP';

  @ApiProperty({ description: 'E-mail ou téléphone au format E.164', example: '+221771234567' })
  @IsString() @MinLength(5) @MaxLength(255)
  public identifier: string;
}

export class VerifyChallengeDto {
  @ApiProperty() @IsString() @MinLength(5) @MaxLength(255) public identifier: string;

  @ApiProperty({ description: 'Code OTP ou jeton du lien magique' })
  @IsString() @Length(6, 128)
  public secret: string;
}

/** Connexion du back-office par e-mail et mot de passe. */
export class LoginDto {
  @ApiProperty({ example: 'admin@gaatshort.com' })
  @IsEmail() @MaxLength(255)
  public email: string;

  @ApiProperty()
  @IsString() @MinLength(1) @MaxLength(256)
  public password: string;
}
