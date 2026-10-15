-- Dynamic kitchen stations (user can add more than Beverages / Cooking / BBQ).

CREATE TABLE IF NOT EXISTS "KitchenStationDef" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "system" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "KitchenStationDef_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "KitchenStationDef_code_key" ON "KitchenStationDef"("code");
CREATE INDEX IF NOT EXISTS "KitchenStationDef_active_sortOrder_idx" ON "KitchenStationDef"("active", "sortOrder");

INSERT INTO "KitchenStationDef" ("id", "code", "name", "sortOrder", "active", "system", "createdAt", "updatedAt")
VALUES
  ('ks_beverages', 'BEVERAGES', 'Beverages', 1, true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('ks_cooking', 'COOKING', 'Cooking', 2, true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('ks_bbq', 'BBQ', 'BBQ', 3, true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

-- Convert enum columns → TEXT (safe if already text)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'MenuItem' AND column_name = 'kitchenStation'
      AND udt_name = 'KitchenStation'
  ) THEN
    ALTER TABLE "MenuItem" ALTER COLUMN "kitchenStation" DROP DEFAULT;
    ALTER TABLE "MenuItem" ALTER COLUMN "kitchenStation" TYPE TEXT USING "kitchenStation"::text;
    ALTER TABLE "MenuItem" ALTER COLUMN "kitchenStation" SET DEFAULT 'COOKING';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'SpecialProduct' AND column_name = 'kitchenStation'
      AND udt_name = 'KitchenStation'
  ) THEN
    ALTER TABLE "SpecialProduct" ALTER COLUMN "kitchenStation" DROP DEFAULT;
    ALTER TABLE "SpecialProduct" ALTER COLUMN "kitchenStation" TYPE TEXT USING "kitchenStation"::text;
    ALTER TABLE "SpecialProduct" ALTER COLUMN "kitchenStation" SET DEFAULT 'COOKING';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'KitchenStock' AND column_name = 'station'
      AND udt_name = 'KitchenStation'
  ) THEN
    ALTER TABLE "KitchenStock" ALTER COLUMN "station" DROP DEFAULT;
    ALTER TABLE "KitchenStock" ALTER COLUMN "station" TYPE TEXT USING "station"::text;
    ALTER TABLE "KitchenStock" ALTER COLUMN "station" SET DEFAULT 'COOKING';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'KitchenDayClose' AND column_name = 'station'
      AND udt_name = 'KitchenStation'
  ) THEN
    ALTER TABLE "KitchenDayClose" ALTER COLUMN "station" DROP DEFAULT;
    ALTER TABLE "KitchenDayClose" ALTER COLUMN "station" TYPE TEXT USING "station"::text;
    ALTER TABLE "KitchenDayClose" ALTER COLUMN "station" SET DEFAULT 'COOKING';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'StockMovement' AND column_name = 'kitchenStation'
      AND udt_name = 'KitchenStation'
  ) THEN
    ALTER TABLE "StockMovement" ALTER COLUMN "kitchenStation" TYPE TEXT USING "kitchenStation"::text;
  END IF;
END $$;

-- Drop old enum if nothing uses it
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'KitchenStation') THEN
    DROP TYPE "KitchenStation";
  END IF;
EXCEPTION WHEN dependent_objects_still_exist THEN
  NULL;
END $$;
