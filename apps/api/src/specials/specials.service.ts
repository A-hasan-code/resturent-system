import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CostingService } from "../common/costing.service";
import {
  addBusinessDays,
  businessDateOf,
  defaultCookBusinessDate,
  isoDay,
} from "../common/business-day";
import { toNumber } from "../common/units";
import { AuthUser } from "../common/decorators";
import { SettingsService } from "../system/settings.service";
import {
  CookBatchDto,
  CreateSpecialProductDto,
  SaveBatchCloseDto,
  UpdateSpecialProductDto,
} from "./dto";
import { UnitType } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";

@Injectable()
export class SpecialsService {
  /** Carry + waste vs counted may differ by this many grams (matches Close UI ±50g). */
  private static readonly QTY_TOL_G = 50;

  constructor(
    private readonly prisma: PrismaService,
    private readonly costing: CostingService,
    private readonly settings: SettingsService
  ) {}

  async businessDateNow() {
    const day = await this.settings.dayStart();
    return businessDateOf(new Date(), day.h, day.m);
  }

  private async assertDayNotLocked(businessDate: string) {
    const close = await this.prisma.dayCashClose.findUnique({
      where: { businessDate },
      select: { lockedAt: true },
    });
    if (close?.lockedAt) {
      throw new BadRequestException(
        `Business day ${businessDate} is locked after day close. Unlock from Close/Finance before changing specials.`
      );
    }
  }

  private async costForGrams(
    product: { cookRecipeId: string | null; plateGrams: Parameters<typeof toNumber>[0] },
    grams: number
  ) {
    if (!(grams > 0) || !product.cookRecipeId) return 0;
    try {
      const { costPerBase, recipe } = await this.costing.recipeUnitCost(product.cookRecipeId);
      const qty = this.costing.cookedGramsToRecipeQty({
        baseUnit: recipe.baseUnit,
        cookedGrams: grams,
        plateGrams: toNumber(product.plateGrams),
      });
      return Math.round(costPerBase * qty * 100) / 100;
    } catch {
      return 0;
    }
  }

  remainingGrams(batch: {
    openingCarryGrams: Parameters<typeof toNumber>[0];
    cookedGrams: Parameters<typeof toNumber>[0];
    soldGrams: Parameters<typeof toNumber>[0];
    carryOutGrams?: Parameters<typeof toNumber>[0];
  }) {
    return Math.max(
      0,
      toNumber(batch.openingCarryGrams) +
        toNumber(batch.cookedGrams) -
        toNumber(batch.soldGrams) -
        toNumber(batch.carryOutGrams)
    );
  }

  private async isLeftoverClosed(businessDate: string) {
    const row = await this.prisma.dayBatchClose.findUnique({
      where: { businessDate },
      select: { id: true },
    });
    return !!row;
  }

  private async isDayCashLocked(businessDate: string) {
    const row = await this.prisma.dayCashClose.findUnique({
      where: { businessDate },
      select: { lockedAt: true },
    });
    return !!row?.lockedAt;
  }

  /**
   * Cook date: explicit UI date, or auto next day when natural business day leftover is closed.
   */
  async resolveCookBusinessDate(requested?: string | null) {
    const clock = await this.settings.dayStart();
    const now = new Date();
    let target: string;
    if (requested && /^\d{4}-\d{2}-\d{2}$/.test(requested)) {
      target = requested;
    } else {
      const natural = businessDateOf(now, clock.h, clock.m);
      const finished =
        (await this.isLeftoverClosed(natural)) || (await this.isDayCashLocked(natural));
      target = defaultCookBusinessDate(now, clock.h, clock.m, finished);
    }
    if (await this.isDayCashLocked(target)) {
      throw new BadRequestException(
        `Business day ${target} is locked after day close. Unlock or pick another cook date.`
      );
    }
    if (await this.isLeftoverClosed(target)) {
      throw new BadRequestException(
        `Leftover for ${target} is already closed. Edit that close, or choose the next date for cook.`
      );
    }
    return { businessDate: target, dayStart: clock.label, calendarDate: isoDay(now) };
  }

