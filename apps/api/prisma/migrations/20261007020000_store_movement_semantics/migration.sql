-- SALE/COOK/RESTORE movement semantics + purchase void.
ALTER TYPE "StockMoveType" ADD VALUE IF NOT EXISTS 'COOK';
ALTER TYPE "StockMoveType" ADD VALUE IF NOT EXISTS 'RESTORE';

ALTER TABLE "Purchase" ADD COLUMN IF NOT EXISTS "voidedAt" TIMESTAMP(3);
ALTER TABLE "Purchase" ADD COLUMN IF NOT EXISTS "voidNote" TEXT;

CREATE INDEX IF NOT EXISTS "Purchase_voidedAt_idx" ON "Purchase"("voidedAt");
