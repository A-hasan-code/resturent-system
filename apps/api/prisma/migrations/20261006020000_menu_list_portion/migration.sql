-- Menu card shows price for this portion (e.g. 500g); orders may use less/more qty.

ALTER TABLE "MenuItem" ADD COLUMN "listPortionQty" DECIMAL(14,3) NOT NULL DEFAULT 1;
