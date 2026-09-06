import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { buildSummary } from "./analytics";
import { deleteStoredFile, listStoredFiles, saveStoredFile, type StoredFile } from "./fileStore";
import ImportedFilesSidebar from "./ImportedFilesSidebar";
import { mergeStoredFiles } from "./mergeImports";
import { parseUsageCsv } from "./parseCsv";
import type { ExportSource, NamedAmount, UsageRow } from "./types";

const CHART_COLORS = [
  "#6b8cff",
  "#3dd6c3",
  "#f0b429",
  "#f472b6",
  "#a78bfa",
  "#34d399",
  "#fb923c",
  "#94a3b8",
];

const CHART_CHROME = {
  dark: {
    grid: "rgba(255,255,255,0.06)",
    tick: "#8b93a7",
    axis: "rgba(255,255,255,0.1)",
    tooltipBg: "#1a1f2a",
    tooltipBorder: "rgba(255,255,255,0.12)",
    tooltipMuted: "#8b93a7",
    tooltipText: "#e6e9ef",
    legendColor: "#a1a8b8",
  },
  light: {
    grid: "rgba(15,23,42,0.08)",
    tick: "#64748b",
    axis: "rgba(15,23,42,0.12)",
    tooltipBg: "#ffffff",
    tooltipBorder: "rgba(15,23,42,0.12)",
    tooltipMuted: "#64748b",
    tooltipText: "#0f172a",
    legendColor: "#475569",
  },
} as const;

type ThemeMode = "light" | "dark";
type WorkStatsGranularity = "day" | "week" | "month";

const THEME_STORAGE_KEY = "cursor-events-analyzer-theme";

function readStoredTheme(): ThemeMode | null {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY);
    if (v === "light" || v === "dark") return v;
  } catch {
    /* ignore */
  }
  return null;
}

function getPreferredTheme(): ThemeMode {
  if (typeof window === "undefined") return "dark";
  const stored = readStoredTheme();
  if (stored) return stored;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function formatMoney(n: number): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
}

function formatInt(n: number): string {
  return new Intl.NumberFormat().format(Math.round(n));
}

function formatPct(n: number): string {
  return `${n.toFixed(1)}%`;
}

function formatHours(h: number): string {
  if (h < 1) return `${Math.round(h * 60)}m`;
  return `${h.toFixed(1)}h`;
}

function formatDateLabel(d: Date): string {
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatTimeLabel(d: Date): string {
  return d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatRowCost(row: UsageRow): string {
  if (row.cost > 0) return formatMoney(row.cost);
  if (row.costLabel) return row.costLabel;
  return formatMoney(0);
}

function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error(`Failed to read ${file.name}`));
    reader.readAsText(file);
  });
}

function isCsvFile(file: File): boolean {
  return file.type === "text/csv" || file.name.toLowerCase().endsWith(".csv");
}

function appTitle(source: ExportSource | "mixed" | null): string {
  if (source === "devin") return "Devin usage analyzer";
  if (source === "mixed") return "Usage analyzer";
  return "Cursor usage analyzer";
}

function topWithOther(items: NamedAmount[], top = 8): { name: string; value: number }[] {
  if (items.length <= top) return items.map((x) => ({ ...x }));
  const head = items.slice(0, top);
  const rest = items.slice(top).reduce((s, x) => s + x.value, 0);
  if (rest > 0) head.push({ name: "Other", value: rest });
  return head;
}

function CustomTooltip({
  active,
  payload,
  label,
  valueLabel = "Value",
  chrome,
}: {
  active?: boolean;
  payload?: { value: number; name?: string; color?: string }[];
  label?: string;
  valueLabel?: string;
  chrome: (typeof CHART_CHROME)[keyof typeof CHART_CHROME];
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0];
  return (
    <div
      style={{
        background: chrome.tooltipBg,
        border: `1px solid ${chrome.tooltipBorder}`,
        borderRadius: 10,
        padding: "10px 12px",
        fontSize: 13,
        boxShadow: "0 4px 24px rgba(0,0,0,0.12)",
      }}
    >
      {label != null && (
        <div style={{ marginBottom: 6, color: chrome.tooltipMuted, fontSize: 12 }}>{label}</div>
      )}
      <div style={{ color: chrome.tooltipText }}>
        {p.name && `${p.name}: `}
        {valueLabel === "Cost" ? formatMoney(p.value) : formatInt(p.value)}
      </div>
    </div>
  );
}

