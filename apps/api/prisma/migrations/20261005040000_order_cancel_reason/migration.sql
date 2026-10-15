-- AlterTable
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "cancelReason" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "cancelledAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "cancelledById" TEXT;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "Order" ADD CONSTRAINT "Order_cancelledById_fkey"
    FOREIGN KEY ("cancelledById") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Order_cancelledAt_idx" ON "Order"("cancelledAt");
