import {
  useCallback,
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
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { buildSummary } from "./analytics";
import { parseUsageCsv } from "./parseCsv";
import type { NamedAmount, UsageRow } from "./types";

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
  chrome: (typeof CHART_CHROME)["dark"];
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
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<UsageRow[] | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

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

  const summary = useMemo(() => (rows?.length ? buildSummary(rows) : null), [rows]);

  const loadText = useCallback((text: string, name: string) => {
    const result = parseUsageCsv(text);
    if (!result.ok) {
      setParseError(result.error);
      setRows(null);
      setFileName(name);
      return;
    }
    setParseError(null);
    setRows(result.rows);
    setFileName(name);
  }, []);

  const onFile = (f: File | null) => {
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      loadText(text, f.name);
    };
    reader.readAsText(f);
  };

  const onDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const f = e.dataTransfer.files?.[0];
    if (f && (f.type === "text/csv" || f.name.endsWith(".csv"))) onFile(f);
  };

  const onDropzoneKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fileInputRef.current?.click();
    }
  };

  const pieCostData = useMemo(() => {
    if (!summary) return [];
    return topWithOther(summary.byModelCost, 8).map((x) => ({
      name: x.name,
      value: x.value,
    }));
  }, [summary]);

  return (
    <div className="app">
      <header className="hero">
        <div className="hero-row">
          <div className="hero-text">
            <h1>Cursor usage analyzer</h1>
          </div>
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
        <p className="hero-description">
          Upload a Cursor team usage export (CSV) from{" "}
          <a href="https://cursor.com/dashboard/usage" target="_blank" rel="noopener noreferrer">
            cursor.com/dashboard/usage
          </a>
          . See spend, tokens, and model mix over time — all processed in your browser.
        </p>
      </header>

      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,text/csv"
        className="dropzone-hidden-input"
        aria-hidden
        tabIndex={-1}
        onChange={(e) => onFile(e.target.files?.[0] ?? null)}
      />
      <div
        className="dropzone"
        role="button"
        tabIndex={0}
        onClick={() => fileInputRef.current?.click()}
        onKeyDown={onDropzoneKeyDown}
        onDragOver={onDragOver}
        onDrop={onDrop}
        aria-label="Upload CSV: choose a file or drag and drop it here"
      >
        <strong>Choose a CSV file</strong>
        <span> or drag and drop it here</span>
      </div>

      {fileName && <p className="file-name">Loaded: {fileName}</p>}

      {parseError && <div className="error" role="alert">{parseError}</div>}

      {summary && (
        <>
          <div className="kpi-grid">
            <div className="kpi">
              <div className="kpi-label">Total spend</div>
              <div className="kpi-value">{formatMoney(summary.totalCost)}</div>
              <div className="kpi-sub">Sum of reported cost</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Total tokens</div>
              <div className="kpi-value">{formatTokens(summary.totalTokens)}</div>
              <div className="kpi-sub">All token types combined</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Events</div>
              <div className="kpi-value">{formatInt(summary.rowCount)}</div>
              <div className="kpi-sub">Rows in export</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Users</div>
              <div className="kpi-value">{summary.uniqueUsers}</div>
              <div className="kpi-sub">Distinct emails</div>
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
            <div className="kpi">
              <div className="kpi-label">Cache read tokens</div>
              <div className="kpi-value">{formatTokens(summary.totalCacheRead)}</div>
              <div className="kpi-sub">Context from cache</div>
            </div>
          </div>

          <section className="section">
            <h2 className="section-title">Spend and activity over time</h2>
            <p className="section-desc">
              Daily cost shows how usage charges accrue day by day. Spikes often align with large
              composer sessions or models with bigger context windows.
            </p>
            <div className="chart-card">
              <h3>Daily cost (USD)</h3>
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

            <div className="chart-card">
              <h3>Daily events (count)</h3>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={summary.daily} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={chrome.grid} />
                  <XAxis
                    dataKey="day"
                    tick={{ fill: chrome.tick, fontSize: 11 }}
                    tickLine={false}
                  />
                  <YAxis tick={{ fill: chrome.tick, fontSize: 11 }} width={40} />
                  <Tooltip
                    content={({ active, payload, label }) => (
                      <CustomTooltip
                        active={active}
                        payload={payload as { value: number }[]}
                        label={label as string}
                        valueLabel="Events"
                        chrome={chrome}
                      />
                    )}
                  />
                  <Bar dataKey="events" fill="#3dd6c3" radius={[4, 4, 0, 0]} name="Events" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="section">
            <h2 className="section-title">Models and billing kinds</h2>
            <p className="section-desc">
              Compare which models drive cost versus raw token volume. Premium or long-context
              models can move the needle on spend even when event counts look similar.
            </p>
            <div className="grid-2">
              <div className="chart-card">
                <h3>Cost by model</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={pieCostData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={105}
                      innerRadius={28}
                      paddingAngle={2}
                      label={({ percent }) => `${(percent * 100).toFixed(0)}%`}
                      labelLine={{ stroke: chrome.tick }}
                    >
                      {pieCostData.map((_, i) => (
                        <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value: number) => formatMoney(value)}
                      contentStyle={{
                        background: chrome.tooltipBg,
                        border: `1px solid ${chrome.tooltipBorder}`,
                        borderRadius: 10,
                        color: chrome.tooltipText,
                        boxShadow: "0 4px 24px rgba(0,0,0,0.12)",
                      }}
                    />
                    <Legend wrapperStyle={{ color: chrome.legendColor, fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              <div className="chart-card">
                <h3>Tokens by model (top)</h3>
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
              <h3>Cost by billing kind</h3>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={summary.byKind} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={chrome.grid} />
                  <XAxis dataKey="name" tick={{ fill: chrome.tick, fontSize: 11 }} />
                  <YAxis tick={{ fill: chrome.tick, fontSize: 11 }} tickFormatter={(v) => `$${v}`} />
                  <Tooltip
                    formatter={(v: number) => formatMoney(v)}
                    contentStyle={{
                      background: chrome.tooltipBg,
                      border: `1px solid ${chrome.tooltipBorder}`,
                      borderRadius: 10,
                      color: chrome.tooltipText,
                      boxShadow: "0 4px 24px rgba(0,0,0,0.12)",
                    }}
                  />
                  <Bar dataKey="value" fill="#f0b429" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="section">
            <h2 className="section-title">Top spenders &amp; largest requests</h2>
            <p className="section-desc">
              Users ranked by total cost in this file, and the single most expensive rows — useful
              to spot one-off heavy jobs.
            </p>
            <div className="grid-2">
              <div>
                <h3 className="section-title" style={{ fontSize: "0.95rem" }}>
                  Cost by user
                </h3>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>User</th>
                        <th>Cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.byUserCost.map((u) => (
                        <tr key={u.name}>
                          <td style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis" }}>
                            {u.name}
                          </td>
                          <td className="num">{formatMoney(u.value)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <div>
                <h3 className="section-title" style={{ fontSize: "0.95rem" }}>
                  Highest-cost events
                </h3>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>When</th>
                        <th>Model</th>
                        <th>Cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.topExpensive.map((r, i) => (
                        <tr key={i}>
                          <td className="num">{r.date.toLocaleString()}</td>
                          <td style={{ maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis" }}>
                            {r.model}
                          </td>
                          <td className="num">{formatMoney(r.cost)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </section>

          <div className="explain">
            <h2>How to read these metrics</h2>
            <dl>
              <dt>Total tokens</dt>
              <dd>
                Cursor reports input (with/without cache write), cache read, and output tokens.
                Large <strong>cache read</strong> means the model reused a lot of prior context —
                often cheaper per token than fresh input.
              </dd>
              <dt>Cost</dt>
              <dd>
                Dollar amounts come straight from the CSV. They reflect model pricing and usage for
                each billed event (e.g. on-demand vs included allowance).
              </dd>
              <dt>Daily cost vs daily events</dt>
              <dd>
                Many small events can cost less than one huge composer run. Compare the two charts
                to see whether spend is steady or driven by occasional large sessions.
              </dd>
              <dt>Privacy</dt>
              <dd>
                Parsing runs entirely in your browser; files are not uploaded to any server.
              </dd>
            </dl>
          </div>
        </>
      )}
    </div>
  );
}
