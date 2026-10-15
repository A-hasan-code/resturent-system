/**
 * One-off: import Active Stock from hotel PDF inventory sheet.
 * Names kept exactly as on the sheet. Skip remaining qty 0 / blank rows.
 */
import { PrismaClient, UnitType } from "@prisma/client";

const prisma = new PrismaClient();

type Row = {
  name: string;
  qty: number;
  rate: number;
  cat: "BEV" | "KITCHEN";
  unit: UnitType;
};

/** Remaining + Price from Active Stock (04.10.2026). Exact PDF names. */
const ROWS: Row[] = [
  { name: "Regular", qty: 168, rate: 41, cat: "BEV", unit: UnitType.PCS },
  { name: "Budy", qty: 36, rate: 21, cat: "BEV", unit: UnitType.PCS },
  { name: "1 ltr", qty: 72, rate: 129, cat: "BEV", unit: UnitType.PCS },
  { name: "1.5 ltr", qty: 114, rate: 178, cat: "BEV", unit: UnitType.PCS },
  { name: "2 ltr", qty: 18, rate: 193, cat: "BEV", unit: UnitType.PCS },
  { name: "Teen", qty: 12, rate: 0, cat: "BEV", unit: UnitType.PCS },
  { name: "Water Big", qty: 12, rate: 82, cat: "BEV", unit: UnitType.PCS },
  { name: "Water Small", qty: 54, rate: 42, cat: "BEV", unit: UnitType.PCS },
  { name: "Daal Mash", qty: 25, rate: 431, cat: "KITCHEN", unit: UnitType.KG },
  { name: "Daal Mong", qty: 10.9, rate: 228, cat: "KITCHEN", unit: UnitType.KG },
  { name: "Ghiee", qty: 6, rate: 0, cat: "KITCHEN", unit: UnitType.KG },
  { name: "Oil", qty: 50, rate: 539, cat: "KITCHEN", unit: UnitType.L },
  { name: "Olper", qty: 48, rate: 225, cat: "KITCHEN", unit: UnitType.L },
  { name: "Rice Paki", qty: 33, rate: 320, cat: "KITCHEN", unit: UnitType.KG },
  { name: "Rice Kachi", qty: 2.45, rate: 180, cat: "KITCHEN", unit: UnitType.KG },
  { name: "Sugar", qty: 52.5, rate: 135, cat: "KITCHEN", unit: UnitType.KG },
  { name: "White Chana", qty: 7, rate: 300, cat: "KITCHEN", unit: UnitType.KG },
  { name: "Hand Saban", qty: 6, rate: 47.5, cat: "KITCHEN", unit: UnitType.PCS },
  { name: "Bartan Saban", qty: 21, rate: 57, cat: "KITCHEN", unit: UnitType.PCS },
  { name: "Sfunch Foam", qty: 5, rate: 110, cat: "KITCHEN", unit: UnitType.PCS },
  { name: "Subi Jali", qty: 27, rate: 38, cat: "KITCHEN", unit: UnitType.PCS },
  { name: "Sada Shaper", qty: 8, rate: 700, cat: "KITCHEN", unit: UnitType.PCS },
  { name: "Raita Shaper", qty: 1, rate: 700, cat: "KITCHEN", unit: UnitType.PCS },
  { name: "Roti Radi", qty: 8.55, rate: 150, cat: "KITCHEN", unit: UnitType.KG },
  { name: "English Radi", qty: 8.6, rate: 200, cat: "KITCHEN", unit: UnitType.KG },
  { name: "Custard", qty: 4, rate: 220, cat: "KITCHEN", unit: UnitType.KG },
  { name: "Floor", qty: 45, rate: 2000, cat: "KITCHEN", unit: UnitType.KG },
  { name: "Super Fine", qty: 37.95, rate: 142, cat: "KITCHEN", unit: UnitType.KG },
  { name: "Maida", qty: 31.85, rate: 142, cat: "KITCHEN", unit: UnitType.KG },
  { name: "Tissue", qty: 91, rate: 370, cat: "KITCHEN", unit: UnitType.PCS },
  { name: "Green Tea", qty: 2, rate: 0, cat: "KITCHEN", unit: UnitType.KG },
  { name: "Black Tea", qty: 20, rate: 1800, cat: "KITCHEN", unit: UnitType.KG },
  { name: "Khajoor", qty: 4, rate: 500, cat: "KITCHEN", unit: UnitType.KG },
  { name: "Machis", qty: 3, rate: 46, cat: "KITCHEN", unit: UnitType.PCS },
  { name: "Garam Misala", qty: 2, rate: 2200, cat: "KITCHEN", unit: UnitType.KG },
  { name: "Zeera", qty: 2.6, rate: 1100, cat: "KITCHEN", unit: UnitType.KG },
  { name: "Black Paper", qty: 3, rate: 2200, cat: "KITCHEN", unit: UnitType.KG },
  { name: "White Paper", qty: 2.5, rate: 2600, cat: "KITCHEN", unit: UnitType.KG },
  { name: "Iodeen Namak", qty: 4, rate: 50, cat: "KITCHEN", unit: UnitType.KG },
  { name: "Sada Salt", qty: 9, rate: 11.5, cat: "KITCHEN", unit: UnitType.KG },
  { name: "Khushk Dhanya", qty: 2, rate: 600, cat: "KITCHEN", unit: UnitType.KG },
  { name: "Haldi", qty: 6, rate: 300, cat: "KITCHEN", unit: UnitType.KG },
  { name: "Red Paper", qty: 4, rate: 300, cat: "KITCHEN", unit: UnitType.KG },
  { name: "Dhara Paper", qty: 4, rate: 0, cat: "KITCHEN", unit: UnitType.KG },
  { name: "National Kaichup", qty: 3, rate: 400, cat: "KITCHEN", unit: UnitType.KG },
  { name: "Sirka", qty: 3, rate: 120, cat: "KITCHEN", unit: UnitType.L },
  { name: "C-H Salt", qty: 2, rate: 1200, cat: "KITCHEN", unit: UnitType.KG },
  { name: "Suref", qty: 1.17, rate: 210, cat: "KITCHEN", unit: UnitType.KG },
  { name: "Goualmerch", qty: 5.4, rate: 600, cat: "KITCHEN", unit: UnitType.KG },
  { name: "Aloo Misala", qty: 4, rate: 0, cat: "KITCHEN", unit: UnitType.KG },
  { name: "Surjical Cap", qty: 3, rate: 0, cat: "KITCHEN", unit: UnitType.PCS },
  { name: "Tooth Pick", qty: 2, rate: 0, cat: "KITCHEN", unit: UnitType.PCS },
  { name: "Room Sapry", qty: 1, rate: 280, cat: "KITCHEN", unit: UnitType.PCS },
  { name: "Kingtox Sapray", qty: 3, rate: 700, cat: "KITCHEN", unit: UnitType.PCS },
  { name: "Straw", qty: 1, rate: 300, cat: "KITCHEN", unit: UnitType.PCS },
  { name: "Kapra", qty: 6, rate: 50, cat: "KITCHEN", unit: UnitType.PCS },
  { name: "Ilachi", qty: 0.75, rate: 12000, cat: "KITCHEN", unit: UnitType.KG },
  { name: "Badam", qty: 1, rate: 3000, cat: "KITCHEN", unit: UnitType.KG },
  { name: "Kaju", qty: 0.15, rate: 3400, cat: "KITCHEN", unit: UnitType.KG },
  { name: "Kheer Parsal Dabi", qty: 200, rate: 6, cat: "KITCHEN", unit: UnitType.PCS },
  { name: "Kheer Chamach", qty: 2, rate: 180, cat: "KITCHEN", unit: UnitType.PCS },
  { name: "Papita Powder", qty: 2, rate: 120, cat: "KITCHEN", unit: UnitType.KG },
  { name: "CornFloor", qty: 19, rate: 0, cat: "KITCHEN", unit: UnitType.KG },
  { name: "Gulocose", qty: 8.71, rate: 300, cat: "KITCHEN", unit: UnitType.KG },
  { name: "Food Colour", qty: 1, rate: 220, cat: "KITCHEN", unit: UnitType.KG },
  { name: "Parsal Rabber", qty: 1, rate: 750, cat: "KITCHEN", unit: UnitType.PCS },
  { name: "Sohaga", qty: 0.5, rate: 700, cat: "KITCHEN", unit: UnitType.KG },
  { name: "Dastany", qty: 1, rate: 1050, cat: "KITCHEN", unit: UnitType.PCS },
  { name: "Gulocose Liquid", qty: 10, rate: 560, cat: "KITCHEN", unit: UnitType.L },
  { name: "Broost Misala", qty: 16, rate: 150, cat: "KITCHEN", unit: UnitType.KG },
];

