import { Prisma } from "@prisma/client";

/** Active cash / kitchen orders — never cancelled or voided. */
export const NOT_CANCELLED: Prisma.OrderWhereInput = {
  status: { not: "CANCELLED" },
};

/** Open cash due — unpaid/partial only; cancelled (VOID) never included. */
export const OPEN_UNPAID_CASH: Prisma.OrderWhereInput = {
  status: { not: "CANCELLED" },
  paymentStatus: { in: ["UNPAID", "PARTIAL"] },
  creditCustomerId: null,
};

/** Payment statuses that still owe money (excludes PAID and VOID). */
export const OPEN_PAYMENT_STATUSES: Array<"UNPAID" | "PARTIAL"> = ["UNPAID", "PARTIAL"];
