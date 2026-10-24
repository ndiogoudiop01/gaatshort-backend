-- Gaatshort — films et séries (05-BACKEND-SCHEMA v0.2, décision Q-02 : portefeuille commun).
-- Expand uniquement : aucune table existante n'est supprimée.

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'BLOCKED', 'DELETED');
CREATE TYPE "SeriesStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');
CREATE TYPE "EpisodeStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'WITHDRAWN');
CREATE TYPE "MediaKind" AS ENUM ('VIDEO', 'SUBTITLE');
CREATE TYPE "MediaProvider" AS ENUM ('BUNNY_STREAM', 'FAKE');
CREATE TYPE "MediaStatus" AS ENUM ('PENDING_UPLOAD', 'PROCESSING', 'READY', 'FAILED');
CREATE TYPE "LedgerKind" AS ENUM ('PURCHASE_CREDIT', 'UNLOCK_DEBIT', 'BONUS_GRANT', 'ADJUSTMENT', 'REFUND_REVERSAL');
CREATE TYPE "EntitlementSource" AS ENUM ('COINS', 'ADMIN_GRANT');
CREATE TYPE "PaymentProvider" AS ENUM ('PAYTECH', 'FAKE');
CREATE TYPE "TenantSeriesStatus" AS ENUM ('HIDDEN', 'LIVE');
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED');

-- AlterTable
ALTER TABLE "users" ADD COLUMN "account_id" UUID;
ALTER TABLE "tenants" ADD COLUMN "is_first_party" BOOLEAN NOT NULL DEFAULT false;
-- Une seule marque maison (D-13).
CREATE UNIQUE INDEX "one_first_party_tenant" ON "tenants" ((true)) WHERE "is_first_party";

-- CreateTable
CREATE TABLE "accounts" (
    "id" UUID NOT NULL,
    "phone_e164" TEXT,
    "email" TEXT,
    "display_name" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'fr',
    "country_code" CHAR(2),
    "status" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "genres" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name_fr" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "genres_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "series" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "SeriesStatus" NOT NULL DEFAULT 'DRAFT',
    "original_locale" TEXT NOT NULL DEFAULT 'fr',
    "title_fr" TEXT NOT NULL,
    "title_en" TEXT,
    "synopsis_fr" TEXT NOT NULL DEFAULT '',
    "synopsis_en" TEXT,
    "poster_url" TEXT,
    "banner_url" TEXT,
    "trailer_asset_id" UUID,
    "maturity_rating" TEXT NOT NULL DEFAULT '13+',
    "release_year" INTEGER,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "free_episodes" INTEGER NOT NULL DEFAULT 5,
    "episode_price_coins" INTEGER NOT NULL DEFAULT 15,
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "series_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "series_genres" (
    "series_id" UUID NOT NULL,
    "genre_id" UUID NOT NULL,

    CONSTRAINT "series_genres_pkey" PRIMARY KEY ("series_id","genre_id")
);

