-- Table partitions (Hall, Lawn, …)
CREATE TABLE "TablePartition" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TablePartition_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TablePartition_name_key" ON "TablePartition"("name");

-- Kitchen station on menu items
CREATE TYPE "KitchenStation" AS ENUM ('BEVERAGES', 'COOKING', 'BBQ');

ALTER TABLE "MenuItem" ADD COLUMN "kitchenStation" "KitchenStation" NOT NULL DEFAULT 'COOKING';

-- Assigned cashier for billing
ALTER TABLE "Order" ADD COLUMN "assignedCashierId" TEXT;
ALTER TABLE "Order" ADD COLUMN "tableId" TEXT;

ALTER TABLE "Order" ADD CONSTRAINT "Order_assignedCashierId_fkey"
  FOREIGN KEY ("assignedCashierId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Migrate existing area strings into partitions
INSERT INTO "TablePartition" ("id", "name", "sortOrder", "active", "createdAt")
SELECT md5(random()::text || clock_timestamp()::text), a.area, ROW_NUMBER() OVER (ORDER BY a.area), true, CURRENT_TIMESTAMP
FROM (SELECT DISTINCT "area" AS area FROM "RestaurantTable" WHERE "area" IS NOT NULL AND TRIM("area") <> '') a;

INSERT INTO "TablePartition" ("id", "name", "sortOrder", "active", "createdAt")
SELECT md5('default-hall'), 'Hall', 0, true, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "TablePartition");

ALTER TABLE "RestaurantTable" ADD COLUMN "partitionId" TEXT;

UPDATE "RestaurantTable" t
SET "partitionId" = p."id"
FROM "TablePartition" p
WHERE t."area" IS NOT NULL AND TRIM(t."area") <> '' AND p."name" = t."area";

UPDATE "RestaurantTable"
SET "partitionId" = (SELECT "id" FROM "TablePartition" ORDER BY "sortOrder" ASC LIMIT 1)
WHERE "partitionId" IS NULL;

ALTER TABLE "RestaurantTable" ALTER COLUMN "partitionId" SET NOT NULL;

ALTER TABLE "RestaurantTable" DROP CONSTRAINT IF EXISTS "RestaurantTable_name_key";
DROP INDEX IF EXISTS "RestaurantTable_name_key";

ALTER TABLE "RestaurantTable" ADD CONSTRAINT "RestaurantTable_partitionId_fkey"
  FOREIGN KEY ("partitionId") REFERENCES "TablePartition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS "RestaurantTable_partitionId_name_key" ON "RestaurantTable"("partitionId", "name");

ALTER TABLE "Order" ADD CONSTRAINT "Order_tableId_fkey"
  FOREIGN KEY ("tableId") REFERENCES "RestaurantTable"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Order_assignedCashierId_idx" ON "Order"("assignedCashierId");
CREATE INDEX "Order_tableId_idx" ON "Order"("tableId");
CREATE INDEX "Order_waiterId_idx" ON "Order"("waiterId");
