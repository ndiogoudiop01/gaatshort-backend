import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Prisma } from '@prisma/client';

/**
 * Transporte la transaction courante à travers la pile d'appels.
 *
 * Sans ça, un cas d'usage qui appelle trois repositories obtiendrait trois
 * connexions distinctes et perdrait l'atomicité — le bug classique
 * « la candidature est créée mais l'historique de statut manque ».
 */
@Injectable()
export class TransactionHost {
  private readonly als = new AsyncLocalStorage<Prisma.TransactionClient>();

  public run<T>(tx: Prisma.TransactionClient, fn: () => Promise<T>): Promise<T> {
    return this.als.run(tx, fn);
  }

  public get current(): Prisma.TransactionClient | null {
    return this.als.getStore() ?? null;
  }

  public get isInTransaction(): boolean {
    return this.als.getStore() !== undefined;
  }
}
