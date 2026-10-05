import { useT } from "../i18n";
import { VENDOR } from "../vendor";

type Props = {
  /** Compact line for receipt / thermal-style slips. */
  variant?: "app" | "receipt";
  className?: string;
};

/** Shared "Powered by Pixalbotics" credit with contact number. */
export function PoweredBy({ variant = "app", className }: Props) {
  const t = useT();
  const classes = ["powered-by", variant === "receipt" ? "powered-by--receipt" : "powered-by--app", className]
    .filter(Boolean)
    .join(" ");

  if (variant === "receipt") {
    return (
      <div className={classes}>
        <div>
          {t("login.poweredBy")} {VENDOR.name}
        </div>
        <div>{VENDOR.phoneDisplay}</div>
      </div>
    );
  }

  return (
    <footer className={classes}>
      <span>
        {t("login.poweredBy")}{" "}
        <a href={VENDOR.websiteUrl} target="_blank" rel="noopener noreferrer">
          {VENDOR.name}
        </a>
      </span>
      <span className="powered-by-sep" aria-hidden="true">
        ·
      </span>
      <a href={`tel:${VENDOR.phoneTel}`}>{VENDOR.phoneDisplay}</a>
    </footer>
  );
}
