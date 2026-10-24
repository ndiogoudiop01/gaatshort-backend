import {
  BadRequestException, Body, Controller, Get, Headers, HttpCode, Param, Patch, Post, Query, Res, ParseUUIDPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { RequirePermissions } from '@shared/decorators/permissions.decorator';
import { Public } from '@shared/decorators/public.decorator';
import { RawResponse } from '@shared/decorators/raw-response.decorator';
import { requireAccountId } from '@shared/kernel/access/viewer';
import type { AuthenticatedUser } from '@shared/kernel/types/authenticated-user';
import { OrdersService } from '../../application/orders.service';
import { PacksService } from '../../application/packs.service';
import { PaymentNotificationService } from '../../application/payment-notification.service';
import { AdminOrdersQueryDto, CreateOrderDto, MyOrdersQueryDto, PackDto, UpdatePackDto } from './dto/billing.dto';

@ApiTags('App — Boutique')
@Controller({ version: '1' })
export class BillingController {
  constructor(
    private readonly packs: PacksService,
    private readonly orders: OrdersService,
    private readonly notifications: PaymentNotificationService,
  ) {}

  @Public()
  @Get('billing/packs')
  @ApiOperation({ summary: 'Packs de crédits de la marque' })
  public listPacks() {
    return this.packs.listActive();
  }

  @ApiBearerAuth('access-token')
  @Post('billing/orders')
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: 'Une clé par intention d’achat (double tap = même commande)' })
  @ApiOperation({ summary: 'Créer une commande et obtenir l’URL de paiement', description: 'Le portefeuille n’est crédité qu’à réception de la notification vérifiée du fournisseur.' })
  public createOrder(
    @Body() dto: CreateOrderDto,
    @Headers('idempotency-key') key: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!key || !/^[A-Za-z0-9_-]{8,100}$/.test(key)) {
      throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'En-tête Idempotency-Key requis (8 à 100 caractères)' });
    }
    return this.orders.create({
      accountId: requireAccountId(user),
      packId: dto.packId,
      idempotencyKey: key,
      returnUrl: dto.returnUrl,
    });
  }

  @ApiBearerAuth('access-token')
  @Get('billing/orders')
  @ApiOperation({ summary: 'Mes commandes' })
  public myOrders(@CurrentUser() user: AuthenticatedUser, @Query() q: MyOrdersQueryDto) {
    return this.orders.listMine(requireAccountId(user), q.limit);
  }

  @ApiBearerAuth('access-token')
  @Get('billing/orders/:idOrReference')
  @ApiOperation({ summary: 'Statut d’une commande (à interroger au retour du paiement)' })
  public myOrder(@Param('idOrReference') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.orders.getMine(requireAccountId(user), id);
  }

  /** IPN PayTech : toujours 200, sinon PayTech réessaie en boucle ; le résultat est journalisé. */
  @Public()
  @Post('webhooks/paytech')
  @HttpCode(200)
  @ApiExcludeEndpoint()
  public async paytechIpn(@Body() body: Record<string, unknown>) {
    const result = await this.notifications.handle(body ?? {}, 'webhook');
    return { received: true, result };
  }

  // ── Paiement simulé (PAYMENT_DRIVER=fake, jamais en production) ──────────

  @Public()
  @RawResponse()
  @Get('billing/fake-checkout/:reference')
  @ApiExcludeEndpoint()
  public fakeCheckout(@Param('reference') reference: string, @Query() query: Record<string, unknown>, @Res() res: Response) {
    this.orders.assertFakeEnabled();
    const safe = reference.replace(/[^A-Z0-9-]/gi, '');
    // Paramètres de retour réémis tels quels (échappés) : vérifiés par signature à la décision.
    const keep = new URLSearchParams(
      Object.entries(query).filter((e): e is [string, string] => ['ok', 'ko', 'sig'].includes(e[0]) && typeof e[1] === 'string'),
    ).toString().replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    const suffix = keep ? `?${keep}` : '';
    res.type('html').send(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Paiement simulé</title><style>body{font-family:system-ui,sans-serif;background:#0f0b14;color:#f4eff8;display:grid;place-items:center;min-height:100vh;margin:0}
main{background:#18131f;border:1px solid #2f2639;border-radius:16px;padding:24px;max-width:360px;width:calc(100% - 32px)}h1{font-size:20px;margin:0 0 8px}
p{color:#a99db6;font-size:14px}form{display:inline}button{border:0;border-radius:10px;padding:12px 18px;font-size:16px;margin:8px 8px 0 0;cursor:pointer}
.pay{background:#e0325e;color:#fff}.cancel{background:#231c2c;color:#f4eff8}</style></head><body><main>
<h1>Paiement simulé</h1><p>Environnement de test : aucun argent réel. Commande <strong>${safe}</strong>.</p>
<form method="post" action="${safe}/PAID${suffix}"><button class="pay">Payer</button></form>
<form method="post" action="${safe}/CANCELLED${suffix}"><button class="cancel">Annuler</button></form>
</main></body></html>`);
  }

  @Public()
  @RawResponse()
  @Post('billing/fake-checkout/:reference/:outcome')
  @ApiExcludeEndpoint()
  public async fakeCheckoutDecide(
    @Param('reference') reference: string,
    @Param('outcome') outcome: string,
    @Query() query: Record<string, unknown>,
    @Res() res: Response,
  ) {
    this.orders.assertFakeEnabled();
    const decided = outcome === 'PAID' ? 'PAID' : 'CANCELLED';
    const result = await this.notifications.simulate(reference, decided);
    const back = this.orders.simulatedReturnUrl(reference, decided, query);
    if (back) {
      res.redirect(303, back);
      return;
    }
    res.type('html').send(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Paiement simulé</title></head>
<body style="font-family:system-ui;background:#0f0b14;color:#f4eff8;display:grid;place-items:center;min-height:100vh;margin:0">
<main style="text-align:center"><h1>${decided === 'PAID' ? 'Paiement accepté' : 'Paiement annulé'}</h1><p>Résultat : ${result}. Vous pouvez revenir à l’application.</p></main></body></html>`);
  }

  // ── Back-office ───────────────────────────────────────────────────────────

  @ApiTags('Back-office — Monétisation')
  @ApiBearerAuth('access-token')
  @Get('admin/packs')
  @RequirePermissions('pack:write')
  @ApiOperation({ summary: 'Packs de crédits (actifs et inactifs)' })
  public adminPacks() {
    return this.packs.listAll();
  }

  @ApiTags('Back-office — Monétisation')
  @ApiBearerAuth('access-token')
  @Post('admin/packs')
  @RequirePermissions('pack:write')
  @ApiOperation({ summary: 'Créer un pack' })
  public createPack(@Body() dto: PackDto, @CurrentUser() user: AuthenticatedUser) {
    return this.packs.create(user.id, {
      code: dto.code, coins: dto.coins, bonusCoins: dto.bonusCoins, currencyCode: dto.currencyCode,
      amountMinor: dto.amountMinor, badge: dto.badge, position: dto.position, active: dto.active,
    });
  }

  @ApiTags('Back-office — Monétisation')
  @ApiBearerAuth('access-token')
  @Patch('admin/packs/:id')
  @RequirePermissions('pack:write')
  @ApiOperation({ summary: 'Modifier un pack (les commandes passées gardent leur prix)' })
  public updatePack(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePackDto, @CurrentUser() user: AuthenticatedUser) {
    return this.packs.update(user.id, id, {
      coins: dto.coins, bonusCoins: dto.bonusCoins, amountMinor: dto.amountMinor, badge: dto.badge, position: dto.position, active: dto.active,
    });
  }

  @ApiTags('Back-office — Monétisation')
  @ApiBearerAuth('access-token')
  @Get('admin/orders')
  @RequirePermissions('order:read')
  @ApiOperation({ summary: 'Commandes de la marque' })
  public adminOrders(@Query() q: AdminOrdersQueryDto) {
    return this.orders.adminList({ status: q.status, q: q.q, page: q.page, perPage: q.perPage });
  }

  @ApiTags('Back-office — Monétisation')
  @ApiBearerAuth('access-token')
  @Get('admin/orders/:id')
  @RequirePermissions('order:read')
  @ApiOperation({ summary: 'Commande : historique et notifications reçues' })
  public adminOrder(@Param('id', ParseUUIDPipe) id: string) {
    return this.orders.adminGet(id);
  }
}
