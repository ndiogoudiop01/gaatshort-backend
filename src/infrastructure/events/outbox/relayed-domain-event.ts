/**
 * Reconstruit, côté worker, un objet qui expose le même contrat que
 * `DomainEvent` (`tenantId`, `aggregateId`, `payload()`…) à partir de la
 * ligne `outbox_messages` relayée par BullMQ.
 *
 * PAS la classe d'origine (`ApplicationPreselectedEvent`…) : celle-ci vit
 * dans son module et n'a aucune raison d'être reconstructible depuis du
 * JSON générique. Les listeners `@OnEvent()` n'utilisent que la forme
 * (duck typing), jamais `instanceof` — cet adaptateur suffit.
 */
export class RelayedDomainEvent {
  constructor(
    public readonly eventName: string,
    public readonly tenantId: string,
    public readonly aggregateId: string,
    public readonly aggregateType: string,
    private readonly rawPayload: Record<string, unknown>,
    public readonly metadata: Record<string, unknown> = {},
    /**
     * Identifiant du message outbox (= `jobId` BullMQ) : STABLE d'un rejeu à
     * l'autre, contrairement à un UUID tiré à la réhydratation. Les
     * consommateurs qui doivent dédoublonner (frise entrepreneur) s'en servent.
     */
    public readonly eventId?: string,
    /** Instant du fait métier (`outbox_messages.occurred_at`), pas celui du relais. */
    public readonly occurredAt?: Date,
  ) {}

  public payload(): Record<string, unknown> {
    return this.rawPayload;
  }
}
