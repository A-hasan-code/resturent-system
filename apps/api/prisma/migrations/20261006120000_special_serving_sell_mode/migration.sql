-- How waiter may sell a special pot: serving count, rupees→grams, or both.
-- Idempotent: restore / partial apply may already have the enum.
DO $$ BEGIN
  CREATE TYPE "SpecialSellMode" AS ENUM ('BOTH', 'SERVING_ONLY', 'RS_ONLY');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "SpecialProduct"
  ADD COLUMN IF NOT EXISTS "servingLabel" TEXT NOT NULL DEFAULT 'Plate',
  ADD COLUMN IF NOT EXISTS "sellMode" "SpecialSellMode" NOT NULL DEFAULT 'BOTH';
