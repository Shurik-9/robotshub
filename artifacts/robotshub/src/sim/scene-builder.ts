import type { Flow, Rack, SimFloor, SimScene } from "./sim-engine";

export type SceneBuilderKind = "warehouse" | "airport" | "hospital" | "medical";

export interface SceneBuilderConfig {
  kind: SceneBuilderKind;
  areaM2: number;
  floors: number;
  rackRows?: number;
  docks?: number;
  chargeStations?: number;
  elevatorIntegrationReady?: boolean;
  stationarySolutions?: string[];
}

export type GeneratedScene = SimScene & { title: string };

export interface SceneGeometrySummary {
  floors: number;
  rows: {
    applicable: boolean;
    total: number;
    perFloor: number;
  };
  posts: {
    applicable: boolean;
    total: number;
  };
  charges: {
    applicable: boolean;
    total: number;
    perFloor: number;
  };
}

const WALLS = { x: 16, y: 16, w: 1168, h: 688 };
const FLOOR_CENTER: [number, number] = [600, 360];

/**
 * Main simulation scenes are deliberately generated instead of copied from
 * the showcase JSON files. This keeps the visual model tied to the saved
 * object profile while preserving the sim-engine's existing scene contract.
 */
export function buildScene(config: SceneBuilderConfig, seed = 42): GeneratedScene {
  const kind = normalizeKind(config.kind);
  const areaM2 = positive(config.areaM2, defaultArea(kind));
  const floorsCount = clampInt(config.floors, 1, 3, 2);
  const rackRows = kind === "warehouse" ? clampInt(config.rackRows, 0, 20, 8) : 0;
  const docks = kind === "warehouse" || kind === "airport"
    ? clampInt(config.docks, 0, 6, kind === "warehouse" ? 4 : 2)
    : 0;
  const chargeStations = clampInt(config.chargeStations, 1, 6, 3);
  const layoutScale = clamp(Math.sqrt(areaM2 / defaultArea(kind)), 0.72, 1.45);
  const seedOffset = seededOffset(seed);
  const floorIds = Array.from({ length: floorsCount }, (_, index) => `${kind}-${index + 1}`);
  const floors = floorIds.map((id, index) => buildFloor({
    kind,
    id,
    level: index + 1,
    areaM2,
    layoutScale,
    rackRows,
    chargeStations,
    seedOffset,
  }));

  const verticalLinks = floorsCount > 1
    ? [{
        id: `${kind}-service-lift`,
        label: "служебный лифт",
        kind: "elevator" as const,
        floors: floorIds,
        points: Object.fromEntries(floorIds.map((id) => [id, FLOOR_CENTER])),
        waitSec: kind === "warehouse" ? 18 : 24,
        travelSec: kind === "warehouse" ? 10 : 16,
        capacity: kind === "warehouse" ? 3 : 2,
        enabled: config.elevatorIntegrationReady !== false,
        blockedReason: "Управление лифтом не подтверждено в параметрах объекта",
      }]
    : [];

  const flows = buildFlows(kind, floorIds, docks, floorsCount);
  const stationaryProps = buildStationaryProps(
    config.stationarySolutions ?? [],
    kind,
    floorsCount,
  );

  return {
    id: `generated-${kind}`,
    title: `${kindTitle(kind)} ${formatArea(areaM2)} м² · ${floorsCount} эт.`,
    width: 1200,
    height: 720,
    // The form specifies total facility area. Equal floor plates are an
    // explicit schematic assumption, not a fixed scale for every building.
    mPerPx: Math.sqrt(areaM2 / floorsCount / (WALLS.w * WALLS.h)),
    startClock: kind === "hospital" ? "07:00" : kind === "airport" ? "06:00" : "08:00",
    walls: WALLS,
    doors: buildDoors(docks),
    zones: floors[0]?.zones ?? [],
    racks: floors[0]?.racks ?? [],
    props: [
      ...stationaryProps,
      ...(floorsCount > 1 ? [{ sprite: "elevator", x: FLOOR_CENTER[0], y: FLOOR_CENTER[1], label: "Лифт" }] : []),
    ],
    flows,
    charges: floors[0]?.charges ?? [],
    floors,
    verticalLinks,
    defaultFloorId: floorIds[0],
  };
}

/**
 * Counts the geometry that was actually created, rather than repeating the
 * values from the object form. Rows and charging places are reported both as
 * a scene total and per floor because the canvas shows one floor at a time.
 */
