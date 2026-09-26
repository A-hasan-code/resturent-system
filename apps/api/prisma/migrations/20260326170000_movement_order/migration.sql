-- AlterTable
ALTER TABLE "StockMovement" ADD COLUMN IF NOT EXISTS "orderId" TEXT;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
