-- Split Used vs Extra on closing lines (leftover already on store lines).
ALTER TABLE "DayStockCloseLine" ADD COLUMN IF NOT EXISTS "usedQty" DECIMAL(14,3) NOT NULL DEFAULT 0;
ALTER TABLE "KitchenDayCloseLine" ADD COLUMN IF NOT EXISTS "usedQty" DECIMAL(14,3) NOT NULL DEFAULT 0;

-- Backfill kitchen: previous "extra beyond recipe" stays in extraQty; used ≈ recipe auto.
UPDATE "KitchenDayCloseLine" SET "usedQty" = "autoQty" WHERE "usedQty" = 0 AND "autoQty" > 0;

-- Backfill store: previous single bucket was extraQty — move into used, clear extra.
UPDATE "DayStockCloseLine"
SET "usedQty" = "extraQty", "extraQty" = 0
WHERE "usedQty" = 0 AND "extraQty" > 0;