export function getSceneGeometrySummary(
  scene: SimScene,
  kind: SceneBuilderKind,
): SceneGeometrySummary {
  const floors = scene.floors ?? [];
  const floorCount = floors.length || 1;
  const rowsPerFloor = floors[0]?.racks?.length ?? scene.racks?.length ?? 0;
  const chargesPerFloor = floors[0]?.charges?.length ?? scene.charges.length;

  return {
    floors: floors.length || 1,
    rows: {
      applicable: normalizeKind(kind) === "warehouse",
      perFloor: rowsPerFloor,
      total: floors.reduce((total, floor) => total + (floor.racks?.length ?? 0), 0)
        || rowsPerFloor,
    },
    posts: {
      applicable: normalizeKind(kind) === "warehouse" || normalizeKind(kind) === "airport",
      total: scene.doors?.length ?? 0,
    },
    charges: {
      applicable: true,
      perFloor: chargesPerFloor,
      total: floors.reduce((total, floor) => total + (floor.charges?.length ?? 0), 0)
        || chargesPerFloor * floorCount,
    },
  };
}

interface FloorBuildOptions {
  kind: Exclude<SceneBuilderKind, "medical">;
  id: string;
  level: number;
  areaM2: number;
  layoutScale: number;
  rackRows: number;
  chargeStations: number;
  seedOffset: number;
}

function buildFloor(options: FloorBuildOptions): SimFloor {
  const {
    kind,
    id,
    level,
    areaM2,
    layoutScale,
    rackRows,
    chargeStations,
    seedOffset,
  } = options;
  const zones = kind === "warehouse"
    ? warehouseZones(layoutScale, areaM2, level)
    : kind === "airport"
      ? airportZones(layoutScale, areaM2, level)
      : hospitalZones(layoutScale, areaM2, level);
  const racks = kind === "warehouse"
    ? buildRacks(rackRows, layoutScale, seedOffset)
    : [];
  const chargeZone = zones.find((zone) => zone.id.includes("charge")) ?? zones[zones.length - 1];

  return {
    id,
    label: `${level} этаж · ${kind === "warehouse" ? "операционная зона" : kind === "airport" ? "терминал" : "службы"}`,
    level,
    walls: WALLS,
    zones,
    racks,
    charges: buildCharges(chargeZone, chargeStations),
  };
}

