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
  LabelList,
  Legend,
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

function formatPct(n: number): string {
  return `${n.toFixed(1)}%`;
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
      {!summary && (
        <>
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

          <p className="privacy-note">
            <span aria-hidden>🔒</span> Your file stays on your machine — everything is processed locally in your browser.
          </p>
        </>
      )}

      {parseError && <div className="error" role="alert">{parseError}</div>}

      {summary && (
        <>
          {summary.byUserCost.length > 0 && (
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
                <ResponsiveContainer width="100%" height={costByModelChartHeight}>
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
              <ResponsiveContainer width="100%" height={240}>
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
              </ResponsiveContainer>
            </div>
          </section>

          <section className="section">
            <h2 className="section-title">Top spenders &amp; largest requests</h2>
            <p className="section-desc">
              Users ranked by total cost in this file, and the single most expensive rows — useful
              to spot one-off heavy jobs.
            </p>
            <div className="grid-2 grid-2--tables">
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
              <div className="chart-card table-card">
                <div className="table-card-header">
                  <h3 className="section-title table-card-title">Highest-cost events</h3>
                  <p className="table-card-desc">Most expensive individual rows in the uploaded export.</p>
                </div>
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th className="num">#</th>
                        <th>When</th>
                        <th>User</th>
                        <th>Model</th>
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
                          <td className="cell-main">
                            <span className="cell-primary" title={r.user}>
                              {r.user}
                            </span>
                          </td>
                          <td className="cell-main">
                            <span className="cell-primary" title={r.model}>
                              {r.model}
                            </span>
                            <span className="cell-secondary">
                              <span className="badge">{r.kind}</span>
                            </span>
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
