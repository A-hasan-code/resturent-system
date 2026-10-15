-- Store closing: counted leftover (physical stock after close)
ALTER TABLE "DayStockCloseLine" ADD COLUMN IF NOT EXISTS "leftoverQty" DECIMAL(14,3) NOT NULL DEFAULT 0;