  /**
   * Move previous-day pot remaining that never hit today's carry (e.g. cook after close)
   * onto today's openingCarry — no kitchen stock change.
   */
  async migrateOrphanRemainingTo(businessDate: string) {
    const prevDate = addBusinessDays(businessDate, -1);
    const prevBatches = await this.prisma.dailyBatch.findMany({
      where: { businessDate: prevDate },
    });
    if (!prevBatches.length) return { migrated: 0, lines: [] as { name: string; grams: number }[] };

    const prevClose = await this.prisma.dayBatchClose.findUnique({
      where: { businessDate: prevDate },
      include: { lines: true },
    });
    const closeByProduct = new Map(
      (prevClose?.lines ?? []).map((l) => [l.specialProductId, l])
    );
    const products = await this.prisma.specialProduct.findMany({
      where: { id: { in: prevBatches.map((b) => b.specialProductId) } },
      select: { id: true, name: true },
    });
    const nameById = new Map(products.map((p) => [p.id, p.name]));

    const migratedLines: { name: string; grams: number }[] = [];
    let migrated = 0;

    for (const pb of prevBatches) {
      const rem = this.remainingGrams(pb);
      if (rem <= 0.5) continue;
      const closeLine = closeByProduct.get(pb.specialProductId);
      let orphan = rem;
      if (closeLine) {
        const systemAtClose = toNumber(closeLine.systemRemainingGrams);
        orphan = Math.max(0, rem - systemAtClose);
        // If close was wiped/reopened maths off, still move anything above recorded carry+waste intent.
        if (orphan <= 0.5) {
          const accounted =
            toNumber(closeLine.carryGrams) + toNumber(closeLine.wasteGrams);
          orphan = Math.max(0, rem - accounted - toNumber(pb.carryOutGrams));
        }
      }
      orphan = Math.round(orphan * 1000) / 1000;
      if (orphan <= 0.5) continue;

      let today = await this.prisma.dailyBatch.findUnique({
        where: {
          specialProductId_businessDate: {
            specialProductId: pb.specialProductId,
            businessDate,
          },
        },
      });
      if (!today) {
        const carryFromClose = closeLine ? toNumber(closeLine.carryGrams) : 0;
        today = await this.prisma.dailyBatch.create({
          data: {
            specialProductId: pb.specialProductId,
            businessDate,
            openingCarryGrams: carryFromClose,
            cookedGrams: 0,
            soldGrams: 0,
            status: "OPEN",
          },
        });
      }

      await this.prisma.$transaction([
        this.prisma.dailyBatch.update({
          where: { id: pb.id },
          data: { carryOutGrams: { increment: orphan } },
        }),
        this.prisma.dailyBatch.update({
          where: { id: today.id },
          data: { openingCarryGrams: { increment: orphan }, status: "OPEN", closedAt: null },
        }),
      ]);
      migrated += 1;
      migratedLines.push({
        name: nameById.get(pb.specialProductId) ?? pb.specialProductId,
        grams: orphan,
      });
    }

    return { migrated, lines: migratedLines };
  }

  async listProducts() {
    const products = await this.prisma.specialProduct.findMany({
      where: { active: true },
      include: {
        cookRecipe: { select: { id: true, name: true, category: true } },
        menuItems: {
          where: { active: true },
          select: { id: true, name: true, kind: true, sellingPrice: true },
        },
      },
      orderBy: { name: "asc" },
    });
    // Backfill Waiter menu rows for pots created before auto-sync.
    let touched = false;
    for (const p of products) {
      if (!p.menuItems.some((m) => m.kind === "SPECIAL")) {
        await this.syncSpecialMenuItem(p);
        touched = true;
      }
    }
    if (!touched) return products;
    return this.prisma.specialProduct.findMany({
      where: { active: true },
      include: {
        cookRecipe: { select: { id: true, name: true, category: true } },
        menuItems: {
          where: { active: true },
          select: { id: true, name: true, kind: true, sellingPrice: true },
        },
      },
      orderBy: { name: "asc" },
    });
  }

  /** Sync Waiter SPECIAL rows: Full (+ Half when halfPlatePrice set). */
  private async syncSpecialMenuItem(product: {
    id: string;
    name: string;
    category: string;
    platePrice: Decimal;
    halfPlatePrice?: Decimal | null;
    kitchenStation?: string;
    active: boolean;
  }) {
    const fullPrice = toNumber(product.platePrice);
    const halfPrice =
      product.halfPlatePrice != null ? toNumber(product.halfPlatePrice) : 0;
    const station = product.kitchenStation ?? "COOKING";

    if (!product.active) {
      await this.prisma.menuItem.updateMany({
        where: { specialProductId: product.id, kind: "SPECIAL" },
        data: { active: false },
      });
      return null;
    }

    const upsertPortion = async (name: string, price: number, mix: number) => {
      const row = await this.prisma.menuItem.findFirst({
        where: {
          kind: "SPECIAL",
          OR: [
            { specialProductId: product.id, name },
            { specialProductId: product.id, mixSpecialPlates: mix, name: { contains: mix === 0.5 ? "Half" : "Full" } },
          ],
        },
        orderBy: { createdAt: "asc" },
      });
      const data = {
        name,
        category: product.category,
        kitchenStation: station,
        kind: "SPECIAL" as const,
        sellUnit: "PCS" as const,
        sellingPrice: price,
        specialProductId: product.id,
        recipeId: null as string | null,
        mixSpecialPlates: mix,
        listPortionQty: 1,
        minQty: 1,
        qtyStep: 1,
        allowCustomQty: false,
        active: true,
      };
      if (row) return this.prisma.menuItem.update({ where: { id: row.id }, data });
      return this.prisma.menuItem.create({ data });
    };

    if (halfPrice > 0) {
      const full = await upsertPortion(`${product.name} (Full)`, fullPrice, 1);
      await upsertPortion(`${product.name} (Half)`, halfPrice, 0.5);
      await this.prisma.menuItem.updateMany({
        where: {
          specialProductId: product.id,
          kind: "SPECIAL",
          active: true,
          name: product.name,
        },
        data: { active: false },
      });
      return full;
    }

    // Full-only: one row with pot name; hide leftover Half/Full labels.
    const bare = await this.prisma.menuItem.findFirst({
      where: {
        specialProductId: product.id,
        kind: "SPECIAL",
        OR: [{ name: product.name }, { name: `${product.name} (Full)` }],
      },
      orderBy: { createdAt: "asc" },
    });
    const data = {
      name: product.name,
      category: product.category,
      kitchenStation: station,
      kind: "SPECIAL" as const,
      sellUnit: "PCS" as const,
      sellingPrice: fullPrice,
      specialProductId: product.id,
      recipeId: null as string | null,
      mixSpecialPlates: 1,
      listPortionQty: 1,
      minQty: 1,
      qtyStep: 1,
      allowCustomQty: false,
      active: true,
    };
    const primary = bare
      ? await this.prisma.menuItem.update({ where: { id: bare.id }, data })
      : await this.prisma.menuItem.create({ data });
    await this.prisma.menuItem.updateMany({
      where: {
        specialProductId: product.id,
        kind: "SPECIAL",
        active: true,
        id: { not: primary.id },
      },
      data: { active: false },
    });
    return primary;
  }

