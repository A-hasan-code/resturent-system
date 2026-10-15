-- CreateEnum (idempotent for partial / re-run installs)
DO $$ BEGIN
  CREATE TYPE "PackUnit" AS ENUM ('NONE', 'BOX', 'PACKET', 'TRAY', 'CRATE', 'CARTON', 'DOZEN', 'BUNDLE', 'SACK', 'TIN', 'BAG');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AlterTable
ALTER TABLE "StoreItem" ADD COLUMN IF NOT EXISTS "packUnit" "PackUnit" NOT NULL DEFAULT 'NONE';
ALTER TABLE "StoreItem" ADD COLUMN IF NOT EXISTS "unitsPerPack" DECIMAL(14,3) NOT NULL DEFAULT 1;
