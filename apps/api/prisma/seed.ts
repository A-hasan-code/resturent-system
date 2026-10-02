import { PrismaClient, UnitType } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const PERMS = [
  ["store.view", "View store"],
  ["store.manage", "Manage store"],
  ["recipe.view", "View recipes"],
  ["recipe.manage", "Manage recipes"],
  ["menu.view", "View menu"],
  ["menu.manage", "Manage menu"],
  ["order.create", "Create orders"],
  ["order.pay", "Take payment"],
  ["bill.view", "View bills"],
  ["kitchen.view", "Kitchen view"],
  ["kitchen.update", "Update kitchen status"],
  ["reports.view", "View reports"],
  ["users.manage", "Manage users"],
  ["order.addItems", "Add items to open order"],
  ["order.viewOwn", "View own orders"],
  ["bill.request", "Request bill"],
  ["print.kot", "Print kitchen slip"],
  ["print.bill", "Print customer bill"],
  ["printers.manage", "Manage printers"],
  ["tables.manage", "Manage tables"],
  ["system.manage", "Server settings & backups"],
  ["cash.keep", "Keeps the cash drawer (receives handovers)"],
  ["payments.view", "View payment & cash handover records"],
] as const;

const ROLE_PERMS: Record<string, string[]> = {
  ADMIN: PERMS.map(([c]) => c),
  // Floor manager: takes orders and payments, prints bills, hands the cash to a cashier.
  MANAGER: [
    "order.create",
    "order.addItems",
    "order.pay",
    "bill.view",
    "bill.request",
    "print.kot",
    "print.bill",
  ],
  STORE: ["store.view", "store.manage"],
  CASHIER: [
    "menu.view",
    "order.create",
    "order.addItems",
    "order.pay",
    "bill.view",
    "bill.request",
    "kitchen.view",
    "reports.view",
    "print.kot",
    "print.bill",
    "cash.keep",
  ],
  KITCHEN: ["kitchen.view", "kitchen.update", "print.kot"],
  WAITER: [
    "order.create",
    "order.addItems",
    "order.viewOwn",
    "bill.request",
    "print.kot",
  ],
};

const ROLES = [
  { code: "ADMIN", name: "Admin" },
  { code: "MANAGER", name: "Manager" },
  { code: "STORE", name: "Store" },
  { code: "CASHIER", name: "Cashier" },
  { code: "KITCHEN", name: "Kitchen" },
  { code: "WAITER", name: "Waiter" },
];

const DEFAULT_SETTINGS: Record<string, string> = {
  "restaurant.name": "Hotel System",
  "restaurant.tagline": "Fine Dining · BBQ · Karahi",
  "restaurant.address": "Pakistan",
  "restaurant.phone": "0300-0000000",
  "restaurant.accent": "#0f7a6c",
};

async function upsertItem(
  categoryId: string,
  name: string,
  unit: UnitType,
  qty: number,
  rate: number,
  reorder = 5
) {
  return prisma.storeItem.upsert({
    where: { categoryId_name: { categoryId, name } },
    update: { quantityOnHand: qty, ratePerUnit: rate, unit, reorderLevel: reorder },
    create: {
      name,
      categoryId,
      unit,
      quantityOnHand: qty,
      ratePerUnit: rate,
      reorderLevel: reorder,
    },
  });
}

