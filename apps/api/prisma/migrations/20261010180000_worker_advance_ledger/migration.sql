-- CreateEnum
CREATE TYPE "WorkerLedgerKind" AS ENUM ('OPENING_ADVANCE', 'OPENING_PAYABLE', 'ADVANCE', 'RECOVERY', 'SETTLE_PAYABLE');

-- AlterTable
ALTER TABLE "WorkerSalaryPayment" ADD COLUMN "advanceRecovered" DECIMAL(14,2) NOT NULL DEFAULT 0;
ALTER TABLE "WorkerSalaryPayment" ADD COLUMN "payableSettled" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "WorkerLedgerEntry" (
    "id" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "kind" "WorkerLedgerKind" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "entryOn" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "hotelExpenseId" TEXT,
    "salaryPaymentId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkerLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkerLedgerEntry_hotelExpenseId_key" ON "WorkerLedgerEntry"("hotelExpenseId");

-- CreateIndex
CREATE INDEX "WorkerLedgerEntry_workerId_kind_idx" ON "WorkerLedgerEntry"("workerId", "kind");

-- CreateIndex
CREATE INDEX "WorkerLedgerEntry_entryOn_idx" ON "WorkerLedgerEntry"("entryOn");

-- CreateIndex
CREATE INDEX "WorkerLedgerEntry_salaryPaymentId_idx" ON "WorkerLedgerEntry"("salaryPaymentId");

-- AddForeignKey
ALTER TABLE "WorkerLedgerEntry" ADD CONSTRAINT "WorkerLedgerEntry_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkerLedgerEntry" ADD CONSTRAINT "WorkerLedgerEntry_hotelExpenseId_fkey" FOREIGN KEY ("hotelExpenseId") REFERENCES "HotelExpense"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkerLedgerEntry" ADD CONSTRAINT "WorkerLedgerEntry_salaryPaymentId_fkey" FOREIGN KEY ("salaryPaymentId") REFERENCES "WorkerSalaryPayment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkerLedgerEntry" ADD CONSTRAINT "WorkerLedgerEntry_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
