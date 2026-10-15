-- Stock movements: tag kitchen station
ALTER TABLE "StockMovement" ADD COLUMN IF NOT EXISTS "kitchenStation" "KitchenStation";
CREATE INDEX IF NOT EXISTS "StockMovement_kitchenStation_createdAt_idx"
  ON "StockMovement"("kitchenStation", "createdAt");

-- KitchenStock: per-station balances
ALTER TABLE "KitchenStock" ADD COLUMN IF NOT EXISTS "station" "KitchenStation" NOT NULL DEFAULT 'COOKING';

ALTER TABLE "KitchenStock" DROP CONSTRAINT IF EXISTS "KitchenStock_storeItemId_key";
DROP INDEX IF EXISTS "KitchenStock_storeItemId_key";

CREATE UNIQUE INDEX IF NOT EXISTS "KitchenStock_storeItemId_station_key"
  ON "KitchenStock"("storeItemId", "station");
CREATE INDEX IF NOT EXISTS "KitchenStock_station_idx" ON "KitchenStock"("station");

-- KitchenDayClose: one close per business day + station
ALTER TABLE "KitchenDayClose" ADD COLUMN IF NOT EXISTS "station" "KitchenStation" NOT NULL DEFAULT 'COOKING';

ALTER TABLE "KitchenDayClose" DROP CONSTRAINT IF EXISTS "KitchenDayClose_businessDate_key";
DROP INDEX IF EXISTS "KitchenDayClose_businessDate_key";

CREATE UNIQUE INDEX IF NOT EXISTS "KitchenDayClose_businessDate_station_key"
  ON "KitchenDayClose"("businessDate", "station");