function buildFlows(
  kind: Exclude<SceneBuilderKind, "medical">,
  floorIds: string[],
  docks: number,
  floorsCount: number,
): Flow[] {
  if (kind === "warehouse") {
    const topFloor = floorIds[floorIds.length - 1];
    return [
      {
        id: "inbound",
        label: "Погрузочные посты → хранение",
        share: 0.38,
        sprite: "amr-pallet",
        core: true,
        waypoints: warehouseOuterPath("inbound", docks),
        floorStops: floorsCount > 1
          ? [
              stop(floorIds[0], [[120, 90], [260, 360], FLOOR_CENTER]),
              stop(topFloor, [FLOOR_CENTER, [940, 360], [1080, 90]]),
            ]
          : undefined,
      },
      {
        id: "outbound",
        label: "Комплектация → отгрузка",
        share: 0.32,
        sprite: "amr-pallet",
        core: true,
        waypoints: warehouseOuterPath("outbound", docks),
        floorStops: floorsCount > 1
          ? [
              stop(topFloor, [[120, 620], [260, 360], FLOOR_CENTER]),
              stop(floorIds[0], [FLOOR_CENTER, [940, 360], [1080, 620]]),
            ]
          : undefined,
      },
      {
        id: "replenishment",
        label: "Пополнение зон хранения",
        share: 0.18,
        sprite: "fmr-forklift",
        waypoints: [[1080, 90], [980, 90], [940, 360], [260, 360], [120, 90]],
      },
      {
        id: "cleaning",
        label: "Уборка проездов",
        share: 0.12,
        sprite: "scrubber",
        waypoints: [[1000, 360], [1000, 620], [1000, 90], [260, 90], [260, 620]],
        floorStops: floorsCount > 1
          ? floorIds.map((floorId) => stop(floorId, [[1000, 360], [1000, 620], [1000, 90], [260, 90], [260, 620]]))
          : undefined,
      },
    ];
  }

  if (kind === "airport") {
    const topFloor = floorIds[floorIds.length - 1];
    return [
      {
        id: "bags-in",
        label: "Сортировка → выдача багажа",
        share: 0.45,
        sprite: "amr-pallet",
        core: true,
        waypoints: [[120, 520], [260, 360], [940, 360], [760, 520]],
        floorStops: floorsCount > 1
          ? [stop(floorIds[0], [[120, 520], [260, 360], FLOOR_CENTER]), stop(topFloor, [FLOOR_CENTER, [940, 360], [760, 520]])]
          : undefined,
      },
      {
        id: "bags-out",
        label: "Регистрация → сортировка",
        share: 0.25,
        sprite: "tug",
        core: true,
        waypoints: [[180, 120], [260, 360], [940, 360], [120, 520]],
        floorStops: floorsCount > 1
          ? [stop(topFloor, [[180, 120], [260, 360], FLOOR_CENTER]), stop(floorIds[0], [FLOOR_CENTER, [940, 360], [120, 520]])]
          : undefined,
      },
      {
        id: "carts",
        label: "Перрон → служебная зона",
        share: 0.18,
        sprite: "tug",
        waypoints: [[160, 600], [260, 360], [940, 360], [1040, 120]],
      },
      {
        id: "clean",
        label: "Уборка терминала",
        share: 0.12,
        sprite: "scrubber",
        waypoints: [[1000, 520], [1000, 120], [260, 120], [260, 600]],
        floorStops: floorsCount > 1
          ? floorIds.map((floorId) => stop(floorId, [[1000, 520], [1000, 120], [260, 120], [260, 600]]))
          : undefined,
      },
    ];
  }

  const topFloor = floorIds[floorIds.length - 1];
  return [
    {
      id: "food",
      label: "Пищеблок → отделения",
      share: 0.3,
      sprite: "medical-amr",
      core: true,
      waypoints: [[120, 120], [260, 360], [940, 360], [1040, 120]],
      floorStops: floorsCount > 1
        ? [stop(floorIds[0], [[120, 120], [260, 360], FLOOR_CENTER]), stop(topFloor, [FLOOR_CENTER, [940, 360], [1040, 120]])]
        : undefined,
    },
    {
      id: "meds",
      label: "Аптека → отделения",
      share: 0.25,
      sprite: "medical-amr",
      core: true,
      waypoints: [[120, 360], [260, 360], [940, 360], [1040, 520]],
      floorStops: floorsCount > 1
        ? [stop(floorIds[0], [[120, 360], [260, 360], FLOOR_CENTER]), stop(topFloor, [FLOOR_CENTER, [940, 360], [1040, 520]])]
        : undefined,
    },
    {
      id: "samples",
      label: "Отделения → лаборатория",
      share: 0.2,
      sprite: "medical-amr",
      waypoints: [[1040, 520], [940, 360], [260, 360], [120, 600]],
      floorStops: floorsCount > 1
        ? [stop(topFloor, [[1040, 520], [940, 360], FLOOR_CENTER]), stop(floorIds[0], [FLOOR_CENTER, [260, 360], [120, 600]])]
        : undefined,
    },
    {
      id: "laundry",
      label: "Бельё → этажные посты",
      share: 0.15,
      sprite: "delivery-bot",
      waypoints: [[1040, 120], [940, 360], [260, 360], [120, 520]],
      floorStops: floorsCount > 1
        ? floorIds.map((floorId) => stop(floorId, [[1040, 120], [940, 360], [260, 360], [120, 520]]))
        : undefined,
    },
    {
      id: "waste",
      label: "Этажи → медицинские отходы",
      share: 0.1,
      sprite: "medical-amr",
      waypoints: [[1040, 600], [940, 360], [260, 360], [120, 600]],
      floorStops: floorsCount > 1
        ? floorIds.map((floorId) => stop(floorId, [[1040, 600], [940, 360], [260, 360], [120, 600]]))
        : undefined,
    },
  ];
}

function warehouseZones(scale: number, areaM2: number, level: number) {
  return [
    zone("inbound", "Приёмка", 40, 40, 210, 120),
    zone("storage", `Хранение · ${formatArea(areaM2)} м²`, 290, 40, Math.round(630 * scale), 600),
    zone("outbound", "Отгрузка", 950, 440, 210, 210),
    zone("charge", `Зарядная · этаж ${level}`, 960, 40, 190, 110),
  ];
}

function airportZones(scale: number, areaM2: number, level: number) {
  return [
    zone("baggage", "Багаж", 40, 420, 240, 180),
    zone("terminal", `Терминал · ${formatArea(areaM2)} м²`, 360, 60, Math.round(560 * scale), 170),
    zone("airside", "Перрон / сервис", 40, 60, 240, 180),
    zone("charge", `Сервис / заряд · этаж ${level}`, 950, 60, 180, 140),
    zone("claim", "Выдача багажа", 650, 420, 260, 180),
  ];
}