export default function App() {
  const [theme, setTheme] = useState<ThemeMode>(() => getPreferredTheme());
  const [storedFiles, setStoredFiles] = useState<StoredFile[]>([]);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showWorkStats, setShowWorkStats] = useState(false);
  const [workStatsGranularity, setWorkStatsGranularity] = useState<WorkStatsGranularity>("month");

  const chrome = CHART_CHROME[theme];

  useLayoutEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  const toggleTheme = () => setTheme((t) => (t === "dark" ? "light" : "dark"));

  const fileInputRef = useRef<HTMLInputElement>(null);

  const refreshStoredFiles = useCallback(async () => {
    const files = await listStoredFiles();
    setStoredFiles(files);
  }, []);

  useEffect(() => {
    void refreshStoredFiles();
  }, [refreshStoredFiles]);

  const merged = useMemo(() => mergeStoredFiles(storedFiles), [storedFiles]);
  const rows = merged.rows.length > 0 ? merged.rows : null;
  const exportSource = merged.source;
  const parseErrors = useMemo(
    () => [...importErrors, ...merged.errors],
    [importErrors, merged.errors]
  );

  const summary = useMemo(() => (rows?.length ? buildSummary(rows) : null), [rows]);
  const isDevin = exportSource === "devin";
  const showUserBreakdown = !isDevin && exportSource !== "mixed" && (summary?.uniqueUsers ?? 0) > 1;
  const overageSessionCount = useMemo(
    () => (rows && isDevin ? rows.filter((r) => r.cost > 0).length : 0),
    [rows, isDevin]
  );
  const mostlyIncluded = useMemo(
    () => Boolean(!isDevin && summary && summary.includedEventCount > summary.billedEventCount),
    [isDevin, summary]
  );

  const importFiles = useCallback(
    async (files: File[]) => {
      const csvFiles = files.filter(isCsvFile);
      if (csvFiles.length === 0) return;

      const errors: string[] = [];

      for (const file of csvFiles) {
        try {
          const text = await readFileText(file);
          const result = parseUsageCsv(text);
          if (!result.ok) {
            errors.push(`${file.name}: ${result.error}`);
            continue;
          }

          await saveStoredFile({
            id: crypto.randomUUID(),
            name: file.name,
            source: result.source,
            importedAt: Date.now(),
            text,
            rowCount: result.rows.length,
          });
        } catch (err) {
          errors.push(`${file.name}: ${err instanceof Error ? err.message : "Import failed"}`);
        }
      }

      await refreshStoredFiles();
      setImportErrors(errors);
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    [refreshStoredFiles]
  );

  const handleDeleteFile = useCallback(
    async (id: string) => {
      await deleteStoredFile(id);
      await refreshStoredFiles();
    },
    [refreshStoredFiles]
  );

  const openFilePicker = () => fileInputRef.current?.click();

  const onFileInputChange = (fileList: FileList | null) => {
    if (!fileList?.length) return;
    void importFiles(Array.from(fileList));
  };

  const onDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    void importFiles(Array.from(e.dataTransfer.files ?? []));
  };

  const onDropzoneKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openFilePicker();
    }
  };

  const costByModelBarData = useMemo(() => {
    if (!summary) return [];
    const total = summary.totalCost;
    const denom = total > 0 ? total : 1;
    return topWithOther(summary.byModelCost, 12).map((x) => ({
      name: x.name,
      value: x.value,
      pct: (x.value / denom) * 100,
    }));
  }, [summary]);

  const costByModelChartHeight = Math.min(560, Math.max(260, 24 + costByModelBarData.length * 38));

  const workStatsChartData = useMemo(() => {
    if (!summary) return [];
    if (workStatsGranularity === "day") return summary.workStats.byDay;
    if (workStatsGranularity === "week") return summary.workStats.byWeek;
    return summary.workStats.byMonth;
  }, [summary, workStatsGranularity]);

  const workStatsChartHeight = Math.min(320, Math.max(260, 220 + Math.min(workStatsChartData.length, 40) * 0.5));

  return (
    <div className="app">
      <header className="hero">
        <div className="hero-row">
          <div className="hero-text">
            <h1>{appTitle(exportSource)}</h1>
          </div>
          <div className="hero-actions">
            <button
              type="button"
              className="files-toggle"
              onClick={() => setSidebarOpen(true)}
              aria-label={`Open imported files panel, ${storedFiles.length} files`}
              title="Imported files"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
              </svg>
              <span className="files-toggle-label">Files</span>
              {storedFiles.length > 0 && (
                <span className="files-toggle-count">{storedFiles.length}</span>
              )}
            </button>
            <button
              type="button"
              className="theme-toggle"
              onClick={toggleTheme}
              aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
              title={theme === "dark" ? "Light theme" : "Dark theme"}
            >
            <span className="theme-toggle-icon" aria-hidden>
              {theme === "dark" ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <circle cx="12" cy="12" r="4" />
                  <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                </svg>
              )}
            </span>
            <span className="theme-toggle-label">{theme === "dark" ? "Light" : "Dark"}</span>
          </button>
          </div>
        </div>
        <p className="hero-description">
          {exportSource === "devin" ? (
            <>
              Devin sessions from {merged.fileCount} file{merged.fileCount === 1 ? "" : "s"}. See overage
              spend, ACU usage, and session activity over time — all processed in your browser.
            </>
          ) : exportSource === "mixed" ? (
            <>
              Combined Cursor and Devin exports from {merged.fileCount} file
              {merged.fileCount === 1 ? "" : "s"}. See spend and activity over time — all processed in
              your browser.
            </>
          ) : summary ? (
            <>
              Cursor usage from {merged.fileCount} file{merged.fileCount === 1 ? "" : "s"}. See spend,
              tokens, and model mix over time — all processed in your browser.
            </>
          ) : (
            <>
              Upload Cursor team usage or Devin session exports (CSV). You can import multiple files —
              they are saved locally and combined in the dashboard. Export Cursor data from{" "}
              <a href="https://cursor.com/dashboard/usage" target="_blank" rel="noopener noreferrer">
                cursor.com/dashboard/usage
              </a>
              .
            </>
          )}
        </p>
      </header>

      <ImportedFilesSidebar
        open={sidebarOpen}
        files={storedFiles}
        onClose={() => setSidebarOpen(false)}
        onImportClick={openFilePicker}
        onDelete={(id) => void handleDeleteFile(id)}
      />

      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,text/csv"
        multiple
        className="dropzone-hidden-input"
        aria-hidden
        tabIndex={-1}
        onChange={(e) => onFileInputChange(e.target.files)}
      />
      {!summary && (
        <>
          <div
            className="dropzone"
            role="button"
            tabIndex={0}
            onClick={openFilePicker}
            onKeyDown={onDropzoneKeyDown}
            onDragOver={onDragOver}
            onDrop={onDrop}
            aria-label="Upload CSV files: choose files or drag and drop them here"
          >
            <strong>Choose CSV files</strong>
            <span> or drag and drop them here</span>
          </div>

          <p className="privacy-note">
            <span aria-hidden>🔒</span> Your file stays on your machine — everything is processed locally in your browser.
          </p>
        </>
      )}

      {parseErrors.length > 0 && (
        <div className="error" role="alert">
          {parseErrors.map((err) => (
            <p key={err} className="error-line">
              {err}
            </p>
          ))}
        </div>
      )}

      {summary && (
        <>
          <div className="import-bar">
            <span>
              Analyzing {merged.fileCount} imported file{merged.fileCount === 1 ? "" : "s"} (
              {formatInt(summary.rowCount)} rows)
            </span>
            <div className="import-bar-actions">
              <button type="button" className="import-bar-btn" onClick={() => setSidebarOpen(true)}>
                Manage files
              </button>
              <button type="button" className="import-bar-btn import-bar-btn--primary" onClick={openFilePicker}>
                Add files
              </button>
            </div>
          </div>

          {mostlyIncluded && (
            <div className="pricing-notice" role="status">
              Most requests in this export are marked <strong>Included</strong> — covered by your
              Cursor subscription with no extra charge. Only{" "}
              <strong>{formatInt(summary.billedEventCount)}</strong> of{" "}
              <strong>{formatInt(summary.rowCount)}</strong> events have a dollar cost (
              {formatMoney(summary.totalCost)} total billed).
            </div>
          )}

          {summary.byUserCost.length > 0 && showUserBreakdown && (
            <section className="chart-card leaderboard" aria-labelledby="leaderboard-heading">
              <div className="leaderboard-intro">
                <h2 id="leaderboard-heading" className="leaderboard-title">
                  Spend leaderboard
                </h2>
                <p className="leaderboard-desc">Users ranked by total cost in this file.</p>
              </div>
              <ol className="leaderboard-list">
                {summary.byUserCost.map((u, i) => {
                  const rank = i + 1;
                  const pct =
                    summary.totalCost > 0 ? (u.value / summary.totalCost) * 100 : 0;
                  return (
                    <li
                      key={u.name}
                      className={
                        rank <= 3 ? `leaderboard-row leaderboard-row--podium leaderboard-row--${rank}` : "leaderboard-row"
                      }
                      aria-label={`${rank}. ${u.name}, ${formatMoney(u.value)}, ${pct.toFixed(1)}% of total spend`}
                    >
                      <span className="leaderboard-fill" aria-hidden style={{ width: `${Math.max(pct, 4)}%` }} />
                      <span className="leaderboard-rank">{rank}</span>
                      <span className="leaderboard-name" title={u.name}>
                        {u.name}
                      </span>
                      <span className="leaderboard-stats">
                        <span className="leaderboard-pct">{formatPct(pct)}</span>
                        <span className="leaderboard-cost">{formatMoney(u.value)}</span>
                      </span>
                    </li>
                  );
                })}
              </ol>
            </section>
          )}

          <div className="kpi-grid">
            <div className="kpi">
              <div className="kpi-label">{isDevin ? "Total overage" : "Billed spend"}</div>
              <div className="kpi-value">{formatMoney(summary.totalCost)}</div>
              <div className="kpi-sub">
                {isDevin
                  ? "Sum of overage charges"
                  : mostlyIncluded
                    ? `${formatInt(summary.billedEventCount)} paid events`
                    : "Sum of reported cost"}
              </div>
            </div>
            <div className="kpi">
              <div className="kpi-label">{isDevin ? "Total ACU" : "Total tokens"}</div>
              <div className="kpi-value">{formatTokens(summary.totalTokens)}</div>
              <div className="kpi-sub">
                {isDevin ? "Agent compute units used" : "All token types combined"}
              </div>
            </div>
            <div className="kpi">
              <div className="kpi-label">{isDevin ? "Sessions" : "Events"}</div>
              <div className="kpi-value">{formatInt(summary.rowCount)}</div>
              <div className="kpi-sub">{isDevin ? "Devin sessions in export" : "Rows in export"}</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">
                {isDevin ? "Overage sessions" : mostlyIncluded ? "Included" : "Users"}
              </div>
              <div className="kpi-value">
                {isDevin
                  ? formatInt(overageSessionCount)
                  : mostlyIncluded
                    ? formatInt(summary.includedEventCount)
                    : summary.uniqueUsers}
              </div>
              <div className="kpi-sub">
                {isDevin
                  ? "Sessions with overage charges"
                  : mostlyIncluded
                    ? "Subscription-covered requests"
                    : "Distinct emails"}
              </div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Period</div>
              <div className="kpi-value" style={{ fontSize: "1.1rem" }}>
                {summary.dateMin && summary.dateMax
                  ? `${summary.dateMin.toLocaleDateString()} – ${summary.dateMax.toLocaleDateString()}`
                  : "—"}
              </div>
              <div className="kpi-sub">From first to last event</div>
            </div>
            {!isDevin && (
              <div className="kpi">
                <div className="kpi-label">Cache read tokens</div>
                <div className="kpi-value">{formatTokens(summary.totalCacheRead)}</div>
                <div className="kpi-sub">Context from cache</div>
              </div>
            )}
          </div>

          <section className="section">
            <h2 className="section-title">Spend and activity over time</h2>
            <p className="section-desc">
              Daily cost shows how usage charges accrue day by day. Spikes often align with large
              composer sessions or models with bigger context windows.
            </p>
            <div className="chart-card">
              <h3>{isDevin ? "Daily overage (USD)" : "Daily cost (USD)"}</h3>
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={summary.daily} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id={`costFill-${theme}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#6b8cff" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#6b8cff" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={chrome.grid} />
                  <XAxis
                    dataKey="day"
                    tick={{ fill: chrome.tick, fontSize: 11 }}
                    tickLine={false}
                    axisLine={{ stroke: chrome.axis }}
                  />
                  <YAxis
                    tick={{ fill: chrome.tick, fontSize: 11 }}
                    tickFormatter={(v) => `$${v}`}
                    width={48}
                  />
                  <Tooltip
                    content={({ active, payload, label }) => (
                      <CustomTooltip
                        active={active}
                        payload={payload as { value: number }[]}
                        label={label as string}
                        valueLabel="Cost"
                        chrome={chrome}
                      />
                    )}
                  />
                  <Area
                    type="monotone"
                    dataKey="cost"
                    stroke="#6b8cff"
                    strokeWidth={2}
                    fill={`url(#costFill-${theme})`}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {showUserBreakdown && (
            <div className="chart-card">
              <h3>Daily events by user</h3>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={summary.dailyByUser} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={chrome.grid} />
                  <XAxis
                    dataKey="day"
                    tick={{ fill: chrome.tick, fontSize: 11 }}
                    tickLine={false}
                  />
                  <YAxis tick={{ fill: chrome.tick, fontSize: 11 }} width={40} />
                  <Legend
                    wrapperStyle={{ color: chrome.legendColor, fontSize: 12 }}
                    formatter={(value) => (
                      <span style={{ color: chrome.legendColor }}>
                        {String(value).length > 22 ? `${String(value).slice(0, 20)}...` : String(value)}
                      </span>
                    )}
                  />
                  <Tooltip
                    content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null;
                      const items = [...payload]
                        .filter((item) => typeof item.value === "number" && Number(item.value) > 0)
                        .sort((a, b) => Number(b.value) - Number(a.value));

                      return (
                        <div
                          style={{
                            background: chrome.tooltipBg,
                            border: `1px solid ${chrome.tooltipBorder}`,
                            borderRadius: 10,
                            padding: "10px 12px",
                            fontSize: 13,
                            boxShadow: "0 4px 24px rgba(0,0,0,0.12)",
                          }}
                        >
                          <div style={{ marginBottom: 6, color: chrome.tooltipMuted, fontSize: 12 }}>
                            {label as string}
                          </div>
                          {items.map((item) => (
                            <div
                              key={String(item.dataKey)}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                gap: 12,
                                color: chrome.tooltipText,
                              }}
                            >
                              <span
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 8,
                                  minWidth: 0,
                                }}
                              >
                                <span
                                  style={{
                                    width: 8,
                                    height: 8,
                                    borderRadius: 999,
                                    background: item.color,
                                    flexShrink: 0,
                                  }}
                                />
                                <span title={String(item.name)}>
                                  {String(item.name).length > 28
                                    ? `${String(item.name).slice(0, 26)}...`
                                    : String(item.name)}
                                </span>
                              </span>
                              <span>{formatInt(Number(item.value))}</span>
                            </div>
                          ))}
                        </div>
                      );
                    }}
                  />
                  {summary.dailyUserSeries.map((user, i) => (
                    <Bar
                      key={user}
                      dataKey={user}
                      stackId="events"
                      fill={CHART_COLORS[i % CHART_COLORS.length]}
                      radius={i === summary.dailyUserSeries.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
                      name={user}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
            )}
          </section>

          <section className="section">
            <h2 className="section-title">Models and billing kinds</h2>
            <p className="section-desc">
              {isDevin
                ? "Compare overage spend versus ACU consumed per session type."
                : "Compare which models drive cost versus raw token volume. Premium or long-context models can move the needle on spend even when event counts look similar."}
            </p>
            <div className="grid-2">
              <div className="chart-card">
                <h3>{mostlyIncluded ? "Requests by cost type" : "Cost by model"}</h3>
                <ResponsiveContainer width="100%" height={mostlyIncluded ? 300 : costByModelChartHeight}>
                  {mostlyIncluded ? (
                    <BarChart
                      layout="vertical"
                      data={summary.byCostLabel.slice(0, 10)}
                      margin={{ top: 8, right: 20, left: 8, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke={chrome.grid} horizontal={false} />
                      <XAxis type="number" tick={{ fill: chrome.tick, fontSize: 11 }} />
                      <YAxis
                        type="category"
                        dataKey="name"
                        width={120}
                        tick={{ fill: chrome.tick, fontSize: 10 }}
                      />
                      <Tooltip
                        formatter={(v: number) => formatInt(v)}
                        contentStyle={{
                          background: chrome.tooltipBg,
                          border: `1px solid ${chrome.tooltipBorder}`,
                          borderRadius: 10,
                          color: chrome.tooltipText,
                        }}
                      />
                      <Bar dataKey="value" fill="#6b8cff" radius={[0, 4, 4, 0]} name="Requests" />
                    </BarChart>
                  ) : (
                  <BarChart
                    layout="vertical"
                    data={costByModelBarData}
                    margin={{ top: 8, right: 88, left: 4, bottom: 8 }}
                    barCategoryGap="12%"
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke={chrome.grid} horizontal={false} />
                    <XAxis
                      type="number"
                      tick={{ fill: chrome.tick, fontSize: 11 }}
                      tickFormatter={(v) => `$${v}`}
                      domain={[0, "auto"]}
                      axisLine={{ stroke: chrome.axis }}
                    />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={148}
                      tick={{ fill: chrome.tick, fontSize: 10 }}
                      tickFormatter={(v: string) => (v.length > 22 ? `${v.slice(0, 20)}…` : v)}
                      interval={0}
                    />
                    <Tooltip
                      cursor={{ fill: "rgba(107, 140, 255, 0.06)" }}
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null;
                        const row = payload[0].payload as {
                          name: string;
                          value: number;
                          pct: number;
                        };
                        return (
                          <div
                            style={{
                              background: chrome.tooltipBg,
                              border: `1px solid ${chrome.tooltipBorder}`,
                              borderRadius: 10,
                              padding: "10px 12px",
                              fontSize: 13,
                              boxShadow: "0 4px 24px rgba(0,0,0,0.12)",
                            }}
                          >
                            <div style={{ fontWeight: 600, color: chrome.tooltipText, marginBottom: 4 }}>
                              {row.name}
                            </div>
                            <div style={{ color: chrome.tooltipText }}>{formatMoney(row.value)}</div>
                            <div style={{ color: chrome.tooltipMuted, fontSize: 12, marginTop: 4 }}>
                              {row.pct.toFixed(1)}% of total spend
                            </div>
                          </div>
                        );
                      }}
                    />
                    <Bar dataKey="value" radius={[0, 6, 6, 0]} maxBarSize={28}>
                      {costByModelBarData.map((_, i) => (
                        <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                      ))}
                      <LabelList
                        dataKey="value"
                        position="right"
                        formatter={(v: number) => formatMoney(v)}
                        style={{ fill: chrome.tick, fontSize: 11, fontWeight: 500 }}
                      />
                    </Bar>
                  </BarChart>
                  )}
                </ResponsiveContainer>
              </div>

              <div className="chart-card">
                <h3>{isDevin ? "ACU by model" : "Tokens by model (top)"}</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart
                    layout="vertical"
                    data={summary.byModelTokens.slice(0, 10)}
                    margin={{ top: 8, right: 20, left: 8, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke={chrome.grid} />
                    <XAxis type="number" tick={{ fill: chrome.tick, fontSize: 11 }} tickFormatter={formatTokens} />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={120}
                      tick={{ fill: chrome.tick, fontSize: 10 }}
                    />
                    <Tooltip
                      formatter={(v: number) => formatInt(v)}
                      contentStyle={{
                        background: chrome.tooltipBg,
                        border: `1px solid ${chrome.tooltipBorder}`,
                        borderRadius: 10,
                        color: chrome.tooltipText,
                        boxShadow: "0 4px 24px rgba(0,0,0,0.12)",
                      }}
                    />
                    <Bar dataKey="value" fill="#f472b6" radius={[0, 4, 4, 0]} name="Tokens" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="chart-card">
              <h3>{mostlyIncluded ? "Events by billing kind" : "Cost by billing kind"}</h3>
              <ResponsiveContainer width="100%" height={240}>
                {mostlyIncluded ? (
                  <BarChart data={summary.byKindEvents} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={chrome.grid} />
                    <XAxis dataKey="name" tick={{ fill: chrome.tick, fontSize: 11 }} />
                    <YAxis tick={{ fill: chrome.tick, fontSize: 11 }} width={48} />
                    <Tooltip
                      formatter={(v: number) => formatInt(v)}
                      contentStyle={{
                        background: chrome.tooltipBg,
                        border: `1px solid ${chrome.tooltipBorder}`,
                        borderRadius: 10,
                        color: chrome.tooltipText,
                      }}
                    />
                    <Bar dataKey="value" fill="#3dd6c3" radius={[4, 4, 0, 0]} name="Events" />
                  </BarChart>
                ) : (
                <BarChart data={summary.byKindUser} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={chrome.grid} />
                  <XAxis dataKey="name" tick={{ fill: chrome.tick, fontSize: 11 }} />
                  <YAxis tick={{ fill: chrome.tick, fontSize: 11 }} tickFormatter={(v) => `$${v}`} />
                  <Legend
                    wrapperStyle={{ color: chrome.legendColor, fontSize: 12 }}
                    formatter={(value) => (
                      <span style={{ color: chrome.legendColor }}>
                        {String(value).length > 22 ? `${String(value).slice(0, 20)}...` : String(value)}
                      </span>
                    )}
                  />
                  <Tooltip
                    content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null;
                      const items = [...payload]
                        .filter((item) => typeof item.value === "number" && Number(item.value) > 0)
                        .sort((a, b) => Number(b.value) - Number(a.value));

                      return (
                        <div
                          style={{
                            background: chrome.tooltipBg,
                            border: `1px solid ${chrome.tooltipBorder}`,
                            borderRadius: 10,
                            padding: "10px 12px",
                            fontSize: 13,
                            boxShadow: "0 4px 24px rgba(0,0,0,0.12)",
                          }}
                        >
                          <div style={{ marginBottom: 6, color: chrome.tooltipMuted, fontSize: 12 }}>
                            {label as string}
                          </div>
                          {items.map((item) => (
                            <div
                              key={String(item.dataKey)}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                gap: 12,
                                color: chrome.tooltipText,
                              }}
                            >
                              <span
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 8,
                                  minWidth: 0,
                                }}
                              >
                                <span
                                  style={{
                                    width: 8,
                                    height: 8,
                                    borderRadius: 999,
                                    background: item.color,
                                    flexShrink: 0,
                                  }}
                                />
                                <span title={String(item.name)}>
                                  {String(item.name).length > 28
                                    ? `${String(item.name).slice(0, 26)}...`
                                    : String(item.name)}
                                </span>
                              </span>
                              <span>{formatMoney(Number(item.value))}</span>
                            </div>
                          ))}
                        </div>
                      );
                    }}
                  />
                  {summary.kindUserSeries.map((user, i) => (
                    <Bar
                      key={user}
                      dataKey={user}
                      stackId="billing-kind"
                      fill={CHART_COLORS[i % CHART_COLORS.length]}
                      radius={i === summary.kindUserSeries.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
                      name={user}
                    />
                  ))}
                </BarChart>
                )}
              </ResponsiveContainer>
            </div>
          </section>

          <section className="section">
            <h2 className="section-title">Top spenders &amp; largest requests</h2>
            <p className="section-desc">
              {isDevin
                ? "Sessions with the largest overage charges in this export."
                : mostlyIncluded
                  ? "Paid requests with dollar amounts, and the largest token-heavy requests (mostly subscription-covered)."
                  : "Users ranked by total cost in this file, and the single most expensive rows — useful to spot one-off heavy jobs."}
            </p>
            <div className="grid-2 grid-2--tables">
              {showUserBreakdown && (
              <div className="chart-card table-card">
                <div className="table-card-header">
                  <h3 className="section-title table-card-title">Cost by user</h3>
                  <p className="table-card-desc">Ranked by total spend with share of overall cost.</p>
                </div>
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th className="num">#</th>
                        <th>User</th>
                        <th>Share</th>
                        <th>Cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.byUserCost.map((u, i) => {
                        const pct = summary.totalCost > 0 ? (u.value / summary.totalCost) * 100 : 0;
                        return (
                        <tr key={u.name}>
                          <td className="num cell-rank">
                            <span className="rank-badge">{i + 1}</span>
                          </td>
                          <td className="cell-main">
                            <span className="cell-primary" title={u.name}>
                              {u.name}
                            </span>
                          </td>
                          <td className="cell-share">
                            <span className="cell-share-value">{formatPct(pct)}</span>
                            <span className="cell-share-bar" aria-hidden>
                              <span className="cell-share-bar-fill" style={{ width: `${pct}%` }} />
                            </span>
                          </td>
                          <td className="num">{formatMoney(u.value)}</td>
                        </tr>
                      )})}
                    </tbody>
                  </table>
                </div>
              </div>
              )}
              {(summary.topExpensive.length > 0 || isDevin) && (
              <div className="chart-card table-card">
                <div className="table-card-header">
                  <h3 className="section-title table-card-title">
                    {isDevin ? "Highest overage sessions" : "Highest-cost events"}
                  </h3>
                  <p className="table-card-desc">
                    {isDevin
                      ? "Devin sessions with the largest overage charges in this export."
                      : "Rows with an actual dollar cost in the export."}
                  </p>
                </div>
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th className="num">#</th>
                        <th>When</th>
                        {!isDevin && <th>User</th>}
                        <th>{isDevin ? "Session" : "Model"}</th>
                        <th>Cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.topExpensive.map((r, i) => (
                        <tr key={i}>
                          <td className="num cell-rank">
                            <span className="rank-badge">{i + 1}</span>
                          </td>
                          <td className="cell-main">
                            <span className="cell-primary">{formatDateLabel(r.date)}</span>
                            <span className="cell-secondary">{formatTimeLabel(r.date)}</span>
                          </td>
                          {!isDevin && (
                            <td className="cell-main">
                              <span className="cell-primary" title={r.user}>
                                {r.user}
                              </span>
                            </td>
                          )}
                          <td className="cell-main">
                            <span className="cell-primary" title={isDevin ? r.label ?? r.model : r.model}>
                              {isDevin ? r.label ?? r.model : r.model}
                            </span>
                            {!isDevin && (
                              <span className="cell-secondary">
                                <span className="badge">{r.kind}</span>
                              </span>
                            )}
                          </td>
                          <td className="num">{formatRowCost(r)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              )}
              {!isDevin && (
              <div className="chart-card table-card">
                <div className="table-card-header">
                  <h3 className="section-title table-card-title">Largest requests</h3>
                  <p className="table-card-desc">
                    Highest token usage per request, including subscription-covered usage.
                  </p>
                </div>
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th className="num">#</th>
                        <th>When</th>
                        <th>Model</th>
                        <th>Tokens</th>
                        <th>Cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.topByTokens.map((r, i) => (
                        <tr key={i}>
                          <td className="num cell-rank">
                            <span className="rank-badge">{i + 1}</span>
                          </td>
                          <td className="cell-main">
                            <span className="cell-primary">{formatDateLabel(r.date)}</span>
                            <span className="cell-secondary">{formatTimeLabel(r.date)}</span>
                          </td>
                          <td className="cell-main">
                            <span className="cell-primary" title={r.model}>
                              {r.model}
                            </span>
                            <span className="cell-secondary">
                              <span className="badge">{r.kind}</span>
                            </span>
                          </td>
                          <td className="num">{formatTokens(r.totalTokens)}</td>
                          <td className="num">{formatRowCost(r)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              )}
            </div>
          </section>

          <section className="section work-stats-section">
            <div className="work-stats-header">
              <div className="work-stats-heading">
                <h2 className="section-title">Work days &amp; hours</h2>
                <p className="section-desc">
                  Active days and estimated session hours over the full period. Switch Day, Week, or
                  Month to change the time bucket.
                </p>
              </div>
              <button
                type="button"
                className="visibility-toggle"
                onClick={() => setShowWorkStats((v) => !v)}
                aria-label={showWorkStats ? "Hide work stats" : "Show work stats"}
                aria-pressed={showWorkStats}
                title={showWorkStats ? "Hide work stats" : "Show work stats"}
              >
                <span className="visibility-toggle-icon" aria-hidden>
                  {showWorkStats ? (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                      <path d="M1 1l22 22" />
                      <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
                    </svg>
                  )}
                </span>
              </button>
            </div>

            {showWorkStats && (
              <>
                <div className="work-stats-kpis">
                  <div className="kpi">
                    <div className="kpi-label">Active days</div>
                    <div className="kpi-value">{formatInt(summary.workStats.activeDays)}</div>
                    <div className="kpi-sub">Days with at least one event</div>
                  </div>
                  <div className="kpi">
                    <div className="kpi-label">Active hours</div>
                    <div className="kpi-value">{formatHours(summary.workStats.totalActiveHours)}</div>
                    <div className="kpi-sub">First-to-last span per day</div>
                  </div>
                  <div className="kpi">
                    <div className="kpi-label">Avg per day</div>
                    <div className="kpi-value">{formatHours(summary.workStats.avgHoursPerDay)}</div>
                    <div className="kpi-sub">On active days only</div>
                  </div>
                </div>

                <div className="granularity-toggle" role="tablist" aria-label="Work stats granularity">
                  {(["day", "week", "month"] as const).map((g) => (
                    <button
                      key={g}
                      type="button"
                      role="tab"
                      aria-selected={workStatsGranularity === g}
                      className={workStatsGranularity === g ? "granularity-btn is-active" : "granularity-btn"}
                      onClick={() => setWorkStatsGranularity(g)}
                    >
                      {g === "day" ? "Day" : g === "week" ? "Week" : "Month"}
                    </button>
                  ))}
                </div>

                <div className="chart-card">
                  <h3>
                    {workStatsGranularity === "day"
                      ? "Daily activity"
                      : workStatsGranularity === "week"
                        ? "Weekly activity"
                        : "Monthly activity"}
                  </h3>
                  <ResponsiveContainer width="100%" height={workStatsChartHeight}>
                    <BarChart data={workStatsChartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={chrome.grid} />
                      <XAxis
                        dataKey="label"
                        tick={{ fill: chrome.tick, fontSize: 10 }}
                        tickLine={false}
                        interval={workStatsGranularity === "day" ? "preserveStartEnd" : 0}
                        minTickGap={workStatsGranularity === "day" ? 28 : 8}
                      />
                      <YAxis
                        yAxisId="events"
                        tick={{ fill: chrome.tick, fontSize: 11 }}
                        width={40}
                      />
                      <YAxis
                        yAxisId="hours"
                        orientation="right"
                        tick={{ fill: chrome.tick, fontSize: 11 }}
                        tickFormatter={(v) => formatHours(v)}
                        width={48}
                      />
                      <Legend wrapperStyle={{ color: chrome.legendColor, fontSize: 12 }} />
                      <Tooltip
                        content={({ active, payload, label }) => {
                          if (!active || !payload?.length) return null;
                          const row = payload[0]?.payload as {
                            events: number;
                            hours: number;
                            activeDays?: number;
                          };
                          return (
                            <div
                              style={{
                                background: chrome.tooltipBg,
                                border: `1px solid ${chrome.tooltipBorder}`,
                                borderRadius: 10,
                                padding: "10px 12px",
                                fontSize: 13,
                                boxShadow: "0 4px 24px rgba(0,0,0,0.12)",
                              }}
                            >
                              <div style={{ marginBottom: 6, color: chrome.tooltipMuted, fontSize: 12 }}>
                                {label as string}
                              </div>
                              <div style={{ color: chrome.tooltipText }}>{formatInt(row.events)} events</div>
                              {row.activeDays != null && (
                                <div style={{ color: chrome.tooltipText, marginTop: 4 }}>
                                  {formatInt(row.activeDays)} active days
                                </div>
                              )}
                              <div style={{ color: chrome.tooltipText, marginTop: 4 }}>
                                {formatHours(row.hours)} active
                              </div>
                            </div>
                          );
                        }}
                      />
                      <Bar
                        yAxisId="events"
                        dataKey="events"
                        fill="#6b8cff"
                        radius={[4, 4, 0, 0]}
                        name="Events"
                        maxBarSize={workStatsGranularity === "day" ? 6 : 28}
                      />
                      <Bar
                        yAxisId="hours"
                        dataKey="hours"
                        fill="#f0b429"
                        radius={[4, 4, 0, 0]}
                        name="Active hours"
                        maxBarSize={workStatsGranularity === "day" ? 6 : 28}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </>
            )}
          </section>

          <div className="explain">
            <h2>How to read these metrics</h2>
            <dl>
              {isDevin ? (
                <>
                  <dt>Total ACU</dt>
                  <dd>
                    Devin reports Agent Compute Units (ACU) per session. This is the closest
                    equivalent to token volume for comparing session intensity.
                  </dd>
                  <dt>Overage cost</dt>
                  <dd>
                    Dollar amounts come from the <strong>overage_dollars</strong> column — charges
                    beyond your plan&apos;s included ACU. Sessions with zero overage still count as
                    activity but do not add to total spend.
                  </dd>
                </>
              ) : (
                <>
                  <dt>Total tokens</dt>
                  <dd>
                    Cursor reports input (with/without cache write), cache read, and output tokens.
                    Large <strong>cache read</strong> means the model reused a lot of prior context —
                    often cheaper per token than fresh input.
                  </dd>
                  <dt>Cost</dt>
                  <dd>
                    Dollar amounts come from numeric values in the Cost column. Many Cursor exports mark
                    subscription usage as <strong>Included</strong> or <strong>Free</strong> instead of
                    a dollar amount — those requests count as activity but not as extra billed spend.
                  </dd>
                </>
              )}
              <dt>Daily cost vs daily events</dt>
              <dd>
                Many small events can cost less than one huge composer run. Compare the two charts
                to see whether spend is steady or driven by occasional large sessions.
              </dd>
              <dt>Work days &amp; hours</dt>
              <dd>
                Active hours group prompts into sessions. A new session starts after 30 minutes
                with no prompts. Each session counts from its first to last prompt (minimum 15
                minutes for a single prompt). Day shows each calendar day, Week groups
                Monday-Sunday buckets, and Month rolls up full calendar months across your export.
              </dd>
              <dt>Privacy</dt>
              <dd>
                Parsing runs entirely in your browser; files are not uploaded to any server.
              </dd>
            </dl>
          </div>

          <footer className="app-footer">
            <p>
              <span aria-hidden>🔒</span> All processing happens locally in your browser. Your CSV is never uploaded to any server.
            </p>
          </footer>
        </>
      )}
    </div>
  );
}
