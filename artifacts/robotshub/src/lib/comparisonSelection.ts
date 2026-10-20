export const COMPARISON_STORAGE_KEY = 'robotshub-comparison-v1';
export const MAX_COMPARISON_SOLUTIONS = 3;

export function parseComparisonIds(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return Array.from(new Set(parsed.filter((id): id is string =>
      typeof id === 'string' && id.trim().length > 0,
    ))).slice(0, MAX_COMPARISON_SOLUTIONS);
  } catch {
    return [];
  }
}

export function toggleComparisonId(ids: string[], id: string): {
  ids: string[];
  limitReached: boolean;
} {
  if (ids.includes(id)) return { ids: ids.filter(item => item !== id), limitReached: false };
  if (ids.length >= MAX_COMPARISON_SOLUTIONS) return { ids, limitReached: true };
  return { ids: [...ids, id], limitReached: false };
}

export function readComparisonIds(): string[] {
  try {
    return parseComparisonIds(window.localStorage.getItem(COMPARISON_STORAGE_KEY));
  } catch {
    return [];
  }
}

export function writeComparisonIds(ids: string[]) {
  try {
    window.localStorage.setItem(
      COMPARISON_STORAGE_KEY,
      JSON.stringify(Array.from(new Set(ids)).slice(0, MAX_COMPARISON_SOLUTIONS)),
    );
  } catch {
    // Comparison remains usable for the current session when storage is unavailable.
  }
}
