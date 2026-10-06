import { KitchenStation, PrismaClient, UnitType } from "@prisma/client";
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
  ["order.edit", "Edit order items (main cashier)"],
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
  ["expense.view", "View hotel expense sheet"],
  ["expense.manage", "Add and edit hotel expenses"],
  ["close.view", "View daily cash close report"],
  ["close.manage", "Save daily cash close report"],
] as const;

const ROLE_PERMS: Record<string, string[]> = {
  ADMIN: PERMS.map(([c]) => c),
  SYSTEM_MANAGER: [
    "close.view",
    "close.manage",
    "payments.view",
    "reports.view",
    "bill.view",
    "order.edit",
    "expense.view",
    "expense.manage",
    "menu.view",
    "menu.manage",
    "store.view",
    "store.manage",
  ],
  SUPERVISOR: [
    "order.create",
    "order.addItems",
    "order.viewOwn",
    "bill.request",
    "print.kot",
    "kitchen.view",
    "kitchen.update",
    "expense.view",
    "expense.manage",
  ],
  MAIN_CASHIER: [
    "menu.view",
    "order.create",
    "order.addItems",
    "order.edit",
    "order.pay",
    "bill.view",
    "bill.request",
    "kitchen.view",
    "reports.view",
    "print.kot",
    "print.bill",
    "cash.keep",
  ],
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
  STORE: ["store.view", "store.manage"],
  KITCHEN: ["kitchen.view", "kitchen.update", "print.kot"],
  WAITER: ["order.viewOwn", "bill.request", "kitchen.view"],
};

const ROLES = [
  { code: "ADMIN", name: "Admin" },
  { code: "SYSTEM_MANAGER", name: "System Manager" },
  { code: "SUPERVISOR", name: "Supervisor" },
  { code: "MAIN_CASHIER", name: "Main Cashier" },
  { code: "CASHIER", name: "Cashier" },
  { code: "STORE", name: "Store" },
  { code: "KITCHEN", name: "Kitchen" },
  { code: "WAITER", name: "Waiter" },
];

const SETTINGS: Record<string, string> = {
  "restaurant.name": "کوئٹہ سنگت چائے خانہ ہوٹل اینڈ ریسٹورنٹ",
  "restaurant.tagline": "Quetta Sangat Chaye Khana Hotel & Restaurant",
  "restaurant.address": "Adda Lunda Minor, Kehror Pakka Road, Dunyapur",
  "restaurant.phone": "0300 0607 222",
  "restaurant.accent": "#0f7a6c",
  "billing.perHeadEnabled": "1",
  "billing.perHeadAmount": "100",
  "billing.perHeadLabel": "Per head",
  "billing.perHeadPackage": "[]",
};

type StoreDef = {
  key: string;
  name: string;
  cat: "FRESH" | "DRY" | "LIQUID";
  unit: UnitType;
  qty: number;
  rate: number;
  reorder?: number;
};

