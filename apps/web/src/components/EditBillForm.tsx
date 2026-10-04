export type EditBillMeta = {
  partitionId: string;
  tableId: string;
  cashierId: string;
  supervisorId: string;
  servedBy: string;
};

export type EditBillTable = {
  id: string;
  name: string;
  partitionId: string;
  orderId: string | null;
};

export type EditBillPartition = { id: string; name: string };

export type EditBillPerson = { id: string; name: string; roleCode?: string };

function uniquePeople(list: EditBillPerson[]) {
  const map = new Map<string, EditBillPerson>();
  for (const person of list) map.set(person.id, person);
  return [...map.values()];
}

export function withCurrent(
  list: EditBillPerson[],
  current?: { id?: string; name: string; roleCode?: string } | null
) {
  const people = uniquePeople(list);
  if (current?.id && !people.some((p) => p.id === current.id)) {
    people.unshift({ id: current.id, name: current.name, roleCode: current.roleCode });
  }
  return people;
}

export function serverNames(list: EditBillPerson[], current: string) {
  const names = [...new Set(list.map((p) => p.name).filter(Boolean))];
  if (current && !names.includes(current)) names.unshift(current);
  return names;
}

export function EditBillForm({
  meta,
  onChange,
  currentOrderId,
  partitions,
  tables,
  cashiers,
  supervisors,
  servers,
  labels,
}: {
  meta: EditBillMeta;
  onChange: (next: EditBillMeta) => void;
  currentOrderId: string;
  partitions: EditBillPartition[];
  tables: EditBillTable[];
  cashiers: EditBillPerson[];
  supervisors: EditBillPerson[];
  servers: string[];
  labels: {
    where: string;
    who: string;
    partition: string;
    table: string;
    cashier: string;
    supervisor: string;
    servedBy: string;
    busy: string;
  };
}) {
  const inPartition = tables.filter((t) => t.partitionId === meta.partitionId);
  return (
    <div className="edit-bill">
      <section>
        <div className="edit-bill-title">{labels.where}</div>
        <div className="edit-bill-grid">
      <label>
        {labels.partition}
        <select
          value={meta.partitionId}
          onChange={(e) => {
            const partitionId = e.target.value;
            const still = tables.some((t) => t.id === meta.tableId && t.partitionId === partitionId);
            onChange({ ...meta, partitionId, tableId: still ? meta.tableId : "" });
          }}
        >
          <option value="">—</option>
          {partitions.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        {labels.table}
        <select value={meta.tableId} onChange={(e) => onChange({ ...meta, tableId: e.target.value })}>
          <option value="">—</option>
          {inPartition.map((t) => {
            const busy = !!t.orderId && t.orderId !== currentOrderId;
            return (
              <option key={t.id} value={t.id} disabled={busy}>
                {t.name}
                {busy ? ` (${labels.busy})` : ""}
              </option>
            );
          })}
        </select>
      </label>
        </div>
      </section>
      <section>
        <div className="edit-bill-title">{labels.who}</div>
        <div className="edit-bill-grid">
      <label>
        {labels.cashier}
        <select value={meta.cashierId} onChange={(e) => onChange({ ...meta, cashierId: e.target.value })}>
          <option value="">—</option>
          {cashiers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        {labels.supervisor}
        <select value={meta.supervisorId} onChange={(e) => onChange({ ...meta, supervisorId: e.target.value })}>
          <option value="">—</option>
          {supervisors.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <label className="span-2">
        {labels.servedBy}
        <select value={meta.servedBy} onChange={(e) => onChange({ ...meta, servedBy: e.target.value })}>
          <option value="">—</option>
          {servers.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </label>
        </div>
      </section>
    </div>
  );
}