async function main() {
  for (const [code, name] of PERMS) {
    await prisma.permission.upsert({
      where: { code },
      update: { name },
      create: { code, name },
    });
  }

  for (const r of ROLES) {
    const role = await prisma.role.upsert({
      where: { code: r.code },
      update: { name: r.name },
      create: r,
    });
    const codes = ROLE_PERMS[r.code] ?? [];
    const perms = await prisma.permission.findMany({
      where: { code: { in: codes } },
    });
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    if (perms.length) {
      await prisma.rolePermission.createMany({
        data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })),
      });
    }
  }

  const roleId = async (code: string) => (await prisma.role.findUniqueOrThrow({ where: { code } })).id;

  // Demo accounts are only created when missing; existing users (and their passwords) are never touched.
  const users = [
    { username: "admin", name: "Admin", pass: "admin123", role: "ADMIN" },
    { username: "manager", name: "Manager Usman", pass: "manager123", pin: "2222", role: "MANAGER" },
    { username: "cashier", name: "Cashier Ali", pass: "cashier123", role: "CASHIER" },
    { username: "kitchen", name: "Kitchen Staff", pass: "kitchen123", role: "KITCHEN" },
    { username: "store", name: "Store Keeper", pass: "store123", role: "STORE" },
    { username: "waiter", name: "Waiter Ahmed", pass: "waiter123", pin: "1111", role: "WAITER" },
    { username: "waiter2", name: "Waiter Bilal", pass: "waiter123", pin: "1112", role: "WAITER" },
  ];
  for (const u of users) {
    const exists = await prisma.user.findUnique({ where: { username: u.username } });
    if (exists) continue;
    await prisma.user.create({
      data: {
        username: u.username,
        name: u.name,
        passwordHash: await bcrypt.hash(u.pass, 10),
        pinHash: u.pin ? await bcrypt.hash(u.pin, 10) : null,
        roleId: await roleId(u.role),
      },
    });
  }

  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await prisma.setting.upsert({ where: { key }, update: {}, create: { key, value } });
  }

  if ((await prisma.restaurantTable.count()) === 0) {
    await prisma.restaurantTable.createMany({
      data: Array.from({ length: 12 }, (_, i) => ({
        name: `T-${i + 1}`,
        area: i < 8 ? "Hall" : "Family",
        sortOrder: i + 1,
      })),
    });
  }

  if ((await prisma.printer.count()) === 0) {
    await prisma.printer.create({
      data: {
        name: "Preview (no printer yet)",
        kind: "FILE",
        target: "",
        printsKot: true,
        printsBill: true,
      },
    });
  }

  for (const name of ["Karahi", "BBQ", "Sweet", "Drinks", "Rice", "Curry", "General"]) {
    await prisma.recipeCategory.upsert({ where: { name }, update: {}, create: { name } });
  }

  if ((await prisma.storeItem.count()) > 0) {
    console.log("Seed OK — roles/permissions/settings updated (existing data kept)");
    return;
  }
  await seedDemoData();
  console.log("Seed OK — users, inventory, recipes, menu, demo orders");
}