/** Inventory items used by standard recipes (starting stock approx). */
const STORE_ITEMS: StoreDef[] = [
  { key: "chicken", name: "Chicken (bone-in)", cat: "FRESH", unit: UnitType.KG, qty: 40, rate: 650, reorder: 8 },
  { key: "chicken_boneless", name: "Chicken Boneless", cat: "FRESH", unit: UnitType.KG, qty: 15, rate: 780, reorder: 4 },
  { key: "chicken_mince", name: "Chicken Mince", cat: "FRESH", unit: UnitType.KG, qty: 10, rate: 700, reorder: 3 },
  { key: "chicken_breast", name: "Chicken Breast", cat: "FRESH", unit: UnitType.KG, qty: 8, rate: 820, reorder: 2 },
  { key: "beef", name: "Beef (with bone)", cat: "FRESH", unit: UnitType.KG, qty: 25, rate: 1400, reorder: 5 },
  { key: "mutton", name: "Mutton", cat: "FRESH", unit: UnitType.KG, qty: 20, rate: 1800, reorder: 5 },
  { key: "tomato", name: "Tomato", cat: "FRESH", unit: UnitType.KG, qty: 25, rate: 80, reorder: 5 },
  { key: "onion", name: "Onion", cat: "FRESH", unit: UnitType.KG, qty: 30, rate: 60, reorder: 5 },
  { key: "garlic", name: "Garlic", cat: "FRESH", unit: UnitType.KG, qty: 5, rate: 400, reorder: 1 },
  { key: "ginger", name: "Ginger", cat: "FRESH", unit: UnitType.KG, qty: 5, rate: 350, reorder: 1 },
  { key: "green_chilli", name: "Green Chilli", cat: "FRESH", unit: UnitType.KG, qty: 4, rate: 200, reorder: 1 },
  { key: "capsicum", name: "Capsicum", cat: "FRESH", unit: UnitType.KG, qty: 5, rate: 180, reorder: 1 },
  { key: "carrot", name: "Carrot", cat: "FRESH", unit: UnitType.KG, qty: 5, rate: 100, reorder: 1 },
  { key: "cabbage", name: "Cabbage", cat: "FRESH", unit: UnitType.KG, qty: 5, rate: 80, reorder: 1 },
  { key: "spring_onion", name: "Spring Onion", cat: "FRESH", unit: UnitType.KG, qty: 2, rate: 150, reorder: 0.5 },
  { key: "coriander", name: "Fresh Coriander", cat: "FRESH", unit: UnitType.KG, qty: 2, rate: 120, reorder: 0.5 },
  { key: "mint", name: "Fresh Mint", cat: "FRESH", unit: UnitType.KG, qty: 1, rate: 150, reorder: 0.3 },
  { key: "lemon", name: "Lemon", cat: "FRESH", unit: UnitType.PCS, qty: 50, rate: 15, reorder: 10 },
  { key: "egg", name: "Egg", cat: "FRESH", unit: UnitType.PCS, qty: 120, rate: 30, reorder: 24 },
  { key: "potato", name: "Potato", cat: "FRESH", unit: UnitType.KG, qty: 20, rate: 70, reorder: 5 },

  { key: "rice", name: "Rice (Sella/Basmati)", cat: "DRY", unit: UnitType.KG, qty: 50, rate: 280, reorder: 10 },
  { key: "flour", name: "Flour (Atta/Maida)", cat: "DRY", unit: UnitType.KG, qty: 40, rate: 140, reorder: 8 },
  { key: "salt", name: "Salt", cat: "DRY", unit: UnitType.KG, qty: 10, rate: 40, reorder: 2 },
  { key: "black_pepper", name: "Black Pepper", cat: "DRY", unit: UnitType.KG, qty: 2, rate: 1800, reorder: 0.3 },
  { key: "white_pepper", name: "White Pepper", cat: "DRY", unit: UnitType.KG, qty: 1, rate: 2000, reorder: 0.2 },
  { key: "chilli_flakes", name: "Red Chilli Flakes", cat: "DRY", unit: UnitType.KG, qty: 3, rate: 900, reorder: 0.5 },
  { key: "cumin", name: "Cumin Powder", cat: "DRY", unit: UnitType.KG, qty: 2, rate: 800, reorder: 0.3 },
  { key: "coriander_powder", name: "Coriander Powder", cat: "DRY", unit: UnitType.KG, qty: 2, rate: 600, reorder: 0.3 },
  { key: "coriander_seeds", name: "Coriander Seeds", cat: "DRY", unit: UnitType.KG, qty: 2, rate: 500, reorder: 0.3 },
  { key: "fennel", name: "Fennel Seeds", cat: "DRY", unit: UnitType.KG, qty: 1, rate: 700, reorder: 0.2 },
  { key: "garam_masala", name: "Garam Masala", cat: "DRY", unit: UnitType.KG, qty: 1, rate: 1200, reorder: 0.2 },
  { key: "whole_garam", name: "Whole Garam Masala", cat: "DRY", unit: UnitType.KG, qty: 1, rate: 1400, reorder: 0.2 },
  { key: "cardamom", name: "Green Cardamom", cat: "DRY", unit: UnitType.KG, qty: 0.5, rate: 4500, reorder: 0.1 },
  { key: "cinnamon", name: "Cinnamon", cat: "DRY", unit: UnitType.KG, qty: 0.5, rate: 1800, reorder: 0.1 },
  { key: "chaat_masala", name: "Chaat Masala", cat: "DRY", unit: UnitType.KG, qty: 1, rate: 700, reorder: 0.2 },
  { key: "besan", name: "Roasted Gram Flour", cat: "DRY", unit: UnitType.KG, qty: 5, rate: 250, reorder: 1 },
  { key: "cornstarch", name: "Cornstarch", cat: "DRY", unit: UnitType.KG, qty: 3, rate: 300, reorder: 0.5 },
  { key: "kasoori_methi", name: "Kasoori Methi", cat: "DRY", unit: UnitType.KG, qty: 0.5, rate: 900, reorder: 0.1 },
  { key: "tea", name: "Black Tea Leaves", cat: "DRY", unit: UnitType.KG, qty: 5, rate: 1200, reorder: 1 },
  { key: "green_tea", name: "Green Tea Leaves", cat: "DRY", unit: UnitType.KG, qty: 1, rate: 1500, reorder: 0.2 },
  { key: "sugar", name: "Sugar", cat: "DRY", unit: UnitType.KG, qty: 20, rate: 160, reorder: 3 },
  { key: "gur", name: "Jaggery (Gur)", cat: "DRY", unit: UnitType.KG, qty: 8, rate: 200, reorder: 2 },
  { key: "garlic_paste", name: "Garlic Paste", cat: "DRY", unit: UnitType.KG, qty: 3, rate: 350, reorder: 0.5 },
  { key: "ginger_garlic", name: "Ginger Garlic Paste", cat: "DRY", unit: UnitType.KG, qty: 3, rate: 380, reorder: 0.5 },
  { key: "green_chilli_paste", name: "Green Chilli Paste", cat: "DRY", unit: UnitType.KG, qty: 1, rate: 250, reorder: 0.2 },

  { key: "oil", name: "Cooking Oil", cat: "LIQUID", unit: UnitType.L, qty: 40, rate: 480, reorder: 8 },
  { key: "ghee", name: "Desi Ghee / Tallow", cat: "LIQUID", unit: UnitType.KG, qty: 10, rate: 1200, reorder: 2 },
  { key: "butter", name: "Butter", cat: "LIQUID", unit: UnitType.KG, qty: 5, rate: 1400, reorder: 1 },
  { key: "milk", name: "Full Cream Milk", cat: "LIQUID", unit: UnitType.L, qty: 30, rate: 220, reorder: 5 },
  { key: "cream", name: "Fresh Cream", cat: "LIQUID", unit: UnitType.L, qty: 5, rate: 600, reorder: 1 },
  { key: "yogurt", name: "Yogurt", cat: "LIQUID", unit: UnitType.KG, qty: 10, rate: 200, reorder: 2 },
  { key: "ketchup", name: "Tomato Ketchup", cat: "LIQUID", unit: UnitType.L, qty: 4, rate: 450, reorder: 1 },
  { key: "chilli_garlic_sauce", name: "Chilli Garlic Sauce", cat: "LIQUID", unit: UnitType.L, qty: 3, rate: 500, reorder: 0.5 },
  { key: "soy", name: "Soy Sauce", cat: "LIQUID", unit: UnitType.L, qty: 3, rate: 400, reorder: 0.5 },
  { key: "vinegar", name: "Vinegar", cat: "LIQUID", unit: UnitType.L, qty: 3, rate: 250, reorder: 0.5 },
  { key: "honey", name: "Honey", cat: "LIQUID", unit: UnitType.KG, qty: 2, rate: 900, reorder: 0.3 },
];

type MenuSeed = {
  name: string;
  category: string;
  station: KitchenStation;
  unit: UnitType;
  price: number;
  recipeKey?: string;
  minQty?: number;
  maxQty?: number | null;
  qtyStep?: number | null;
  allowCustomQty?: boolean;
};

const PCS_FIXED: Pick<MenuSeed, "minQty" | "qtyStep" | "allowCustomQty" | "maxQty"> = {
  minQty: 1,
  qtyStep: 1,
  allowCustomQty: false,
  maxQty: null,
};

/** Half band by weight: custom from 225g up to 1 kg. Price = per KG (0.5 kg ≈ card half). */
function halfKg(
  name: string,
  category: string,
  station: KitchenStation,
  pricePerKg: number,
  recipeKey?: string
): MenuSeed {
  return {
    name: `${name} (Half)`,
    category,
    station,
    unit: UnitType.KG,
    price: pricePerKg,
    recipeKey,
    minQty: 0.225,
    maxQty: 1,
    qtyStep: 0.025,
    allowCustomQty: true,
  };
}

/** Full band by weight: from 1 kg upward in 0.5 kg steps. */
function fullKg(
  name: string,
  category: string,
  station: KitchenStation,
  pricePerKg: number,
  recipeKey?: string
): MenuSeed {
  return {
    name: `${name} (Full)`,
    category,
    station,
    unit: UnitType.KG,
    price: pricePerKg,
    recipeKey,
    minQty: 1,
    maxQty: null,
    qtyStep: 0.5,
    allowCustomQty: true,
  };
}

