export function normalizeComparisonValue(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('ru-RU');
}

export function areComparisonValuesEqual(values: unknown[]): boolean {
  return values.length < 2 || new Set(values.map(normalizeComparisonValue)).size <= 1;
}
