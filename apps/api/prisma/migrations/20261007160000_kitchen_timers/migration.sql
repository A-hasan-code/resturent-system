-- Recipe target prep time + order kitchen timing / alert stamps (idempotent)

ALTER TABLE "Recipe" ADD COLUMN IF NOT EXISTS "prepMinutes" INTEGER NOT NULL DEFAULT 15;

ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "pendingAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "preparingAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "readyAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "pendingAlertedAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "lateAlertedAt" TIMESTAMP(3);

UPDATE "Order" SET "pendingAt" = "createdAt" WHERE "pendingAt" IS NULL;

ALTER TABLE "Order" ALTER COLUMN "pendingAt" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Order" ALTER COLUMN "pendingAt" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "Order_status_pendingAt_idx" ON "Order"("status", "pendingAt");
CREATE INDEX IF NOT EXISTS "Order_status_preparingAt_idx" ON "Order"("status", "preparingAt");