/** Bowl / plate portions (not weight) — keep as separate PCS lines. */
function halfFull(
  base: string,
  category: string,
  station: KitchenStation,
  half: number,
  full: number
): MenuSeed[] {
  return [
    { name: `${base} (Half)`, category, station, unit: UnitType.PCS, price: half, ...PCS_FIXED },
    { name: `${base} (Full)`, category, station, unit: UnitType.PCS, price: full, ...PCS_FIXED },
  ];
}

/** Meat sold by weight (single line). Price = per KG. Custom from 0.5 kg unless overridden. */
function byKg(
  name: string,
  category: string,
  station: KitchenStation,
  pricePerKg: number,
  recipeKey?: string
): MenuSeed {
  return {
    name,
    category,
    station,
    unit: UnitType.KG,
    price: pricePerKg,
    recipeKey,
    minQty: 0.5,
    maxQty: null,
    qtyStep: 0.5,
    allowCustomQty: true,
  };
}

const MENU: MenuSeed[] = [
  // Live Kitchen — fixed PCS (no half/full / no custom grams)
  {
    name: "Mutton Khada Sijji (5hr advance)",
    category: "Live Kitchen",
    station: KitchenStation.COOKING,
    unit: UnitType.PCS,
    price: 4500,
    ...PCS_FIXED,
  },
  {
    name: "Ranjha Goshat",
    category: "Live Kitchen",
    station: KitchenStation.COOKING,
    unit: UnitType.PCS,
    price: 4500,
    ...PCS_FIXED,
  },
  {
    name: "Chicken Khada Sijji",
    category: "Live Kitchen",
    station: KitchenStation.COOKING,
    unit: UnitType.PCS,
    price: 2000,
    ...PCS_FIXED,
  },
  // Shinwari: card half/full ≈ 950/1800 & 2200/4100 → per-kg rates on Half/Full lines
  halfKg("Chicken Shinwari Karahi", "Live Kitchen", KitchenStation.COOKING, 1900, "chicken_shinwari_karahi"),
  fullKg("Chicken Shinwari Karahi", "Live Kitchen", KitchenStation.COOKING, 1800, "chicken_shinwari_karahi"),
  halfKg("Mutton Shinwari Karahi", "Live Kitchen", KitchenStation.COOKING, 4400),
  fullKg("Mutton Shinwari Karahi", "Live Kitchen", KitchenStation.COOKING, 4100),
  {
    name: "Banu Pulao",
    category: "Live Kitchen",
    station: KitchenStation.COOKING,
    unit: UnitType.KG,
    price: 1000,
    recipeKey: "bannu_beef_pulao",
    minQty: 0.5,
    maxQty: null,
    qtyStep: 0.5,
    allowCustomQty: true,
  },
  {
    name: "Dam Pukhat",
    category: "Live Kitchen",
    station: KitchenStation.COOKING,
    unit: UnitType.PCS,
    price: 1000,
    ...PCS_FIXED,
  },
  {
    name: "Rosh + Daal",
    category: "Live Kitchen",
    station: KitchenStation.COOKING,
    unit: UnitType.PCS,
    price: 1500,
    recipeKey: "mutton_namkeen_rosh",
    ...PCS_FIXED,
  },
  {
    name: "Paneer BBQ",
    category: "Live Kitchen",
    station: KitchenStation.BBQ,
    unit: UnitType.PCS,
    price: 400,
    ...PCS_FIXED,
  },
  {
    name: "Beef BBQ",
    category: "Live Kitchen",
    station: KitchenStation.BBQ,
    unit: UnitType.PCS,
    price: 350,
    ...PCS_FIXED,
  },
  {
    name: "Afghani Boti",
    category: "Live Kitchen",
    station: KitchenStation.BBQ,
    unit: UnitType.PCS,
    price: 200,
    ...PCS_FIXED,
  },

  // Breakfast
  { name: "Plain Paratha", category: "Breakfast & Paratha", station: KitchenStation.COOKING, unit: UnitType.PCS, price: 60 },
  { name: "Aloo Paratha", category: "Breakfast & Paratha", station: KitchenStation.COOKING, unit: UnitType.PCS, price: 100 },
  {
    name: "Special Chicken Paratha",
    category: "Breakfast & Paratha",
    station: KitchenStation.COOKING,
    unit: UnitType.PCS,
    price: 200,
    recipeKey: "special_chicken_paratha",
  },
  { name: "Egg Paratha", category: "Breakfast & Paratha", station: KitchenStation.COOKING, unit: UnitType.PCS, price: 150 },
  { name: "Omelette", category: "Breakfast & Paratha", station: KitchenStation.COOKING, unit: UnitType.PCS, price: 100 },
  ...halfFull("Yogurt", "Breakfast & Paratha", KitchenStation.COOKING, 100, 200),

  // Appetizers (bowl portions)
  ...halfFull("Quetta Sangat Special Soup", "Appetizers", KitchenStation.COOKING, 450, 700),
  ...halfFull("Chicken Hot & Sour Soup", "Appetizers", KitchenStation.COOKING, 400, 650),
  ...halfFull("Chicken Corn Soup", "Appetizers", KitchenStation.COOKING, 400, 600),
  ...halfFull("Chicken Vegetable Soup", "Appetizers", KitchenStation.COOKING, 400, 600),
  { name: "Quetta Sangat Special Fries", category: "Appetizers", station: KitchenStation.COOKING, unit: UnitType.PCS, price: 300 },

  // BBQ
  { name: "Chicken Tikka Boti", category: "BBQ", station: KitchenStation.BBQ, unit: UnitType.PCS, price: 200 },
  {
    name: "Chicken Malai Boti",
    category: "BBQ",
    station: KitchenStation.BBQ,
    unit: UnitType.PCS,
    price: 300,
    recipeKey: "chicken_malai_boti",
  },
  { name: "Chicken Kasturi Boti", category: "BBQ", station: KitchenStation.BBQ, unit: UnitType.PCS, price: 350 },
  { name: "Chicken Afghani Boti", category: "BBQ", station: KitchenStation.BBQ, unit: UnitType.PCS, price: 200 },
  { name: "Chicken Makhmali Kabab", category: "BBQ", station: KitchenStation.BBQ, unit: UnitType.PCS, price: 250 },
  { name: "Chicken Kalmi Tikka", category: "BBQ", station: KitchenStation.BBQ, unit: UnitType.PCS, price: 450 },
  {
    name: "Chicken Seekh Kabab",
    category: "BBQ",
    station: KitchenStation.BBQ,
    unit: UnitType.PCS,
    price: 180,
    recipeKey: "chicken_seekh_kabab",
  },
  { name: "Chicken Reshmi Kabab", category: "BBQ", station: KitchenStation.BBQ, unit: UnitType.PCS, price: 220 },
  { name: "Beef Kabab", category: "BBQ", station: KitchenStation.BBQ, unit: UnitType.PCS, price: 230 },
  { name: "Chicken Turkish Kabab", category: "BBQ", station: KitchenStation.BBQ, unit: UnitType.PCS, price: 300 },
  { name: "Chicken Tikka Chest Piece", category: "BBQ", station: KitchenStation.BBQ, unit: UnitType.PCS, price: 400 },
  { name: "Chicken Tikka Leg Piece", category: "BBQ", station: KitchenStation.BBQ, unit: UnitType.PCS, price: 350 },
  { name: "Afghani Tikka Chest Piece", category: "BBQ", station: KitchenStation.BBQ, unit: UnitType.PCS, price: 450 },
  { name: "Afghani Tikka Leg Piece", category: "BBQ", station: KitchenStation.BBQ, unit: UnitType.PCS, price: 400 },
  { name: "Special Grill Fish (By Weight)", category: "BBQ", station: KitchenStation.BBQ, unit: UnitType.KG, price: 900 },

  // Quetta Sangat Special — meat by KG
  byKg("Mutton Namkeen Gosht Special", "Quetta Sangat Special", KitchenStation.COOKING, 4000),
  byKg("Beef Namkeen Gosht", "Quetta Sangat Special", KitchenStation.COOKING, 2400),
  {
    name: "Mutton Rosh (Special Daal)",
    category: "Quetta Sangat Special",
    station: KitchenStation.COOKING,
    unit: UnitType.PCS,
    price: 1500,
    recipeKey: "mutton_namkeen_rosh",
  },
  { name: "Beef Namkeen Platter", category: "Quetta Sangat Special", station: KitchenStation.COOKING, unit: UnitType.PCS, price: 1000 },

  // Daal & Sabzi (bowl portions)
  { name: "Special Shahi Daal", category: "Daal & Sabzi", station: KitchenStation.COOKING, unit: UnitType.PCS, price: 550 },
  { name: "Special Mix Vegetable", category: "Daal & Sabzi", station: KitchenStation.COOKING, unit: UnitType.PCS, price: 400 },
  ...halfFull("Special Daal Moong", "Daal & Sabzi", KitchenStation.COOKING, 120, 200),
  ...halfFull("Chicken Qorma", "Daal & Sabzi", KitchenStation.COOKING, 180, 280),
  ...halfFull("Special Daal Mash", "Daal & Sabzi", KitchenStation.COOKING, 150, 250),

  // Chicken Karahi — KG (0.5 = Half, 1 = Full)
  byKg("Quetta Sangat Special Chicken Karahi", "Chicken Karahi", KitchenStation.COOKING, 1700),
  byKg("Special Desi Murgha Karahi", "Chicken Karahi", KitchenStation.COOKING, 3200),
  byKg("Chicken Lahori Karahi (Red Chilli)", "Chicken Karahi", KitchenStation.COOKING, 1700),
  byKg("Chicken Karahi (Black Pepper)", "Chicken Karahi", KitchenStation.COOKING, 1800),
  byKg("Chicken Afghani Karahi (White)", "Chicken Karahi", KitchenStation.COOKING, 1800, "chicken_afghani_handi"),
  byKg("Chicken Achari Karahi", "Chicken Karahi", KitchenStation.COOKING, 1800),
  byKg("Chicken Peshawari Karahi (Shinwari)", "Chicken Karahi", KitchenStation.COOKING, 1700, "chicken_shinwari_karahi"),

  // Beef Karahi
  byKg("Quetta Sangat Special Beef Karahi", "Beef Karahi", KitchenStation.COOKING, 2500),
  byKg("Beef Lahori Karahi (Red Chilli)", "Beef Karahi", KitchenStation.COOKING, 2500),
  byKg("Beef Karahi (Black Pepper)", "Beef Karahi", KitchenStation.COOKING, 2500),
  byKg("Beef Afghani Karahi (White)", "Beef Karahi", KitchenStation.COOKING, 2500),

  // Mutton Karahi
  byKg("Quetta Sangat Special Mutton Karahi", "Mutton Karahi", KitchenStation.COOKING, 4100),
  byKg("Mutton Lahori Karahi (Red Chilli)", "Mutton Karahi", KitchenStation.COOKING, 4100),
  byKg("Mutton Karahi (Black Pepper)", "Mutton Karahi", KitchenStation.COOKING, 4100),
  byKg("Mutton Afghani Karahi (White)", "Mutton Karahi", KitchenStation.COOKING, 4300),
  byKg("Mutton Peshawari Karahi (Shinwari)", "Mutton Karahi", KitchenStation.COOKING, 4100),

  // Mutton Handi
  byKg("Special Mutton Handi (With Bone)", "Mutton Handi", KitchenStation.COOKING, 4000),
  byKg("Mutton Handi (With Bone)", "Mutton Handi", KitchenStation.COOKING, 3800),
  byKg("Mutton Hari Mirch Handi (With Bone)", "Mutton Handi", KitchenStation.COOKING, 3800),
  byKg("Mutton Afghani Handi (White / With Bone)", "Mutton Handi", KitchenStation.COOKING, 4000),

  // Chicken Handi
  byKg("Quetta Sangat Special Chicken Handi", "Chicken Handi", KitchenStation.COOKING, 1900),
  byKg("Chicken Handi", "Chicken Handi", KitchenStation.COOKING, 1700),
  { name: "Chicken Hari Mirch Handi", category: "Chicken Handi", station: KitchenStation.COOKING, unit: UnitType.PCS, price: 1200 },
  byKg("Chicken Afghani Handi (White)", "Chicken Handi", KitchenStation.COOKING, 1900, "chicken_afghani_handi"),
  byKg("Chicken Achari Handi", "Chicken Handi", KitchenStation.COOKING, 1750),
  { name: "Chicken Jalfrezi", category: "Chicken Handi", station: KitchenStation.COOKING, unit: UnitType.PCS, price: 900 },
  { name: "Chicken Chatkhara", category: "Chicken Handi", station: KitchenStation.COOKING, unit: UnitType.PCS, price: 900 },
  { name: "Chicken Ginger", category: "Chicken Handi", station: KitchenStation.COOKING, unit: UnitType.PCS, price: 1000 },

  // Chinese Rice (plate portions)
  ...halfFull("Quetta Sangat Special Rice", "Chinese Rice", KitchenStation.COOKING, 450, 900),
  ...halfFull("Chicken Fried Rice", "Chinese Rice", KitchenStation.COOKING, 400, 800),
  ...halfFull("Chicken Masala Rice", "Chinese Rice", KitchenStation.COOKING, 400, 800),
  ...halfFull("Egg Fried Rice", "Chinese Rice", KitchenStation.COOKING, 350, 700),
  ...halfFull("Vegetable Rice", "Chinese Rice", KitchenStation.COOKING, 350, 700),

  // Chinese Combo
  {
    name: "Chicken Manchurian + Fried Rice",
    category: "Chinese Combo",
    station: KitchenStation.COOKING,
    unit: UnitType.PCS,
    price: 1050,
    recipeKey: "chicken_manchurian_fried_rice",
  },
  { name: "Chicken Garlic + Fried Rice", category: "Chinese Combo", station: KitchenStation.COOKING, unit: UnitType.PCS, price: 800 },
  { name: "Chicken Black Pepper + Fried Rice", category: "Chinese Combo", station: KitchenStation.COOKING, unit: UnitType.PCS, price: 800 },

  // Salad
  { name: "Green Salad", category: "Salad", station: KitchenStation.COOKING, unit: UnitType.PCS, price: 100 },
  { name: "Kachumar Salad", category: "Salad", station: KitchenStation.COOKING, unit: UnitType.PCS, price: 120 },

  // Beverages (null market prices filled with local estimates)
  { name: "Regular Cold Drink", category: "Beverages", station: KitchenStation.BEVERAGES, unit: UnitType.PCS, price: 80 },
  { name: "Can Pack", category: "Beverages", station: KitchenStation.BEVERAGES, unit: UnitType.PCS, price: 120 },
  { name: "Can Pack (Sugar Free)", category: "Beverages", station: KitchenStation.BEVERAGES, unit: UnitType.PCS, price: 130 },
  { name: "1 Litre Drink", category: "Beverages", station: KitchenStation.BEVERAGES, unit: UnitType.PCS, price: 180 },
  { name: "1.5 Litre Drink", category: "Beverages", station: KitchenStation.BEVERAGES, unit: UnitType.PCS, price: 220 },
  { name: "2 Litre Drink", category: "Beverages", station: KitchenStation.BEVERAGES, unit: UnitType.PCS, price: 280 },
  { name: "Mineral Water (Small)", category: "Beverages", station: KitchenStation.BEVERAGES, unit: UnitType.PCS, price: 50 },
  { name: "Mineral Water (Large)", category: "Beverages", station: KitchenStation.BEVERAGES, unit: UnitType.PCS, price: 100 },
  {
    name: "Quetta Sangat Special Doodh Patti",
    category: "Beverages",
    station: KitchenStation.BEVERAGES,
    unit: UnitType.PCS,
    price: 70,
    recipeKey: "doodh_patti",
  },
  {
    name: "Gur Wali Chaye",
    category: "Beverages",
    station: KitchenStation.BEVERAGES,
    unit: UnitType.PCS,
    price: 100,
    recipeKey: "gur_wali_chaye",
  },
  { name: "Green Tea", category: "Beverages", station: KitchenStation.BEVERAGES, unit: UnitType.PCS, price: 70 },
  {
    name: "Sulaimani Qehwa",
    category: "Beverages",
    station: KitchenStation.BEVERAGES,
    unit: UnitType.PCS,
    price: 70,
    recipeKey: "sulaimani_qehwa",
  },
];

