import { createHmac } from 'node:crypto';

/**
 * Signature d'URL Bunny CDN (authentification par jeton, variante HS256), portée
 * à l'identique de l'implémentation officielle :
 * https://github.com/BunnyWay/BunnyCDN.TokenAuthentication/blob/master/nodejs/token.js
 *
 * Mode « répertoire » (`token_path`) : le jeton est placé dans le CHEMIN, si bien
 * que les segments HLS relatifs (`480p/video0.ts`) héritent du jeton — obligatoire
 * pour HLS (docs Bunny, « path-based URL format »).
 *
 * À VALIDER en staging avec la vraie clé de la zone (vidéo jouée de bout en bout).
 */
export function signBunnyDirectoryUrl(params: {
  host: string;
  securityKey: string;
  directory: string; // ex. "/<guid>/"
  file: string; // ex. "playlist.m3u8"
  expires: number; // horodatage unix (s)
}): string {
  const { host, securityKey, directory, file, expires } = params;
  const signingData = `token_path=${directory}`;
  const hmac = createHmac('sha256', securityKey);
  hmac.update(directory);
  hmac.update(String(expires));
  hmac.update(Buffer.alloc(0)); // pas de verrouillage par IP
  hmac.update(signingData);
  const token =
    'HS256-' + hmac.digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `https://${host}/bcdn_token=${token}&token_path=${encodeURIComponent(directory)}&expires=${expires}${directory}${file}`;
}
