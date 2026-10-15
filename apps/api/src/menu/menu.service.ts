import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CostingService } from "../common/costing.service";
import { menuQtyDto } from "../common/menu-qty";
import { toNumber } from "../common/units";
import { CreateMenuItemDto, MenuDealPartInputDto, UpdateMenuItemDto } from "./dto";

type NormalizedPart = {
  kind: "STORE" | "SPECIAL";
  recipeId: string | null;
  specialProductId: string | null;
  quantity: number;
  sortOrder: number;
  label: string | null;
};

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

  /** Normalize MIX parts from `parts[]` or legacy single recipe + pot fields. */
  private normalizeDealParts(
    dto: CreateMenuItemDto | UpdateMenuItemDto,
    requireParts: boolean
  ): NormalizedPart[] | undefined {
    if (dto.parts !== undefined) {
      if (!Array.isArray(dto.parts) || dto.parts.length === 0) {
        throw new BadRequestException("Deal needs at least one store recipe part");
      }
      return this.validateParts(dto.parts);
    }
    if (!requireParts) return undefined;

    // Legacy create path: recipeId (+ optional special)
    const recipeId = "recipeId" in dto ? dto.recipeId : undefined;
    const specialProductId = "specialProductId" in dto ? dto.specialProductId : undefined;
    const mixSpecialPlates = "mixSpecialPlates" in dto ? dto.mixSpecialPlates : undefined;
    if (!recipeId) {
      throw new BadRequestException("Deal needs at least one store recipe");
    }
    const parts: NormalizedPart[] = [
      {
        kind: "STORE",
        recipeId,
        specialProductId: null,
        quantity: 1,
        sortOrder: 0,
        label: null,
      },
    ];
    if (specialProductId) {
      const plates = mixSpecialPlates != null && mixSpecialPlates > 0 ? mixSpecialPlates : 1;
      parts.push({
        kind: "SPECIAL",
        recipeId: null,
        specialProductId,
        quantity: plates,
        sortOrder: 1,
        label: null,
      });
    }
    return parts;
  }

  private validateParts(parts: MenuDealPartInputDto[]): NormalizedPart[] {
    const out: NormalizedPart[] = [];
    let i = 0;
    for (const p of parts) {
      const qty = Number(p.quantity);
      if (!(qty > 0)) throw new BadRequestException("Each deal part needs quantity > 0");
      if (p.kind === "STORE") {
        if (!p.recipeId) throw new BadRequestException("Store deal part needs a recipe");
        out.push({
          kind: "STORE",
          recipeId: p.recipeId,
          specialProductId: null,
          quantity: qty,
          sortOrder: p.sortOrder ?? i,
          label: p.label?.trim() || null,
        });
      } else if (p.kind === "SPECIAL") {
        if (!p.specialProductId) throw new BadRequestException("Cooked deal part needs a pot");
        out.push({
          kind: "SPECIAL",
          recipeId: null,
          specialProductId: p.specialProductId,
          quantity: qty,
          sortOrder: p.sortOrder ?? i,
          label: p.label?.trim() || null,
        });
      } else {
        throw new BadRequestException("Invalid deal part kind");
      }
      i += 1;
    }
    if (!out.some((p) => p.kind === "STORE")) {
      throw new BadRequestException("Deal needs at least one store recipe part");
    }
    return out;
  }

  private legacyFromParts(parts: NormalizedPart[]) {
    const firstStore = parts.find((p) => p.kind === "STORE");
    const firstSpecial = parts.find((p) => p.kind === "SPECIAL");
    return {
      recipeId: firstStore?.recipeId ?? null,
      specialProductId: firstSpecial?.specialProductId ?? null,
      mixSpecialPlates: firstSpecial ? firstSpecial.quantity : null,
    };
  }

  private async replaceDealParts(menuItemId: string, parts: NormalizedPart[]) {
    for (const p of parts) {
      if (p.kind === "STORE" && p.recipeId) {
        const r = await this.prisma.recipe.findUnique({ where: { id: p.recipeId } });
        if (!r) throw new BadRequestException(`Recipe not found: ${p.recipeId}`);
      }
      if (p.kind === "SPECIAL" && p.specialProductId) {
        const s = await this.prisma.specialProduct.findUnique({ where: { id: p.specialProductId } });
        if (!s) throw new BadRequestException(`Special pot not found: ${p.specialProductId}`);
      }
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.menuDealPart.deleteMany({ where: { menuItemId } });
      for (const p of parts) {
        await tx.menuDealPart.create({
          data: {
            menuItemId,
            kind: p.kind,
            recipeId: p.recipeId,
            specialProductId: p.specialProductId,
            quantity: p.quantity,
            sortOrder: p.sortOrder,
            label: p.label,
          },
        });
      }
    });
  }

  private mapPart(p: {
    id: string;
    kind: string;
    recipeId: string | null;
    specialProductId: string | null;
    quantity: Parameters<typeof toNumber>[0];
    sortOrder: number;
    label: string | null;
    recipe?: { id: string; name: string; category: string; baseUnit: string } | null;
    specialProduct?: {
      id: string;
      name: string;
      platePrice: Parameters<typeof toNumber>[0];
      plateGrams: Parameters<typeof toNumber>[0];
      category: string;
    } | null;
  }) {
    return {
      id: p.id,
      kind: p.kind,
      recipeId: p.recipeId,
      specialProductId: p.specialProductId,
      quantity: toNumber(p.quantity),
      sortOrder: p.sortOrder,
      label: p.label,
      recipe: p.recipe
        ? {
            id: p.recipe.id,
            name: p.recipe.name,
            category: p.recipe.category,
            baseUnit: p.recipe.baseUnit,
          }
        : null,
      specialProduct: p.specialProduct
        ? {
            id: p.specialProduct.id,
            name: p.specialProduct.name,
            category: p.specialProduct.category,
            platePrice: toNumber(p.specialProduct.platePrice),
            plateGrams: toNumber(p.specialProduct.plateGrams),
          }
        : null,
    };
  }

  async list(showCost = true) {
    const items = await this.prisma.menuItem.findMany({
      where: { active: true },
      include: {
        recipe: true,
        dealParts: {
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          include: {
            recipe: { select: { id: true, name: true, category: true, baseUnit: true } },
            specialProduct: {
              select: { id: true, name: true, category: true, platePrice: true, plateGrams: true },
            },
          },
        },
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
            halfPlatePrice: true,
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
      let parts = m.dealParts.map((p) => this.mapPart(p));
      // Legacy MIX without backfill yet: synthesize from denormalized fields.
      if (m.kind === "MIX" && parts.length === 0) {
        const synth: ReturnType<MenuService["mapPart"]>[] = [];
        if (m.recipeId && m.recipe) {
          synth.push(
            this.mapPart({
              id: `legacy-store-${m.id}`,
              kind: "STORE",
              recipeId: m.recipeId,
              specialProductId: null,
              quantity: 1,
              sortOrder: 0,
              label: null,
              recipe: m.recipe,
              specialProduct: null,
            })
          );
        }
        if (m.specialProductId && m.specialProduct) {
          synth.push(
            this.mapPart({
              id: `legacy-special-${m.id}`,
              kind: "SPECIAL",
              recipeId: null,
              specialProductId: m.specialProductId,
              quantity: toNumber(m.mixSpecialPlates) || 1,
              sortOrder: 1,
              label: null,
              recipe: null,
              specialProduct: m.specialProduct,
            })
          );
        }
        parts = synth;
      }
      return {
        id: m.id,
        name: m.name,
        category: m.category,
        kitchenStation: m.kitchenStation,
        kind: m.kind,
        sellUnit: m.sellUnit,
        sellingPrice,
        listPortionQty,
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
              halfPlatePrice:
                m.specialProduct.halfPlatePrice != null
                  ? toNumber(m.specialProduct.halfPlatePrice)
                  : null,
              plateGrams: toNumber(m.specialProduct.plateGrams),
            }
          : null,
        parts,
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
      const base = mapBase(m);
      let cost = 0;
      if (m.kind === "MIX" && base.parts.length) {
        for (const p of base.parts) {
          if (p.kind === "STORE" && p.recipeId) {
            try {
              const c = await this.costing.recipeUnitCost(p.recipeId);
              cost += c.costPerBase * p.quantity;
            } catch {
              /* skip */
            }
          } else if (p.kind === "SPECIAL" && p.specialProduct) {
            const spFull = await this.prisma.specialProduct.findUnique({
              where: { id: p.specialProduct.id },
              select: { cookRecipeId: true, plateGrams: true },
            });
            if (spFull?.cookRecipeId) {
              try {
                const plateGrams = toNumber(spFull.plateGrams) || 1;
                const grams = p.quantity * plateGrams;
                const { costPerBase, recipe } = await this.costing.recipeUnitCost(spFull.cookRecipeId);
                cost +=
                  costPerBase *
                  this.costing.cookedGramsToRecipeQty({
                    baseUnit: recipe.baseUnit,
                    cookedGrams: grams,
                    plateGrams,
                  });
              } catch {
                /* skip */
              }
            }
          }
        }
      } else {
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
      }
      out.push({
        ...base,
        costPerUnit: Math.round(cost * 100) / 100,
      });
    }
    return out;
  }

  async create(dto: CreateMenuItemDto) {
    const qty = this.qtyFields(dto);
    const itemKind = dto.kind ?? "NORMAL";
    if (itemKind === "SPECIAL" && !dto.specialProductId) {
      throw new BadRequestException("SPECIAL menu needs a special product");
    }

    let parts: NormalizedPart[] | undefined;
    let legacy = {
      recipeId: dto.recipeId || null,
      specialProductId: dto.specialProductId || null,
      mixSpecialPlates: dto.mixSpecialPlates ?? null,
    };

    if (itemKind === "MIX") {
      parts = this.normalizeDealParts(dto, true)!;
      legacy = this.legacyFromParts(parts);
    }

    const created = await this.prisma.menuItem.create({
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
        recipeId: legacy.recipeId,
        specialProductId: legacy.specialProductId,
        mixSpecialPlates: legacy.mixSpecialPlates,
      },
    });

    if (parts) {
      await this.replaceDealParts(created.id, parts);
    }
    return created;
  }

  async update(id: string, dto: UpdateMenuItemDto) {
    try {
      const existing = await this.prisma.menuItem.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException("Menu item not found");

      const qty = this.qtyFields(dto);
      const nextKind = dto.kind ?? existing.kind;

      let parts: NormalizedPart[] | undefined;
      let legacyPatch: {
        recipeId?: string | null;
        specialProductId?: string | null;
        mixSpecialPlates?: number | null;
      } = {};

      if (nextKind === "MIX") {
        if (dto.parts !== undefined) {
          parts = this.normalizeDealParts(dto, true)!;
          legacyPatch = this.legacyFromParts(parts);
        } else if (
          dto.recipeId !== undefined ||
          dto.specialProductId !== undefined ||
          dto.mixSpecialPlates !== undefined
        ) {
          // Legacy field patch without parts[] — rebuild from merged legacy fields.
          const recipeId =
            dto.recipeId !== undefined ? dto.recipeId : existing.recipeId;
          const specialProductId =
            dto.specialProductId !== undefined ? dto.specialProductId : existing.specialProductId;
          const mixSpecialPlates =
            dto.mixSpecialPlates !== undefined
              ? dto.mixSpecialPlates
              : existing.mixSpecialPlates != null
                ? toNumber(existing.mixSpecialPlates)
                : null;
          if (!recipeId) {
            throw new BadRequestException("Deal needs at least one store recipe");
          }
          parts = this.normalizeDealParts(
            {
              recipeId,
              specialProductId: specialProductId || undefined,
              mixSpecialPlates: mixSpecialPlates || undefined,
              parts: undefined,
            } as UpdateMenuItemDto,
            true
          )!;
          legacyPatch = this.legacyFromParts(parts);
        }
      } else {
        if (dto.recipeId !== undefined) legacyPatch.recipeId = dto.recipeId || null;
        if (dto.specialProductId !== undefined) {
          legacyPatch.specialProductId = dto.specialProductId || null;
        }
        if (dto.mixSpecialPlates !== undefined) {
          legacyPatch.mixSpecialPlates = dto.mixSpecialPlates;
        }
      }

      const updated = await this.prisma.menuItem.update({
        where: { id },
        data: {
          ...(dto.name != null ? { name: dto.name } : {}),
          ...(dto.category !== undefined ? { category: dto.category } : {}),
          ...(dto.kitchenStation != null ? { kitchenStation: dto.kitchenStation } : {}),
          ...(dto.kind != null ? { kind: dto.kind } : {}),
          ...(dto.sellUnit != null ? { sellUnit: dto.sellUnit } : {}),
          ...(dto.sellingPrice != null ? { sellingPrice: dto.sellingPrice } : {}),
          ...(dto.listPortionQty != null && dto.listPortionQty > 0
            ? { listPortionQty: dto.listPortionQty }
            : {}),
          ...(qty.minQty !== undefined ? { minQty: qty.minQty } : {}),
          ...(qty.maxQty !== undefined ? { maxQty: qty.maxQty } : {}),
          ...(qty.qtyStep !== undefined ? { qtyStep: qty.qtyStep } : {}),
          ...(qty.allowCustomQty !== undefined ? { allowCustomQty: qty.allowCustomQty } : {}),
          ...(legacyPatch.recipeId !== undefined ? { recipeId: legacyPatch.recipeId } : {}),
          ...(legacyPatch.specialProductId !== undefined
            ? { specialProductId: legacyPatch.specialProductId }
            : {}),
          ...(legacyPatch.mixSpecialPlates !== undefined
            ? { mixSpecialPlates: legacyPatch.mixSpecialPlates }
            : {}),
          ...(dto.active != null ? { active: dto.active } : {}),
        },
      });

      if (parts) {
        await this.replaceDealParts(id, parts);
      } else if (nextKind !== "MIX" && dto.kind === "NORMAL") {
        // Switching away from MIX: drop deal parts (menu row kept).
        await this.prisma.menuDealPart.deleteMany({ where: { menuItemId: id } });
      }

      return updated;
    } catch (e) {
      if (e instanceof BadRequestException || e instanceof NotFoundException) throw e;
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
