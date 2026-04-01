import type { DailyPoint, DailyUserPoint, KindUserPoint, NamedAmount, Summary, UsageRow } from "./types";

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
  const byUserCost = aggregate(sorted, (r) => r.user, (r) => r.cost);
  const byUserEvents = aggregate(sorted, (r) => r.user, () => 1);
  const dailyUserSeries = byUserEvents.slice(0, 6).map((u) => u.name);
  const hasOtherUsers = byUserEvents.length > dailyUserSeries.length;
  const dailyByUserMap = new Map<string, Map<string, number>>();

  for (const r of sorted) {
    const day = dayKey(r.date);
    const bucket = dailyByUserMap.get(day) ?? new Map<string, number>();
    const userKey = dailyUserSeries.includes(r.user) ? r.user : "Other";
    bucket.set(userKey, (bucket.get(userKey) ?? 0) + 1);
    dailyByUserMap.set(day, bucket);
  }

  const dailyByUser: DailyUserPoint[] = [...dailyByUserMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, userCounts]) => {
      const point: DailyUserPoint = { day, total: 0 };
      for (const user of dailyUserSeries) {
        const count = userCounts.get(user) ?? 0;
        point[user] = count;
        point.total += count;
      }
      if (hasOtherUsers) {
        const otherCount = userCounts.get("Other") ?? 0;
        point.Other = otherCount;
        point.total += otherCount;
      }
      return point;
    });

  const kindUserSeries = byUserCost.slice(0, 6).map((u) => u.name);
  const hasOtherKindUsers = byUserCost.length > kindUserSeries.length;
  const byKindUserMap = new Map<string, Map<string, number>>();

  for (const r of sorted) {
    const bucket = byKindUserMap.get(r.kind) ?? new Map<string, number>();
    const userKey = kindUserSeries.includes(r.user) ? r.user : "Other";
    bucket.set(userKey, (bucket.get(userKey) ?? 0) + r.cost);
    byKindUserMap.set(r.kind, bucket);
  }

  const byKindUser: KindUserPoint[] = byKind.map((kind) => {
    const userCosts = byKindUserMap.get(kind.name) ?? new Map<string, number>();
    const point: KindUserPoint = { name: kind.name, total: 0 };

    for (const user of kindUserSeries) {
      const cost = userCosts.get(user) ?? 0;
      point[user] = cost;
      point.total += cost;
    }

    if (hasOtherKindUsers) {
      const otherCost = userCosts.get("Other") ?? 0;
      point.Other = otherCost;
      point.total += otherCost;
    }

    return point;
  });

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
    byKindUser,
    byUserCost,
    daily,
    dailyByUser,
    dailyUserSeries: hasOtherUsers ? [...dailyUserSeries, "Other"] : dailyUserSeries,
    kindUserSeries: hasOtherKindUsers ? [...kindUserSeries, "Other"] : kindUserSeries,
    topExpensive,
  };
}
