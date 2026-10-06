/**
 * Force-open all closed special pots (any business date).
 * Run: npx tsx prisma/reopen-specials-today.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const closedDates = await prisma.dailyBatch.findMany({
    where: { status: "CLOSED" },
    select: { businessDate: true },
    distinct: ["businessDate"],
  });
  const closeRows = await prisma.dayBatchClose.findMany({
    select: { businessDate: true, id: true },
  });
  const dates = [
    ...new Set([
      ...closedDates.map((d) => d.businessDate),
      ...closeRows.map((d) => d.businessDate),
    ]),
  ];

  if (!dates.length) {
    const sample = await prisma.dailyBatch.findMany({
      orderBy: { businessDate: "desc" },
      take: 10,
      select: {
        businessDate: true,
        status: true,
        cookedGrams: true,
        specialProduct: { select: { name: true } },
      },
    });
    console.log(JSON.stringify({ ok: true, message: "Already open", sample }, null, 2));
    return;
  }

  const results = [];
  for (const businessDate of dates) {
    const close = closeRows.find((c) => c.businessDate === businessDate);
    if (close) {
      await prisma.dayBatchClose.delete({ where: { id: close.id } });
    }
    const batches = await prisma.dailyBatch.updateMany({
      where: { businessDate },
      data: { status: "OPEN", closedAt: null },
    });
    results.push({
      businessDate,
      deletedBatchClose: !!close,
      batchesOpened: batches.count,
    });
  }

  const sample = await prisma.dailyBatch.findMany({
    orderBy: { businessDate: "desc" },
    take: 10,
    select: {
      businessDate: true,
      status: true,
      cookedGrams: true,
      specialProduct: { select: { name: true } },
    },
  });

  console.log(JSON.stringify({ ok: true, results, sample }, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
