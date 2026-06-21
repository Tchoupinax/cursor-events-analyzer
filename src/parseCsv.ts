import Papa from "papaparse";
import type { ExportSource, UsageRow } from "./types";

function normKey(s: string): string {
  return s.trim().toLowerCase().replace(/[_\s]+/g, " ");
}

/** Map common header variants to canonical keys */
function buildColumnMap(headers: string[]): Record<string, string> | null {
  const map: Record<string, string> = {};
  const byNorm = new Map<string, string>();
  for (const h of headers) {
    byNorm.set(normKey(h), h);
  }

  const pick = (...candidates: string[]): string | undefined => {
    for (const c of candidates) {
      const found = byNorm.get(normKey(c));
      if (found) return found;
    }
    return undefined;
  };

  const dateCol = pick("date", "timestamp", "time");
  const userCol = pick("user", "email", "member");
  const kindCol = pick("kind", "type", "plan");
  const modelCol = pick("model");
  const maxModeCol = pick("max mode", "maxmode");
  const inCacheCol = pick("input (w/ cache write)", "input w/ cache write");
  const inNoCacheCol = pick("input (w/o cache write)", "input w/o cache write");
  const cacheReadCol = pick("cache read");
  const outTokCol = pick("output tokens", "output");
  const totalTokCol = pick("total tokens", "total");
  const costCol = pick("cost", "amount", "usd");

  if (!dateCol || !totalTokCol) {
    return null;
  }

  map.date = dateCol;
  map.user = userCol ?? "user";
  map.kind = kindCol ?? "kind";
  map.model = modelCol ?? "model";
  map.maxMode = maxModeCol ?? "max mode";
  map.inputCacheWrite = inCacheCol ?? "input (w/ cache write)";
  map.inputNoCacheWrite = inNoCacheCol ?? "input (w/o cache write)";
  map.cacheRead = cacheReadCol ?? "cache read";
  map.outputTokens = outTokCol ?? "output tokens";
  map.totalTokens = totalTokCol;
  map.cost = costCol ?? "cost";

  return map;
}

function parseNum(v: string | undefined): number {
  if (v == null || v === "") return 0;
  const n = Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function parseDate(s: string): Date | null {
  const trimmed = s.replace(/^"|"$/g, "").trim();
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (dateOnly) {
    return new Date(+dateOnly[1], +dateOnly[2] - 1, +dateOnly[3], 12, 0, 0);
  }
  const d = new Date(trimmed);
  return Number.isNaN(d.getTime()) ? null : d;
}

function isAnalyticsFormat(headers: string[]): boolean {
  const byNorm = new Map(headers.map((h) => [normKey(h), h]));
  return (
    byNorm.has("chats composer requests") &&
    byNorm.has("agent lines total lines suggested")
  );
}

function isDevinFormat(headers: string[]): boolean {
  const byNorm = new Map(headers.map((h) => [normKey(h), h]));
  const has = (...names: string[]) => names.every((name) => byNorm.has(normKey(name)));
  return has("session_name", "session_id", "created_at", "acu_used", "overage_dollars");
}

function devinSessionAcu(acuUsed: number, overage: number): number {
  if (acuUsed > 0) return acuUsed;
  // Recent Devin exports often leave acu_used at 0 and bill via overage instead.
  return overage > 0 ? overage : 0;
}

function parseDevinRows(rows: string[][], headers: string[]): UsageRow[] {
  const idx = (name: string) => headers.findIndex((h) => normKey(h) === normKey(name));
  const iName = idx("session_name");
  const iCreated = idx("created_at");
  const iAcu = idx("acu_used");
  const iOverage = idx("overage_dollars");

  if (iCreated < 0) return [];

  const out: UsageRow[] = [];

  for (let r = 1; r < rows.length; r++) {
    const line = rows[r];
    const dateStr = String(line[iCreated] ?? "").trim();
    if (!dateStr) continue;

    const date = parseDate(dateStr);
    if (!date) continue;

    const sessionName = String(line[iName] ?? "").replace(/^"|"$/g, "").trim();
    const acuUsed = iAcu >= 0 ? parseNum(line[iAcu]) : 0;
    const overage = iOverage >= 0 ? parseNum(line[iOverage]) : 0;
    const sessionAcu = devinSessionAcu(acuUsed, overage);

    out.push({
      date,
      user: "Team",
      kind: "session",
      model: "Devin",
      maxMode: "",
      inputCacheWrite: 0,
      inputNoCacheWrite: 0,
      cacheRead: 0,
      outputTokens: 0,
      totalTokens: sessionAcu,
      cost: overage,
      label: sessionName || undefined,
    });
  }

  return out;
}

function parseAnalyticsRows(rows: string[][], headers: string[]): UsageRow[] {
  const idx = (name: string) => headers.findIndex((h) => normKey(h) === normKey(name));
  const iDate = idx("Date");
  const iComposer = idx("Chats Composer Requests");
  const iAgent = idx("Chats Agent Requests");
  const iLines = idx("Agent Lines Total Lines Accepted");
  const iTabs = idx("Tabs Total Accepts");

  if (iDate < 0) return [];

  const out: UsageRow[] = [];

  for (let r = 1; r < rows.length; r++) {
    const line = rows[r];
    const dateStr = String(line[iDate] ?? "").trim();
    if (!dateStr) continue;

    const date = parseDate(dateStr);
    if (!date) continue;

    const activity =
      (iComposer >= 0 ? parseNum(line[iComposer]) : 0) +
      (iAgent >= 0 ? parseNum(line[iAgent]) : 0) +
      (iTabs >= 0 ? parseNum(line[iTabs]) : 0);
    const tokens = iLines >= 0 ? parseNum(line[iLines]) : 0;

    if (activity <= 0 && tokens <= 0) continue;

    const eventCount = Math.max(Math.round(activity), 1);
    const tokensPerEvent = eventCount > 0 ? Math.max(tokens / eventCount, 0) : 0;

    for (let i = 0; i < eventCount; i++) {
      const hour = 9 + Math.floor((i / Math.max(eventCount - 1, 1)) * 9);
      const minute = (i * 13) % 60;
      out.push({
        date: new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, minute),
        user: "Team",
        kind: "analytics",
        model: "(unknown)",
        maxMode: "",
        inputCacheWrite: 0,
        inputNoCacheWrite: 0,
        cacheRead: 0,
        outputTokens: 0,
        totalTokens: tokensPerEvent,
        cost: 0,
      });
    }
  }

  return out;
}