CREATE TABLE "episodes" (
    "id" UUID NOT NULL,
    "series_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "status" "EpisodeStatus" NOT NULL DEFAULT 'DRAFT',
    "title_fr" TEXT,
    "title_en" TEXT,
    "video_asset_id" UUID,
    "duration_seconds" INTEGER,
    "price_coins_override" INTEGER,
    "thumbnail_url" TEXT,
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "episodes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "media_assets" (
    "id" UUID NOT NULL,
    "kind" "MediaKind" NOT NULL,
    "provider" "MediaProvider" NOT NULL,
    "provider_ref" TEXT NOT NULL,
    "status" "MediaStatus" NOT NULL DEFAULT 'PENDING_UPLOAD',
    "title" TEXT,
    "duration_seconds" INTEGER,
    "width" INTEGER,
    "height" INTEGER,
    "thumbnail_url" TEXT,
    "failure_reason" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "subtitle_tracks" (
    "episode_id" UUID NOT NULL,
    "locale" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subtitle_tracks_pkey" PRIMARY KEY ("episode_id","locale")
);

CREATE TABLE "licenses" (
    "id" UUID NOT NULL,
    "licensor_name" TEXT NOT NULL,
    "contract_ref" TEXT NOT NULL,
    "document_url" TEXT,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "territories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sublicensing_allowed" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "licenses_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "license_series" (
    "license_id" UUID NOT NULL,
    "series_id" UUID NOT NULL,

    CONSTRAINT "license_series_pkey" PRIMARY KEY ("license_id","series_id")
);

CREATE TABLE "wallets" (
    "account_id" UUID NOT NULL,
    "paid_balance" INTEGER NOT NULL DEFAULT 0,
    "bonus_balance" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("account_id")
);

CREATE TABLE "wallet_ledger_entries" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "kind" "LedgerKind" NOT NULL,
    "paid_delta" INTEGER NOT NULL,
    "bonus_delta" INTEGER NOT NULL,
    "paid_balance_after" INTEGER NOT NULL,
    "bonus_balance_after" INTEGER NOT NULL,
    "origin_tenant_id" UUID,
    "order_id" UUID,
    "episode_id" UUID,
    "idempotency_key" TEXT,
    "reason" TEXT,
    "actor_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_ledger_entries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "entitlements" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "episode_id" UUID NOT NULL,
    "source" "EntitlementSource" NOT NULL,
    "ledger_entry_id" UUID,
    "origin_tenant_id" UUID,
    "granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "entitlements_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "payment_provider_events" (
    "id" UUID NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "event_type" TEXT,
    "signature_valid" BOOLEAN NOT NULL,
    "order_reference" TEXT,
    "payload" JSONB NOT NULL,
    "processing_status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "processing_error" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),

    CONSTRAINT "payment_provider_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tenant_series" (
    "tenant_id" UUID NOT NULL,
    "series_id" UUID NOT NULL,
    "status" "TenantSeriesStatus" NOT NULL DEFAULT 'HIDDEN',
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,
    "free_episodes_override" INTEGER,
    "episode_price_coins_override" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_series_pkey" PRIMARY KEY ("tenant_id","series_id")
);

CREATE TABLE "coin_packs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "coins" INTEGER NOT NULL,
    "bonus_coins" INTEGER NOT NULL DEFAULT 0,
    "currency_code" CHAR(3) NOT NULL DEFAULT 'XOF',
    "amount_minor" INTEGER NOT NULL,
    "badge" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "coin_packs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "coin_pack_id" UUID NOT NULL,
    "coins" INTEGER NOT NULL,
    "bonus_coins" INTEGER NOT NULL,
    "currency_code" CHAR(3) NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "provider_token" TEXT,
    "redirect_url" TEXT,
    "payment_method" TEXT,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
    "failure_code" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "order_status_history" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "from_status" "OrderStatus",
    "to_status" "OrderStatus" NOT NULL,
    "cause" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_status_history_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "watch_progress" (
    "tenant_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "episode_id" UUID NOT NULL,
    "series_id" UUID NOT NULL,
    "position_seconds" INTEGER NOT NULL,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "watch_progress_pkey" PRIMARY KEY ("tenant_id","account_id","episode_id")
);

CREATE TABLE "favorites" (
    "tenant_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "series_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "favorites_pkey" PRIMARY KEY ("tenant_id","account_id","series_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_tenant_id_account_id_key" ON "users"("tenant_id", "account_id");
CREATE UNIQUE INDEX "accounts_phone_e164_key" ON "accounts"("phone_e164");
CREATE UNIQUE INDEX "accounts_email_key" ON "accounts"("email");
CREATE UNIQUE INDEX "genres_slug_key" ON "genres"("slug");
CREATE UNIQUE INDEX "series_slug_key" ON "series"("slug");
CREATE INDEX "series_status_published_at_idx" ON "series"("status", "published_at" DESC);
CREATE INDEX "series_genres_genre_id_idx" ON "series_genres"("genre_id");
CREATE UNIQUE INDEX "episodes_video_asset_id_key" ON "episodes"("video_asset_id");
CREATE UNIQUE INDEX "episodes_series_id_number_key" ON "episodes"("series_id", "number");
CREATE INDEX "media_assets_status_idx" ON "media_assets"("status");
CREATE UNIQUE INDEX "media_assets_provider_provider_ref_key" ON "media_assets"("provider", "provider_ref");
CREATE INDEX "license_series_series_id_idx" ON "license_series"("series_id");
CREATE INDEX "wallet_ledger_entries_account_id_created_at_idx" ON "wallet_ledger_entries"("account_id", "created_at" DESC);
CREATE UNIQUE INDEX "wallet_ledger_entries_account_id_idempotency_key_key" ON "wallet_ledger_entries"("account_id", "idempotency_key");
CREATE UNIQUE INDEX "entitlements_ledger_entry_id_key" ON "entitlements"("ledger_entry_id");
CREATE UNIQUE INDEX "entitlements_account_id_episode_id_key" ON "entitlements"("account_id", "episode_id");
CREATE INDEX "payment_provider_events_order_reference_idx" ON "payment_provider_events"("order_reference");
CREATE UNIQUE INDEX "payment_provider_events_provider_dedupe_key_key" ON "payment_provider_events"("provider", "dedupe_key");
CREATE INDEX "tenant_series_tenant_id_status_position_idx" ON "tenant_series"("tenant_id", "status", "position");
CREATE INDEX "coin_packs_tenant_id_active_position_idx" ON "coin_packs"("tenant_id", "active", "position");
CREATE UNIQUE INDEX "coin_packs_tenant_id_code_key" ON "coin_packs"("tenant_id", "code");
CREATE UNIQUE INDEX "orders_reference_key" ON "orders"("reference");
CREATE UNIQUE INDEX "orders_provider_token_key" ON "orders"("provider_token");
CREATE INDEX "orders_tenant_id_account_id_created_at_idx" ON "orders"("tenant_id", "account_id", "created_at" DESC);
CREATE INDEX "orders_tenant_id_status_created_at_idx" ON "orders"("tenant_id", "status", "created_at" DESC);
CREATE UNIQUE INDEX "orders_tenant_id_account_id_idempotency_key_key" ON "orders"("tenant_id", "account_id", "idempotency_key");
CREATE INDEX "order_status_history_tenant_id_order_id_idx" ON "order_status_history"("tenant_id", "order_id");
CREATE INDEX "watch_progress_tenant_id_account_id_updated_at_idx" ON "watch_progress"("tenant_id", "account_id", "updated_at" DESC);
CREATE INDEX "watch_progress_tenant_id_series_id_updated_at_idx" ON "watch_progress"("tenant_id", "series_id", "updated_at" DESC);
CREATE INDEX "favorites_tenant_id_account_id_created_at_idx" ON "favorites"("tenant_id", "account_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "series" ADD CONSTRAINT "series_trailer_asset_id_fkey" FOREIGN KEY ("trailer_asset_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "series_genres" ADD CONSTRAINT "series_genres_series_id_fkey" FOREIGN KEY ("series_id") REFERENCES "series"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "series_genres" ADD CONSTRAINT "series_genres_genre_id_fkey" FOREIGN KEY ("genre_id") REFERENCES "genres"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_series_id_fkey" FOREIGN KEY ("series_id") REFERENCES "series"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_video_asset_id_fkey" FOREIGN KEY ("video_asset_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "subtitle_tracks" ADD CONSTRAINT "subtitle_tracks_episode_id_fkey" FOREIGN KEY ("episode_id") REFERENCES "episodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "license_series" ADD CONSTRAINT "license_series_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "license_series" ADD CONSTRAINT "license_series_series_id_fkey" FOREIGN KEY ("series_id") REFERENCES "series"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "wallet_ledger_entries" ADD CONSTRAINT "wallet_ledger_entries_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "wallets"("account_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_episode_id_fkey" FOREIGN KEY ("episode_id") REFERENCES "episodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_ledger_entry_id_fkey" FOREIGN KEY ("ledger_entry_id") REFERENCES "wallet_ledger_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Règles d'intégrité hors Prisma (05-BACKEND-SCHEMA §5.2, §10) ───────────
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_balances_non_negative" CHECK ("paid_balance" >= 0 AND "bonus_balance" >= 0);
ALTER TABLE "wallet_ledger_entries" ADD CONSTRAINT "ledger_balances_non_negative" CHECK ("paid_balance_after" >= 0 AND "bonus_balance_after" >= 0);
ALTER TABLE "wallet_ledger_entries" ADD CONSTRAINT "ledger_non_zero" CHECK ("paid_delta" <> 0 OR "bonus_delta" <> 0);
ALTER TABLE "wallet_ledger_entries" ADD CONSTRAINT "ledger_purchase_has_order" CHECK ("kind" <> 'PURCHASE_CREDIT' OR "order_id" IS NOT NULL);
ALTER TABLE "wallet_ledger_entries" ADD CONSTRAINT "ledger_unlock_has_episode" CHECK ("kind" <> 'UNLOCK_DEBIT' OR "episode_id" IS NOT NULL);
ALTER TABLE "wallet_ledger_entries" ADD CONSTRAINT "ledger_adjustment_has_reason" CHECK ("kind" <> 'ADJUSTMENT' OR "reason" IS NOT NULL);
-- Un achat ne crédite qu'une fois, quel que soit le nombre de notifications.
CREATE UNIQUE INDEX "ledger_one_credit_per_order" ON "wallet_ledger_entries"("order_id") WHERE "kind" = 'PURCHASE_CREDIT';
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_number_positive" CHECK ("number" > 0);
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_published_has_video" CHECK ("status" <> 'PUBLISHED' OR "video_asset_id" IS NOT NULL);
ALTER TABLE "series" ADD CONSTRAINT "series_pricing_valid" CHECK ("free_episodes" >= 0 AND "episode_price_coins" > 0);
ALTER TABLE "licenses" ADD CONSTRAINT "licenses_period_valid" CHECK ("ends_at" > "starts_at");
ALTER TABLE "coin_packs" ADD CONSTRAINT "coin_packs_amounts_valid" CHECK ("coins" > 0 AND "bonus_coins" >= 0 AND "amount_minor" > 0);
ALTER TABLE "orders" ADD CONSTRAINT "orders_amounts_valid" CHECK ("coins" > 0 AND "bonus_coins" >= 0 AND "amount_minor" > 0);

-- Grand livre immuable : une correction est une nouvelle écriture.
CREATE OR REPLACE FUNCTION ledger_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'wallet_ledger_entries est en ajout seul (% interdit)', TG_OP;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER wallet_ledger_entries_immutable
  BEFORE UPDATE OR DELETE ON "wallet_ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION ledger_immutable();
