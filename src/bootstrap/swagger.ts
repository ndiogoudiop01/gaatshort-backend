import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { AppConfigService } from '@config/app-config.service';

export function setupSwagger(app: INestApplication, config: AppConfigService): void {
  // Jamais de documentation exposée en production : c'est une carte du
  // système offerte à un attaquant. Le contrat est publié en CI (openapi.json).
  if (config.app.isProduction) return;

  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Gaatshort — API')
      .setDescription(
        [
          'API backend multi-tenant de la plateforme de mini-séries Gaatshort (marque blanche).',
          '',
          '**Résolution du tenant** : sous-domaine (`kaay.gaatshort.com`),',
          "en-tête `x-tenant-id`, ou revendication `tid` du JWT (priorité la plus haute).",
          '',
          '**Enveloppe de réponse** : `{ success, data | error, requestId, timestamp }`.',
          '',
          '**Idempotence** : les créations publiques exigent un en-tête `Idempotency-Key`.',
        ].join('\n'),
      )
      .setVersion('1.0')
      .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'access-token')
      .addGlobalParameters({
        name: 'x-tenant-id',
        in: 'header',
        required: false,
        schema: { type: 'string' },
        description: 'Identifiant ou slug du tenant (développement / serveur-à-serveur)',
      })
      .addTag('Public — Contenu', 'Référentiels publics (pays, devises)')
      .addTag('Compte', 'Authentification OTP, profil et consentements')
      .addTag('Back-office — Utilisateurs', 'Comptes, rôles et périmètres')
      .addTag('Back-office — Pilotage', 'Administration des marques (tenants)')
      .addTag('App — Vitrine et lecture', 'Accueil, séries, fiche, lecture HLS signée, progression, favoris')
      .addTag('App — Portefeuille', 'Solde commun, historique, déblocage d’épisodes')
      .addTag('App — Boutique', 'Packs de crédits, commandes, paiement')
      .addTag('Back-office — Catalogue', 'Séries, épisodes, vidéos, sous-titres, genres, licences, vitrine de la marque')
      .addTag('Back-office — Monétisation', 'Packs de crédits et commandes')
      .addTag('Back-office — Spectateurs et pilotage', 'Tableau de bord, spectateurs, ajustement de crédits')
      .addTag('Système', 'Santé, métriques')
      .build(),
    { operationIdFactory: (controllerKey, methodKey) => `${controllerKey}_${methodKey}` },
  );

  SwaggerModule.setup('docs', app, document, {
    swaggerOptions: { persistAuthorization: true, tagsSorter: 'alpha' },
    jsonDocumentUrl: 'docs/openapi.json',
  });
}