  private async assertUniqueName(name: string, excludeId?: string) {
    const trimmed = name.trim();
    const clash = await this.prisma.specialProduct.findFirst({
      where: {
        name: { equals: trimmed, mode: "insensitive" },
        ...(excludeId ? { NOT: { id: excludeId } } : {}),
      },
    });
    if (clash) {
      throw new BadRequestException(`Special pot "${clash.name}" already exists`);
    }
  }

  async createProduct(dto: CreateSpecialProductDto) {
    if (!dto.cookRecipeId?.trim()) {
      throw new BadRequestException("Pick a cook recipe — required for store deduct and waste cost");
    }
    const recipe = await this.prisma.recipe.findUnique({ where: { id: dto.cookRecipeId } });
    if (!recipe) throw new BadRequestException("Cook recipe not found");
    await this.assertUniqueName(dto.name);
    const half =
      dto.halfPlatePrice != null && dto.halfPlatePrice > 0 ? dto.halfPlatePrice : null;
    const product = await this.prisma.specialProduct.create({
      data: {
        name: dto.name.trim(),
        category: dto.category?.trim() || "Pakistani Special",
        servingLabel: (dto.servingLabel?.trim() || "Plate").slice(0, 40),
        sellMode: dto.sellMode ?? "BOTH",
        platePrice: dto.platePrice,
        halfPlatePrice: half,
        plateGrams: dto.plateGrams,
        cookRecipeId: dto.cookRecipeId,
        kitchenStation: dto.kitchenStation ?? "COOKING",
      },
    });
    await this.syncSpecialMenuItem(product);
    return this.prisma.specialProduct.findUniqueOrThrow({
      where: { id: product.id },
      include: {
        cookRecipe: { select: { id: true, name: true, category: true } },
        menuItems: {
          where: { active: true },
          select: { id: true, name: true, kind: true, sellingPrice: true },
        },
      },
    });
  }

  async updateProduct(id: string, dto: UpdateSpecialProductDto) {
    try {
      // Soft-delete / deactivate is not an edit — use DELETE after hotel close (Admin).
      if (dto.active === false) {
        throw new BadRequestException(
          "Cannot delete a special pot while editing. After hotel close, Admin can remove it."
        );
      }
      if (dto.cookRecipeId !== undefined) {
        if (dto.cookRecipeId === null || dto.cookRecipeId === "") {
          throw new BadRequestException("Cook recipe is required — cannot clear it");
        }
        const recipe = await this.prisma.recipe.findUnique({ where: { id: dto.cookRecipeId } });
        if (!recipe) throw new BadRequestException("Cook recipe not found");
      }
      if (dto.name != null) await this.assertUniqueName(dto.name, id);
      const product = await this.prisma.specialProduct.update({
        where: { id },
        data: {
          ...(dto.name != null ? { name: dto.name.trim() } : {}),
          ...(dto.category != null ? { category: dto.category.trim() } : {}),
          ...(dto.servingLabel != null
            ? { servingLabel: dto.servingLabel.trim().slice(0, 40) || "Plate" }
            : {}),
          ...(dto.sellMode != null ? { sellMode: dto.sellMode } : {}),
          ...(dto.platePrice != null ? { platePrice: dto.platePrice } : {}),
          ...(dto.halfPlatePrice !== undefined
            ? {
                halfPlatePrice:
                  dto.halfPlatePrice != null && dto.halfPlatePrice > 0
                    ? dto.halfPlatePrice
                    : null,
              }
            : {}),
          ...(dto.plateGrams != null ? { plateGrams: dto.plateGrams } : {}),
          ...(dto.cookRecipeId !== undefined
            ? { cookRecipeId: dto.cookRecipeId || null }
            : {}),
          ...(dto.kitchenStation != null ? { kitchenStation: dto.kitchenStation } : {}),
          ...(dto.active === true ? { active: true } : {}),
        },
      });
      await this.syncSpecialMenuItem(product);
      return this.prisma.specialProduct.findUniqueOrThrow({
        where: { id: product.id },
        include: {
          cookRecipe: { select: { id: true, name: true, category: true } },
          menuItems: {
            where: { active: true },
            select: { id: true, name: true, kind: true, sellingPrice: true },
          },
        },
      });
    } catch (e) {
      if (e instanceof BadRequestException || e instanceof ForbiddenException) throw e;
      throw new NotFoundException("Special product not found");
    }
  }

