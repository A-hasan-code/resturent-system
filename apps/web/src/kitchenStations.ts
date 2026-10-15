import { api } from "./api";

export type KitchenStationRow = {
  id: string;
  code: string;
  name: string;
  sortOrder: number;
  active: boolean;
  system: boolean;
};

const FALLBACK: KitchenStationRow[] = [
  { id: "ks_beverages", code: "BEVERAGES", name: "Beverages", sortOrder: 1, active: true, system: true },
  { id: "ks_cooking", code: "COOKING", name: "Cooking", sortOrder: 2, active: true, system: true },
  { id: "ks_bbq", code: "BBQ", name: "BBQ", sortOrder: 3, active: true, system: true },
];

/** Active kitchen stations (for transfer / closing / menu assign). */
export async function loadKitchenStations(opts?: { all?: boolean }): Promise<KitchenStationRow[]> {
  try {
    const q = opts?.all ? "?all=1" : "";
    const list = await api<KitchenStationRow[]>(`/store/kitchen/stations${q}`);
    if (list?.length) return list;
  } catch {
    /* offline / perm — use defaults */
  }
  return opts?.all ? FALLBACK : FALLBACK.filter((s) => s.active);
}
