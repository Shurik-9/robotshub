export const MIN_START_AREA_M2 = 100;
export const MAX_START_AREA_M2 = 100_000;

/** Scenario assumptions, not measured site data. */
export function estimateWarehouseParams(area: number) {
  if (!Number.isFinite(area) || area < MIN_START_AREA_M2 || area > MAX_START_AREA_M2) {
    throw new RangeError('Площадь склада должна быть от 100 до 100 000 м².');
  }
  const palletsPerDay = Math.max(20, Math.round(area / 20));
  return {
    total_area_m2: area,
    active_area_m2: Math.round(area * 0.5),
    floors_count: 1,
    rack_rows: 8,
    docks_count: 4,
    charge_stations: 3,
    shifts_per_day: 2,
    shift_duration_h: 11,
    working_days_per_year: 365,
    payroll_factor: 1.302,
    inbound_pallets_per_day: palletsPerDay,
    outbound_pallets_per_day: palletsPerDay,
    pickers_count: Math.max(2, Math.ceil(area / 2000)),
    picker_salary_gross: 100_000,
  };
}
