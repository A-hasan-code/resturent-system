-- Admin edit audit on past day-use closings
ALTER TABLE "DayStockClose" ADD COLUMN IF NOT EXISTS "editedAt" TIMESTAMP(3);
ALTER TABLE "DayStockClose" ADD COLUMN IF NOT EXISTS "editedById" TEXT;
ALTER TABLE "DayStockClose" ADD COLUMN IF NOT EXISTS "editedByName" TEXT;
ALTER TABLE "DayStockClose" ADD COLUMN IF NOT EXISTS "editReason" TEXT;
