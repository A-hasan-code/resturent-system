-- AlterEnum: kitchen transfer / return / out
ALTER TYPE "StockMoveType" ADD VALUE IF NOT EXISTS 'KITCHEN_TRANSFER';
ALTER TYPE "StockMoveType" ADD VALUE IF NOT EXISTS 'KITCHEN_RETURN';
ALTER TYPE "StockMoveType" ADD VALUE IF NOT EXISTS 'KITCHEN_OUT';

-- Store closing: track transfers to kitchen
ALTER TABLE "DayStockCloseLine" ADD COLUMN IF NOT EXISTS "transferredQty" DECIMAL(14,3) NOT NULL DEFAULT 0;

-- Kitchen on-hand (after store → kitchen transfers; sales deduct here)
CREATE TABLE IF NOT EXISTS "KitchenStock" (
    "id" TEXT NOT NULL,
    "storeItemId" TEXT NOT NULL,
    "quantityOnHand" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "KitchenStock_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "KitchenStock_storeItemId_key" ON "KitchenStock"("storeItemId");

ALTER TABLE "KitchenStock"
  DROP CONSTRAINT IF EXISTS "KitchenStock_storeItemId_fkey",
  ADD CONSTRAINT "KitchenStock_storeItemId_fkey"
  FOREIGN KEY ("storeItemId") REFERENCES "StoreItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Kitchen daily closing (separate from store)
CREATE TABLE IF NOT EXISTS "KitchenDayClose" (
    "id" TEXT NOT NULL,
    "businessDate" TEXT NOT NULL,
    "stockUsedValue" DECIMAL(14,2) NOT NULL,
    "transferredValue" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "sales" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "profit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "closedById" TEXT,
    "editedAt" TIMESTAMP(3),
    "editedById" TEXT,
    "editedByName" TEXT,
    "editReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "KitchenDayClose_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "KitchenDayClose_businessDate_key" ON "KitchenDayClose"("businessDate");

ALTER TABLE "KitchenDayClose"
  DROP CONSTRAINT IF EXISTS "KitchenDayClose_closedById_fkey",
  ADD CONSTRAINT "KitchenDayClose_closedById_fkey"
  FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "KitchenDayCloseLine" (
    "id" TEXT NOT NULL,
    "closeId" TEXT NOT NULL,
    "storeItemId" TEXT NOT NULL,
    "kitchenOnHand" DECIMAL(14,3) NOT NULL,
    "transferredQty" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "autoQty" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "extraQty" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "reason" TEXT,
    "ratePerUnit" DECIMAL(14,2) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    CONSTRAINT "KitchenDayCloseLine_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "KitchenDayCloseLine_closeId_storeItemId_key"
  ON "KitchenDayCloseLine"("closeId", "storeItemId");

ALTER TABLE "KitchenDayCloseLine"
  DROP CONSTRAINT IF EXISTS "KitchenDayCloseLine_closeId_fkey",
  ADD CONSTRAINT "KitchenDayCloseLine_closeId_fkey"
  FOREIGN KEY ("closeId") REFERENCES "KitchenDayClose"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "KitchenDayCloseLine"
  DROP CONSTRAINT IF EXISTS "KitchenDayCloseLine_storeItemId_fkey",
  ADD CONSTRAINT "KitchenDayCloseLine_storeItemId_fkey"
  FOREIGN KEY ("storeItemId") REFERENCES "StoreItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
