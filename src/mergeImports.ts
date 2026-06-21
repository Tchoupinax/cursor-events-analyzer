import { parseUsageCsv } from "./parseCsv";
import type { StoredFile } from "./fileStore";
import type { ExportSource, UsageRow } from "./types";

export type ResolvedExportSource = ExportSource | "mixed";

export type MergedImportData = {
  rows: UsageRow[];
  source: ResolvedExportSource | null;
  fileCount: number;
  errors: string[];
};

export function mergeStoredFiles(files: StoredFile[]): MergedImportData {
  const allRows: UsageRow[] = [];
  const sources = new Set<ExportSource>();
  const errors: string[] = [];

  for (const file of files) {
    const result = parseUsageCsv(file.text);
    if (!result.ok) {
      errors.push(`${file.name}: ${result.error}`);
      continue;
    }
    allRows.push(...result.rows);
    sources.add(result.source);
  }

  allRows.sort((a, b) => a.date.getTime() - b.date.getTime());

  let source: ResolvedExportSource | null = null;
  if (sources.size === 1) {
    source = [...sources][0];
  } else if (sources.size > 1) {
    source = "mixed";
  }

  return {
    rows: allRows,
    source,
    fileCount: files.length,
    errors,
  };
}
