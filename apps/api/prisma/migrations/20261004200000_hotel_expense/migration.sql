-- CreateEnum
CREATE TYPE "HotelExpensePeriod" AS ENUM ('DAILY', 'MONTHLY');

-- CreateTable
CREATE TABLE "HotelExpense" (
    "id" TEXT NOT NULL,
    "spentAt" TIMESTAMP(3) NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "period" "HotelExpensePeriod" NOT NULL DEFAULT 'DAILY',
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HotelExpense_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HotelExpense_spentAt_idx" ON "HotelExpense"("spentAt");

-- CreateIndex
CREATE INDEX "HotelExpense_category_idx" ON "HotelExpense"("category");

-- AddForeignKey
ALTER TABLE "HotelExpense" ADD CONSTRAINT "HotelExpense_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
