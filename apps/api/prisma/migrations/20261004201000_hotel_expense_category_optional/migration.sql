-- CreateTable
CREATE TABLE "HotelExpenseCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HotelExpenseCategory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HotelExpenseCategory_name_key" ON "HotelExpenseCategory"("name");

-- AlterTable
ALTER TABLE "HotelExpense" ALTER COLUMN "category" DROP NOT NULL;