export type ParseResult =
  | { ok: true; rows: UsageRow[]; rawHeaders: string[]; source: ExportSource }
  | { ok: false; error: string };

export function parseUsageCsv(raw: string): ParseResult {
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  const parsed = Papa.parse<string[]>(text, {
    header: false,
    skipEmptyLines: true,
  });

  if (parsed.errors.length > 0 && !parsed.data.length) {
    return { ok: false, error: parsed.errors[0]?.message ?? "Invalid CSV" };
  }

  const rows = parsed.data as string[][];
  if (rows.length < 2) {
    return { ok: false, error: "CSV needs a header row and at least one data row." };
  }

  const headers = rows[0].map((h) => String(h ?? ""));

  if (isAnalyticsFormat(headers)) {
    const out = parseAnalyticsRows(rows, headers);
    if (out.length === 0) {
      return { ok: false, error: "No active days found in analytics export." };
    }
    return { ok: true, rows: out, rawHeaders: headers, source: "cursor-analytics" };
  }

  if (isDevinFormat(headers)) {
    const out = parseDevinRows(rows, headers);
    if (out.length === 0) {
      return { ok: false, error: "No valid Devin sessions found in export." };
    }
    return { ok: true, rows: out, rawHeaders: headers, source: "devin" };
  }

  const col = buildColumnMap(headers);
  if (!col) {
    return {
      ok: false,
      error:
        "Could not find required columns. Need at least Date and Total Tokens (or similar).",
    };
  }

  const idx = (name: string) => headers.indexOf(name);
  const iDate = idx(col.date);
  const iUser = idx(col.user);
  const iKind = idx(col.kind);
  const iModel = idx(col.model);
  const iMax = idx(col.maxMode);
  const iInC = idx(col.inputCacheWrite);
  const iInN = idx(col.inputNoCacheWrite);
  const iCR = idx(col.cacheRead);
  const iOut = idx(col.outputTokens);
  const iTot = idx(col.totalTokens);
  const iCost = idx(col.cost);

  const out: UsageRow[] = [];

  for (let r = 1; r < rows.length; r++) {
    const line = rows[r];
    const dateStr = String(line[iDate] ?? "").trim();
    if (!dateStr) continue;

    const date = parseDate(dateStr.replace(/^"|"$/g, ""));
    if (!date) continue;

    out.push({
      date,
      user: String(line[iUser] ?? "").replace(/^"|"$/g, "") || "(unknown)",
      kind: String(line[iKind] ?? "").replace(/^"|"$/g, "") || "(unknown)",
      model: String(line[iModel] ?? "").replace(/^"|"$/g, "") || "(unknown)",
      maxMode: String(line[iMax] ?? "").replace(/^"|"$/g, "") || "",
      inputCacheWrite: iInC >= 0 ? parseNum(line[iInC]) : 0,
      inputNoCacheWrite: iInN >= 0 ? parseNum(line[iInN]) : 0,
      cacheRead: iCR >= 0 ? parseNum(line[iCR]) : 0,
      outputTokens: iOut >= 0 ? parseNum(line[iOut]) : 0,
      totalTokens: parseNum(line[iTot]),
      cost: iCost >= 0 ? parseNum(line[iCost]) : 0,
    });
  }

  if (out.length === 0) {
    return { ok: false, error: "No valid rows with parseable dates." };
  }

  return { ok: true, rows: out, rawHeaders: headers, source: "cursor" };
}
