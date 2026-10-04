-- Credit customers: seated meals posted to an account, settled later in one payment.

CREATE TABLE "CreditCustomer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "address" TEXT,
    "cnic" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreditCustomer_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CreditCustomer_phone_key" ON "CreditCustomer"("phone");
CREATE UNIQUE INDEX "CreditCustomer_cnic_key" ON "CreditCustomer"("cnic");

ALTER TABLE "Order" ADD COLUMN "creditCustomerId" TEXT;

CREATE INDEX "Order_creditCustomerId_idx" ON "Order"("creditCustomerId");

ALTER TABLE "Order" ADD CONSTRAINT "Order_creditCustomerId_fkey" FOREIGN KEY ("creditCustomerId") REFERENCES "CreditCustomer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
