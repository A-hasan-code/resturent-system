-- CreateEnum
CREATE TYPE "ExtraExpensePaidBy" AS ENUM ('SUPPLIER', 'SELF');

-- AlterTable
ALTER TABLE "Purchase" ADD COLUMN "extraExpense" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN "extraExpenseNote" TEXT,
ADD COLUMN "extraExpensePaidBy" "ExtraExpensePaidBy";
