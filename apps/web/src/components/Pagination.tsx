import { useEffect } from "react";
import { useT } from "../i18n";

type Props = {
  page: number;
  pageSize: number;
  total: number;
  onChange: (page: number) => void;
};

export function Pagination({ page, pageSize, total, onChange }: Props) {
  const t = useT();
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  useEffect(() => {
    if (page > totalPages) onChange(totalPages);
    else if (page < 1) onChange(1);
  }, [page, totalPages, onChange]);

  if (total <= pageSize) return null;

  const safePage = Math.min(Math.max(page, 1), totalPages);
  const from = (safePage - 1) * pageSize + 1;
  const to = Math.min(safePage * pageSize, total);

  return (
    <div className="pagination">
      <span className="muted tiny">
        {t("common.rangeOf", { from, to, total })}
      </span>
      <div className="row" style={{ gap: "0.4rem" }}>
        <button
          type="button"
          className="btn ghost sm"
          disabled={safePage <= 1}
          onClick={() => onChange(safePage - 1)}
        >
          {t("common.prev")}
        </button>
        <span
          className="tiny"
          style={{ alignSelf: "center", minWidth: "4.5rem", textAlign: "center" }}
        >
          {safePage} / {totalPages}
        </span>
        <button
          type="button"
          className="btn ghost sm"
          disabled={safePage >= totalPages}
          onClick={() => onChange(safePage + 1)}
        >
          {t("common.next")}
        </button>
      </div>
    </div>
  );
}

export function paginate<T>(items: T[], page: number, pageSize: number): T[] {
  const start = (page - 1) * pageSize;
  return items.slice(start, start + pageSize);
}
