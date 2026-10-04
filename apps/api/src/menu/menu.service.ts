import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CostingService } from "../common/costing.service";
import { toNumber } from "../common/units";
import { CreateMenuItemDto, UpdateMenuItemDto } from "./dto";

@Injectable()
export class MenuService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly costing: CostingService
  ) {}

  async list(showCost = true) {
    const items = await this.prisma.menuItem.findMany({
      where: { active: true },
      include: { recipe: true },
      orderBy: { name: "asc" },
    });

    if (!showCost) {
      return items.map((m) => ({
        id: m.id,
        name: m.name,
        category: m.category,
        kitchenStation: m.kitchenStation,
        sellUnit: m.sellUnit,
        sellingPrice: toNumber(m.sellingPrice),
      }));
    }

    const out = [];
    for (const m of items) {
      let cost = 0;
      if (m.recipeId) {
        const c = await this.costing.recipeUnitCost(m.recipeId);
        cost = c.costPerBase;
      }
      const sell = toNumber(m.sellingPrice);
      out.push({
        id: m.id,
        name: m.name,
        category: m.category,
        kitchenStation: m.kitchenStation,
        sellUnit: m.sellUnit,
        sellingPrice: sell,
        costPerUnit: cost,
        profitPerUnit: sell - cost,
        recipeId: m.recipeId,
      });
    }
    return out;
  }

  create(dto: CreateMenuItemDto) {
    return this.prisma.menuItem.create({
      data: {
        name: dto.name,
        category: dto.category,
        kitchenStation: dto.kitchenStation ?? "COOKING",
        sellUnit: dto.sellUnit,
        sellingPrice: dto.sellingPrice,
        recipeId: dto.recipeId,
      },
    });
  }

  async update(id: string, dto: UpdateMenuItemDto) {
    try {
      return await this.prisma.menuItem.update({
        where: { id },
        data: {
          ...(dto.name != null ? { name: dto.name } : {}),
          ...(dto.category !== undefined ? { category: dto.category } : {}),
          ...(dto.kitchenStation != null ? { kitchenStation: dto.kitchenStation } : {}),
          ...(dto.sellUnit != null ? { sellUnit: dto.sellUnit } : {}),
          ...(dto.sellingPrice != null
            ? { sellingPrice: dto.sellingPrice }
            : {}),
          ...(dto.recipeId !== undefined
            ? { recipeId: dto.recipeId || null }
            : {}),
          ...(dto.active != null ? { active: dto.active } : {}),
        },
      });
    } catch {
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
}
