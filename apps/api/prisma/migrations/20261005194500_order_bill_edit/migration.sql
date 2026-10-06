-- AlterEnum
ALTER TYPE "PrintJobType" ADD VALUE 'BILL_EDIT';

-- CreateTable
CREATE TABLE "OrderBillEdit" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "beforeTotal" DECIMAL(14,2) NOT NULL,
    "afterTotal" DECIMAL(14,2) NOT NULL,
    "beforeNet" DECIMAL(14,2) NOT NULL,
    "afterNet" DECIMAL(14,2) NOT NULL,
    "beforePaidAmount" DECIMAL(14,2) NOT NULL,
    "afterPaidAmount" DECIMAL(14,2) NOT NULL,
    "itemsJson" JSONB,
    "editedById" TEXT NOT NULL,
    "editedByName" TEXT NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "confirmedById" TEXT,
    "confirmedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderBillEdit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrderBillEdit_orderId_idx" ON "OrderBillEdit"("orderId");

-- CreateIndex
CREATE INDEX "OrderBillEdit_createdAt_idx" ON "OrderBillEdit"("createdAt");

-- CreateIndex
CREATE INDEX "OrderBillEdit_confirmedAt_idx" ON "OrderBillEdit"("confirmedAt");

-- AddForeignKey
ALTER TABLE "OrderBillEdit" ADD CONSTRAINT "OrderBillEdit_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderBillEdit" ADD CONSTRAINT "OrderBillEdit_editedById_fkey" FOREIGN KEY ("editedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderBillEdit" ADD CONSTRAINT "OrderBillEdit_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
