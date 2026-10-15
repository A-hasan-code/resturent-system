import { FormEvent, useCallback, useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import {
  BILL_BUILDER_SPECIAL_KEY,
  isBillBuilderUnlocked,
  lockBillBuilder,
  unlockBillBuilder,
} from "../bill-builder/dev-unlock";
import {
  DEVELOPER_SPECIAL_KEY,
  DEVELOPER_UNLOCK_EVENT,
  isDeveloperUnlocked,
  lockDeveloper,
  unlockDeveloper,
} from "../developer/dev-unlock";
import { useConfirm, usePrompt } from "../components/ConfirmModal";
import { Pagination, paginate } from "../components/Pagination";
import { useT, type MessageKey } from "../i18n";
import { useToast } from "../toast";

const PAGE_SIZE = 15;

type Backup = { file: string; size: number; createdAt: string; auto: boolean; kind?: string };
type SeedScript = {
  id: string;
  label: string;
  path: string;
  folder?: string;
  available: boolean;
  mtime?: string;
  size?: number;
  isNew?: boolean;
};
type DevCmd = { id: string; title: string; cmd: string };
type DeveloperInfo = {
  about: {
    app: string;
    name: string;
    version: string;
    hostname: string;
    port: number;
    time: string;
    urls: string[];
    mdnsUrl: string;
    platform: string;
    release: string;
    arch: string;
    cpus: number;
    memoryGb: number;
    node: string;
  };
  paths: {
    dataDir: string;
    backupsDir: string;
    workspaceRoot?: string;
    pgDataHint: string;
    envFileHint: string;
  };
  database: { host: string; port: string; name: string };
  commands: DevCmd[];
  seeds: { confirmPhrase: string; scripts: SeedScript[] };
};

const BACKUP_KIND_KEY: Record<string, MessageKey> = {
  daily: "settings.kindDaily",
  monthly: "settings.kindMonthly",
  manual: "settings.kindManual",
  safety: "settings.kindBefore",
};

function errMsg(e: unknown, fallback: string) {
  return e instanceof Error ? e.message : fallback;
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function DeveloperSetupPage() {
  const { can } = useAuth();
  const t = useT();
  const toast = useToast();
  const navigate = useNavigate();
  const [gateOpen, setGateOpen] = useState(() => isDeveloperUnlocked());
  const [keyIn, setKeyIn] = useState("");

  useEffect(() => {
    const sync = () => setGateOpen(isDeveloperUnlocked());
    window.addEventListener(DEVELOPER_UNLOCK_EVENT, sync);
    return () => window.removeEventListener(DEVELOPER_UNLOCK_EVENT, sync);
  }, []);

  if (!can("system.manage")) return <Navigate to="/" replace />;

  function tryUnlock(e: FormEvent) {
    e.preventDefault();
    if (keyIn.trim() !== DEVELOPER_SPECIAL_KEY) {
      toast.push(t("dev.tabKeyBad"), "err");
      return;
    }
    unlockDeveloper();
    setGateOpen(true);
    setKeyIn("");
    toast.push(t("dev.tabUnlocked"), "ok");
  }

  function lockTab() {
    lockDeveloper();
    setGateOpen(false);
    toast.push(t("dev.tabLockedAgain"), "ok");
    navigate("/");
  }

  if (!gateOpen) {
    return (
      <div>
        <div className="page-head">
          <div>
            <h1>{t("dev.title")}</h1>
            <p>{t("dev.tabGateHint")}</p>
          </div>
        </div>
        <div className="panel panel-pad settings-block">
          <form className="row" style={{ gap: "0.5rem", flexWrap: "wrap", alignItems: "end" }} onSubmit={tryUnlock}>
            <label className="field" style={{ flex: "1 1 200px", margin: 0 }}>
              <span className="tiny">{t("dev.tabKeyLabel")}</span>
              <input
                value={keyIn}
                onChange={(e) => setKeyIn(e.target.value)}
                placeholder={t("dev.tabKeyPlaceholder")}
                autoComplete="off"
                spellCheck={false}
                autoFocus
              />
            </label>
            <button type="submit" className="btn">
              {t("dev.tabUnlock")}
            </button>
            <span className="tiny muted">{t("dev.tabShortcut")}</span>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{t("dev.title")}</h1>
          <p>{t("dev.subtitle")}</p>
        </div>
        <button type="button" className="btn ghost sm" onClick={lockTab}>
          {t("dev.tabLock")}
        </button>
      </div>
      <BillBuilderDevPanel />
      <AboutSection />
      <BackupPanel />
      <SeedsPanel />
      <CommandLinePanel />
    </div>
  );
}

/** Hidden bill layout builder — unlock with special key, then open once. Design saves for all print/preview. */
function BillBuilderDevPanel() {
  const t = useT();
  const toast = useToast();
  const navigate = useNavigate();
  const [keyIn, setKeyIn] = useState("");
  const [unlocked, setUnlocked] = useState(() => isBillBuilderUnlocked());

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ctrl+Shift+B — same unlock as typing the special key
      if (e.ctrlKey && e.shiftKey && (e.key === "b" || e.key === "B")) {
        const tag = (e.target as HTMLElement | null)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable) return;
        e.preventDefault();
        unlockBillBuilder();
        setUnlocked(true);
        toast.push(t("dev.billBuilderUnlocked"), "ok");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [t, toast]);

  function tryUnlock(e: FormEvent) {
    e.preventDefault();
    if (keyIn.trim() !== BILL_BUILDER_SPECIAL_KEY) {
      toast.push(t("dev.billBuilderKeyBad"), "err");
      return;
    }
    unlockBillBuilder();
    setUnlocked(true);
    setKeyIn("");
    toast.push(t("dev.billBuilderUnlocked"), "ok");
  }

  function openBuilder() {
    if (!isBillBuilderUnlocked()) {
      toast.push(t("dev.billBuilderLocked"), "err");
      return;
    }
    navigate("/bill-design");
  }

  function lockAgain() {
    lockBillBuilder();
    setUnlocked(false);
    toast.push(t("dev.billBuilderLockedAgain"), "ok");
  }

  return (
    <div className="panel panel-pad settings-block">
      <h2 className="settings-h" style={{ margin: 0 }}>{t("dev.billBuilder")}</h2>
      <p className="tiny muted" style={{ margin: "0.2rem 0 0.75rem" }}>{t("dev.billBuilderHint")}</p>
      {!unlocked ? (
        <form className="row" style={{ gap: "0.5rem", flexWrap: "wrap", alignItems: "end" }} onSubmit={tryUnlock}>
          <label className="field" style={{ flex: "1 1 200px", margin: 0 }}>
            <span className="tiny">{t("dev.billBuilderKeyLabel")}</span>
            <input
              value={keyIn}
              onChange={(e) => setKeyIn(e.target.value)}
              placeholder={t("dev.billBuilderKeyPlaceholder")}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <button type="submit" className="btn">
            {t("dev.billBuilderUnlock")}
          </button>
          <span className="tiny muted">{t("dev.billBuilderShortcut")}</span>
        </form>
      ) : (
        <div className="row" style={{ gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
          <button type="button" className="btn" onClick={openBuilder}>
            {t("dev.billBuilderOpen")}
          </button>
          <button type="button" className="btn ghost" onClick={lockAgain}>
            {t("dev.billBuilderLock")}
          </button>
          <span className="tiny muted">{t("dev.billBuilderOnce")}</span>
        </div>
      )}
    </div>
  );
}

function AboutSection() {
  const t = useT();
  const toast = useToast();
  const [info, setInfo] = useState<DeveloperInfo | null>(null);

  useEffect(() => {
    api<DeveloperInfo>("/system/developer")
      .then(setInfo)
      .catch(() => undefined);
  }, []);

  const a = info?.about;
  const paths = info?.paths;
  const db = info?.database;

  return (
    <div className="panel panel-pad settings-block">
      <h2 className="settings-h" style={{ margin: 0 }}>{t("dev.about")}</h2>
      <p className="tiny muted" style={{ margin: "0.2rem 0 0.75rem" }}>{t("dev.aboutHint")}</p>
      {!a ? (
        <p className="muted tiny">{t("settings.working")}</p>
      ) : (
        <div className="table-wrap">
          <table>
            <tbody>
              <tr><th className="tiny">{t("dev.app")}</th><td>{a.name} <span className="muted">({a.app})</span></td></tr>
              <tr><th className="tiny">{t("dev.version")}</th><td><code>{a.version}</code> · Node {a.node}</td></tr>
              <tr><th className="tiny">{t("dev.host")}</th><td>{a.hostname} · {a.platform} {a.release} · {a.arch}</td></tr>
              <tr><th className="tiny">{t("dev.resources")}</th><td>{a.cpus} CPU · {a.memoryGb} GB RAM · port {a.port}</td></tr>
              <tr>
                <th className="tiny">{t("dev.urls")}</th>
                <td className="tiny">
                  {(a.urls || []).join(" · ") || "—"}
                  {a.mdnsUrl ? ` · ${a.mdnsUrl}` : ""}
                </td>
              </tr>
              <tr><th className="tiny">{t("dev.workspace")}</th><td className="tiny"><code>{paths?.workspaceRoot || "—"}</code></td></tr>
              <tr><th className="tiny">{t("dev.dataDir")}</th><td className="tiny"><code>{paths?.dataDir}</code></td></tr>
              <tr><th className="tiny">{t("dev.backupsDir")}</th><td className="tiny"><code>{paths?.backupsDir}</code></td></tr>
              <tr><th className="tiny">{t("dev.pgData")}</th><td className="tiny"><code>{paths?.pgDataHint}</code></td></tr>
              <tr><th className="tiny">{t("dev.envFile")}</th><td className="tiny"><code>{paths?.envFileHint}</code></td></tr>
              <tr>
                <th className="tiny">{t("dev.database")}</th>
                <td className="tiny">
                  {db?.host ? (
                    <code>{db.host}:{db.port}/{db.name}</code>
                  ) : (
                    "—"
                  )}
                  <button
                    type="button"
                    className="btn ghost sm"
                    style={{ marginLeft: "0.5rem" }}
                    onClick={async () => {
                      const line = db?.host ? `${db.host}:${db.port}/${db.name}` : "";
                      if (line && (await copyText(line))) toast.push(t("dev.copied"), "ok");
                    }}
                  >
                    {t("dev.copy")}
                  </button>
                </td>
              </tr>
              <tr><th className="tiny">{t("dev.serverTime")}</th><td className="tiny">{a.time ? new Date(a.time).toLocaleString("en-PK") : "—"}</td></tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function BackupPanel() {
  const toast = useToast();
  const t = useT();
  const ask = useConfirm();
  const [dir, setDir] = useState("");
  const [files, setFiles] = useState<Backup[]>([]);
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api<{ dir: string; files: Backup[] }>("/system/backups");
      setDir(r.dir);
      setFiles(r.files);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function backupNow() {
    setBusy(true);
    try {
      await api("/system/backups", { method: "POST", body: "{}" });
      toast.push(t("settings.backupCreated"), "ok");
      void load();
    } catch (e) {
      toast.push(errMsg(e, t("common.failed")), "err");
    } finally {
      setBusy(false);
    }
  }

  async function restore(b: Backup) {
    if (
      !(await ask({
        title: t("settings.restoreTitle"),
        body: t("settings.restoreConfirm", { file: b.file }),
        danger: true,
        confirmLabel: t("settings.restore"),
      }))
    ) {
      return;
    }
    setBusy(true);
    try {
      await api(`/system/backups/${encodeURIComponent(b.file)}/restore`, { method: "POST", body: "{}" });
      toast.push(t("settings.restoreOk"), "ok");
      setTimeout(() => location.reload(), 1500);
    } catch (e) {
      toast.push(errMsg(e, t("common.failed")), "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel panel-pad settings-block">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <h2 className="settings-h" style={{ margin: 0 }}>{t("settings.backup")}</h2>
          <p className="tiny muted" style={{ margin: "0.2rem 0 0" }}>
            {t("settings.backupHint")} <code>{dir}</code>
          </p>
          <p className="tiny muted" style={{ margin: "0.35rem 0 0" }}>{t("settings.restoreHint")}</p>
        </div>
        <button type="button" className="btn sm" disabled={busy} onClick={() => void backupNow()}>
          {busy ? t("settings.working") : t("settings.backupNow")}
        </button>
      </div>
      <div className="table-wrap" style={{ marginTop: "0.75rem" }}>
        <table>
          <thead>
            <tr>
              <th>{t("settings.file")}</th>
              <th>{t("settings.size")}</th>
              <th>{t("settings.date")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {paginate(files, page, PAGE_SIZE).map((b) => (
              <tr key={b.file}>
                <td className="tiny">
                  {b.file}{" "}
                  <span className={`badge ${b.kind === "monthly" ? "paid" : "ready"}`}>
                    {t(BACKUP_KIND_KEY[b.kind || (b.auto ? "daily" : "manual")] ?? "settings.kindManual")}
                  </span>
                </td>
                <td>{(b.size / 1024).toFixed(0)} KB</td>
                <td className="tiny">{new Date(b.createdAt).toLocaleString("en-PK")}</td>
                <td>
                  <button type="button" className="btn ghost sm" disabled={busy} onClick={() => void restore(b)}>
                    {t("settings.restore")}
                  </button>
                </td>
              </tr>
            ))}
            {!files.length && (
              <tr>
                <td colSpan={4} className="empty">{t("settings.noBackups")}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <Pagination page={page} pageSize={PAGE_SIZE} total={files.length} onChange={setPage} />
    </div>
  );
}

function SeedsPanel() {
  const toast = useToast();
  const t = useT();
  const ask = useConfirm();
  const prompt = usePrompt();
  const [scripts, setScripts] = useState<SeedScript[]>([]);
  const [phrase, setPhrase] = useState("YES SEED");
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    try {
      const r = await api<{ confirmPhrase: string; scripts: SeedScript[] }>("/system/seed");
      setPhrase(r.confirmPhrase || "YES SEED");
      setScripts(r.scripts || []);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function runSeed(s: SeedScript) {
    if (!s.available) {
      toast.push(t("settings.seedUnavailable"), "err");
      return;
    }
    if (
      !(await ask({
        title: t("dev.seeds"),
        body: `${s.label} (${s.path})\n\n${t("settings.devSetupWarn")}`,
        danger: true,
        confirmLabel: t("common.confirm"),
      }))
    ) {
      return;
    }
    const typed = await prompt({
      title: s.label,
      body: t("settings.devSetupWarn"),
      danger: true,
      confirmLabel: t("settings.runSeed"),
      inputLabel: t("settings.seedConfirmLabel"),
      inputPlaceholder: t("settings.seedConfirmPh"),
      inputRequired: true,
      inputMaxLength: 40,
    });
    if (typed == null) return;
    if (typed.trim() !== phrase) {
      toast.push(t("settings.seedConfirmMismatch"), "err");
      return;
    }
    setBusy(true);
    try {
      const r = await api<{ ok: true; backup?: string; log?: string }>("/system/seed", {
        method: "POST",
        body: JSON.stringify({ scriptId: s.id, confirm: phrase, backupFirst: true }),
      });
      toast.push(
        r.backup ? t("settings.seedBackupNote", { file: r.backup }) : t("settings.seedOk"),
        "ok"
      );
      if (r.log) toast.push(r.log.slice(0, 180), "ok");
      void load();
    } catch (e) {
      toast.push(errMsg(e, t("common.failed")), "err");
    } finally {
      setBusy(false);
    }
  }

  const newCount = scripts.filter((s) => s.isNew && s.available).length;

  return (
    <div className="panel panel-pad settings-block">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: "0.75rem" }}>
        <div>
          <h2 className="settings-h" style={{ margin: 0 }}>{t("dev.seeds")}</h2>
          <p className="tiny muted" style={{ margin: "0.2rem 0 0" }}>{t("dev.seedsHint")}</p>
          <p className="tiny muted" style={{ margin: "0.35rem 0 0" }}>{t("settings.seedListHint")}</p>
          {newCount > 0 && (
            <p className="tiny" style={{ margin: "0.35rem 0 0", color: "var(--accent, #c45)" }}>
              {t("dev.newSeeds", { count: String(newCount) })}
            </p>
          )}
        </div>
        <button type="button" className="btn ghost sm" disabled={busy} onClick={() => void load()}>
          {t("settings.refreshSeeds")}
        </button>
      </div>
      <div className="table-wrap" style={{ marginTop: "0.75rem" }}>
        <table>
          <thead>
            <tr>
              <th>{t("settings.seedScript")}</th>
              <th>{t("settings.file")}</th>
              <th>{t("dev.modified")}</th>
              <th>{t("settings.seedStatus")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {paginate(scripts, page, PAGE_SIZE).map((s) => (
              <tr key={s.id}>
                <td>
                  {s.label}{" "}
                  {s.isNew && s.available ? <span className="badge paid">{t("dev.newBadge")}</span> : null}
                </td>
                <td className="tiny"><code>{s.path}</code></td>
                <td className="tiny">
                  {s.mtime ? new Date(s.mtime).toLocaleString("en-PK") : "—"}
                </td>
                <td>
                  <span className={`badge ${s.available ? "paid" : "ready"}`}>
                    {s.available ? t("settings.seedReady") : t("settings.seedMissing")}
                  </span>
                </td>
                <td>
                  <button
                    type="button"
                    className="btn danger sm"
                    disabled={busy || !s.available}
                    onClick={() => void runSeed(s)}
                  >
                    {busy ? t("settings.working") : t("settings.runSeed")}
                  </button>
                </td>
              </tr>
            ))}
            {!scripts.length && (
              <tr>
                <td colSpan={5} className="empty">{t("settings.noSeedScripts")}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <Pagination page={page} pageSize={PAGE_SIZE} total={scripts.length} onChange={setPage} />
    </div>
  );
}

function CommandLinePanel() {
  const t = useT();
  const toast = useToast();
  const ask = useConfirm();
  const prompt = usePrompt();
  const [commands, setCommands] = useState<DevCmd[]>([]);
  const [phrase, setPhrase] = useState("YES SHELL");
  const [query, setQuery] = useState("pnpm run hotel:dev -- list");
  const [busy, setBusy] = useState(false);
  const [output, setOutput] = useState("");

  useEffect(() => {
    api<DeveloperInfo & { shellConfirmPhrase?: string }>("/system/developer")
      .then((r) => {
        setCommands(r.commands || []);
        if (r.shellConfirmPhrase) setPhrase(r.shellConfirmPhrase);
      })
      .catch(() => undefined);
  }, []);

  async function runQuery() {
    const cmd = query.trim();
    if (!cmd) {
      toast.push(t("dev.shellEmpty"), "err");
      return;
    }
    if (
      !(await ask({
        title: t("dev.shellTitle"),
        body: t("dev.shellWarn"),
        danger: true,
        confirmLabel: t("common.confirm"),
      }))
    ) {
      return;
    }
    const typed = await prompt({
      title: t("dev.shellTitle"),
      body: t("dev.shellWarn"),
      danger: true,
      confirmLabel: t("dev.shellRun"),
      inputLabel: t("dev.shellConfirmLabel"),
      inputPlaceholder: phrase,
      inputRequired: true,
      inputMaxLength: 40,
    });
    if (typed == null) return;
    if (typed.trim() !== phrase) {
      toast.push(t("dev.shellConfirmMismatch"), "err");
      return;
    }
    setBusy(true);
    setOutput("");
    try {
      const r = await api<{
        ok: boolean;
        code: number | null;
        stdout: string;
        stderr: string;
        ms: number;
      }>("/system/developer/shell", {
        method: "POST",
        body: JSON.stringify({ command: cmd, confirm: phrase }),
      });
      const cwd = (r as { cwd?: string }).cwd;
      const parts = [
        `$ exit ${r.code ?? "?"} · ${r.ms} ms${cwd ? ` · cwd ${cwd}` : ""}`,
        r.stdout?.trim() ? r.stdout.trim() : "",
        r.stderr?.trim() ? `STDERR:\n${r.stderr.trim()}` : "",
      ].filter(Boolean);
      setOutput(parts.join("\n\n"));
      toast.push(r.ok ? t("dev.shellOk") : t("dev.shellFailed"), r.ok ? "ok" : "err");
    } catch (e) {
      setOutput(errMsg(e, t("common.failed")));
      toast.push(errMsg(e, t("common.failed")), "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel panel-pad settings-block">
      <h2 className="settings-h" style={{ margin: 0 }}>{t("dev.cli")}</h2>
      <p className="tiny muted" style={{ margin: "0.2rem 0 0.75rem" }}>{t("dev.cliHint")}</p>

      <label className="field" style={{ display: "block", marginBottom: "0.75rem" }}>
        <span>{t("dev.shellQuery")}</span>
        <textarea
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          rows={5}
          placeholder={t("dev.shellPlaceholder")}
          spellCheck={false}
          style={{ width: "100%", fontFamily: "ui-monospace, Consolas, monospace", resize: "vertical" }}
          disabled={busy}
        />
      </label>
      <div className="row" style={{ gap: "0.5rem", marginBottom: "0.75rem", flexWrap: "wrap" }}>
        <button type="button" className="btn danger sm" disabled={busy} onClick={() => void runQuery()}>
          {busy ? t("settings.working") : t("dev.shellRun")}
        </button>
        <button
          type="button"
          className="btn ghost sm"
          disabled={busy || !query.trim()}
          onClick={async () => {
            if (await copyText(query)) toast.push(t("dev.copied"), "ok");
          }}
        >
          {t("dev.copy")}
        </button>
      </div>
      {output ? (
        <pre
          className="tiny"
          style={{
            margin: "0 0 1rem",
            padding: "0.75rem",
            background: "var(--surface-2, #111)",
            color: "var(--text, #eee)",
            borderRadius: "6px",
            overflow: "auto",
            maxHeight: "22rem",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {output}
        </pre>
      ) : null}

      <p className="tiny muted" style={{ margin: "0 0 0.5rem" }}>{t("dev.cliCheat")}</p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{t("dev.cliAction")}</th>
              <th>{t("dev.cliCommand")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {commands.map((c) => (
              <tr key={c.id}>
                <td>{c.title}</td>
                <td className="tiny"><code>{c.cmd}</code></td>
                <td className="row" style={{ gap: "0.35rem", flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="btn ghost sm"
                    disabled={busy}
                    onClick={() => setQuery(c.cmd)}
                  >
                    {t("dev.shellUse")}
                  </button>
                  <button
                    type="button"
                    className="btn ghost sm"
                    onClick={async () => {
                      if (await copyText(c.cmd)) toast.push(t("dev.copied"), "ok");
                    }}
                  >
                    {t("dev.copy")}
                  </button>
                </td>
              </tr>
            ))}
            {!commands.length && (
              <tr>
                <td colSpan={3} className="empty">{t("settings.working")}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
