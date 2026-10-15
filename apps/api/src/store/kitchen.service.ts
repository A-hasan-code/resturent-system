import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { SettingsService } from "../system/settings.service";
import { toNumber } from "../common/units";
import { businessDateOf, businessQueryWindow } from "../common/business-day";
import { AuthUser } from "../common/decorators";
import { applySaleRestoreNet } from "./store.service";
import {
  CreateKitchenStationDto,
  KitchenReturnDto,
  KitchenTransferDto,
  SaveKitchenDayUseDto,
  UpdateKitchenStationDto,
} from "./dto";
import { renderKitchenClosePdf } from "./kitchen-pdf";

const money2 = (n: number) => Math.round(n * 100) / 100;
const qty3 = (n: number) => Math.round(n * 1000) / 1000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const DEFAULT_STATIONS = [
  { code: "BEVERAGES", name: "Beverages", sortOrder: 1 },
  { code: "COOKING", name: "Cooking", sortOrder: 2 },
  { code: "BBQ", name: "BBQ", sortOrder: 3 },
] as const;

function slugStationCode(name: string): string {
  const raw = name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  if (!raw || !/^[A-Z]/.test(raw)) {
    throw new BadRequestException("Station name must start with a letter");
  }
  return raw;
}

@Injectable()
export class KitchenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService
  ) {}

  private async ensureDefaultStations() {
    const count = await this.prisma.kitchenStationDef.count();
    if (count > 0) return;
    for (const s of DEFAULT_STATIONS) {
      await this.prisma.kitchenStationDef.upsert({
        where: { code: s.code },
        create: {
          code: s.code,
          name: s.name,
          sortOrder: s.sortOrder,
          system: true,
          active: true,
        },
        update: {},
      });
    }
  }

  async stations(opts?: { all?: boolean }) {
    await this.ensureDefaultStations();
    const rows = await this.prisma.kitchenStationDef.findMany({
      where: opts?.all ? undefined : { active: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
    return rows.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      sortOrder: r.sortOrder,
      active: r.active,
      system: r.system,
    }));
  }

  private async resolveStation(raw?: string | null): Promise<string> {
    await this.ensureDefaultStations();
    const code = (raw || "COOKING").trim().toUpperCase();
    const row = await this.prisma.kitchenStationDef.findUnique({ where: { code } });
    if (!row || !row.active) {
      throw new BadRequestException(`Unknown or inactive kitchen station: ${code}`);
    }
    return row.code;
  }

  async createStation(dto: CreateKitchenStationDto) {
    await this.ensureDefaultStations();
    const name = dto.name.trim().slice(0, 60);
    if (!name) throw new BadRequestException("Station name required");
    const code = (dto.code?.trim().toUpperCase() || slugStationCode(name)).slice(0, 40);
    const exists = await this.prisma.kitchenStationDef.findUnique({ where: { code } });
    if (exists) throw new BadRequestException(`Station code ${code} already exists`);
    const maxSort = await this.prisma.kitchenStationDef.aggregate({ _max: { sortOrder: true } });
    const row = await this.prisma.kitchenStationDef.create({
      data: {
        code,
        name,
        sortOrder: (maxSort._max.sortOrder ?? 0) + 1,
        system: false,
        active: true,
      },
    });
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      sortOrder: row.sortOrder,
      active: row.active,
      system: row.system,
    };
  }

  async updateStation(id: string, dto: UpdateKitchenStationDto) {
    const row = await this.prisma.kitchenStationDef.findUnique({ where: { id } });
    if (!row) throw new NotFoundException("Station not found");
    const updated = await this.prisma.kitchenStationDef.update({
      where: { id },
      data: {
        ...(dto.name != null ? { name: dto.name.trim().slice(0, 60) } : {}),
        ...(dto.sortOrder != null ? { sortOrder: Math.max(0, Math.floor(dto.sortOrder)) } : {}),
        ...(dto.active != null ? { active: !!dto.active } : {}),
      },
    });
    return {
      id: updated.id,
      code: updated.code,
      name: updated.name,
      sortOrder: updated.sortOrder,
      active: updated.active,
      system: updated.system,
    };
  }

  async deleteStation(id: string) {
    const row = await this.prisma.kitchenStationDef.findUnique({ where: { id } });
    if (!row) throw new NotFoundException("Station not found");
    if (row.system) {
      throw new BadRequestException("Default stations cannot be deleted — deactivate instead");
    }
    const [stock, menu, special, close] = await Promise.all([
      this.prisma.kitchenStock.count({
        where: { station: row.code, quantityOnHand: { not: 0 } },
      }),
      this.prisma.menuItem.count({ where: { kitchenStation: row.code, active: true } }),
      this.prisma.specialProduct.count({ where: { kitchenStation: row.code, active: true } }),
      this.prisma.kitchenDayClose.count({ where: { station: row.code } }),
    ]);
    if (stock > 0) {
      throw new BadRequestException("Station still has kitchen stock — transfer out or zero first");
    }
    if (menu > 0 || special > 0) {
      throw new BadRequestException("Station is used on menu / specials — reassign first");
    }
    if (close > 0) {
      await this.prisma.kitchenStationDef.update({
        where: { id },
        data: { active: false },
      });
      return { ok: true, deactivated: true };
    }
    await this.prisma.kitchenStationDef.delete({ where: { id } });
    return { ok: true, deleted: true };
  }

  private async clock(dateStr?: string) {
    const start = await this.settings.dayStart();
    const now = new Date();
    const today = businessDateOf(now, start.h, start.m);
    const businessDate = dateStr?.trim() || today;
    if (!DATE_RE.test(businessDate)) {
      throw new BadRequestException("Invalid business date");
    }
    const window = businessQueryWindow(businessDate, start.h, start.m);
    return {
      ...start,
      businessDate,
      today,
      isToday: businessDate === today,
      from: window.from,
      to: window.to,
      gte: window.gte,
      lt: window.lt,
    };
  }

  async stockList(stationRaw?: string) {
    const station = stationRaw ? await this.resolveStation(stationRaw) : null;
    const [items, kitchen] = await Promise.all([
      this.prisma.storeItem.findMany({
        where: { active: true },
        include: { category: true },
        orderBy: [{ category: { sortOrder: "asc" } }, { name: "asc" }],
      }),
      this.prisma.kitchenStock.findMany({
        where: station ? { station } : undefined,
      }),
    ]);

    if (station) {
      const byId = new Map(kitchen.map((k) => [k.storeItemId, toNumber(k.quantityOnHand)]));
      return items.map((i) => ({
        id: i.id,
        name: i.name,
        category: i.category.name,
        unit: i.unit,
        station,
        storeOnHand: toNumber(i.quantityOnHand),
        kitchenOnHand: qty3(byId.get(i.id) ?? 0),
        ratePerUnit: toNumber(i.ratePerUnit),
      }));
    }

    return items.map((i) => {
      const byStation: Record<string, number> = {
        BEVERAGES: 0,
        COOKING: 0,
        BBQ: 0,
      };
      for (const k of kitchen) {
        if (k.storeItemId !== i.id) continue;
        byStation[k.station] = qty3(toNumber(k.quantityOnHand));
      }
      const kitchenOnHand = qty3(
        byStation.BEVERAGES + byStation.COOKING + byStation.BBQ
      );
      return {
        id: i.id,
        name: i.name,
        category: i.category.name,
        unit: i.unit,
        storeOnHand: toNumber(i.quantityOnHand),
        kitchenOnHand,
        byStation,
        ratePerUnit: toNumber(i.ratePerUnit),
      };
    });
  }

  /** Move qty from main store → one kitchen station. */
  async transfer(dto: KitchenTransferDto) {
    const station = await this.resolveStation(dto.station);
    const note = (dto.note || `Kitchen transfer · ${station}`).trim().slice(0, 120);
    return this.prisma.$transaction(async (tx) => {
      const results: {
        storeItemId: string;
        station: string;
        quantity: number;
        kitchenOnHand: number;
        storeOnHand: number;
      }[] = [];
      for (const line of dto.lines) {
        const qty = qty3(line.quantity);
        if (!(qty > 0)) continue;
        const item = await tx.storeItem.findUnique({ where: { id: line.storeItemId } });
        if (!item || !item.active) {
          throw new BadRequestException("Item is not in inventory");
        }
        const storeOnHand = toNumber(item.quantityOnHand);
        if (qty - storeOnHand > 0.0001) {
          throw new BadRequestException(
            `Not enough ${item.name} in store. Available: ${storeOnHand} ${item.unit}`
          );
        }
        const updatedStore = await tx.storeItem.update({
          where: { id: item.id },
          data: { quantityOnHand: { decrement: qty } },
        });
        const kitchen = await tx.kitchenStock.upsert({
          where: { storeItemId_station: { storeItemId: item.id, station } },
          create: { storeItemId: item.id, station, quantityOnHand: qty },
          update: { quantityOnHand: { increment: qty } },
        });
        await tx.stockMovement.create({
          data: {
            storeItemId: item.id,
            type: "KITCHEN_TRANSFER",
            quantity: -qty,
            ratePerUnit: item.ratePerUnit,
            note,
            kitchenStation: station,
          },
        });
        results.push({
          storeItemId: item.id,
          station,
          quantity: qty,
          kitchenOnHand: qty3(toNumber(kitchen.quantityOnHand)),
          storeOnHand: qty3(toNumber(updatedStore.quantityOnHand)),
        });
      }
      if (!results.length) throw new BadRequestException("Add at least one transfer line");
      return { ok: true, station, lines: results };
    });
  }

  /** Return unused station stock to the main store. */
  async returnToStore(dto: KitchenReturnDto) {
    const station = await this.resolveStation(dto.station);
    const qty = qty3(dto.quantity);
    const note = (dto.note || `Kitchen return · ${station}`).trim().slice(0, 120);
    return this.prisma.$transaction(async (tx) => {
      const item = await tx.storeItem.findUnique({ where: { id: dto.storeItemId } });
      if (!item || !item.active) throw new BadRequestException("Item is not in inventory");
      const kitchen = await tx.kitchenStock.findUnique({
        where: { storeItemId_station: { storeItemId: item.id, station } },
      });
      const kitchenOnHand = kitchen ? toNumber(kitchen.quantityOnHand) : 0;
      if (qty - kitchenOnHand > 0.0001) {
        throw new BadRequestException(
          `Not enough ${item.name} at ${station}. Available: ${kitchenOnHand} ${item.unit}`
        );
      }
      await tx.kitchenStock.update({
        where: { storeItemId_station: { storeItemId: item.id, station } },
        data: { quantityOnHand: { decrement: qty } },
      });
      const updatedStore = await tx.storeItem.update({
        where: { id: item.id },
        data: { quantityOnHand: { increment: qty } },
      });
      await tx.stockMovement.create({
        data: {
          storeItemId: item.id,
          type: "KITCHEN_RETURN",
          quantity: qty,
          ratePerUnit: item.ratePerUnit,
          note,
          kitchenStation: station,
        },
      });
      return {
        storeItemId: item.id,
        station,
        quantity: qty,
        kitchenOnHand: qty3(kitchenOnHand - qty),
        storeOnHand: qty3(toNumber(updatedStore.quantityOnHand)),
      };
    });
  }

  async dayUseHistory(limit = 90, stationRaw?: string) {
    const take = Math.min(365, Math.max(1, limit || 90));
    const station = stationRaw ? await this.resolveStation(stationRaw) : undefined;
    const rows = await this.prisma.kitchenDayClose.findMany({
      take,
      where: station ? { station } : undefined,
      orderBy: [{ businessDate: "desc" }, { station: "asc" }],
      include: {
        closedBy: { select: { name: true } },
        _count: { select: { lines: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      businessDate: r.businessDate,
      station: r.station,
      stockUsedValue: money2(toNumber(r.stockUsedValue)),
      transferredValue: money2(toNumber(r.transferredValue)),
      sales: money2(toNumber(r.sales)),
      profit: money2(toNumber(r.profit)),
      closedByName: r.closedBy?.name ?? null,
      closedAt: r.createdAt,
      editedAt: r.editedAt,
      editedByName: r.editedByName,
      editReason: r.editReason,
      lineCount: r._count.lines,
    }));
  }

  async dayUseSheet(dateStr?: string, user?: AuthUser, stationRaw?: string) {
    const station = await this.resolveStation(stationRaw || "COOKING");
    const clock = await this.clock(dateStr);
    const isAdmin = user?.roleCode === "ADMIN";

    const [items, kitchen, salesMoves, transferMoves, close, paid] = await Promise.all([
      this.prisma.storeItem.findMany({
        where: { active: true },
        include: { category: true },
        orderBy: [{ category: { sortOrder: "asc" } }, { name: "asc" }],
      }),
      this.prisma.kitchenStock.findMany({ where: { station } }),
      this.prisma.stockMovement.findMany({
        where: {
          type: { in: ["SALE", "RESTORE", "COOK"] },
          kitchenStation: station,
          createdAt: { gte: clock.gte, lt: clock.lt },
        },
        select: { storeItemId: true, quantity: true, type: true },
      }),
      this.prisma.stockMovement.findMany({
        where: {
          type: { in: ["KITCHEN_TRANSFER", "KITCHEN_RETURN"] },
          kitchenStation: station,
          createdAt: { gte: clock.gte, lt: clock.lt },
        },
        select: { storeItemId: true, quantity: true, type: true },
      }),
      this.prisma.kitchenDayClose.findUnique({
        where: {
          businessDate_station: { businessDate: clock.businessDate, station },
        },
        include: {
          lines: {
            include: {
              storeItem: { include: { category: true } },
            },
          },
          closedBy: { select: { name: true } },
        },
      }),
      this.prisma.order.aggregate({
        where: {
          paymentStatus: "PAID",
          status: { not: "CANCELLED" },
          createdAt: { gte: clock.gte, lt: clock.lt },
        },
        _sum: { total: true },
      }),
    ]);

    // Past dates without a saved close still load (live movements for that day) so
    // staff/admin can pick a date from the calendar and enter or edit closing.

    const kitchenById = new Map(kitchen.map((k) => [k.storeItemId, toNumber(k.quantityOnHand)]));

    const auto = new Map<string, number>();
    for (const m of salesMoves) {
      if (m.type === "COOK") {
        const abs = Math.abs(toNumber(m.quantity));
        auto.set(m.storeItemId, (auto.get(m.storeItemId) ?? 0) + abs);
      } else {
        applySaleRestoreNet(auto, m.type, m.storeItemId, toNumber(m.quantity));
      }
    }
    for (const [id, qty] of [...auto.entries()]) {
      auto.set(id, Math.max(0, qty3(qty)));
    }

    const transferred = new Map<string, number>();
    for (const m of transferMoves) {
      const abs = Math.abs(toNumber(m.quantity));
      if (m.type === "KITCHEN_TRANSFER") {
        transferred.set(m.storeItemId, (transferred.get(m.storeItemId) ?? 0) + abs);
      } else if (m.type === "KITCHEN_RETURN") {
        transferred.set(m.storeItemId, (transferred.get(m.storeItemId) ?? 0) - abs);
      }
    }
    for (const [id, qty] of [...transferred.entries()]) {
      transferred.set(id, qty3(qty));
    }

    const saved = new Map(close?.lines.map((l) => [l.storeItemId, l]) ?? []);

    type SheetRow = {
      id: string;
      name: string;
      category: string;
      unit: string;
      kitchenOnHand: number;
      transferredQty: number;
      autoQty: number;
      /** Declared used (defaults to recipe autoQty). */
      usedQty: number;
      extraQty: number;
      /** Counted leftover at station (editable; defaults to on-hand). */
      leftoverQty: number;
      variance: number;
      reason: string;
      rate: number;
      value: number;
    };

    let rows: SheetRow[];
    if (close && !clock.isToday) {
      // Past saved closing: exact snapshot — never mix with today's live kitchen stock.
      rows = close.lines
        .map((line) => {
          const item = line.storeItem;
          const autoQty = qty3(toNumber(line.autoQty));
          const transferredQty = qty3(toNumber(line.transferredQty));
          const extraQty = qty3(toNumber(line.extraQty));
          const kitchenOnHand = qty3(toNumber(line.kitchenOnHand));
          const savedUsed = qty3(toNumber((line as { usedQty?: unknown }).usedQty));
          const usedQty = savedUsed > 0 ? savedUsed : autoQty;
          const totalUsed = qty3(usedQty + extraQty);
          const rate = toNumber(line.ratePerUnit);
          return {
            id: item.id,
            name: item.name,
            category: item.category.name,
            unit: item.unit,
            kitchenOnHand,
            transferredQty,
            autoQty,
            usedQty,
            extraQty,
            leftoverQty: kitchenOnHand,
            variance: qty3(transferredQty - totalUsed),
            reason: line.reason ?? "",
            rate,
            value: money2(toNumber(line.amount)),
          };
        })
        .sort(
          (a, b) =>
            a.category.localeCompare(b.category) || a.name.localeCompare(b.name)
        );
    } else if (!clock.isToday) {
      // Past day, not yet saved: only that day's transfers + recipe use (no live on-hand).
      rows = items
        .map((item) => {
          const autoQty = qty3(auto.get(item.id) ?? 0);
          const transferredQty = qty3(transferred.get(item.id) ?? 0);
          const rate = toNumber(item.ratePerUnit);
          const totalUsed = autoQty;
          return {
            id: item.id,
            name: item.name,
            category: item.category.name,
            unit: item.unit,
            kitchenOnHand: 0,
            transferredQty,
            autoQty,
            usedQty: autoQty,
            extraQty: 0,
            leftoverQty: 0,
            variance: qty3(transferredQty - totalUsed),
            reason: "",
            rate,
            value: money2(totalUsed * rate),
          };
        })
        .filter(
          (r) =>
            Math.abs(r.transferredQty) > 0.0005 || Math.abs(r.autoQty) > 0.0005
        );
    } else {
      // Today: live station stock + that day's movements + any saved used/extra.
      rows = items
        .map((item) => {
          const line = saved.get(item.id);
          const autoQty = qty3(auto.get(item.id) ?? 0);
          const transferredQty = qty3(transferred.get(item.id) ?? 0);
          const extraQty = line ? qty3(toNumber(line.extraQty)) : 0;
          const rate = toNumber(item.ratePerUnit);
          const kitchenOnHand = qty3(kitchenById.get(item.id) ?? 0);
          const savedUsed = line
            ? qty3(toNumber((line as { usedQty?: unknown }).usedQty))
            : 0;
          const usedQty = line ? (savedUsed > 0 ? savedUsed : autoQty) : autoQty;
          const leftoverQty = line
            ? qty3(toNumber(line.kitchenOnHand))
            : kitchenOnHand;
          const totalUsed = qty3(usedQty + extraQty);
          const variance = qty3(transferredQty - totalUsed);
          return {
            id: item.id,
            name: item.name,
            category: item.category.name,
            unit: item.unit,
            kitchenOnHand,
            transferredQty,
            autoQty,
            usedQty,
            extraQty,
            leftoverQty,
            variance,
            reason: line?.reason ?? "",
            rate,
            value: money2(totalUsed * rate),
          };
        })
        .filter(
          (r) =>
            Math.abs(r.transferredQty) > 0.0005 ||
            Math.abs(r.autoQty) > 0.0005 ||
            Math.abs(r.kitchenOnHand) > 0.0005 ||
            Math.abs(r.extraQty) > 0.0005 ||
            Math.abs(r.usedQty) > 0.0005
        );
    }

    const stockUsedValue = close
      ? money2(toNumber(close.stockUsedValue))
      : money2(rows.reduce((s, r) => s + r.value, 0));
    const transferredValue = close
      ? money2(toNumber(close.transferredValue))
      : money2(rows.reduce((s, r) => s + r.transferredQty * r.rate, 0));
    const sales = close
      ? money2(toNumber(close.sales))
      : money2(toNumber(paid._sum.total));

    // Today: store managers + admin. Past days: admin only.
    const canEdit =
      !!user &&
      (user.permissions.includes("store.manage") || isAdmin) &&
      (clock.isToday || !!isAdmin);

    return {
      businessDate: clock.businessDate,
      station,
      stations: await this.stations(),
      today: clock.today,
      isToday: clock.isToday,
      dayStart: clock.label,
      from: clock.from.toISOString(),
      to: clock.to.toISOString(),
      saved: !!close,
      canEdit,
      isAdmin: !!isAdmin,
      closedByName: close?.closedBy?.name ?? null,
      closedAt: close?.createdAt ?? null,
      editedAt: close?.editedAt ?? null,
      editedByName: close?.editedByName ?? null,
      editReason: close?.editReason ?? null,
      sales,
      stockUsedValue,
      transferredValue,
      profit: money2(sales - stockUsedValue),
      items: rows,
    };
  }

  async saveDayUse(user: AuthUser, dto: SaveKitchenDayUseDto) {
    const station = await this.resolveStation(dto.station);
    const clock = await this.clock(dto.businessDate);
    const isAdmin = user.roleCode === "ADMIN";
    // Past-day admin edits may run after hotel close; today still requires hotel open.
    if (clock.isToday || !isAdmin) {
      await this.settings.assertHotelOpen();
    }

    if (!clock.isToday && !isAdmin) {
      throw new ForbiddenException(
        "Past kitchen closings are view-only. Only an admin can edit a past closing."
      );
    }
    if (!user.permissions.includes("store.manage") && !isAdmin) {
      throw new ForbiddenException("Not allowed to save kitchen closing");
    }

    const wanted = new Map<
      string,
      { usedQty: number; extraQty: number; leftoverQty: number | null; reason: string }
    >();
    for (const line of dto.lines ?? []) {
      const usedQty = qty3(Math.max(0, line.usedQty ?? 0));
      const extraQty = qty3(Math.max(0, line.extraQty ?? 0));
      const leftoverQty =
        line.leftoverQty == null || Number.isNaN(Number(line.leftoverQty))
          ? null
          : qty3(Math.max(0, Number(line.leftoverQty)));
      if (usedQty <= 0 && extraQty <= 0 && leftoverQty == null) continue;
      wanted.set(line.storeItemId, {
        usedQty,
        extraQty,
        leftoverQty,
        reason: (line.reason || "Wastage / spoilage").trim().slice(0, 80),
      });
    }

    await this.prisma.$transaction(async (tx) => {
      const items = await tx.storeItem.findMany({
        where: { active: true },
        include: { category: true },
      });
      const itemIds = new Set(items.map((i) => i.id));
      for (const id of wanted.keys()) {
        if (!itemIds.has(id)) throw new BadRequestException("Item is not in inventory");
      }

      const [salesMoves, transferMoves, kitchenRows] = await Promise.all([
        tx.stockMovement.findMany({
          where: {
            type: { in: ["SALE", "RESTORE", "COOK"] },
            kitchenStation: station,
            createdAt: { gte: clock.gte, lt: clock.lt },
          },
          select: { storeItemId: true, quantity: true, type: true },
        }),
        tx.stockMovement.findMany({
          where: {
            type: { in: ["KITCHEN_TRANSFER", "KITCHEN_RETURN"] },
            kitchenStation: station,
            createdAt: { gte: clock.gte, lt: clock.lt },
          },
          select: { storeItemId: true, quantity: true, type: true },
        }),
        tx.kitchenStock.findMany({ where: { station } }),
      ]);

      const auto = new Map<string, number>();
      for (const m of salesMoves) {
        if (m.type === "COOK") {
          const abs = Math.abs(toNumber(m.quantity));
          auto.set(m.storeItemId, (auto.get(m.storeItemId) ?? 0) + abs);
        } else {
          applySaleRestoreNet(auto, m.type, m.storeItemId, toNumber(m.quantity));
        }
      }
      for (const [id, qty] of [...auto.entries()]) {
        auto.set(id, Math.max(0, qty3(qty)));
      }

      const transferred = new Map<string, number>();
      for (const m of transferMoves) {
        const abs = Math.abs(toNumber(m.quantity));
        if (m.type === "KITCHEN_TRANSFER") {
          transferred.set(m.storeItemId, (transferred.get(m.storeItemId) ?? 0) + abs);
        } else {
          transferred.set(m.storeItemId, (transferred.get(m.storeItemId) ?? 0) - abs);
        }
      }

      const kitchenById = new Map(
        kitchenRows.map((k) => [k.storeItemId, toNumber(k.quantityOnHand)])
      );

      const existing = await tx.kitchenDayClose.findUnique({
        where: {
          businessDate_station: { businessDate: clock.businessDate, station },
        },
        include: { lines: true },
      });
      const previous = new Map(
        existing?.lines.map((l) => {
          const a = toNumber(l.autoQty);
          const u = toNumber((l as { usedQty?: unknown }).usedQty);
          const e = toNumber(l.extraQty);
          const declared = u > 0 ? u : a;
          return [l.storeItemId, Math.max(0, declared + e - a)] as const;
        }) ?? []
      );

      for (const item of items) {
        const autoQty = qty3(auto.get(item.id) ?? 0);
        const w = wanted.get(item.id);
        const usedQty = w ? qty3(Math.max(0, w.usedQty)) : autoQty;
        const extraQty = w?.extraQty ?? 0;
        // Beyond recipe: (used - auto) + extra column.
        const nextBeyond = qty3(Math.max(0, usedQty - autoQty) + extraQty);
        const prev = qty3(previous.get(item.id) ?? 0);
        const delta = qty3(nextBeyond - prev);
        const onHand = kitchenById.get(item.id) ?? 0;
        if (delta > 0 && delta - onHand > 0.0001) {
          throw new BadRequestException(
            `Not enough ${item.name} at ${station}. Available: ${onHand} ${item.unit}`
          );
        }
      }

      const close = existing
        ? existing
        : await tx.kitchenDayClose.create({
            data: {
              businessDate: clock.businessDate,
              station,
              stockUsedValue: 0,
              transferredValue: 0,
              sales: 0,
              profit: 0,
              closedById: user.id,
            },
          });

      if (existing) {
        await tx.stockMovement.deleteMany({
          where: {
            type: "KITCHEN_OUT",
            kitchenStation: station,
            note: { startsWith: `Kitchen day use · ${station} · ${clock.businessDate}` },
          },
        });
        await tx.kitchenDayCloseLine.deleteMany({ where: { closeId: close.id } });
      }

      let stockUsed = 0;
      let transferredValue = 0;
      for (const item of items) {
        const autoQty = qty3(auto.get(item.id) ?? 0);
        const w = wanted.get(item.id);
        const usedQty = w ? qty3(Math.max(0, w.usedQty)) : autoQty;
        const extraQty = w?.extraQty ?? 0;
        const nextBeyond = qty3(Math.max(0, usedQty - autoQty) + extraQty);
        const prev = qty3(previous.get(item.id) ?? 0);
        const delta = qty3(nextBeyond - prev);
        if (delta !== 0) {
          await tx.kitchenStock.upsert({
            where: { storeItemId_station: { storeItemId: item.id, station } },
            create: {
              storeItemId: item.id,
              station,
              quantityOnHand: Math.max(0, -delta),
            },
            update: { quantityOnHand: { increment: -delta } },
          });
          kitchenById.set(item.id, (kitchenById.get(item.id) ?? 0) - delta);
        }
        let kitchenOnHand = qty3(Math.max(0, kitchenById.get(item.id) ?? 0));
        const leftoverQty =
          w?.leftoverQty != null ? qty3(Math.max(0, w.leftoverQty)) : kitchenOnHand;
        if (Math.abs(leftoverQty - kitchenOnHand) > 0.0001) {
          await tx.kitchenStock.upsert({
            where: { storeItemId_station: { storeItemId: item.id, station } },
            create: {
              storeItemId: item.id,
              station,
              quantityOnHand: leftoverQty,
            },
            update: { quantityOnHand: leftoverQty },
          });
          kitchenById.set(item.id, leftoverQty);
          kitchenOnHand = leftoverQty;
        }
        const transferredQty = qty3(transferred.get(item.id) ?? 0);
        const rate = toNumber(item.ratePerUnit);
        const totalUsed = qty3(usedQty + extraQty);
        const amount = money2(totalUsed * rate);
        stockUsed += amount;
        transferredValue += transferredQty * rate;
        if (
          autoQty <= 0 &&
          usedQty <= 0 &&
          extraQty <= 0 &&
          transferredQty === 0 &&
          kitchenOnHand <= 0 &&
          !w
        ) {
          continue;
        }
        await tx.kitchenDayCloseLine.create({
          data: {
            closeId: close.id,
            storeItemId: item.id,
            kitchenOnHand,
            transferredQty,
            autoQty,
            usedQty,
            extraQty,
            reason:
              extraQty > 0 || usedQty > autoQty || w?.leftoverQty != null
                ? w?.reason ?? null
                : null,
            ratePerUnit: rate,
            amount,
          },
        });
        if (nextBeyond > 0) {
          await tx.stockMovement.create({
            data: {
              storeItemId: item.id,
              type: "KITCHEN_OUT",
              quantity: -nextBeyond,
              ratePerUnit: rate,
              kitchenStation: station,
              note: `Kitchen day use · ${station} · ${clock.businessDate} · ${w?.reason ?? "Extra"}`,
            },
          });
        }
      }

      const paid = await tx.order.aggregate({
        where: {
          paymentStatus: "PAID",
          status: { not: "CANCELLED" },
          createdAt: { gte: clock.gte, lt: clock.lt },
        },
        _sum: { total: true },
      });
      const sales = money2(toNumber(paid._sum.total));
      stockUsed = money2(stockUsed);
      transferredValue = money2(transferredValue);

      await tx.kitchenDayClose.update({
        where: { id: close.id },
        data: {
          stockUsedValue: stockUsed,
          transferredValue,
          sales,
          profit: money2(sales - stockUsed),
          closedById: existing ? existing.closedById ?? user.id : user.id,
          ...(existing
            ? {
                editedAt: new Date(),
                editedById: user.id,
                editedByName: user.name,
              }
            : {}),
        },
      });
    });

    return this.dayUseSheet(clock.businessDate, user, station);
  }

  async exportDayUsePdf(dateStr?: string, user?: AuthUser, stationRaw?: string) {
    const sheet = await this.dayUseSheet(dateStr, user, stationRaw);
    const hotel = await this.settings.restaurant();
    const stationName =
      (sheet.stations as { code: string; name: string }[] | undefined)?.find(
        (s) => s.code === sheet.station
      )?.name || sheet.station;
    const pdf = await renderKitchenClosePdf(
      {
        businessDate: sheet.businessDate,
        station: sheet.station,
        stationName,
        dayStart: sheet.dayStart,
        saved: sheet.saved,
        closedByName: sheet.closedByName,
        closedAt: sheet.closedAt ? String(sheet.closedAt) : null,
        sales: sheet.sales,
        stockUsedValue: sheet.stockUsedValue,
        transferredValue: sheet.transferredValue,
        profit: sheet.profit,
        items: sheet.items,
      },
      hotel
    );
    const safeStation = stationName.replace(/[^\w\-]+/g, "_").replace(/_+/g, "_").slice(0, 24) || "station";
    return {
      filename: `kitchen-close-${sheet.businessDate}-${safeStation}.pdf`,
      body: pdf,
    };
  }
}
