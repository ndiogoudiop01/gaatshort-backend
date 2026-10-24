import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TenantPrismaService } from '@infra/persistence/prisma/tenant-prisma.service';
import { ResourceNotFoundError } from '@shared/kernel/errors/domain.error';

export interface PackInput {
  code?: string;
  coins?: number;
  bonusCoins?: number;
  currencyCode?: string;
  amountMinor?: number;
  badge?: string | null;
  position?: number;
  active?: boolean;
}

/** Packs de crédits de la marque courante (RLS). Prix en unités mineures (XOF : 0 décimale). */
@Injectable()
export class PacksService {
  constructor(private readonly prisma: TenantPrismaService) {}

  public listActive() {
    return this.prisma.client.coinPack.findMany({
      where: { active: true },
      orderBy: [{ position: 'asc' }, { amountMinor: 'asc' }],
      select: { id: true, code: true, coins: true, bonusCoins: true, currencyCode: true, amountMinor: true, badge: true },
    });
  }

  public listAll() {
    return this.prisma.client.coinPack.findMany({ orderBy: [{ position: 'asc' }, { amountMinor: 'asc' }] });
  }

  public async create(actorId: string, input: PackInput & { code: string; coins: number; amountMinor: number }) {
    try {
      const pack = await this.prisma.client.coinPack.create({ data: input as never });
      await this.audit(actorId, 'billing.pack.created', pack.id, input);
      return pack;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException({ code: 'DUPLICATE_RESOURCE', message: 'Un pack porte déjà ce code' });
      }
      throw error;
    }
  }

  public async update(actorId: string, id: string, input: PackInput) {
    const found = await this.prisma.client.coinPack.findFirst({ where: { id } });
    if (!found) throw new ResourceNotFoundError('coin_pack', id);
    // `where` scopé tenant par l'extension ; les commandes passées gardent leurs montants figés.
    await this.prisma.client.coinPack.updateMany({ where: { id }, data: input });
    await this.audit(actorId, 'billing.pack.updated', id, input);
    return this.prisma.client.coinPack.findFirst({ where: { id } });
  }

  private async audit(actorId: string, action: string, id: string, after: PackInput) {
    await this.prisma.client.auditLog.create({
      data: { actorId, action, resourceType: 'coin_pack', resourceId: id, after: after as Prisma.InputJsonValue } as never,
    });
  }
}