const CATEGORIES = [
  { code: "BEV", name: "Baverage", sortOrder: 10 },
  { code: "KITCHEN", name: "Main Kitchen", sortOrder: 11 },
] as const;

async function main() {
  for (const c of CATEGORIES) {
    await prisma.storeCategory.upsert({
      where: { code: c.code },
      update: { name: c.name, sortOrder: c.sortOrder },
      create: { code: c.code, name: c.name, sortOrder: c.sortOrder },
    });
  }

  const cats = {
    BEV: await prisma.storeCategory.findUniqueOrThrow({ where: { code: "BEV" } }),
    KITCHEN: await prisma.storeCategory.findUniqueOrThrow({ where: { code: "KITCHEN" } }),
  };

  let created = 0;
  let updated = 0;

  for (const row of ROWS) {
    if (!(row.qty > 0)) continue;
    const categoryId = cats[row.cat].id;

    // Prefer same category; else any existing exact name (avoid duplicates).
    const existing =
      (await prisma.storeItem.findUnique({
        where: { categoryId_name: { categoryId, name: row.name } },
      })) ??
      (await prisma.storeItem.findFirst({ where: { name: row.name } }));

    if (existing) {
      const prevQty = Number(existing.quantityOnHand);
      await prisma.storeItem.update({
        where: { id: existing.id },
        data: {
          quantityOnHand: row.qty,
          ratePerUnit: row.rate,
          unit: row.unit,
          active: true,
          categoryId,
        },
      });
      const delta = row.qty - prevQty;
      if (Math.abs(delta) > 0.0005) {
        await prisma.stockMovement.create({
          data: {
            storeItemId: existing.id,
            type: delta > 0 ? "IN" : "OUT",
            quantity: Math.abs(delta),
            ratePerUnit: row.rate,
            note: "PDF inventory sync 04.10.2026",
          },
        });
      }
      updated++;
    } else {
      const item = await prisma.storeItem.create({
        data: {
          name: row.name,
          categoryId,
          unit: row.unit,
          quantityOnHand: row.qty,
          ratePerUnit: row.rate,
          reorderLevel: 0,
          active: true,
        },
      });
      await prisma.stockMovement.create({
        data: {
          storeItemId: item.id,
          type: "IN",
          quantity: row.qty,
          ratePerUnit: row.rate,
          note: "Opening stock (PDF 04.10.2026)",
        },
      });
      created++;
    }
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        source: "copy.pdf Active Stock 04.10.2026",
        rows: ROWS.length,
        created,
        updated,
      },
      null,
      2
    )
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
