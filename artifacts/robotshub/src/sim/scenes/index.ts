import type { FleetEntry, SimScene } from "../sim-engine";
import airportSceneJson from "./airport.json" with { type: "json" };
import hospitalSceneJson from "./hospital.json" with { type: "json" };
import warehouseSceneJson from "./warehouse.json" with { type: "json" };

export type SandboxSceneId = "warehouse" | "airport" | "hospital";

export interface SandboxSceneDefinition {
  id: SandboxSceneId;
  label: string;
  description: string;
  title: string;
  scene: SimScene;
  fleet: FleetEntry[];
}

function asScene(scene: unknown): SimScene {
  return scene as SimScene;
}

/**
 * Static scenes are intentionally kept separate from buildScene. They are
 * visual references for the sandbox and must not receive object-profile
 * parameters or participate in the user's calculation.
 */
export const SANDBOX_SCENES: Record<SandboxSceneId, SandboxSceneDefinition> = {
  warehouse: {
    id: "warehouse",
    label: "Склад",
    description: "Паллетная логистика, хранение и уборка проездов",
    title: "Витрина · склад",
    scene: asScene(warehouseSceneJson),
    fleet: [
      { sprite: "amr-pallet", count: 2, speedMps: 1.5, title: "Паллетный AMR" },
      { sprite: "fmr-forklift", count: 1, speedMps: 1.2, title: "Штабелер" },
      { sprite: "scrubber", count: 1, speedMps: 0.8, title: "Поломоечная машина" },
    ],
  },
  airport: {
    id: "airport",
    label: "Аэропорт",
    description: "Багажные потоки, тягач и уборка терминала",
    title: "Витрина · аэропорт",
    scene: asScene(airportSceneJson),
    fleet: [
      { sprite: "amr-pallet", count: 2, speedMps: 1.5, title: "Багажный AMR" },
      { sprite: "tug", count: 1, speedMps: 1.8, title: "Аэродромный тягач" },
      { sprite: "scrubber", count: 1, speedMps: 0.8, title: "Поломоечная машина" },
    ],
  },
  hospital: {
    id: "hospital",
    label: "Медицинское учреждение",
    description: "Доставка питания, лекарств, проб и белья",
    title: "Витрина · медицинское учреждение",
    scene: asScene(hospitalSceneJson),
    fleet: [
      { sprite: "delivery-bot", count: 2, speedMps: 1.1, title: "Робот доставки" },
      { sprite: "medical-amr", count: 2, speedMps: 1.3, title: "Медицинский AMR" },
    ],
  },
};