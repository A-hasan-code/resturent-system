-- Served-by is a free-text name (not a linked user)
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "servedByName" TEXT;

UPDATE "Order" AS o
SET "servedByName" = u.name
FROM "User" AS u
WHERE o."servedById" = u.id
  AND (o."servedByName" IS NULL OR o."servedByName" = '');

ALTER TABLE "Order" DROP CONSTRAINT IF EXISTS "Order_servedById_fkey";
ALTER TABLE "Order" DROP COLUMN IF EXISTS "servedById";
