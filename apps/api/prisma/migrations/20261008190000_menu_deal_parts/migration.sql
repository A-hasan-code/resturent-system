-- MIX deals: multiple store recipes ± optional cooked pots (additive; no data wipe).

CREATE TYPE "MenuDealPartKind" AS ENUM ('STORE', 'SPECIAL');

CREATE TABLE "MenuDealPart" (
    "id" TEXT NOT NULL,
    "menuItemId" TEXT NOT NULL,
    "kind" "MenuDealPartKind" NOT NULL,
    "recipeId" TEXT,
    "specialProductId" TEXT,
    "quantity" DECIMAL(14,3) NOT NULL DEFAULT 1,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MenuDealPart_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MenuDealPart_menuItemId_sortOrder_idx" ON "MenuDealPart"("menuItemId", "sortOrder");

ALTER TABLE "MenuDealPart" ADD CONSTRAINT "MenuDealPart_menuItemId_fkey"
  FOREIGN KEY ("menuItemId") REFERENCES "MenuItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MenuDealPart" ADD CONSTRAINT "MenuDealPart_recipeId_fkey"
  FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MenuDealPart" ADD CONSTRAINT "MenuDealPart_specialProductId_fkey"
  FOREIGN KEY ("specialProductId") REFERENCES "SpecialProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill existing MIX rows into deal parts (keep MenuItem columns as denormalized primary).
INSERT INTO "MenuDealPart" ("id", "menuItemId", "kind", "recipeId", "specialProductId", "quantity", "sortOrder", "label", "createdAt")
SELECT
  md5(random()::text || clock_timestamp()::text || m."id" || 'store'),
  m."id",
  'STORE',
  m."recipeId",
  NULL,
  1,
  0,
  NULL,
  CURRENT_TIMESTAMP
FROM "MenuItem" m
WHERE m."kind" = 'MIX'
  AND m."recipeId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "MenuDealPart" p WHERE p."menuItemId" = m."id" AND p."kind" = 'STORE' AND p."recipeId" = m."recipeId"
  );

INSERT INTO "MenuDealPart" ("id", "menuItemId", "kind", "recipeId", "specialProductId", "quantity", "sortOrder", "label", "createdAt")
SELECT
  md5(random()::text || clock_timestamp()::text || m."id" || 'special'),
  m."id",
  'SPECIAL',
  NULL,
  m."specialProductId",
  COALESCE(NULLIF(m."mixSpecialPlates", 0), 1),
  1,
  NULL,
  CURRENT_TIMESTAMP
FROM "MenuItem" m
WHERE m."kind" = 'MIX'
  AND m."specialProductId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "MenuDealPart" p WHERE p."menuItemId" = m."id" AND p."kind" = 'SPECIAL' AND p."specialProductId" = m."specialProductId"
  );

-- Sale snapshot for multi-recipe / multi-pot restore on cancel (additive).
ALTER TABLE "OrderItem" ADD COLUMN "dealTakesJson" JSONB;