const RECIPE_CATEGORIES = [
  "Live Kitchen",
  "Breakfast & Paratha",
  "BBQ",
  "Karahi & Handi",
  "Chinese",
  "Chaye Khana",
  "Quetta Sangat Special",
  "Daal & Sabzi",
  "Chicken Karahi",
  "Beef Karahi",
  "Mutton Karahi",
  "Mutton Handi",
  "Chicken Handi",
  "Chinese Rice",
  "Chinese Combo",
  "Salad",
  "Beverages",
  "Appetizers",
];

type Ing = { key: string; quantity: number; unit: UnitType };
type RecipeDef = {
  key: string;
  name: string;
  category: string;
  baseUnit: UnitType;
  baseQty: number;
  ingredients: Ing[];
};

/** tbsp≈15g/ml, tsp≈5g — normalized for stock deduct. Water skipped. */
const RECIPES: RecipeDef[] = [
  {
    key: "chicken_shinwari_karahi",
    name: "Chicken Shinwari Karahi",
    category: "Karahi & Handi",
    baseUnit: UnitType.KG,
    baseQty: 1,
    ingredients: [
      { key: "chicken", quantity: 1, unit: UnitType.KG },
      { key: "tomato", quantity: 500, unit: UnitType.G },
      { key: "oil", quantity: 150, unit: UnitType.ML },
      { key: "garlic_paste", quantity: 22, unit: UnitType.G },
      { key: "green_chilli", quantity: 60, unit: UnitType.G },
      { key: "salt", quantity: 8, unit: UnitType.G },
      { key: "black_pepper", quantity: 10, unit: UnitType.G },
      { key: "ginger", quantity: 20, unit: UnitType.G },
    ],
  },
  {
    key: "bannu_beef_pulao",
    name: "Bannu Beef Pulao",
    category: "Live Kitchen",
    baseUnit: UnitType.KG,
    baseQty: 1,
    ingredients: [
      { key: "beef", quantity: 1, unit: UnitType.KG },
      { key: "rice", quantity: 1, unit: UnitType.KG },
      { key: "ghee", quantity: 200, unit: UnitType.G },
      { key: "onion", quantity: 300, unit: UnitType.G },
      { key: "tomato", quantity: 200, unit: UnitType.G },
      { key: "garlic", quantity: 50, unit: UnitType.G },
      { key: "ginger", quantity: 30, unit: UnitType.G },
      { key: "coriander_seeds", quantity: 20, unit: UnitType.G },
      { key: "fennel", quantity: 20, unit: UnitType.G },
      { key: "whole_garam", quantity: 15, unit: UnitType.G },
      { key: "chilli_flakes", quantity: 10, unit: UnitType.G },
      { key: "green_chilli", quantity: 70, unit: UnitType.G },
      { key: "salt", quantity: 45, unit: UnitType.G },
    ],
  },
  {
    key: "mutton_namkeen_rosh",
    name: "Mutton Namkeen Rosh",
    category: "Quetta Sangat Special",
    baseUnit: UnitType.KG,
    baseQty: 1,
    ingredients: [
      { key: "mutton", quantity: 1, unit: UnitType.KG },
      { key: "garlic", quantity: 100, unit: UnitType.G },
      { key: "ginger", quantity: 40, unit: UnitType.G },
      { key: "green_chilli", quantity: 40, unit: UnitType.G },
      { key: "black_pepper", quantity: 5, unit: UnitType.G },
      { key: "salt", quantity: 15, unit: UnitType.G },
    ],
  },
  {
    key: "special_chicken_paratha",
    name: "Special Chicken Paratha",
    category: "Breakfast & Paratha",
    baseUnit: UnitType.PCS,
    baseQty: 2,
    ingredients: [
      { key: "flour", quantity: 280, unit: UnitType.G },
      { key: "chicken_breast", quantity: 200, unit: UnitType.G },
      { key: "onion", quantity: 50, unit: UnitType.G },
      { key: "green_chilli", quantity: 20, unit: UnitType.G },
      { key: "coriander", quantity: 10, unit: UnitType.G },
      { key: "cumin", quantity: 2, unit: UnitType.G },
      { key: "chilli_flakes", quantity: 3, unit: UnitType.G },
      { key: "chaat_masala", quantity: 2, unit: UnitType.G },
      { key: "salt", quantity: 4, unit: UnitType.G },
      { key: "ghee", quantity: 60, unit: UnitType.G },
    ],
  },
  {
    key: "chicken_malai_boti",
    name: "Chicken Malai Boti",
    category: "BBQ",
    baseUnit: UnitType.PCS,
    baseQty: 4,
    ingredients: [
      { key: "chicken_boneless", quantity: 500, unit: UnitType.G },
      { key: "cream", quantity: 50, unit: UnitType.ML },
      { key: "yogurt", quantity: 40, unit: UnitType.G },
      { key: "ginger_garlic", quantity: 15, unit: UnitType.G },
      { key: "green_chilli_paste", quantity: 15, unit: UnitType.G },
      { key: "white_pepper", quantity: 3, unit: UnitType.G },
      { key: "cornstarch", quantity: 5, unit: UnitType.G },
      { key: "lemon", quantity: 1, unit: UnitType.PCS },
      { key: "salt", quantity: 5, unit: UnitType.G },
      { key: "butter", quantity: 45, unit: UnitType.G },
    ],
  },
  {
    key: "chicken_seekh_kabab",
    name: "Chicken Seekh Kabab",
    category: "BBQ",
    baseUnit: UnitType.PCS,
    baseQty: 7,
    ingredients: [
      { key: "chicken_mince", quantity: 500, unit: UnitType.G },
      { key: "onion", quantity: 120, unit: UnitType.G },
      { key: "ginger_garlic", quantity: 15, unit: UnitType.G },
      { key: "green_chilli", quantity: 30, unit: UnitType.G },
      { key: "coriander", quantity: 10, unit: UnitType.G },
      { key: "mint", quantity: 5, unit: UnitType.G },
      { key: "besan", quantity: 20, unit: UnitType.G },
      { key: "coriander_seeds", quantity: 10, unit: UnitType.G },
      { key: "cumin", quantity: 3, unit: UnitType.G },
      { key: "garam_masala", quantity: 3, unit: UnitType.G },
      { key: "chilli_flakes", quantity: 5, unit: UnitType.G },
      { key: "salt", quantity: 5, unit: UnitType.G },
      { key: "oil", quantity: 30, unit: UnitType.ML },
    ],
  },
  {
    key: "chicken_afghani_handi",
    name: "Chicken Afghani White Handi",
    category: "Karahi & Handi",
    baseUnit: UnitType.KG,
    baseQty: 1,
    ingredients: [
      { key: "chicken_boneless", quantity: 1, unit: UnitType.KG },
      { key: "oil", quantity: 120, unit: UnitType.ML },
      { key: "butter", quantity: 60, unit: UnitType.G },
      { key: "ginger_garlic", quantity: 44, unit: UnitType.G },
      { key: "yogurt", quantity: 300, unit: UnitType.G },
      { key: "cream", quantity: 200, unit: UnitType.ML },
      { key: "white_pepper", quantity: 6, unit: UnitType.G },
      { key: "black_pepper", quantity: 4, unit: UnitType.G },
      { key: "cumin", quantity: 6, unit: UnitType.G },
      { key: "coriander_powder", quantity: 6, unit: UnitType.G },
      { key: "salt", quantity: 10, unit: UnitType.G },
      { key: "green_chilli", quantity: 80, unit: UnitType.G },
      { key: "kasoori_methi", quantity: 4, unit: UnitType.G },
    ],
  },
  {
    key: "chicken_manchurian_fried_rice",
    name: "Chicken Manchurian with Egg Fried Rice",
    category: "Chinese",
    baseUnit: UnitType.PCS,
    baseQty: 1,
    ingredients: [
      { key: "chicken_boneless", quantity: 300, unit: UnitType.G },
      { key: "egg", quantity: 2.5, unit: UnitType.PCS },
      { key: "cornstarch", quantity: 30, unit: UnitType.G },
      { key: "garlic", quantity: 15, unit: UnitType.G },
      { key: "capsicum", quantity: 80, unit: UnitType.G },
      { key: "onion", quantity: 80, unit: UnitType.G },
      { key: "ketchup", quantity: 75, unit: UnitType.ML },
      { key: "chilli_garlic_sauce", quantity: 45, unit: UnitType.ML },
      { key: "soy", quantity: 45, unit: UnitType.ML },
      { key: "vinegar", quantity: 15, unit: UnitType.ML },
      { key: "oil", quantity: 80, unit: UnitType.ML },
      { key: "rice", quantity: 350, unit: UnitType.G },
      { key: "carrot", quantity: 30, unit: UnitType.G },
      { key: "cabbage", quantity: 30, unit: UnitType.G },
      { key: "spring_onion", quantity: 20, unit: UnitType.G },
      { key: "white_pepper", quantity: 2, unit: UnitType.G },
      { key: "salt", quantity: 3, unit: UnitType.G },
    ],
  },
  {
    key: "doodh_patti",
    name: "Quetta Sangat Special Doodh Patti",
    category: "Chaye Khana",
    baseUnit: UnitType.PCS,
    baseQty: 2,
    ingredients: [
      { key: "milk", quantity: 400, unit: UnitType.ML },
      { key: "tea", quantity: 8, unit: UnitType.G },
      { key: "cardamom", quantity: 2, unit: UnitType.G },
      { key: "sugar", quantity: 10, unit: UnitType.G },
    ],
  },
  {
    key: "gur_wali_chaye",
    name: "Gur Wali Chaye",
    category: "Chaye Khana",
    baseUnit: UnitType.PCS,
    baseQty: 2,
    ingredients: [
      { key: "milk", quantity: 350, unit: UnitType.ML },
      { key: "gur", quantity: 35, unit: UnitType.G },
      { key: "tea", quantity: 6, unit: UnitType.G },
      { key: "cardamom", quantity: 2, unit: UnitType.G },
      { key: "fennel", quantity: 1, unit: UnitType.G },
    ],
  },
  {
    key: "sulaimani_qehwa",
    name: "Sulaimani Qehwa",
    category: "Chaye Khana",
    baseUnit: UnitType.PCS,
    baseQty: 2,
    ingredients: [
      { key: "green_tea", quantity: 3, unit: UnitType.G },
      { key: "cardamom", quantity: 2, unit: UnitType.G },
      { key: "cinnamon", quantity: 3, unit: UnitType.G },
      { key: "lemon", quantity: 0.25, unit: UnitType.PCS },
      { key: "honey", quantity: 10, unit: UnitType.G },
    ],
  },
];

