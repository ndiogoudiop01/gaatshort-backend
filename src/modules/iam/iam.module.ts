import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AppConfigService } from '@config/app-config.service';
import { SecurityModule } from '@infra/security/security.module';
import { AuthService } from './application/services/auth.service';
import { JwtStrategy } from './infrastructure/jwt.strategy';
import { AuthController } from './presentation/http/auth.controller';
import { AdminAccessQuery } from './application/queries/admin-access.query';
import { ManageAccessUseCase } from './application/commands/manage-access.usecase';
import { AdminRolesController, AdminUsersController } from './presentation/http/admin-access.controller';

@Module({
  imports: [
    SecurityModule,
    PassportModule.register({ defaultStrategy: 'jwt', session: false }),
    JwtModule.registerAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        secret: config.auth.accessSecret,
        // `accessTtl` est une durée validée par le schéma d'env (ex. "900s") ;
        // le typage de la lib exige un littéral, on caste ce `string` de confiance.
        signOptions: { expiresIn: config.auth.accessTtl as never, issuer: config.app.name },
      }),
    }),
  ],
  // BSG-12 — écran Utilisateurs : comptes, rôles, matrice de permissions, périmètre pays.
  controllers: [AuthController, AdminUsersController, AdminRolesController],
  providers: [AuthService, JwtStrategy, AdminAccessQuery, ManageAccessUseCase],
  exports: [AuthService, JwtModule, PassportModule],
})
export class IamModule {}
