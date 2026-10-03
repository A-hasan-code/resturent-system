import { FormEvent, useCallback, useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { LanguageSwitcher } from "../components/LanguageSwitcher";
import { useT } from "../i18n";
import type { MessageKey } from "../i18n";
import { useToast } from "../toast";
import { onConnStatus } from "../server";

type Staff = { id: string; name: string; roleCode: string; roleName: string };

const DEMOS: { roleKey: MessageKey; username: string; password: string }[] = [
  { roleKey: "role.ADMIN", username: "admin", password: "admin123" },
  { roleKey: "role.MANAGER", username: "manager", password: "manager123" },
  { roleKey: "role.CASHIER", username: "cashier", password: "cashier123" },
  { roleKey: "role.KITCHEN", username: "kitchen", password: "kitchen123" },
  { roleKey: "role.STORE", username: "store", password: "store123" },
  { roleKey: "role.WAITER", username: "waiter", password: "waiter123" },
];

const PIN_MAX = 6;

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

export function LoginPage() {
  const { user } = useAuth();
  const t = useT();
  const [staff, setStaff] = useState<Staff[] | null>(null);
  const [mode, setMode] = useState<"pin" | "password">("pin");

  useEffect(() => {
    const load = () =>
      api<Staff[]>("/auth/staff")
        .then((s) => {
          setStaff(s);
          setMode(s.length ? "pin" : "password");
        })
        .catch(() => {
          setStaff([]);
          setMode("password");
        });
    void load();
    const off = onConnStatus((s) => {
      if (s === "ok") void load();
    });
    return () => {
      off();
    };
  }, []);

  if (user) return <Navigate to="/" replace />;

  return (
    <div className="login-screen">
      <aside className="login-visual" aria-hidden={false}>
        <img
          className="login-visual-img"
          src="/login-hero.jpg"
          alt={t("login.heroAlt")}
        />
        <div className="login-visual-shade" />
        <div className="login-visual-content">
          <p className="login-brand-mark">{t("brand.name")}</p>
          <h1>{t("login.headline")}</h1>
          <p className="login-lead">{t("login.lead")}</p>
          <ul className="login-points">
            <li>{t("login.point1")}</li>
            <li>{t("login.point2")}</li>
            <li>{t("login.point3")}</li>
          </ul>
        </div>
        <aside className="login-vendor">
          <span>
            <em>company:</em> Pixalbotics
          </span>
          <a href="mailto:pixalbotics@gmail.com">
            <em>email:</em> pixalbotics@gmail.com
          </a>
          <a href="https://wa.me/923431743916" target="_blank" rel="noopener noreferrer">
            <em>whatsapp:</em> +92 343 1743916
          </a>
          <a href="https://www.pixalbotic.com/" target="_blank" rel="noopener noreferrer">
            <em>url:</em> www.pixalbotic.com
          </a>
        </aside>
      </aside>

      <main className="login-panel">
        <div className="login-panel-inner">
          <div className="login-lang">
            <LanguageSwitcher />
          </div>
          <header className="login-panel-head">
            <span className="login-panel-kicker">{t("login.secureAccess")}</span>
            <h2>{t("login.signInWorkspace")}</h2>
            <p>{mode === "pin" ? t("login.pinHint") : t("login.passwordHint")}</p>
          </header>

          {!!staff?.length && (
            <div className="login-tabs" role="tablist">
              <button type="button" role="tab" className={mode === "pin" ? "active" : ""} onClick={() => setMode("pin")}>
                {t("login.pinTab")}
              </button>
              <button
                type="button"
                role="tab"
                className={mode === "password" ? "active" : ""}
                onClick={() => setMode("password")}
              >
                {t("login.passwordTab")}
              </button>
            </div>
          )}

          {mode === "pin" && staff?.length ? <PinLogin staff={staff} /> : <PasswordLogin />}

          <footer className="login-credit">
            <span>
              {t("login.poweredBy")}{" "}
              <a
                href="https://www.pixalbotics.com/"
                target="_blank"
                rel="noopener noreferrer"
              >
                Pixalbotics
              </a>
            </span>
            <span className="login-credit-sep">·</span>
            <span className="login-credit-copy">{t("login.copyright", { year: 2026 })}</span>
          </footer>
        </div>
      </main>
    </div>
  );
}

function PinLogin({ staff }: { staff: Staff[] }) {
  const { loginWithPin } = useAuth();
  const toast = useToast();
  const t = useT();
  const [who, setWho] = useState<Staff | null>(null);
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = useCallback(async () => {
    if (!who || pin.length < 4 || loading) return;
    setLoading(true);
    try {
      await loginWithPin(who.id, pin);
      toast.push(t("login.welcome", { name: who.name }), "ok");
    } catch (err) {
      setPin("");
      toast.push(err instanceof Error ? err.message : t("login.failed"), "err");
    } finally {
      setLoading(false);
    }
  }, [who, pin, loading, loginWithPin, toast, t]);

  const press = useCallback((d: string) => setPin((p) => (p.length < PIN_MAX ? p + d : p)), []);

  useEffect(() => {
    if (!who) return;
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === "Backspace") setPin((p) => p.slice(0, -1));
      else if (e.key === "Enter") void submit();
      else if (e.key === "Escape") setWho(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [who, press, submit]);

  if (!who) {
    return (
      <div className="login-card">
        <div className="staff-grid">
          {staff.map((s) => (
            <button
              key={s.id}
              type="button"
              className="staff-btn"
              onClick={() => {
                setWho(s);
                setPin("");
              }}
            >
              <span className="staff-avatar">{initials(s.name)}</span>
              <strong>{s.name}</strong>
              <span className="tiny muted">{s.roleName}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="login-card pin-card">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <button type="button" className="btn ghost sm" onClick={() => setWho(null)}>
          {t("login.backStaff")}
        </button>
        <div style={{ textAlign: "right" }}>
          <strong>{who.name}</strong>
          <div className="tiny muted">{who.roleName}</div>
        </div>
      </div>
      <div className="pin-dots" aria-label={t("login.digitsEntered", { n: pin.length })}>
        {Array.from({ length: Math.max(4, pin.length) }, (_, i) => (
          <span key={i} className={i < pin.length ? "on" : ""} />
        ))}
      </div>
      <div className="pin-pad">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
          <button key={d} type="button" onClick={() => press(d)} disabled={loading}>
            {d}
          </button>
        ))}
        <button type="button" className="pin-aux" onClick={() => setPin((p) => p.slice(0, -1))} disabled={loading}>
          ⌫
        </button>
        <button type="button" onClick={() => press("0")} disabled={loading}>
          0
        </button>
        <button type="button" className="pin-go" onClick={() => void submit()} disabled={loading || pin.length < 4}>
          {loading ? "…" : t("login.ok")}
        </button>
      </div>
    </div>
  );
}

function PasswordLogin() {
  const { login } = useAuth();
  const toast = useToast();
  const t = useT();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await login(username.trim(), password);
      toast.push(t("login.welcomeBack"), "ok");
    } catch (err) {
      toast.push(err instanceof Error ? err.message : t("login.failed"), "err");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <form className="login-card" onSubmit={onSubmit}>
        <div className="field">
          <label htmlFor="u">{t("login.username")}</label>
          <input
            id="u"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoCapitalize="none"
            placeholder={t("login.usernamePh")}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="p">{t("login.password")}</label>
          <input
            id="p"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            placeholder="••••••••"
            required
          />
        </div>
        <button className="btn login-submit" type="submit" disabled={loading}>
          {loading ? t("login.signingIn") : t("login.submit")}
        </button>
      </form>

      {import.meta.env.DEV && (
        <div className="demo-accounts">
          <p className="demo-label">{t("login.demoTitle")}</p>
          <div className="demo-grid">
            {DEMOS.map((d) => (
              <button
                key={d.username}
                type="button"
                className="demo-btn"
                onClick={() => {
                  setUsername(d.username);
                  setPassword(d.password);
                }}
              >
                <strong>{t(d.roleKey)}</strong>
                <span className="tiny muted">{d.username}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
