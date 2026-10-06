-- Menu kinds + special daily batch (Pakistani Special pots)

CREATE TYPE "MenuItemKind" AS ENUM ('NORMAL', 'SPECIAL', 'MIX');
CREATE TYPE "DailyBatchStatus" AS ENUM ('OPEN', 'CLOSED');
CREATE TYPE "SpecialSaleMode" AS ENUM ('PLATE', 'RS', 'MIX', 'MIX_SOLO_STORE');

CREATE TABLE "SpecialProduct" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'Pakistani Special',
    "platePrice" DECIMAL(14,2) NOT NULL,
    "plateGrams" DECIMAL(14,3) NOT NULL,
    "cookRecipeId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpecialProduct_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SpecialProduct_name_key" ON "SpecialProduct"("name");

ALTER TABLE "SpecialProduct" ADD CONSTRAINT "SpecialProduct_cookRecipeId_fkey" FOREIGN KEY ("cookRecipeId") REFERENCES "Recipe"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "DailyBatch" (
    "id" TEXT NOT NULL,
    "specialProductId" TEXT NOT NULL,
    "businessDate" TEXT NOT NULL,
    "openingCarryGrams" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "cookedGrams" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "soldGrams" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "status" "DailyBatchStatus" NOT NULL DEFAULT 'OPEN',
    "note" TEXT,
    "cookedById" TEXT,
    "cookedByName" TEXT,
    "cookedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyBatch_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DailyBatch_specialProductId_businessDate_key" ON "DailyBatch"("specialProductId", "businessDate");
CREATE INDEX "DailyBatch_businessDate_idx" ON "DailyBatch"("businessDate");
CREATE INDEX "DailyBatch_status_idx" ON "DailyBatch"("status");

ALTER TABLE "DailyBatch" ADD CONSTRAINT "DailyBatch_specialProductId_fkey" FOREIGN KEY ("specialProductId") REFERENCES "SpecialProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "DayBatchClose" (
    "id" TEXT NOT NULL,
    "businessDate" TEXT NOT NULL,
    "note" TEXT,
    "closedById" TEXT,
    "closedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DayBatchClose_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DayBatchClose_businessDate_key" ON "DayBatchClose"("businessDate");

CREATE TABLE "DayBatchCloseLine" (
    "id" TEXT NOT NULL,
    "closeId" TEXT NOT NULL,
    "specialProductId" TEXT NOT NULL,
    "dailyBatchId" TEXT,
    "systemRemainingGrams" DECIMAL(14,3) NOT NULL,
    "countedRemainingGrams" DECIMAL(14,3) NOT NULL,
    "carryGrams" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "wasteGrams" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "wasteNote" TEXT,
    "lossCost" DECIMAL(14,2) NOT NULL DEFAULT 0,

    CONSTRAINT "DayBatchCloseLine_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DayBatchCloseLine_closeId_specialProductId_key" ON "DayBatchCloseLine"("closeId", "specialProductId");

ALTER TABLE "DayBatchCloseLine" ADD CONSTRAINT "DayBatchCloseLine_closeId_fkey" FOREIGN KEY ("closeId") REFERENCES "DayBatchClose"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DayBatchCloseLine" ADD CONSTRAINT "DayBatchCloseLine_specialProductId_fkey" FOREIGN KEY ("specialProductId") REFERENCES "SpecialProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MenuItem" ADD COLUMN "kind" "MenuItemKind" NOT NULL DEFAULT 'NORMAL';
ALTER TABLE "MenuItem" ADD COLUMN "specialProductId" TEXT;
ALTER TABLE "MenuItem" ADD COLUMN "mixSpecialPlates" DECIMAL(14,3);

ALTER TABLE "MenuItem" ADD CONSTRAINT "MenuItem_specialProductId_fkey" FOREIGN KEY ("specialProductId") REFERENCES "SpecialProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "OrderItem" ADD COLUMN "batchGrams" DECIMAL(14,3) NOT NULL DEFAULT 0;
ALTER TABLE "OrderItem" ADD COLUMN "specialProductId" TEXT;
ALTER TABLE "OrderItem" ADD COLUMN "saleMode" "SpecialSaleMode";
