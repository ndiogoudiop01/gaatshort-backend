import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { writeFileSync } from 'node:fs';
import { AppModule } from '../src/app.module';

/**
 * Exporte le contrat OpenAPI dans un fichier.
 *
 * Exécuté en CI, il permet de DÉTECTER les ruptures de contrat : un diff sur
 * `openapi.json` dans une PR rend visible ce qui, sinon, casserait le
 * frontend en silence après le déploiement.
 */
async function exportSpec(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('api');

  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Gaatshort — API')
      .setVersion('1.0')
      .addBearerAuth({ type: 'http', scheme: 'bearer' }, 'access-token')
      .build(),
  );

  writeFileSync('openapi.json', JSON.stringify(document, null, 2));
  await app.close();
  console.log('✔ openapi.json généré');
}

exportSpec()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error('✖ Échec de l’export OpenAPI :', error);
    process.exit(1);
  });
// `process.exit` explicite : script CI un coup, pas un serveur — des
// connexions ouvertes par des providers du module (Redis/BullMQ) peuvent
// survivre à `app.close()` et laisser le process suspendu indéfiniment,
// au-delà du budget « CI < 10 min » (US-IG — pipeline qualité).
