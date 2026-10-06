import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CostingService } from "../common/costing.service";
import { businessDateOf } from "../common/business-day";
import { toNumber } from "../common/units";
import { AuthUser } from "../common/decorators";
import { SettingsService } from "../system/settings.service";
import {
  CookBatchDto,
  CreateSpecialProductDto,
  SaveBatchCloseDto,
  UpdateSpecialProductDto,
} from "./dto";
import { Decimal } from "@prisma/client/runtime/library";

@Injectable()
export class SpecialsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly costing: CostingService,
    private readonly settings: SettingsService
  ) {}

  async businessDateNow() {
    const day = await this.settings.dayStart();
    return businessDateOf(new Date(), day.h, day.m);
  }

  remainingGrams(batch: {
    openingCarryGrams: Parameters<typeof toNumber>[0];
    cookedGrams: Parameters<typeof toNumber>[0];
    soldGrams: Parameters<typeof toNumber>[0];
  }) {
    return Math.max(
      0,
      toNumber(batch.openingCarryGrams) +
        toNumber(batch.cookedGrams) -
        toNumber(batch.soldGrams)
    );
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

  /** Keep a SPECIAL menu row in sync so Waiter can sell without Menu Rates setup. */
  private async syncSpecialMenuItem(product: {
    id: string;
    name: string;
    category: string;
    platePrice: Decimal;
    active: boolean;
  }) {
    const existing = await this.prisma.menuItem.findFirst({
      where: { specialProductId: product.id, kind: "SPECIAL" },
      orderBy: { createdAt: "asc" },
    });
    const price = toNumber(product.platePrice);
    if (!product.active) {
      if (existing) {
        await this.prisma.menuItem.update({
          where: { id: existing.id },
          data: { active: false },
        });
      }
      return existing;
    }
    if (existing) {
      return this.prisma.menuItem.update({
        where: { id: existing.id },
        data: {
          name: product.name,
          category: product.category,
        sellingPrice: price,
        sellUnit: "PCS",
        kind: "SPECIAL",
        specialProductId: product.id,
        recipeId: null,
        mixSpecialPlates: null,
        listPortionQty: 1,
        active: true,
        minQty: 1,
        qtyStep: 1,
        allowCustomQty: false,
        },
      });
    }
    return this.prisma.menuItem.create({
      data: {
        name: product.name,
        category: product.category,
        kitchenStation: "COOKING",
        kind: "SPECIAL",
        sellUnit: "PCS",
        sellingPrice: price,
        specialProductId: product.id,
        listPortionQty: 1,
        minQty: 1,
        qtyStep: 1,
        allowCustomQty: false,
        active: true,
      },
    });
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
    if (dto.cookRecipeId) {
      const recipe = await this.prisma.recipe.findUnique({ where: { id: dto.cookRecipeId } });
      if (!recipe) throw new BadRequestException("Cook recipe not found");
    }
    await this.assertUniqueName(dto.name);
    const product = await this.prisma.specialProduct.create({
      data: {
        name: dto.name.trim(),
        category: dto.category?.trim() || "Pakistani Special",
        servingLabel: (dto.servingLabel?.trim() || "Plate").slice(0, 40),
        sellMode: dto.sellMode ?? "BOTH",
        platePrice: dto.platePrice,
        plateGrams: dto.plateGrams,
        cookRecipeId: dto.cookRecipeId || null,
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
      if (dto.cookRecipeId) {
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
          ...(dto.plateGrams != null ? { plateGrams: dto.plateGrams } : {}),
          ...(dto.cookRecipeId !== undefined
            ? { cookRecipeId: dto.cookRecipeId || null }
            : {}),
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
    await this.reopenLeftoverIfDayStillOpen(businessDate);
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
      select: { id: true },
    });
    const close = await this.prisma.dayBatchClose.findUnique({
      where: { businessDate },
      include: { lines: true },
    });

    return {
      businessDate,
      /** True only after leftover was saved with Close Report (DayBatchClose row). */
      batchCloseDone: !!close,
      dayCashClosed: !!dayCash,
      products: products.map((p) => {
        const b = byProduct.get(p.id);
        const remaining = b ? this.remainingGrams(b) : 0;
        const plateGrams = toNumber(p.plateGrams) || 1;
        return {
          id: p.id,
          name: p.name,
          category: p.category,
          servingLabel: p.servingLabel || "Plate",
          sellMode: p.sellMode,
          platePrice: toNumber(p.platePrice),
          plateGrams,
          cookRecipeId: p.cookRecipeId,
          batchId: b?.id ?? null,
          status: b?.status ?? null,
          openingCarryGrams: b ? toNumber(b.openingCarryGrams) : 0,
          cookedGrams: b ? toNumber(b.cookedGrams) : 0,
          soldGrams: b ? toNumber(b.soldGrams) : 0,
          remainingGrams: remaining,
          remainingPlates: remaining / plateGrams,
          maxRs: (remaining / plateGrams) * toNumber(p.platePrice),
        };
      }),
    };
  }

  /** System Manager: log morning cook. Deducts cook recipe from store once (for new cook qty). */
  async cook(dto: CookBatchDto, user: AuthUser) {
    const addCook = Number(dto.cookedGrams);
    if (!(addCook > 0)) throw new BadRequestException("Cooked qty invalid");
    const product = await this.prisma.specialProduct.findFirst({
      where: { id: dto.specialProductId, active: true },
    });
    if (!product) throw new NotFoundException("Special product not found");

    const businessDate = await this.businessDateNow();
    await this.reopenLeftoverIfDayStillOpen(businessDate);

    let batch = await this.prisma.dailyBatch.findUnique({
      where: {
        specialProductId_businessDate: {
          specialProductId: product.id,
          businessDate,
        },
      },
    });

    if (!batch) {
      // Pull carry from yesterday's close if any.
      const prev = new Date(businessDate + "T12:00:00");
      prev.setDate(prev.getDate() - 1);
      const prevDate = prev.toISOString().slice(0, 10);
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
      throw new BadRequestException("This batch is already closed for today");
    }

    if (product.cookRecipeId) {
      const recipe = await this.prisma.recipe.findUnique({
        where: { id: product.cookRecipeId },
        select: { baseUnit: true },
      });
      if (!recipe) throw new BadRequestException("Cook recipe not found");
      // Scale by finished weight in recipe base unit (KG: 5000g → 5kg), not plate count.
      const cookQty = this.costing.cookedGramsToRecipeQty({
        baseUnit: recipe.baseUnit,
        cookedGrams: addCook,
        plateGrams: toNumber(product.plateGrams),
      });
      const short = await this.costing.recipeStockShortfalls([
        { recipeId: product.cookRecipeId, quantity: cookQty, name: product.name },
      ]);
      if (short.length) {
        const parts = short.map((n) => {
          const state = n.onHand <= 0.0001 ? "out of stock" : "short";
          const have = `${Math.round(n.onHand * 1000) / 1000} ${n.unit}`;
          const need = `${Math.round(n.need * 1000) / 1000} ${n.unit}`;
          return `${n.name} is ${state} (store ${have}, need ${need})`;
        });
        throw new BadRequestException({
          code: "COOK_STOCK_SHORT",
          message: `Cannot cook ${product.name}: ${parts.join("; ")}. Cook blocked — inventory unchanged.`,
          specialProductId: product.id,
          shorts: short,
        });
      }
      await this.costing.deductRecipeStock(
        product.cookRecipeId,
        cookQty,
        `Special cook · ${product.name} · ${businessDate} · ${addCook}g`,
        undefined
      );
    }

    const updated = await this.prisma.dailyBatch.update({
      where: { id: batch.id },
      data: {
        cookedGrams: { increment: addCook },
        cookedById: user.id,
        cookedByName: user.name,
        cookedAt: new Date(),
        note: dto.note?.trim() || batch.note,
        status: "OPEN",
      },
    });

    return {
      ...updated,
      remainingGrams: this.remainingGrams(updated),
      platePrice: toNumber(product.platePrice),
      plateGrams: toNumber(product.plateGrams),
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
  async reopenLeftoverIfDayStillOpen(businessDate: string) {
    const dayCash = await this.prisma.dayCashClose.findUnique({
      where: { businessDate },
      select: { id: true },
    });
    const batchClose = await this.prisma.dayBatchClose.findUnique({
      where: { businessDate },
      select: { id: true },
    });
    const closedBatches = await this.prisma.dailyBatch.count({
      where: { businessDate, status: "CLOSED" },
    });

    // Proper end-of-day: both saved → leave locked
    if (dayCash && batchClose) return { reopened: false };
    if (!batchClose && closedBatches === 0) return { reopened: false };

    await this.prisma.$transaction(async (tx) => {
      if (batchClose) {
        await tx.dayBatchClose.delete({ where: { id: batchClose.id } });
      }
      await tx.dailyBatch.updateMany({
        where: { businessDate },
        data: { status: "OPEN", closedAt: null },
      });
    });
    return { reopened: true };
  }

  /** Admin/system: force pots open for today (clears leftover close row). */
  async forceReopenToday() {
    const businessDate = await this.businessDateNow();
    const batchClose = await this.prisma.dayBatchClose.findUnique({
      where: { businessDate },
      select: { id: true },
    });
    await this.prisma.$transaction(async (tx) => {
      if (batchClose) {
        await tx.dayBatchClose.delete({ where: { id: batchClose.id } });
      }
      await tx.dailyBatch.updateMany({
        where: { businessDate },
        data: { status: "OPEN", closedAt: null },
      });
    });
    return { businessDate, reopened: true };
  }

  async saveClose(dto: SaveBatchCloseDto, user: AuthUser) {
    const businessDate = await this.businessDateNow();

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
      const waste = line.wasteGrams;
      if (Math.abs(carry + waste - counted) > 0.05) {
        throw new BadRequestException(
          `${product.name}: carry + waste must equal counted remaining`
        );
      }

      let lossCost = 0;
      if (waste > 0 && product.cookRecipeId) {
        const { costPerBase, recipe } = await this.costing.recipeUnitCost(product.cookRecipeId);
        const wasteQty = this.costing.cookedGramsToRecipeQty({
          baseUnit: recipe.baseUnit,
          cookedGrams: waste,
          plateGrams: toNumber(product.plateGrams),
        });
        lossCost = Math.round(costPerBase * wasteQty * 100) / 100;
      }

      lineData.push({
        specialProductId: product.id,
        dailyBatchId: batch?.id ?? null,
        systemRemainingGrams: systemRem,
        countedRemainingGrams: counted,
        carryGrams: carry,
        wasteGrams: waste,
        wasteNote: line.wasteNote?.trim() || null,
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

  /** Snapshot for close preview — leftover stays editable until day cash close is saved. */
  async closePreview() {
    const businessDate = await this.businessDateNow();
    await this.reopenLeftoverIfDayStillOpen(businessDate);
    const today = await this.todayBatches();
    const dayCash = await this.prisma.dayCashClose.findUnique({
      where: { businessDate: today.businessDate },
      select: { id: true },
    });
    const existing = await this.prisma.dayBatchClose.findUnique({
      where: { businessDate: today.businessDate },
      include: {
        lines: { include: { specialProduct: { select: { name: true } } } },
      },
    });
    return {
      ...today,
      batchCloseDone: !!existing,
      existingClose: existing,
      dayCashClosed: !!dayCash,
    };
  }
}