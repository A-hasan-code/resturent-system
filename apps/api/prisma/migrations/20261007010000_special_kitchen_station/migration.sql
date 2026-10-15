-- Special pot kitchen station (synced to SPECIAL menu row for KOT routing).
ALTER TABLE "SpecialProduct" ADD COLUMN IF NOT EXISTS "kitchenStation" "KitchenStation" NOT NULL DEFAULT 'COOKING';
