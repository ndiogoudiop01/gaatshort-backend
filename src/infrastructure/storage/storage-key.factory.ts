import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { TenantContextService } from '@infra/tenancy/context/tenant-context.service';

/**
 * Nommage des objets S3 : préfixé par tenant.
 *
 *   tenants/{tenantId}/applications/{applicationId}/{uuid}.pdf
 *
 * Le préfixe permet une politique IAM par tenant, une purge RGPD par
 * suppression de préfixe, et une facturation par client. Le nom d'origine
 * n'est jamais réutilisé comme clé : c'est un vecteur de path traversal.
 *
 * Une seule exception, assumée : `forDeterministicExport()`, dont le nom
 * est produit côté serveur et doit rester STABLE d'un rejeu à l'autre.
 */
@Injectable()
export class StorageKeyFactory {
  constructor(private readonly tenantContext: TenantContextService) {}

  public forApplicationDocument(applicationId: string, originalName: string): string {
    return this.build(`applications/${applicationId}`, originalName);
  }

  public forPartnerAttachment(partnerLeadId: string, originalName: string): string {
    return this.build(`partners/${partnerLeadId}`, originalName);
  }

  public forExport(kind: string, originalName: string): string {
    return this.build(`exports/${kind}`, originalName);
  }

  /**
   * Clé DÉTERMINISTE, réservée aux artefacts générés par un worker et
   * rejouables : un rejeu doit réécrire le même objet, pas en créer un
   * second. `name` est produit côté serveur ; on l'assainit quand même
   * (aucun `/`, donc aucune remontée de chemin possible) pour qu'aucune
   * valeur de job ne puisse sortir du préfixe du tenant.
   */
  public forDeterministicExport(kind: string, name: string): string {
    const safe = name.replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 120);
    return `tenants/${this.tenantContext.tenantId}/exports/${kind}/${safe}`;
  }

  private build(scope: string, originalName: string): string {
    const ext = extname(originalName).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 10);
    return `tenants/${this.tenantContext.tenantId}/${scope}/${randomUUID()}${ext}`;
  }
}