function hospitalZones(scale: number, areaM2: number, level: number) {
  return [
    zone("source", level === 1 ? "Службы" : `Отделения ${level}`, 40, 60, 220, 180),
    zone("corridor", `Коридор · ${formatArea(areaM2)} м²`, 360, 280, Math.round(520 * scale), 160),
    zone("destination", level === 1 ? "Лаборатория" : "Палаты", 40, 480, 240, 180),
    zone("charge", `Зарядная · этаж ${level}`, 950, 60, 180, 150),
    zone("service", "Сервисная зона", 930, 470, 200, 170),
  ];
}

function buildRacks(count: number, scale: number, seedOffset: number): Rack[] {
  const rackWidth = Math.round(18 + scale * 4);
  const spacing = Math.round(26 + scale * 2);
  return Array.from({ length: count }, (_, index) => ({
    x: 310 + index * spacing + seedOffset,
    y: index % 2 === 0 ? 110 : 470,
    w: rackWidth,
    h: 150,
  }));
}

function buildCharges(
  chargeZone: { x: number; y: number; w: number; h: number } | undefined,
  count: number,
): [number, number][] {
  if (!chargeZone) return [[1040, 100]];
  return Array.from({ length: count }, (_, index) => [
    Math.round(chargeZone.x + 28 + (index % 3) * Math.max(32, (chargeZone.w - 56) / 2)),
    Math.round(chargeZone.y + 42 + Math.floor(index / 3) * 34),
  ] as [number, number]);
}

function buildDoors(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    x: 60 + index * 90,
    y: 10,
    w: 60,
    h: 12,
    label: `Пост ${index + 1}`,
  }));
}

function buildStationaryProps(names: string[], kind: Exclude<SceneBuilderKind, "medical">, floors: number) {
  const props: { sprite: string; x: number; y: number; label: string }[] = [];
  const add = (sprite: string, label: string, x: number, y: number) => {
    if (!props.some((prop) => prop.sprite === sprite)) props.push({ sprite, label, x, y });
  };

  for (const name of names) {
    const blob = name.toLowerCase();
    if (/паллетайз|паллетиз/.test(blob)) add("palletizer", "Паллетайзер", 780, 590);
    else if (/манипулятор|кобот|робот.?рук/.test(blob)) add("robot-arm", "Манипулятор", 820, 150);
    else if (/конвейер|транспортн.*систем/.test(blob)) add("conveyor", "Конвейер", 480, 590);
    else if (/кубич|autostore|ячее|стеллаж/.test(blob)) add("cube-storage", "Ячеечное хранение", 610, 200);
    else if (/шаттл/.test(blob)) add("shuttle", "Шаттл", 610, 200);
  }
  if (kind === "hospital" && floors > 1 && !props.some((prop) => prop.sprite === "elevator")) {
    add("elevator", "Лифт", FLOOR_CENTER[0], FLOOR_CENTER[1]);
  }
  return props;
}

function warehouseOuterPath(direction: "inbound" | "outbound", docks: number): [number, number][] {
  const dockX = docks > 0 ? 60 + ((docks - 1) * 45) % 180 : 120;
  return direction === "inbound"
    ? [[dockX, 90], [260, 360], [940, 360], [1080, 90]]
    : [[120, 620], [260, 360], [940, 360], [1080, 620]];
}

function stop(floorId: string, waypoints: [number, number][]) {
  return { floorId, waypoints };
}

function zone(id: string, label: string, x: number, y: number, w: number, h: number) {
  return { id, label, x, y, w, h };
}

function normalizeKind(kind: SceneBuilderKind): Exclude<SceneBuilderKind, "medical"> {
  return kind === "medical" ? "hospital" : kind;
}

function kindTitle(kind: Exclude<SceneBuilderKind, "medical">) {
  return kind === "warehouse" ? "Склад" : kind === "airport" ? "Аэропорт" : "Медицинское учреждение";
}

function defaultArea(kind: Exclude<SceneBuilderKind, "medical">) {
  return kind === "warehouse" ? 20_000 : kind === "airport" ? 85_000 : 45_000;
}

function positive(value: number, fallback: number) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function clampInt(value: number | undefined, min: number, max: number, fallback: number) {
  const numeric = Number(value);
  return Math.min(max, Math.max(min, Math.round(Number.isFinite(numeric) ? numeric : fallback)));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function seededOffset(seed: number) {
  const normalized = Math.abs(Math.trunc(seed)) % 17;
  return normalized - 8;
}

function formatArea(areaM2: number) {
  return Math.round(areaM2).toLocaleString("ru-RU");
}