  /**
   * Soft-remove a special pot (active=false). History / batches stay.
   * Only Admin, and only while the hotel is manually closed.
   */
  async deactivateProduct(id: string, user: AuthUser) {
    if (user.roleCode !== "ADMIN") {
      throw new ForbiddenException("Only Admin can remove a special pot");
    }
    const hotel = await this.settings.hotelStatus();
    if (!hotel.manuallyClosed) {
      throw new BadRequestException(
        "Close the hotel first, then Admin can remove the special pot. While open, only update is allowed."
      );
    }
    const existing = await this.prisma.specialProduct.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Special product not found");
    if (!existing.active) {
      return { id: existing.id, name: existing.name, active: false, alreadyInactive: true };
    }
    const product = await this.prisma.specialProduct.update({
      where: { id },
      data: { active: false },
    });
    await this.syncSpecialMenuItem(product);
    return { id: product.id, name: product.name, active: false, alreadyInactive: false };
  }

  async todayBatches() {
    const businessDate = await this.businessDateNow();
    // Recover post-close / wrong-day pot remaining onto today's carry (no stock cut).
    await this.migrateOrphanRemainingTo(businessDate);
    const products = await this.prisma.specialProduct.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
    });
    const batches = await this.prisma.dailyBatch.findMany({
      where: { businessDate },
    });
    const byProduct = new Map(batches.map((b) => [b.specialProductId, b]));
    const dayCash = await this.prisma.dayCashClose.findUnique({
      where: { businessDate },
      select: { id: true, lockedAt: true },
    });
    const close = await this.prisma.dayBatchClose.findUnique({
      where: { businessDate },
      include: { lines: true },
    });

    const rows = [];
    for (const p of products) {
      const b = byProduct.get(p.id);
      const remaining = b ? this.remainingGrams(b) : 0;
      const plateGrams = toNumber(p.plateGrams) || 1;
      const cookedGrams = b ? toNumber(b.cookedGrams) : 0;
      const soldGrams = b ? toNumber(b.soldGrams) : 0;
      const openingCarryGrams = b ? toNumber(b.openingCarryGrams) : 0;
      const storedCookCost = b ? toNumber(b.cookCostTotal) : 0;
      const cookCost =
        storedCookCost > 0 ? storedCookCost : await this.costForGrams(p, cookedGrams);
      const soldCost =
        cookCost > 0 && cookedGrams > 0
          ? Math.round((cookCost * (soldGrams / cookedGrams)) * 100) / 100
          : await this.costForGrams(p, soldGrams);
      // Attribute today's cook cost only to leftover of today's cook (carry has no cookCostTotal).
      const cookedLeft = Math.max(0, cookedGrams - soldGrams);
      const remainingCost =
        cookCost > 0 && cookedGrams > 0
          ? Math.round((cookCost * (cookedLeft / cookedGrams)) * 100) / 100
          : await this.costForGrams(p, remaining);
      const soldValue = (soldGrams / plateGrams) * toNumber(p.platePrice);
      const costPerKg = cookedGrams > 0 ? Math.round((cookCost / (cookedGrams / 1000)) * 100) / 100 : 0;
      rows.push({
        id: p.id,
        name: p.name,
        category: p.category,
        servingLabel: p.servingLabel || "Plate",
        sellMode: p.sellMode,
        platePrice: toNumber(p.platePrice),
        halfPlatePrice:
          p.halfPlatePrice != null ? toNumber(p.halfPlatePrice) : null,
        plateGrams,
        cookRecipeId: p.cookRecipeId,
        batchId: b?.id ?? null,
        status: b?.status ?? (cookedGrams || openingCarryGrams ? "OPEN" : null),
        openingCarryGrams,
        cookedGrams,
        soldGrams,
        remainingGrams: remaining,
        remainingPlates: remaining / plateGrams,
        maxRs: (remaining / plateGrams) * toNumber(p.platePrice),
        cookCost,
        soldCost,
        remainingCost,
        soldValue: Math.round(soldValue * 100) / 100,
        costPerKg,
        cookedByName: b?.cookedByName ?? null,
        cookedAt: b?.cookedAt?.toISOString() ?? null,
      });
    }

    const totals = {
      cookedGrams: rows.reduce((s, r) => s + r.cookedGrams, 0),
      soldGrams: rows.reduce((s, r) => s + r.soldGrams, 0),
      remainingGrams: rows.reduce((s, r) => s + r.remainingGrams, 0),
      cookCost: Math.round(rows.reduce((s, r) => s + r.cookCost, 0) * 100) / 100,
      soldCost: Math.round(rows.reduce((s, r) => s + r.soldCost, 0) * 100) / 100,
      remainingCost: Math.round(rows.reduce((s, r) => s + r.remainingCost, 0) * 100) / 100,
      soldValue: Math.round(rows.reduce((s, r) => s + r.soldValue, 0) * 100) / 100,
      openPots: rows.filter((r) => r.status === "OPEN").length,
      closedPots: rows.filter((r) => r.status === "CLOSED").length,
    };
    const wasteLines = close?.lines ?? [];
    const wasteGrams = wasteLines.reduce((s, l) => s + toNumber(l.wasteGrams), 0);
    const wasteLoss = wasteLines.reduce((s, l) => s + toNumber(l.lossCost), 0);

    return {
      businessDate,
      /** True only after leftover was saved with Close Report (DayBatchClose row). */
      batchCloseDone: !!close,
      dayCashClosed: !!dayCash,
      locked: !!dayCash?.lockedAt,
      products: rows,
      totals: {
        ...totals,
        wasteGrams,
        wasteLoss: Math.round(wasteLoss * 100) / 100,
        yieldPct:
          totals.cookedGrams + rows.reduce((s, r) => s + r.openingCarryGrams, 0) > 0
            ? Math.round(
                (totals.soldGrams /
                  (totals.cookedGrams + rows.reduce((s, r) => s + r.openingCarryGrams, 0))) *
                  1000
              ) / 10
            : 0,
        foodMargin: Math.round((totals.soldValue - totals.soldCost) * 100) / 100,
      },
    };
  }

  /** Recipe ingredient list for cook UI (staff enters actual amounts + finished pot kg). */
  async cookIngredients(specialProductId: string) {
    const product = await this.prisma.specialProduct.findFirst({
      where: { id: specialProductId, active: true },
    });
    if (!product) throw new NotFoundException("Special product not found");
    if (!product.cookRecipeId) {
      throw new BadRequestException(
        `Set a cook recipe on ${product.name} before cooking`
      );
    }
    const recipe = await this.prisma.recipe.findUnique({
      where: { id: product.cookRecipeId },
      include: {
        ingredients: { include: { storeItem: true } },
      },
    });
    if (!recipe || !recipe.active) {
      throw new BadRequestException("Cook recipe not found or inactive");
    }
    const station = product.kitchenStation || "COOKING";
    const kitchenRows = await this.prisma.kitchenStock.findMany({
      where: {
        station,
        storeItemId: { in: recipe.ingredients.map((i) => i.storeItemId) },
      },
    });
    const onHand = new Map(
      kitchenRows.map((k) => [k.storeItemId, Math.max(0, toNumber(k.quantityOnHand))])
    );

    const ingredients = recipe.ingredients
      .filter((ing) => ing.storeItem.active)
      .map((ing) => ({
        storeItemId: ing.storeItemId,
        name: ing.storeItem.name,
        unit: ing.unit,
        storeUnit: ing.storeItem.unit,
        /** Recipe template qty (edit to what you put in today). */
        suggestedQty: toNumber(ing.quantity),
        onHand: onHand.get(ing.storeItemId) ?? 0,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return {
      specialProductId: product.id,
      name: product.name,
      kitchenStation: station,
      recipe: {
        id: recipe.id,
        name: recipe.name,
        baseUnit: recipe.baseUnit,
        baseQty: toNumber(recipe.baseQty) || 1,
      },
      ingredients,
    };
  }

  /** System Manager: log morning cook — actual ingredients used + finished pot weight. */
  async cook(dto: CookBatchDto, user: AuthUser) {
    const addCook = Number(dto.cookedGrams);
    if (!(addCook > 0)) throw new BadRequestException("Cooked qty invalid");
    const product = await this.prisma.specialProduct.findFirst({
      where: { id: dto.specialProductId, active: true },
    });
    if (!product) throw new NotFoundException("Special product not found");
    if (!product.cookRecipeId) {
      throw new BadRequestException(
        `Set a cook recipe on ${product.name} before cooking — needed for store deduct and waste cost`
      );
    }

    const recipe = await this.prisma.recipe.findUnique({
      where: { id: product.cookRecipeId },
      include: { ingredients: { select: { storeItemId: true } } },
    });
    if (!recipe || !recipe.active) {
      throw new BadRequestException("Cook recipe not found or inactive");
    }
    const allowed = new Set(recipe.ingredients.map((i) => i.storeItemId));
    const lines = (dto.ingredients ?? [])
      .map((l) => ({
        storeItemId: l.storeItemId,
        quantity: Number(l.quantity),
        unit: l.unit as UnitType,
      }))
      .filter((l) => l.storeItemId && l.quantity > 0);
    if (!lines.length) {
      throw new BadRequestException("Enter at least one ingredient amount used today");
    }
    for (const line of lines) {
      if (!allowed.has(line.storeItemId)) {
        throw new BadRequestException(
          "Ingredient is not on this pot's cook recipe — pick from the list"
        );
      }
    }

    const { businessDate } = await this.resolveCookBusinessDate(dto.businessDate);
    await this.migrateOrphanRemainingTo(businessDate);

    let batch = await this.prisma.dailyBatch.findUnique({
      where: {
        specialProductId_businessDate: {
          specialProductId: product.id,
          businessDate,
        },
      },
    });

    if (!batch) {
      const prevDate = addBusinessDays(businessDate, -1);
      const prevClose = await this.prisma.dayBatchClose.findUnique({
        where: { businessDate: prevDate },
        include: { lines: true },
      });
      const carry =
        prevClose?.lines.find((l) => l.specialProductId === product.id)?.carryGrams ?? 0;
      batch = await this.prisma.dailyBatch.create({
        data: {
          specialProductId: product.id,
          businessDate,
          openingCarryGrams: carry,
          cookedGrams: 0,
          soldGrams: 0,
          status: "OPEN",
        },
      });
    }

    if (batch.status === "CLOSED") {
      throw new BadRequestException(
        `Pot already closed for ${businessDate} — edit leftover close or pick another cook date`
      );
    }

    const cookStation = product.kitchenStation || "COOKING";
    let cookCost = 0;
    try {
      cookCost = await this.costing.deductKitchenLines(
        lines,
        `Special cook · ${product.name} · ${businessDate} · pot ${addCook}g`,
        "COOK",
        cookStation
      );
    } catch (e) {
      if (e instanceof BadRequestException) {
        const body = e.getResponse();
        if (body && typeof body === "object" && !Array.isArray(body)) {
          throw new BadRequestException({
            ...body,
            specialProductId: product.id,
          });
        }
      }
      throw e;
    }

    const cookedAt = dto.cookedAt ? new Date(dto.cookedAt) : new Date();
    const updated = await this.prisma.dailyBatch.update({
      where: { id: batch.id },
      data: {
        cookedGrams: { increment: addCook },
        cookCostTotal: { increment: cookCost },
        cookedById: user.id,
        cookedByName: user.name,
        cookedAt: Number.isFinite(cookedAt.getTime()) ? cookedAt : new Date(),
        note: dto.note?.trim() || batch.note,
        status: "OPEN",
      },
    });

    return {
      ...updated,
      remainingGrams: this.remainingGrams(updated),
      platePrice: toNumber(product.platePrice),
      plateGrams: toNumber(product.plateGrams),
      cookCost,
      businessDate,
    };
  }

  async assertAvailable(specialProductId: string, grams: number) {
    if (grams <= 0) return { remainingGrams: 0 };
    const businessDate = await this.businessDateNow();
    const batch = await this.prisma.dailyBatch.findUnique({
      where: {
        specialProductId_businessDate: { specialProductId, businessDate },
      },
      include: { specialProduct: true },
    });
    if (!batch || batch.status !== "OPEN") {
      throw new BadRequestException({
        code: "BATCH_UNAVAILABLE",
        message: "Special item not cooked / closed for today",
        specialProductId,
        remainingGrams: 0,
      });
    }
    const rem = this.remainingGrams(batch);
    if (grams - rem > 0.0005) {
      throw new BadRequestException({
        code: "BATCH_SHORT",
        message: `${batch.specialProduct.name} short (need ${grams}g, have ${rem}g)`,
        specialProductId,
        remainingGrams: rem,
        platePrice: toNumber(batch.specialProduct.platePrice),
        plateGrams: toNumber(batch.specialProduct.plateGrams),
      });
    }
    return { remainingGrams: rem, product: batch.specialProduct };
  }

  async assertAndTake(
    specialProductId: string,
    grams: number,
    opts?: { allowZero?: boolean }
  ) {
    if (grams <= 0) {
      if (opts?.allowZero) return { batchId: null as string | null, grams: 0 };
      throw new BadRequestException("Special qty must be greater than 0");
    }
    const businessDate = await this.businessDateNow();
    const batch = await this.prisma.dailyBatch.findUnique({
      where: {
        specialProductId_businessDate: { specialProductId, businessDate },
      },
      include: { specialProduct: true },
    });
    if (!batch || batch.status !== "OPEN") {
      throw new BadRequestException({
        code: "BATCH_UNAVAILABLE",
        message: "Special item not cooked / closed for today",
        specialProductId,
        remainingGrams: 0,
      });
    }
    const rem = this.remainingGrams(batch);
    if (grams - rem > 0.0005) {
      throw new BadRequestException({
        code: "BATCH_SHORT",
        message: `${batch.specialProduct.name} short (need ${grams}g, have ${rem}g)`,
        specialProductId,
        remainingGrams: rem,
        platePrice: toNumber(batch.specialProduct.platePrice),
        plateGrams: toNumber(batch.specialProduct.plateGrams),
      });
    }
    await this.prisma.dailyBatch.update({
      where: { id: batch.id },
      data: { soldGrams: { increment: grams } },
    });
    return { batchId: batch.id, grams, product: batch.specialProduct };
  }

  async restoreGrams(specialProductId: string, grams: number) {
    if (grams <= 0) return;
    const businessDate = await this.businessDateNow();
    const batch = await this.prisma.dailyBatch.findUnique({
      where: {
        specialProductId_businessDate: { specialProductId, businessDate },
      },
    });
    if (!batch) return;
    await this.prisma.dailyBatch.update({
      where: { id: batch.id },
      data: { soldGrams: { decrement: Math.min(grams, toNumber(batch.soldGrams)) } },
    });
  }

  /**
   * Leftover alone must not lock cook. Keep closed only when day cash was saved with leftover.
   * Orphan DayBatchClose / CLOSED pots without day cash are reopened.
   */
  /**
   * Do NOT auto-delete DayBatchClose (that hid morning cook from waste/close lists).
   * Leftover edit goes through saveClose replace or forceReopenToday.
   */
  async reopenLeftoverIfDayStillOpen(businessDate: string) {
    const dayCash = await this.prisma.dayCashClose.findUnique({
      where: { businessDate },
      select: { id: true, lockedAt: true },
    });
    if (dayCash?.lockedAt) return { reopened: false, locked: true };
    return { reopened: false };
  }

  /** Admin/system: force pots open for a day (clears leftover close row so it can be edited). */
  async forceReopenToday(businessDate?: string, user?: AuthUser) {
    const day = businessDate?.trim() || (await this.businessDateNow());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      throw new BadRequestException("Invalid business date");
    }
    const current = await this.businessDateNow();
    if (day !== current && user?.roleCode !== "ADMIN") {
      throw new ForbiddenException("Only Admin can reopen leftover on a previous day");
    }
    await this.assertDayNotLocked(day);
    const batchClose = await this.prisma.dayBatchClose.findUnique({
      where: { businessDate: day },
      select: { id: true },
    });
    await this.prisma.$transaction(async (tx) => {
      if (batchClose) {
        await tx.dayBatchClose.delete({ where: { id: batchClose.id } });
      }
      await tx.dailyBatch.updateMany({
        where: { businessDate: day },
        data: { status: "OPEN", closedAt: null },
      });
    });
    return { businessDate: day, reopened: true };
  }

  async saveClose(dto: SaveBatchCloseDto, user: AuthUser) {
    const current = await this.businessDateNow();
    const businessDate =
      dto.businessDate && /^\d{4}-\d{2}-\d{2}$/.test(dto.businessDate)
        ? dto.businessDate
        : current;
    if (businessDate !== current && user.roleCode !== "ADMIN") {
      throw new ForbiddenException("Only Admin can edit leftover on a previous day");
    }
    await this.assertDayNotLocked(businessDate);

    // Allow re-save with Close Report: replace prior leftover close if day cash not final yet,
    // or update when day cash already exists (report update).
    const prior = await this.prisma.dayBatchClose.findUnique({
      where: { businessDate },
      select: { id: true },
    });
    if (prior) {
      await this.prisma.dayBatchClose.delete({ where: { id: prior.id } });
      await this.prisma.dailyBatch.updateMany({
        where: { businessDate },
        data: { status: "OPEN", closedAt: null },
      });
    }

    const products = await this.prisma.specialProduct.findMany({ where: { active: true } });
    const batches = await this.prisma.dailyBatch.findMany({ where: { businessDate } });
    const byProduct = new Map(batches.map((b) => [b.specialProductId, b]));
    const tol = SpecialsService.QTY_TOL_G;

    // Every OPEN batch with remaining must be in dto.
    for (const b of batches) {
      if (b.status === "CLOSED") continue;
      const rem = this.remainingGrams(b);
      if (rem <= 0.0005) continue;
      if (!dto.lines.some((l) => l.specialProductId === b.specialProductId)) {
        const p = products.find((x) => x.id === b.specialProductId);
        throw new BadRequestException(
          `Account leftover for ${p?.name ?? "special"} (${rem}g)`
        );
      }
    }

    const lineData = [];
    for (const line of dto.lines) {
      const product = products.find((p) => p.id === line.specialProductId);
      if (!product) throw new BadRequestException("Unknown special product");
      const batch = byProduct.get(line.specialProductId);
      const systemRem = batch ? this.remainingGrams(batch) : 0;
      const counted = line.countedRemainingGrams;
      const carry = line.carryGrams;
      let waste = line.wasteGrams;
      if (Math.abs(carry + waste - counted) > tol) {
        throw new BadRequestException(
          `${product.name}: carry + waste must equal counted remaining (±${tol}g)`
        );
      }

      // Book vs count shrink → fold into waste (hotel POS unexplained loss).
      const shrink = Math.max(0, systemRem - counted);
      let wasteNote = (line.wasteNote || "").trim();
      if (shrink > tol) {
        waste = Math.round((waste + shrink) * 1000) / 1000;
        const shrinkNote = `Shrink ${Math.round(shrink)}g vs system`;
        wasteNote = wasteNote ? `${wasteNote} · ${shrinkNote}` : shrinkNote;
      }

      if (waste > tol && wasteNote.length < 3) {
        throw new BadRequestException(
          `${product.name}: waste / shrink needs a reason note (why leftover was lost)`
        );
      }
      if (waste > tol && !product.cookRecipeId) {
        throw new BadRequestException(
          `${product.name}: set a cook recipe so waste can be costed`
        );
      }

      const lossCost = await this.costForGrams(product, waste);

      lineData.push({
        specialProductId: product.id,
        dailyBatchId: batch?.id ?? null,
        systemRemainingGrams: systemRem,
        countedRemainingGrams: counted,
        carryGrams: carry,
        wasteGrams: waste,
        wasteNote: wasteNote || null,
        lossCost,
      });
    }

    const close = await this.prisma.dayBatchClose.create({
      data: {
        businessDate,
        note: dto.note?.trim() || null,
        closedById: user.id,
        closedByName: user.name,
        lines: { create: lineData },
      },
      include: { lines: true },
    });

    for (const b of batches) {
      await this.prisma.dailyBatch.update({
        where: { id: b.id },
        data: { status: "CLOSED", closedAt: new Date() },
      });
    }

    return close;
  }

  async lossReport(from?: string, to?: string) {
    const where: { businessDate?: { gte?: string; lte?: string } } = {};
    if (from || to) {
      where.businessDate = {};
      if (from) where.businessDate.gte = from;
      if (to) where.businessDate.lte = to;
    }
    const closes = await this.prisma.dayBatchClose.findMany({
      where,
      include: {
        lines: {
          where: { wasteGrams: { gt: 0 } },
          include: { specialProduct: { select: { name: true, category: true } } },
        },
      },
      orderBy: { businessDate: "desc" },
    });
    const rows = closes.flatMap((c) =>
      c.lines.map((l) => ({
        businessDate: c.businessDate,
        specialProductId: l.specialProductId,
        name: l.specialProduct.name,
        category: l.specialProduct.category,
        wasteGrams: toNumber(l.wasteGrams),
        lossCost: toNumber(l.lossCost),
        wasteNote: l.wasteNote,
        closedByName: c.closedByName,
      }))
    );
    const totalLoss = rows.reduce((s, r) => s + r.lossCost, 0);
    const totalWasteGrams = rows.reduce((s, r) => s + r.wasteGrams, 0);
    return { rows, totalLoss, totalWasteGrams };
  }

  /** Snapshot for close preview — pass date to edit a previous day's leftover (if unlocked). */
  async closePreview(date?: string) {
    const current = await this.businessDateNow();
    const businessDate =
      date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : current;
    const locked = await this.isDayCashLocked(businessDate);

    let productsPayload: Awaited<ReturnType<SpecialsService["todayBatches"]>>;
    if (businessDate === current) {
      productsPayload = await this.todayBatches();
    } else {
      await this.migrateOrphanRemainingTo(businessDate);
      const products = await this.prisma.specialProduct.findMany({
        where: { active: true },
        orderBy: { name: "asc" },
      });
      const batches = await this.prisma.dailyBatch.findMany({ where: { businessDate } });
      const byProduct = new Map(batches.map((b) => [b.specialProductId, b]));
      const rows = [];
      for (const p of products) {
        const b = byProduct.get(p.id);
        const remaining = b ? this.remainingGrams(b) : 0;
        const plateGrams = toNumber(p.plateGrams) || 1;
        const cookedGrams = b ? toNumber(b.cookedGrams) : 0;
        const soldGrams = b ? toNumber(b.soldGrams) : 0;
        const openingCarryGrams = b ? toNumber(b.openingCarryGrams) : 0;
        rows.push({
          id: p.id,
          name: p.name,
          category: p.category,
          servingLabel: p.servingLabel || "Plate",
          sellMode: p.sellMode,
          platePrice: toNumber(p.platePrice),
          halfPlatePrice: p.halfPlatePrice != null ? toNumber(p.halfPlatePrice) : null,
          plateGrams,
          cookRecipeId: p.cookRecipeId,
          batchId: b?.id ?? null,
          status: b?.status ?? (cookedGrams || openingCarryGrams ? "OPEN" : null),
          openingCarryGrams,
          cookedGrams,
          soldGrams,
          remainingGrams: remaining,
          remainingPlates: remaining / plateGrams,
          maxRs: (remaining / plateGrams) * toNumber(p.platePrice),
        });
      }
      productsPayload = {
        businessDate,
        batchCloseDone: false,
        dayCashClosed: false,
        locked,
        products: rows,
        totals: {
          cookedGrams: 0,
          soldGrams: 0,
          remainingGrams: 0,
          cookCost: 0,
          soldCost: 0,
          remainingCost: 0,
          soldValue: 0,
          openPots: 0,
          closedPots: 0,
          wasteGrams: 0,
          wasteLoss: 0,
          yieldPct: 0,
          foodMargin: 0,
        },
      } as Awaited<ReturnType<SpecialsService["todayBatches"]>>;
    }

    const dayCash = await this.prisma.dayCashClose.findUnique({
      where: { businessDate },
      select: { id: true, lockedAt: true },
    });
    const existing = await this.prisma.dayBatchClose.findUnique({
      where: { businessDate },
      include: {
        lines: { include: { specialProduct: { select: { name: true } } } },
      },
    });
    return {
      ...productsPayload,
      businessDate,
      isCurrentBusinessDay: businessDate === current,
      batchCloseDone: !!existing,
      existingClose: existing,
      dayCashClosed: !!dayCash,
      locked: !!dayCash?.lockedAt,
      canEditLeftover: !dayCash?.lockedAt,
    };
  }

  /** Defaults for cook UI date/time picker. */
  async cookDefaults() {
    const clock = await this.settings.dayStart();
    const now = new Date();
    const natural = businessDateOf(now, clock.h, clock.m);
    const finished =
      (await this.isLeftoverClosed(natural)) || (await this.isDayCashLocked(natural));
    let suggested = defaultCookBusinessDate(now, clock.h, clock.m, finished);
    for (let i = 0; i < 5; i++) {
      if (
        !(await this.isDayCashLocked(suggested)) &&
        !(await this.isLeftoverClosed(suggested))
      ) {
        break;
      }
      suggested = addBusinessDays(suggested, 1);
    }
    const pad = (n: number) => String(n).padStart(2, "0");
    return {
      businessDate: suggested,
      suggestedDate: suggested,
      suggestedTime: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
      dayStart: clock.label,
      calendarDate: isoDay(now),
      naturalBusinessDate: natural,
      rolledToNewDay: suggested !== natural,
    };
  }
}