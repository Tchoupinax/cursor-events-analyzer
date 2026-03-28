import Papa from "papaparse";
import type { UsageRow } from "./types";

function normKey(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
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
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export type ParseResult =
  | { ok: true; rows: UsageRow[]; rawHeaders: string[] }
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

  return { ok: true, rows: out, rawHeaders: headers };
}
