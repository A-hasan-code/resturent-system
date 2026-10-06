import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CostingService } from "../common/costing.service";
import { menuQtyDto } from "../common/menu-qty";
import { toNumber } from "../common/units";
import { CreateMenuItemDto, UpdateMenuItemDto } from "./dto";

@Injectable()
export class MenuService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly costing: CostingService
  ) {}

  private qtyFields(dto: CreateMenuItemDto | UpdateMenuItemDto) {
    const minQty = dto.minQty != null ? dto.minQty : undefined;
    const maxQty = dto.maxQty === undefined ? undefined : dto.maxQty;
    const qtyStep = dto.qtyStep === undefined ? undefined : dto.qtyStep;
    const allowCustomQty = dto.allowCustomQty;

    if (minQty != null && maxQty != null && maxQty > 0 && maxQty < minQty) {
      throw new BadRequestException("maxQty must be greater than or equal to minQty");
    }
    if (qtyStep != null && qtyStep <= 0) {
      throw new BadRequestException("qtyStep must be greater than 0");
    }

    return { minQty, maxQty, qtyStep, allowCustomQty };
  }

  private kindFields(dto: CreateMenuItemDto | UpdateMenuItemDto) {
    const kind = "kind" in dto ? dto.kind : undefined;
    const specialProductId =
      "specialProductId" in dto ? dto.specialProductId : undefined;
    const mixSpecialPlates =
      "mixSpecialPlates" in dto ? dto.mixSpecialPlates : undefined;

    if (kind === "SPECIAL" && specialProductId === null) {
      throw new BadRequestException("SPECIAL menu needs a special product");
    }
    if (kind === "MIX") {
      if (specialProductId === null) {
        throw new BadRequestException("MIX menu needs a special product");
      }
      if (mixSpecialPlates != null && mixSpecialPlates <= 0) {
        throw new BadRequestException("mixSpecialPlates must be greater than 0");
      }
      if ("recipeId" in dto && dto.recipeId === null) {
        throw new BadRequestException("MIX combo needs a store recipe");
      }
    }
    return { kind, specialProductId, mixSpecialPlates };
  }

  async list(showCost = true) {
    const items = await this.prisma.menuItem.findMany({
      where: { active: true },
      include: {
        recipe: true,
        modifiers: {
          where: { active: true },
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
          select: { id: true, name: true, priceDelta: true, sortOrder: true },
        },
        specialProduct: {
          select: {
            id: true,
            name: true,
            platePrice: true,
            plateGrams: true,
            category: true,
            servingLabel: true,
            sellMode: true,
            cookRecipeId: true,
          },
        },
      },
      orderBy: { name: "asc" },
    });

    const mapBase = (m: (typeof items)[number]) => {
      const sellingPrice = toNumber(m.sellingPrice);
      const listPortionQty = toNumber(m.listPortionQty) > 0 ? toNumber(m.listPortionQty) : 1;
      return {
        id: m.id,
        name: m.name,
        category: m.category,
        kitchenStation: m.kitchenStation,
        kind: m.kind,
        sellUnit: m.sellUnit,
        sellingPrice,
        listPortionQty,
        /** Price shown on menu for listPortionQty (e.g. 450 for 500g). */
        listAmount: Math.round(sellingPrice * listPortionQty * 100) / 100,
        recipeId: m.recipeId,
        recipe: m.recipe
          ? { id: m.recipe.id, name: m.recipe.name, category: m.recipe.category, baseUnit: m.recipe.baseUnit }
          : null,
        specialProductId: m.specialProductId,
        mixSpecialPlates: m.mixSpecialPlates != null ? toNumber(m.mixSpecialPlates) : null,
        specialProduct: m.specialProduct
          ? {
              id: m.specialProduct.id,
              name: m.specialProduct.name,
              category: m.specialProduct.category,
              servingLabel: m.specialProduct.servingLabel || "Plate",
              sellMode: m.specialProduct.sellMode,
              platePrice: toNumber(m.specialProduct.platePrice),
              plateGrams: toNumber(m.specialProduct.plateGrams),
            }
          : null,
        modifiers: m.modifiers.map((x) => ({
          id: x.id,
          name: x.name,
          priceDelta: toNumber(x.priceDelta),
          sortOrder: x.sortOrder,
        })),
        ...menuQtyDto(m),
      };
    };

    if (!showCost) {
      return items.map(mapBase);
    }

    const out = [];
    for (const m of items) {
      let cost = 0;
      if (m.recipeId) {
        try {
          const c = await this.costing.recipeUnitCost(m.recipeId);
          cost = c.costPerBase;
        } catch {
          cost = 0;
        }
      }
      const sp = m.specialProduct;
      if (sp?.cookRecipeId) {
        try {
          const plateGrams = toNumber(sp.plateGrams) || 1;
          const plates =
            m.kind === "MIX" ? Math.max(0.001, toNumber(m.mixSpecialPlates) || 1) : 1;
          const grams = plates * plateGrams;
          const { costPerBase, recipe } = await this.costing.recipeUnitCost(sp.cookRecipeId);
          const specialCost =
            costPerBase *
            this.costing.cookedGramsToRecipeQty({
              baseUnit: recipe.baseUnit,
              cookedGrams: grams,
              plateGrams,
            });
          if (m.kind === "SPECIAL") {
            cost = specialCost;
          } else if (m.kind === "MIX") {
            cost += specialCost;
          }
        } catch {
          /* inactive cook recipe — leave store-only cost */
        }
      }
      out.push({
        ...mapBase(m),
        costPerUnit: Math.round(cost * 100) / 100,
      });
    }
    return out;
  }

  create(dto: CreateMenuItemDto) {
    const qty = this.qtyFields(dto);
    const kind = this.kindFields(dto);
    const itemKind = kind.kind ?? "NORMAL";
    if (itemKind === "SPECIAL" && !dto.specialProductId) {
      throw new BadRequestException("SPECIAL menu needs a special product");
    }
    if (itemKind === "MIX" && (!dto.specialProductId || !dto.mixSpecialPlates || !dto.recipeId)) {
      throw new BadRequestException(
        "MIX combo needs store recipe + special pot + plates per serving"
      );
    }
    if (itemKind === "NORMAL" && !dto.recipeId) {
      // allow recipe-less for rare cases; keep prior behaviour
    }
    return this.prisma.menuItem.create({
      data: {
        name: dto.name,
        category: dto.category,
        kitchenStation: dto.kitchenStation ?? "COOKING",
        kind: itemKind,
        sellUnit: dto.sellUnit,
        sellingPrice: dto.sellingPrice,
        listPortionQty: dto.listPortionQty != null && dto.listPortionQty > 0 ? dto.listPortionQty : 1,
        minQty: qty.minQty ?? 0,
        maxQty: qty.maxQty === undefined ? undefined : qty.maxQty,
        qtyStep: qty.qtyStep === undefined ? undefined : qty.qtyStep,
        allowCustomQty: qty.allowCustomQty ?? true,
        recipeId: dto.recipeId || null,
        specialProductId: dto.specialProductId || null,
        mixSpecialPlates: dto.mixSpecialPlates ?? null,
      },
    });
  }

  async update(id: string, dto: UpdateMenuItemDto) {
    try {
      const qty = this.qtyFields(dto);
      const kind = this.kindFields(dto);
      return await this.prisma.menuItem.update({
        where: { id },
        data: {
          ...(dto.name != null ? { name: dto.name } : {}),
          ...(dto.category !== undefined ? { category: dto.category } : {}),
          ...(dto.kitchenStation != null ? { kitchenStation: dto.kitchenStation } : {}),
          ...(kind.kind != null ? { kind: kind.kind } : {}),
          ...(dto.sellUnit != null ? { sellUnit: dto.sellUnit } : {}),
          ...(dto.sellingPrice != null
            ? { sellingPrice: dto.sellingPrice }
            : {}),
          ...(dto.listPortionQty != null && dto.listPortionQty > 0
            ? { listPortionQty: dto.listPortionQty }
            : {}),
          ...(qty.minQty !== undefined ? { minQty: qty.minQty } : {}),
          ...(qty.maxQty !== undefined ? { maxQty: qty.maxQty } : {}),
          ...(qty.qtyStep !== undefined ? { qtyStep: qty.qtyStep } : {}),
          ...(qty.allowCustomQty !== undefined
            ? { allowCustomQty: qty.allowCustomQty }
            : {}),
          ...(dto.recipeId !== undefined
            ? { recipeId: dto.recipeId || null }
            : {}),
          ...(dto.specialProductId !== undefined
            ? { specialProductId: dto.specialProductId || null }
            : {}),
          ...(dto.mixSpecialPlates !== undefined
            ? { mixSpecialPlates: dto.mixSpecialPlates }
            : {}),
          ...(dto.active != null ? { active: dto.active } : {}),
        },
      });
    } catch (e) {
      if (e instanceof BadRequestException) throw e;
      throw new NotFoundException("Menu item not found");
    }
  }

  async remove(id: string) {
    try {
      return await this.prisma.menuItem.update({
        where: { id },
        data: { active: false },
      });
    } catch {
      throw new NotFoundException("Menu item not found");
    }
  }

  /** Replace active modifiers for a menu item (manage UI). */
  async setModifiers(
    menuItemId: string,
    rows: { name: string; priceDelta: number; sortOrder?: number }[]
  ) {
    const item = await this.prisma.menuItem.findUnique({ where: { id: menuItemId } });
    if (!item || !item.active) throw new NotFoundException("Menu item not found");
    const cleaned = rows
      .map((r, i) => ({
        name: (r.name || "").trim(),
        priceDelta: Math.round(Number(r.priceDelta) * 100) / 100,
        sortOrder: r.sortOrder ?? i,
      }))
      .filter((r) => r.name);
    await this.prisma.$transaction(async (tx) => {
      await tx.menuModifier.updateMany({
        where: { menuItemId },
        data: { active: false },
      });
      for (const r of cleaned) {
        await tx.menuModifier.create({
          data: {
            menuItemId,
            name: r.name,
            priceDelta: r.priceDelta,
            sortOrder: r.sortOrder,
            active: true,
          },
        });
      }
    });
    return this.prisma.menuModifier.findMany({
      where: { menuItemId, active: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
  }
}
