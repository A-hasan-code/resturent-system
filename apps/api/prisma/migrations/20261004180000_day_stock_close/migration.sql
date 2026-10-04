-- One stock-usage close per restaurant business day.
CREATE TABLE "DayStockClose" (
    "id" TEXT NOT NULL,
    "businessDate" TEXT NOT NULL,
    "stockUsedValue" DECIMAL(14,2) NOT NULL,
    "sales" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "profit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "closedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DayStockClose_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DayStockCloseLine" (
    "id" TEXT NOT NULL,
    "closeId" TEXT NOT NULL,
    "storeItemId" TEXT NOT NULL,
    "autoQty" DECIMAL(14,3) NOT NULL,
    "extraQty" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "reason" TEXT,
    "ratePerUnit" DECIMAL(14,2) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    CONSTRAINT "DayStockCloseLine_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "StockMovement" ADD COLUMN "dayCloseId" TEXT;

CREATE UNIQUE INDEX "DayStockClose_businessDate_key" ON "DayStockClose"("businessDate");
CREATE UNIQUE INDEX "DayStockCloseLine_closeId_storeItemId_key" ON "DayStockCloseLine"("closeId", "storeItemId");

ALTER TABLE "DayStockClose" ADD CONSTRAINT "DayStockClose_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DayStockCloseLine" ADD CONSTRAINT "DayStockCloseLine_closeId_fkey" FOREIGN KEY ("closeId") REFERENCES "DayStockClose"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DayStockCloseLine" ADD CONSTRAINT "DayStockCloseLine_storeItemId_fkey" FOREIGN KEY ("storeItemId") REFERENCES "StoreItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_dayCloseId_fkey" FOREIGN KEY ("dayCloseId") REFERENCES "DayStockClose"("id") ON DELETE SET NULL ON UPDATE CASCADE;