/** Daily pots sold by plate / Rs from residual batch (linked to cook recipes above). */
const SPECIAL_PRODUCTS: {
  name: string;
  category: string;
  platePrice: number;
  plateGrams: number;
  cookRecipeKey: string;
}[] = [
  {
    name: "Bannu Palao",
    category: "Pakistani Special",
    platePrice: 400,
    plateGrams: 400,
    cookRecipeKey: "bannu_beef_pulao",
  },
  {
    name: "Mutton Namkeen Rosh",
    category: "Pakistani Special",
    platePrice: 550,
    plateGrams: 350,
    cookRecipeKey: "mutton_namkeen_rosh",
  },
];

async function upsertStoreItem(categoryId: string, def: StoreDef) {
  return prisma.storeItem.upsert({
    where: { categoryId_name: { categoryId, name: def.name } },
    update: {
      unit: def.unit,
      quantityOnHand: def.qty,
      ratePerUnit: def.rate,
      reorderLevel: def.reorder ?? 1,
      active: true,
    },
    create: {
      name: def.name,
      categoryId,
      unit: def.unit,
      quantityOnHand: def.qty,
      ratePerUnit: def.rate,
      reorderLevel: def.reorder ?? 1,
    },
  });
}

async function ensureRecipe(
  def: RecipeDef,
  storeIds: Record<string, string>
) {
  const ingredients = def.ingredients.map((i) => {
    const storeItemId = storeIds[i.key];
    if (!storeItemId) throw new Error(`Missing store item key: ${i.key}`);
    return { storeItemId, quantity: i.quantity, unit: i.unit };
  });

  const existing = await prisma.recipe.findUnique({ where: { name: def.name } });
  if (existing) {
    await prisma.recipeIngredient.deleteMany({ where: { recipeId: existing.id } });
    return prisma.recipe.update({
      where: { id: existing.id },
      data: {
        category: def.category,
        baseUnit: def.baseUnit,
        baseQty: def.baseQty,
        active: true,
        ingredients: { create: ingredients },
      },
    });
  }
  return prisma.recipe.create({
    data: {
      name: def.name,
      category: def.category,
      baseUnit: def.baseUnit,
      baseQty: def.baseQty,
      ingredients: { create: ingredients },
    },
  });
}

