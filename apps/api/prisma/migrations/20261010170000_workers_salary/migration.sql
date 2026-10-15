-- CreateEnum
CREATE TYPE "WorkerPayType" AS ENUM ('DAILY', 'MONTHLY');

-- CreateTable
CREATE TABLE "Worker" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "jobTitle" TEXT,
    "phone" TEXT,
    "payType" "WorkerPayType" NOT NULL DEFAULT 'MONTHLY',
    "rate" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Worker_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkerSalaryPayment" (
    "id" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "paidOn" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "period" "HotelExpensePeriod" NOT NULL DEFAULT 'DAILY',
    "note" TEXT,
    "hotelExpenseId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkerSalaryPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Worker_active_idx" ON "Worker"("active");

-- CreateIndex
CREATE INDEX "Worker_deletedAt_idx" ON "Worker"("deletedAt");

-- CreateIndex
CREATE INDEX "Worker_name_idx" ON "Worker"("name");

-- CreateIndex
CREATE UNIQUE INDEX "WorkerSalaryPayment_hotelExpenseId_key" ON "WorkerSalaryPayment"("hotelExpenseId");

-- CreateIndex
CREATE INDEX "WorkerSalaryPayment_paidOn_idx" ON "WorkerSalaryPayment"("paidOn");

-- CreateIndex
CREATE INDEX "WorkerSalaryPayment_workerId_paidOn_idx" ON "WorkerSalaryPayment"("workerId", "paidOn");

-- AddForeignKey
ALTER TABLE "WorkerSalaryPayment" ADD CONSTRAINT "WorkerSalaryPayment_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkerSalaryPayment" ADD CONSTRAINT "WorkerSalaryPayment_hotelExpenseId_fkey" FOREIGN KEY ("hotelExpenseId") REFERENCES "HotelExpense"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkerSalaryPayment" ADD CONSTRAINT "WorkerSalaryPayment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
