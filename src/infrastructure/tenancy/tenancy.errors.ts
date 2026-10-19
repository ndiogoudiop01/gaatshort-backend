/**
 * Ces erreurs vivent désormais dans le kernel (`@shared/kernel/errors/tenant.error`)
 * pour que le traducteur HTTP central puisse les reconnaître sans dépendre de
 * l'infrastructure. Ce fichier reste comme point d'accès historique pour la
 * couche tenancy.
 */
export {
  MissingTenantContextError,
  TenantNotFoundError,
  TenantSuspendedError,
} from '@shared/kernel/errors/tenant.error';
