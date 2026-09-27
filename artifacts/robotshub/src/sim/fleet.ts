// ============================================================
// fleet.ts — сбор флота симуляции из ВЫБРАННЫХ решений каталога.
// Решение → тип техники (спрайт) по подтипу/категории/названию.
// Стационарные системы → установки сцены (props), не агенты.
// ============================================================

import registry from "../assets/tech/registry.json" with { type: "json" };
import type { FleetEntry } from "./sim-engine";

export const STATIONARY =
  "palletizer,robot-arm,cube-storage,conveyor,elevator,shuttle".split(",");

const RULES: [RegExp, string][] = [
  [/уборщ/i, "scrubber"],
  [/доставщ|сервисн|консультант|Robot/i, "delivery-bot"],
  [/вилочн|FMR|погрузчик|штабелер|штабелёр/i, "fmr-forklift"],
  [/тягач/i, "tug"],
  [/грузовик|беспилот.*транспорт|электрогруз/i, "truck"],
  [/медиц|дезинфек|UVC|UV/i, "medical-amr"],
  [/сортиров|AMR|транспортир|мобильн/i, "amr-pallet"],
];

export function spriteForSolution(s: {
  subtype?: string; category?: string; name?: string;
}): string | null {
  const blob = `${s.subtype ?? ""} ${s.category ?? ""} ${s.name ?? ""}`;
  if (/шаттл|AutoStore|кубич|хранени|стеллаж|конвейер|манипул|кобот|стационар/i.test(blob))
    return null; // стационарное — не агент
  for (const [re, sprite] of RULES) if (re.test(blob)) return sprite;
  return "amr-pallet"; // fallback с маркировкой допущения в UI
}

export interface SolutionLike {
  id: string; name: string;
  subtype?: string; category?: string;
  specs?: Record<string, unknown>;
}

/**
 * Строит флот: по каждому выбранному решению — своя техника.
 * Общее число единиц = robotCount из расчёта (распределяется по решениям).
 * Скорость — из ТТХ решения (speed_mps), иначе из registry.
 */
export function buildFleet(
  selected: SolutionLike[],
  robotCount: number
): { fleet: FleetEntry[]; stationary: string[] } {
  const total = Math.max(selected.length, robotCount, 1);
  const fleet: FleetEntry[] = [];
  const stationary: string[] = [];

  // базовая скорость по спрайту из реестра
  const regSpeed = (k: string) => (registry as Record<string, any>)[k]?.speed_mps ?? 1.5;

  const mobile = selected.filter((s) => {
    const sp = spriteForSolution(s);
    if (sp === null) { stationary.push(s.name); return false; }
    return true;
  });

  if (mobile.length === 0) {
    fleet.push({ sprite: "amr-pallet", count: Math.max(1, robotCount), speedMps: regSpeed("amr-pallet") });
    return { fleet, stationary };
  }

  const per = Math.max(1, Math.floor(total / mobile.length));
  let rest = total - per * mobile.length;
  for (const s of mobile) {
    const sp = spriteForSolution(s)!;
    const speed = Number(s.specs?.speed_mps) || regSpeed(sp);
    fleet.push({ sprite: sp, count: per + (rest-- > 0 ? 1 : 0), speedMps: speed, title: s.name });
  }
  return { fleet, stationary };
}
