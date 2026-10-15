-- Finance pack: payment methods, tax on orders, day-close lock + non-cash totals, menu modifiers.

CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'CARD', 'WALLET', 'BANK');

ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "method" "PaymentMethod" NOT NULL DEFAULT 'CASH';

CREATE INDEX IF NOT EXISTS "Payment_method_createdAt_idx" ON "Payment"("method", "createdAt");

ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "taxAmount" DECIMAL(14,2) NOT NULL DEFAULT 0;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "taxPercent" DECIMAL(8,4) NOT NULL DEFAULT 0;

ALTER TABLE "DayCashClose" ADD COLUMN IF NOT EXISTS "lockedAt" TIMESTAMP(3);
ALTER TABLE "DayCashClose" ADD COLUMN IF NOT EXISTS "cardTotal" DECIMAL(14,2) NOT NULL DEFAULT 0;
ALTER TABLE "DayCashClose" ADD COLUMN IF NOT EXISTS "walletTotal" DECIMAL(14,2) NOT NULL DEFAULT 0;
ALTER TABLE "DayCashClose" ADD COLUMN IF NOT EXISTS "bankTotal" DECIMAL(14,2) NOT NULL DEFAULT 0;
ALTER TABLE "DayCashClose" ADD COLUMN IF NOT EXISTS "openingFloat" DECIMAL(14,2) NOT NULL DEFAULT 0;

ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "modifiersJson" JSONB;

CREATE TABLE IF NOT EXISTS "MenuModifier" (
    "id" TEXT NOT NULL,
    "menuItemId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priceDelta" DECIMAL(14,2) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MenuModifier_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "MenuModifier_menuItemId_active_idx" ON "MenuModifier"("menuItemId", "active");

DO $$ BEGIN
  ALTER TABLE "MenuModifier" ADD CONSTRAINT "MenuModifier_menuItemId_fkey"
    FOREIGN KEY ("menuItemId") REFERENCES "MenuItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
