export type ExportSource = "cursor" | "cursor-analytics" | "devin";

export type UsageRow = {
  date: Date;
  user: string;
  kind: string;
  model: string;
  maxMode: string;
  inputCacheWrite: number;
  inputNoCacheWrite: number;
  cacheRead: number;
  outputTokens: number;
  totalTokens: number;
  cost: number;
  /** Session title or other row label (e.g. Devin session name). */
  label?: string;
};

export type DailyPoint = {
  day: string;
  cost: number;
  tokens: number;
  events: number;
};

export type DailyUserPoint = {
  day: string;
  total: number;
  [user: string]: string | number;
};

export type KindUserPoint = {
  name: string;
  total: number;
  [user: string]: string | number;
};

export type NamedAmount = { name: string; value: number };

export type WorkDayPoint = {
  day: string;
  label: string;
  events: number;
  hours: number;
};

export type WorkWeekPoint = {
  week: string;
  label: string;
  events: number;
  activeDays: number;
  hours: number;
};

export type WorkMonthPoint = {
  month: string;
  label: string;
  events: number;
  activeDays: number;
  hours: number;
};

export type WorkStats = {
  activeDays: number;
  totalActiveHours: number;
  avgHoursPerDay: number;
  byDay: WorkDayPoint[];
  byWeek: WorkWeekPoint[];
  byMonth: WorkMonthPoint[];
};

export type Summary = {
  rowCount: number;
  dateMin: Date | null;
  dateMax: Date | null;
  totalCost: number;
  totalTokens: number;
  totalOutputTokens: number;
  totalCacheRead: number;
  uniqueUsers: number;
  byModelCost: NamedAmount[];
  byModelTokens: NamedAmount[];
  byKind: NamedAmount[];
  byKindUser: KindUserPoint[];
  byUserCost: NamedAmount[];
  daily: DailyPoint[];
  dailyByUser: DailyUserPoint[];
  dailyUserSeries: string[];
  kindUserSeries: string[];
  topExpensive: UsageRow[];
  workStats: WorkStats;
};
