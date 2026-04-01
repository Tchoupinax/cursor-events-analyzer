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
};