async function seedDemoData() {

  for (const c of [
    { code: "FRESH", name: "Fresh", sortOrder: 1 },
    { code: "DRY", name: "Dry", sortOrder: 2 },
    { code: "LIQUID", name: "Liquid", sortOrder: 3 },
  ]) {
    await prisma.storeCategory.upsert({
      where: { code: c.code },
      update: { name: c.name, sortOrder: c.sortOrder },
      create: c,
    });
  }

  const fresh = await prisma.storeCategory.findUniqueOrThrow({ where: { code: "FRESH" } });
  const dry = await prisma.storeCategory.findUniqueOrThrow({ where: { code: "DRY" } });
  const liquid = await prisma.storeCategory.findUniqueOrThrow({ where: { code: "LIQUID" } });

  const chicken = await upsertItem(fresh.id, "Chicken", UnitType.KG, 40, 650, 8);
  const mutton = await upsertItem(fresh.id, "Mutton", UnitType.KG, 15, 1800, 5);
  const tomato = await upsertItem(fresh.id, "Tomato", UnitType.KG, 20, 80, 4);
  const onion = await upsertItem(fresh.id, "Onion", UnitType.KG, 25, 60, 5);
  const ginger = await upsertItem(fresh.id, "Ginger Garlic", UnitType.KG, 8, 350, 2);
  const yoghurt = await upsertItem(fresh.id, "Yoghurt", UnitType.KG, 10, 200, 3);

  const rice = await upsertItem(dry.id, "Rice", UnitType.KG, 50, 280, 10);
  const chilli = await upsertItem(dry.id, "Red Chilli", UnitType.KG, 5, 900, 1);
  const sugar = await upsertItem(dry.id, "Sugar", UnitType.KG, 20, 160, 3);
  const flour = await upsertItem(dry.id, "Besan", UnitType.KG, 12, 220, 2);
  const salt = await upsertItem(dry.id, "Salt", UnitType.KG, 10, 40, 2);
  void flour;
  void salt;

  const oil = await upsertItem(liquid.id, "Cooking Oil", UnitType.L, 30, 480, 5);
  const milk = await upsertItem(liquid.id, "Milk", UnitType.L, 20, 220, 4);
  const syrup = await upsertItem(liquid.id, "Rooh Afza", UnitType.L, 6, 900, 1);

  async function ensureRecipe(
    name: string,
    category: string,
    baseUnit: UnitType,
    ingredients: { storeItemId: string; quantity: number; unit: UnitType }[]
  ) {
    const existing = await prisma.recipe.findUnique({ where: { name } });
    if (existing) {
      return prisma.recipe.update({
        where: { id: existing.id },
        data: { category, baseUnit, active: true },
      });
    }
    return prisma.recipe.create({
      data: {
        name,
        category,
        baseUnit,
        baseQty: 1,
        ingredients: { create: ingredients },
      },
    });
  }

  const rKarahi = await ensureRecipe("Chicken Karahi", "Karahi", UnitType.KG, [
    { storeItemId: chicken.id, quantity: 1, unit: UnitType.KG },
    { storeItemId: oil.id, quantity: 0.15, unit: UnitType.L },
    { storeItemId: tomato.id, quantity: 0.3, unit: UnitType.KG },
    { storeItemId: chilli.id, quantity: 0.02, unit: UnitType.KG },
    { storeItemId: ginger.id, quantity: 0.05, unit: UnitType.KG },
  ]);
  const rMutton = await ensureRecipe("Mutton Karahi", "Karahi", UnitType.KG, [
    { storeItemId: mutton.id, quantity: 1, unit: UnitType.KG },
    { storeItemId: oil.id, quantity: 0.18, unit: UnitType.L },
    { storeItemId: tomato.id, quantity: 0.35, unit: UnitType.KG },
    { storeItemId: onion.id, quantity: 0.2, unit: UnitType.KG },
  ]);
  const rBiryani = await ensureRecipe("Chicken Biryani", "Rice", UnitType.KG, [
    { storeItemId: chicken.id, quantity: 0.6, unit: UnitType.KG },
    { storeItemId: rice.id, quantity: 0.5, unit: UnitType.KG },
    { storeItemId: oil.id, quantity: 0.1, unit: UnitType.L },
    { storeItemId: yoghurt.id, quantity: 0.15, unit: UnitType.KG },
  ]);
  const rKheer = await ensureRecipe("Kheer", "Sweet", UnitType.KG, [
    { storeItemId: milk.id, quantity: 1, unit: UnitType.L },
    { storeItemId: rice.id, quantity: 0.08, unit: UnitType.KG },
    { storeItemId: sugar.id, quantity: 0.12, unit: UnitType.KG },
  ]);
  const rLassi = await ensureRecipe("Sweet Lassi", "Drinks", UnitType.L, [
    { storeItemId: yoghurt.id, quantity: 0.4, unit: UnitType.KG },
    { storeItemId: milk.id, quantity: 0.4, unit: UnitType.L },
    { storeItemId: sugar.id, quantity: 0.08, unit: UnitType.KG },
  ]);
  const rSharbat = await ensureRecipe("Rooh Afza Sharbat", "Drinks", UnitType.L, [
    { storeItemId: syrup.id, quantity: 0.08, unit: UnitType.L },
    { storeItemId: milk.id, quantity: 0.2, unit: UnitType.L },
  ]);

  const menus = [
    { id: "seed-chicken-karahi", name: "Chicken Karahi", category: "Karahi", unit: UnitType.KG, price: 1800, recipeId: rKarahi.id },
    { id: "seed-mutton-karahi", name: "Mutton Karahi", category: "Karahi", unit: UnitType.KG, price: 3200, recipeId: rMutton.id },
    { id: "seed-biryani", name: "Chicken Biryani", category: "Rice", unit: UnitType.KG, price: 1400, recipeId: rBiryani.id },
    { id: "seed-kheer", name: "Kheer", category: "Sweet", unit: UnitType.KG, price: 800, recipeId: rKheer.id },
    { id: "seed-lassi", name: "Sweet Lassi", category: "Drinks", unit: UnitType.L, price: 250, recipeId: rLassi.id },
    { id: "seed-sharbat", name: "Rooh Afza", category: "Drinks", unit: UnitType.L, price: 180, recipeId: rSharbat.id },
    { id: "seed-chapli", name: "Chapli Kabab", category: "BBQ", unit: UnitType.PCS, price: 120, recipeId: null },
  ];

  for (const m of menus) {
    await prisma.menuItem.upsert({
      where: { id: m.id },
      update: {
        name: m.name,
        category: m.category,
        sellUnit: m.unit,
        sellingPrice: m.price,
        recipeId: m.recipeId,
        active: true,
      },
      create: {
        id: m.id,
        name: m.name,
        category: m.category,
        sellUnit: m.unit,
        sellingPrice: m.price,
        recipeId: m.recipeId,
      },
    });
  }

  const existingOrders = await prisma.order.count();
  if (existingOrders === 0) {
    const cashier = await prisma.user.findUniqueOrThrow({
      where: { username: "cashier" },
    });
    const manager = await prisma.user.findUniqueOrThrow({
      where: { username: "manager" },
    });
    const mk = await prisma.menuItem.findUniqueOrThrow({
      where: { id: "seed-chicken-karahi" },
    });
    const mb = await prisma.menuItem.findUniqueOrThrow({
      where: { id: "seed-biryani" },
    });
    const ml = await prisma.menuItem.findUniqueOrThrow({
      where: { id: "seed-lassi" },
    });
    const mm = await prisma.menuItem.findUniqueOrThrow({
      where: { id: "seed-mutton-karahi" },
    });
    const mch = await prisma.menuItem.findUniqueOrThrow({
      where: { id: "seed-chapli" },
    });

    const demo = [
      {
        tableNo: "T-1",
        status: "PENDING" as const,
        paymentStatus: "UNPAID" as const,
        items: [
          { menu: mk, qty: 1.5 },
          { menu: ml, qty: 2 },
        ],
      },
      {
        tableNo: "T-3",
        status: "PREPARING" as const,
        paymentStatus: "UNPAID" as const,
        items: [{ menu: mb, qty: 2 }],
      },
      {
        tableNo: "T-5",
        status: "READY" as const,
        paymentStatus: "UNPAID" as const,
        items: [
          { menu: mm, qty: 1 },
          { menu: mch, qty: 6 },
        ],
      },
      {
        tableNo: "T-2",
        status: "COMPLETED" as const,
        paymentStatus: "PAID" as const,
        items: [
          { menu: mk, qty: 1 },
          { menu: ml, qty: 1 },
        ],
      },
      {
        tableNo: "Takeaway",
        status: "COMPLETED" as const,
        paymentStatus: "PAID" as const,
        items: [
          { menu: mb, qty: 1.5 },
          { menu: mch, qty: 4 },
        ],
      },
    ];

    for (const d of demo) {
      let subtotal = 0;
      let costTotal = 0;
      const lines = [];
      for (const { menu, qty } of d.items) {
        const rate = Number(menu.sellingPrice);
        const amount = rate * qty;
        subtotal += amount;
        let unitCost = 0;
        if (menu.recipeId) {
          const recipe = await prisma.recipe.findUnique({
            where: { id: menu.recipeId },
            include: { ingredients: { include: { storeItem: true } } },
          });
          if (recipe) {
            let baseCost = 0;
            for (const ing of recipe.ingredients) {
              const storeRate = Number(ing.storeItem.ratePerUnit);
              const q = Number(ing.quantity);
              let qtyInStore = q;
              if (ing.unit === "G" && ing.storeItem.unit === "KG") qtyInStore = q / 1000;
              else if (ing.unit === "KG" && ing.storeItem.unit === "G") qtyInStore = q * 1000;
              else if (ing.unit === "ML" && ing.storeItem.unit === "L") qtyInStore = q / 1000;
              else if (ing.unit === "L" && ing.storeItem.unit === "ML") qtyInStore = q * 1000;
              baseCost += qtyInStore * storeRate;
            }
            const baseQty = Number(recipe.baseQty) || 1;
            unitCost = baseCost / baseQty;
          }
        }
        const costAmount = unitCost * qty;
        costTotal += costAmount;
        lines.push({
          menuItemId: menu.id,
          name: menu.name,
          sellUnit: menu.sellUnit,
          quantity: qty,
          ratePerUnit: rate,
          amount,
          unitCost,
          costAmount,
        });
      }
      const paid = d.paymentStatus === "PAID";
      // Demo: the takeaway bill was collected by the manager and handed to the cashier (still unconfirmed).
      const viaManager = paid && d.tableNo === "Takeaway";
      await prisma.order.create({
        data: {
          tableNo: d.tableNo,
          status: d.status,
          paymentStatus: d.paymentStatus,
          subtotal,
          total: subtotal,
          paidAmount: paid ? subtotal : 0,
          costTotal,
          cashierId: paid ? cashier.id : null,
          waiterId: viaManager ? manager.id : cashier.id,
          items: { create: lines.map((l) => ({ ...l, addedById: viaManager ? manager.id : cashier.id })) },
          payments: paid
            ? {
                create: viaManager
                  ? { amount: subtotal, collectedById: manager.id, handedToId: cashier.id }
                  : { amount: subtotal, collectedById: cashier.id },
              }
            : undefined,
        },
      });
    }
  }

  const moveCount = await prisma.stockMovement.count();
  if (moveCount === 0) {
    await prisma.stockMovement.create({
      data: {
        storeItemId: oil.id,
        type: "OUT",
        quantity: -1,
        ratePerUnit: oil.ratePerUnit,
        note: "Demo wastage / stock out",
      },
    });
    await prisma.storeItem.update({
      where: { id: oil.id },
      data: { quantityOnHand: { decrement: 1 } },
    });
    await prisma.stockMovement.create({
      data: {
        storeItemId: chilli.id,
        type: "IN",
        quantity: 2,
        ratePerUnit: 900,
        note: "Demo purchase stock in",
      },
    });
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
