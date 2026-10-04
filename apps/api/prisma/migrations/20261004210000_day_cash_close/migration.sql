-- CreateEnum
CREATE TYPE "CashCounterKind" AS ENUM ('COUNTER_1', 'COUNTER_2');

-- CreateTable
CREATE TABLE "DayCashClose" (
    "id" TEXT NOT NULL,
    "businessDate" TEXT NOT NULL,
    "note" TEXT,
    "expectedCash" DECIMAL(14,2) NOT NULL,
    "collectedCash" DECIMAL(14,2) NOT NULL,
    "missCash" DECIMAL(14,2) NOT NULL,
    "pendingAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "pendingCount" INTEGER NOT NULL DEFAULT 0,
    "paidBillsCount" INTEGER NOT NULL DEFAULT 0,
    "paidSalesTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalSale" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "closedById" TEXT,
    "closedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DayCashClose_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DayCashCloseCounter" (
    "id" TEXT NOT NULL,
    "closeId" TEXT NOT NULL,
    "kind" "CashCounterKind" NOT NULL,
    "label" TEXT NOT NULL,
    "expectedCash" DECIMAL(14,2) NOT NULL,
    "collectedCash" DECIMAL(14,2) NOT NULL,
    "missCash" DECIMAL(14,2) NOT NULL,
    "missReason" TEXT,
    "billCount" INTEGER NOT NULL DEFAULT 0,
    "paymentCount" INTEGER NOT NULL DEFAULT 0,
    "tipTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "paymentsJson" JSONB,

    CONSTRAINT "DayCashCloseCounter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DayCashCloseSoldItem" (
    "id" TEXT NOT NULL,
    "closeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "qty" DECIMAL(14,3) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "DayCashCloseSoldItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DayCashClose_businessDate_key" ON "DayCashClose"("businessDate");

-- CreateIndex
CREATE UNIQUE INDEX "DayCashCloseCounter_closeId_kind_key" ON "DayCashCloseCounter"("closeId", "kind");

-- CreateIndex
CREATE INDEX "DayCashCloseSoldItem_closeId_idx" ON "DayCashCloseSoldItem"("closeId");

-- AddForeignKey
ALTER TABLE "DayCashClose" ADD CONSTRAINT "DayCashClose_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DayCashCloseCounter" ADD CONSTRAINT "DayCashCloseCounter_closeId_fkey" FOREIGN KEY ("closeId") REFERENCES "DayCashClose"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DayCashCloseSoldItem" ADD CONSTRAINT "DayCashCloseSoldItem_closeId_fkey" FOREIGN KEY ("closeId") REFERENCES "DayCashClose"("id") ON DELETE CASCADE ON UPDATE CASCADE;
