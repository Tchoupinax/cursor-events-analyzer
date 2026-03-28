import type { DailyPoint, NamedAmount, Summary, UsageRow } from "./types";

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function sortNamed(arr: NamedAmount[], by: "value" | "name" = "value"): NamedAmount[] {
  const copy = [...arr];
  if (by === "value") {
    copy.sort((a, b) => b.value - a.value);
  } else {
    copy.sort((a, b) => a.name.localeCompare(b.name));
  }
  return copy;
}

function aggregate(
  rows: UsageRow[],
  keyFn: (r: UsageRow) => string,
  valueFn: (r: UsageRow) => number
): NamedAmount[] {
  const m = new Map<string, number>();
  for (const r of rows) {
    const k = keyFn(r) || "(empty)";
    m.set(k, (m.get(k) ?? 0) + valueFn(r));
  }
  return sortNamed(
    [...m.entries()].map(([name, value]) => ({ name, value })),
    "value"
  );
}

export function buildSummary(rows: UsageRow[]): Summary {
  const sorted = [...rows].sort((a, b) => a.date.getTime() - b.date.getTime());
  const dates = sorted.map((r) => r.date.getTime());
  const dateMin = sorted.length ? new Date(Math.min(...dates)) : null;
  const dateMax = sorted.length ? new Date(Math.max(...dates)) : null;

  let totalCost = 0;
  let totalTokens = 0;
  let totalOutputTokens = 0;
  let totalCacheRead = 0;
  const users = new Set<string>();

  for (const r of sorted) {
    totalCost += r.cost;
    totalTokens += r.totalTokens;
    totalOutputTokens += r.outputTokens;
    totalCacheRead += r.cacheRead;
    users.add(r.user);
  }

  const dailyMap = new Map<string, { cost: number; tokens: number; events: number }>();
  for (const r of sorted) {
    const k = dayKey(r.date);
    const cur = dailyMap.get(k) ?? { cost: 0, tokens: 0, events: 0 };
    cur.cost += r.cost;
    cur.tokens += r.totalTokens;
    cur.events += 1;
    dailyMap.set(k, cur);
  }

  const daily: DailyPoint[] = [...dailyMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, v]) => ({
      day,
      cost: v.cost,
      tokens: v.tokens,
      events: v.events,
    }));

  const byModelCost = aggregate(sorted, (r) => r.model, (r) => r.cost);
  const byModelTokens = aggregate(sorted, (r) => r.model, (r) => r.totalTokens);
  const byKind = aggregate(sorted, (r) => r.kind, (r) => r.cost);
  const byUserCost = aggregate(sorted, (r) => r.user, (r) => r.cost).slice(0, 12);

  const topExpensive = [...sorted].sort((a, b) => b.cost - a.cost).slice(0, 8);

  return {
    rowCount: sorted.length,
    dateMin,
    dateMax,
    totalCost,
    totalTokens,
    totalOutputTokens,
    totalCacheRead,
    uniqueUsers: users.size,
    byModelCost,
    byModelTokens,
    byKind,
    byUserCost,
    daily,
    topExpensive,
  };
}
