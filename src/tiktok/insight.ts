export type Point = { date: string; value: number };
export type Series = { total: number; points: Point[] };

export type RawHistory = {
  list?: { key: string; value: number }[] | null;
  total?: number;
  status?: number;
} | null;

export type RawScalar = { value?: { value?: number | { key: string; value: number }[] } } | null;

export const INSIGHT_PATH = "/aweme/v2/data/insight/";

export function toSeries(history: RawHistory | undefined): Series {
  const points = (history?.list ?? []).map((point) => ({
    date: new Date(Number(point.key) * 1000).toISOString(),
    value: Number(point.value) || 0,
  }));
  const total = history?.total ?? points.reduce((sum, point) => sum + point.value, 0);
  return { total, points };
}

export function scalar(raw: RawScalar | undefined): number | null {
  const value = raw?.value?.value;
  return typeof value === "number" ? value : null;
}

export function shares(raw: RawScalar | undefined): { source: string; share: number }[] {
  const value = raw?.value?.value;
  return Array.isArray(value) ? value.map((entry) => ({ source: entry.key, share: entry.value })) : [];
}

export function requestedInsightTypes(url: string): string[] {
  const raw = new URL(url).searchParams.get("type_requests");
  if (!raw) return [];
  try {
    return (JSON.parse(raw) as { insigh_type?: string }[]).map((entry) => entry.insigh_type ?? "");
  } catch {
    return [];
  }
}
