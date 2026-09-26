import { FormEvent, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../auth";
import { useToast } from "../toast";

const DEMOS = [
  { role: "Admin", username: "admin", password: "admin123" },
  { role: "Cashier", username: "cashier", password: "cashier123" },
  { role: "Kitchen", username: "kitchen", password: "kitchen123" },
  { role: "Store", username: "store", password: "store123" },
];

export function LoginPage() {
  const { user, login } = useAuth();
  const toast = useToast();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  if (user) return <Navigate to="/" replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await login(username.trim(), password);
      toast.push("Welcome back", "ok");
    } catch (err) {
      toast.push(err instanceof Error ? err.message : "Login failed", "err");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-screen">
      <aside className="login-visual" aria-hidden={false}>
        <img
          className="login-visual-img"
          src="/login-hero.jpg"
          alt="Fine dining hotel restaurant"
        />
        <div className="login-visual-shade" />
        <div className="login-visual-content">
          <p className="login-brand-mark">Hotel System</p>
          <h1>Professional POS for modern hospitality</h1>
          <p className="login-lead">
            Kg billing, live inventory, kitchen tickets, and role-based control —
            built for Pakistan hotels and restaurants.
          </p>
          <ul className="login-points">
            <li>Offline-ready on your own server</li>
            <li>Store, kitchen, cashier &amp; admin roles</li>
            <li>Recipe costing with live stock rates</li>
          </ul>
        </div>
      </aside>

      <main className="login-panel">
        <div className="login-panel-inner">
          <header className="login-panel-head">
            <span className="login-panel-kicker">Secure access</span>
            <h2>Sign in to your workspace</h2>
            <p>Enter your staff credentials to continue.</p>
          </header>

          <form className="login-card" onSubmit={onSubmit}>
            <div className="field">
              <label htmlFor="u">Username</label>
              <input
                id="u"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                placeholder="e.g. admin"
                required
              />
            </div>
            <div className="field">
              <label htmlFor="p">Password</label>
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
            <button
              className="btn login-submit"
              type="submit"
              disabled={loading}
            >
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>

          <div className="demo-accounts">
            <p className="demo-label">Quick demo accounts</p>
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
                  <strong>{d.role}</strong>
                  <span className="tiny muted">{d.username}</span>
                </button>
              ))}
            </div>
          </div>

          <footer className="login-credit">
            <span>Built by</span>
            <a
              href="https://www.pixalbotics.com/"
              target="_blank"
              rel="noopener noreferrer"
            >
              Pixalbotics
            </a>
            <span className="login-credit-sep">·</span>
            <a
              href="https://www.pixalbotics.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="login-credit-site"
            >
              www.pixalbotics.com
            </a>
          </footer>
        </div>
      </main>
    </div>
  );
}