const PARTITIONS: { name: string; sortOrder: number; tableCount: number }[] = [
  { name: "Hall", sortOrder: 1, tableCount: 15 },
  { name: "Lawn", sortOrder: 2, tableCount: 10 },
  { name: "Roof Top", sortOrder: 3, tableCount: 8 },
];

async function ensurePartitionTables(partitionId: string, area: string, count: number) {
  const have = new Set(
    (await prisma.restaurantTable.findMany({ where: { partitionId }, select: { name: true } })).map(
      (t) => t.name
    )
  );
  const rows = Array.from({ length: count }, (_, i) => `T-${i + 1}`)
    .filter((name) => !have.has(name))
    .map((name, i) => ({
      name,
      partitionId,
      area,
      sortOrder: i + 1,
      active: true,
    }));
  if (rows.length) await prisma.restaurantTable.createMany({ data: rows });
}

async function seedCatalog() {
  for (const [key, value] of Object.entries(SETTINGS)) {
    await prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
  }

  // Older DBs may still have global unique(name); partitions need per-partition names.
  await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS "RestaurantTable_name_key"`);

  for (const p of PARTITIONS) {
    const part =
      (await prisma.tablePartition.findUnique({ where: { name: p.name } })) ??
      (await prisma.tablePartition.create({
        data: { name: p.name, sortOrder: p.sortOrder, active: true },
      }));
    if (part.sortOrder !== p.sortOrder || !part.active) {
      await prisma.tablePartition.update({
        where: { id: part.id },
        data: { sortOrder: p.sortOrder, active: true },
      });
    }
    await ensurePartitionTables(part.id, p.name, p.tableCount);
  }

  for (const name of RECIPE_CATEGORIES) {
    await prisma.recipeCategory.upsert({ where: { name }, update: {}, create: { name } });
  }

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

  const cats = {
    FRESH: await prisma.storeCategory.findUniqueOrThrow({ where: { code: "FRESH" } }),
    DRY: await prisma.storeCategory.findUniqueOrThrow({ where: { code: "DRY" } }),
    LIQUID: await prisma.storeCategory.findUniqueOrThrow({ where: { code: "LIQUID" } }),
  };

  const storeIds: Record<string, string> = {};
  for (const def of STORE_ITEMS) {
    const row = await upsertStoreItem(cats[def.cat].id, def);
    storeIds[def.key] = row.id;
  }

  const recipeIds: Record<string, string> = {};
  for (const def of RECIPES) {
    const row = await ensureRecipe(def, storeIds);
    recipeIds[def.key] = row.id;
  }

  // Upsert demo/catalog menu rows only — never delete or disable restaurant-owned items.
  // (Older seed versions wiped anything not in MENU; that destroyed live hotel menus.)
  const existingMenu = await prisma.menuItem.findMany({ select: { id: true, name: true, category: true } });
  const byKey = new Map(existingMenu.map((m) => [`${m.category ?? ""}::${m.name}`, m.id]));

  for (const m of MENU) {
    const key = `${m.category}::${m.name}`;
    const recipeId = m.recipeKey ? recipeIds[m.recipeKey] ?? null : null;
    const pcsDefault = m.unit === UnitType.PCS;
    const qty = {
      minQty: m.minQty ?? (pcsDefault ? 1 : 0),
      maxQty: m.maxQty === undefined ? null : m.maxQty,
      qtyStep: m.qtyStep === undefined ? (pcsDefault ? 1 : null) : m.qtyStep,
      allowCustomQty: m.allowCustomQty ?? !pcsDefault,
    };
    const id = byKey.get(key);
    if (id) {
      await prisma.menuItem.update({
        where: { id },
        data: {
          kitchenStation: m.station,
          sellUnit: m.unit,
          sellingPrice: m.price,
          recipeId,
          ...qty,
          active: true,
        },
      });
    } else {
      const created = await prisma.menuItem.create({
        data: {
          name: m.name,
          category: m.category,
          kitchenStation: m.station,
          sellUnit: m.unit,
          sellingPrice: m.price,
          recipeId,
          ...qty,
        },
      });
      byKey.set(key, created.id);
    }
  }

  // Special pots (Bannu Palao, Rosh, …) + auto SPECIAL menu rows
  for (const sp of SPECIAL_PRODUCTS) {
    const cookRecipeId = recipeIds[sp.cookRecipeKey];
    if (!cookRecipeId) throw new Error(`Missing cook recipe key: ${sp.cookRecipeKey}`);
    const existing = await prisma.specialProduct.findUnique({ where: { name: sp.name } });
    const product = existing
      ? await prisma.specialProduct.update({
          where: { id: existing.id },
          data: {
            category: sp.category,
            platePrice: sp.platePrice,
            plateGrams: sp.plateGrams,
            cookRecipeId,
            active: true,
          },
        })
      : await prisma.specialProduct.create({
          data: {
            name: sp.name,
            category: sp.category,
            platePrice: sp.platePrice,
            plateGrams: sp.plateGrams,
            cookRecipeId,
          },
        });

    const menu = await prisma.menuItem.findFirst({
      where: { specialProductId: product.id, kind: "SPECIAL" },
      orderBy: { createdAt: "asc" },
    });
    if (menu) {
      await prisma.menuItem.update({
        where: { id: menu.id },
        data: {
          name: product.name,
          category: product.category,
          sellingPrice: sp.platePrice,
          sellUnit: UnitType.PCS,
          kind: "SPECIAL",
          specialProductId: product.id,
          recipeId: null,
          mixSpecialPlates: null,
          listPortionQty: 1,
          active: true,
          minQty: 1,
          qtyStep: 1,
          allowCustomQty: false,
          kitchenStation: KitchenStation.COOKING,
        },
      });
    } else {
      await prisma.menuItem.create({
        data: {
          name: product.name,
          category: product.category,
          kitchenStation: KitchenStation.COOKING,
          kind: "SPECIAL",
          sellUnit: UnitType.PCS,
          sellingPrice: sp.platePrice,
          listPortionQty: 1,
          minQty: 1,
          qtyStep: 1,
          allowCustomQty: false,
          specialProductId: product.id,
          recipeId: null,
        },
      });
    }
  }

  const [tableCount, menuActive, menuKg] = await Promise.all([
    prisma.restaurantTable.count(),
    prisma.menuItem.count({ where: { active: true } }),
    prisma.menuItem.count({ where: { active: true, sellUnit: UnitType.KG } }),
  ]);
  return {
    store: STORE_ITEMS.length,
    recipes: RECIPES.length,
    specials: SPECIAL_PRODUCTS.length,
    menu: MENU.length,
    menuActive,
    menuKg,
    partitions: PARTITIONS.length,
    tables: tableCount,
  };
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
    const perms = await prisma.permission.findMany({ where: { code: { in: codes } } });
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    if (perms.length) {
      await prisma.rolePermission.createMany({
        data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })),
      });
    }
  }

  const manager = await prisma.role.findUnique({ where: { code: "MANAGER" } });
  const supervisor = await prisma.role.findUniqueOrThrow({ where: { code: "SUPERVISOR" } });
  if (manager) {
    await prisma.user.updateMany({ where: { roleId: manager.id }, data: { roleId: supervisor.id } });
    await prisma.rolePermission.deleteMany({ where: { roleId: manager.id } });
    await prisma.role.delete({ where: { id: manager.id } }).catch(() => undefined);
  }

  const roleId = async (code: string) => (await prisma.role.findUniqueOrThrow({ where: { code } })).id;

  const users = [
    { username: "admin", name: "Admin", pass: "admin123", role: "ADMIN" },
    { username: "sysmanager", name: "System Manager", pass: "sys123", pin: "5555", role: "SYSTEM_MANAGER" },
    { username: "supervisor", name: "Supervisor Usman", pass: "super123", pin: "2222", role: "SUPERVISOR" },
    { username: "maincashier", name: "Main Cashier", pass: "main123", pin: "3333", role: "MAIN_CASHIER" },
    { username: "cashier", name: "Cashier Ali", pass: "cashier123", pin: "4444", role: "CASHIER" },
    { username: "cashier2", name: "Cashier Two", pass: "cashier123", pin: "4445", role: "CASHIER" },
    { username: "kitchen", name: "Kitchen Staff", pass: "kitchen123", role: "KITCHEN" },
    { username: "store", name: "Store Keeper", pass: "store123", role: "STORE" },
    { username: "waiter", name: "Waiter Ahmed", pass: "waiter123", pin: "1111", role: "WAITER" },
    { username: "waiter2", name: "Waiter Bilal", pass: "waiter123", pin: "1112", role: "WAITER" },
  ];
  for (const u of users) {
    const passwordHash = await bcrypt.hash(u.pass, 10);
    const pinHash = u.pin ? await bcrypt.hash(u.pin, 10) : null;
    const rid = await roleId(u.role);
    const exists = await prisma.user.findUnique({ where: { username: u.username } });
    if (exists) {
      await prisma.user.update({
        where: { id: exists.id },
        data: {
          name: u.name,
          roleId: rid,
          active: true,
          passwordHash,
          ...(pinHash ? { pinHash } : {}),
        },
      });
      continue;
    }
    await prisma.user.create({
      data: {
        username: u.username,
        name: u.name,
        passwordHash,
        pinHash,
        roleId: rid,
      },
    });
  }

  const oldMgr = await prisma.user.findUnique({ where: { username: "manager" } });
  if (oldMgr) {
    await prisma.user.update({
      where: { id: oldMgr.id },
      data: {
        roleId: await roleId("SUPERVISOR"),
        name: oldMgr.name.includes("Manager") ? "Supervisor Usman" : oldMgr.name,
      },
    });
  }

  const catalog = await seedCatalog();
  console.log("Seed OK — Quetta Sangat catalog", catalog);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
