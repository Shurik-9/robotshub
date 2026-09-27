import type { Flow, SimFloor, SimScene } from "./sim-engine";

const HOSPITAL_WALLS = { x: 16, y: 16, w: 1168, h: 688 };
const AIRPORT_WALLS = { x: 16, y: 16, w: 1168, h: 688 };

export interface FacilityFloorOptions {
  floorsCount?: number;
  elevatorsCount?: number;
  elevatorIntegrationReady?: boolean;
}

export function withFacilityFloors(
  scene: SimScene,
  options: FacilityFloorOptions = {},
): SimScene {
  if (scene.id === "hospital") return hospitalFloors(scene, options);
  if (scene.id === "airport") return airportFloors(scene, options);
  return scene;
}

function hospitalFloors(scene: SimScene, options: FacilityFloorOptions): SimScene {
  const floorsCount = clampInt(options.floorsCount ?? 5, 1, 20);
  const elevatorsCount = clampInt(options.elevatorsCount ?? 1, 1, 12);
  const wardLevels = Array.from({ length: Math.max(0, floorsCount - 1) }, (_, index) => index + 2);
  const floors: SimFloor[] = [
    {
      id: "h1",
      label: "1 этаж · службы",
      level: 1,
      walls: HOSPITAL_WALLS,
      zones: [
        zone("foodblock", "Пищеблок", 40, 60, 220, 150),
        zone("pharmacy", "Аптека", 40, 290, 220, 140),
        zone("labs", "Лаборатория", 40, 510, 220, 150),
        zone("reception", "Приёмное отделение", 360, 60, 300, 180),
        zone("sterile", "Стерилизация", 360, 470, 300, 190),
        zone("laundry", "Прачечная", 900, 60, 220, 150),
        zone("charge", "Зарядная", 900, 280, 220, 150),
        zone("waste", "Отходы", 900, 510, 220, 150),
      ],
      props: [{ sprite: "robot-arm", x: 510, y: 565, label: "Стерилизация" }],
      charges: [[980, 330], [1050, 330], [980, 395]],
    },
    ...wardLevels.map((level): SimFloor => ({
      id: `h${level}`,
      label: `${level} этаж · отделения`,
      level,
      walls: HOSPITAL_WALLS,
      zones: [
        zone(`ward-${level}-a`, `Отделение ${level}А`, 40, 60, 300, 220),
        zone(`ward-${level}-b`, `Отделение ${level}Б`, 40, 430, 300, 220),
        zone(`treatment-${level}`, "Процедурная", 430, 60, 260, 170),
        zone(`nurse-${level}`, "Пост медсестры", 430, 430, 260, 170),
        zone(`utility-${level}`, "Служебная зона", 900, 60, 220, 170),
        zone(`floor-charge-${level}`, "Ожидание / заряд", 900, 430, 220, 170),
      ],
      props: [],
      charges: [[1010, 515]],
    })),
  ];

  return {
    ...scene,
    defaultFloorId: "h1",
    floors,
    verticalLinks: floorsCount > 1 ? [{
      id: "hospital-service-lift",
      label: "служебный лифт",
      kind: "elevator",
      floors: floors.map((floor) => floor.id),
      points: Object.fromEntries(floors.map((floor) => [floor.id, [780, 330]])),
      waitSec: Math.max(8, 28 - (elevatorsCount - 1) * 3),
      travelSec: 12,
      capacity: elevatorsCount * 2,
      enabled: options.elevatorIntegrationReady !== false,
      blockedReason: "Нет подтверждённого API управления лифтами",
    }] : [],
    flows: scene.flows.map((flow) => hospitalFlow(flow, wardLevels)),
  };
}

function hospitalFlow(flow: Flow, wardLevels: number[]): Flow {
  if (!wardLevels.length) return { ...flow, floorStops: [stop("h1", flow.waypoints)] };
  const wardPoint = (floor: number, y: number): [number, number] => [430 + (floor % 2) * 120, y];
  switch (flow.id) {
    case "food":
      return {
        ...flow,
        label: "Пищеблок → отделения 2–5",
        floorStops: [
          stop("h1", [[240, 140], [330, 140], [330, 250], [780, 330]]),
          ...wardLevels.map((floor) => stop(`h${floor}`, [[780, 330], wardPoint(floor, 145)])),
        ],
      };
    case "meds":
      return {
        ...flow,
        label: "Аптека → отделения 2–5",
        floorStops: [
          stop("h1", [[240, 360], [330, 360], [780, 330]]),
          ...wardLevels.map((floor) => stop(`h${floor}`, [[780, 330], wardPoint(floor, 500)])),
        ],
      };
    case "samples":
      return {
        ...flow,
        label: "Отделения 5–2 → лаборатория",
        floorStops: [
          ...[...wardLevels].reverse().map((floor) =>
            stop(`h${floor}`, [[550, floor % 2 === 0 ? 145 : 500], [780, 330]]),
          ),
          stop("h1", [[780, 330], [330, 500], [240, 580]]),
        ],
      };
    case "laundry":
      return {
        ...flow,
        label: "Прачечная → этажи 2–5",
        floorStops: [
          stop("h1", [[900, 135], [780, 135], [780, 330]]),
          ...wardLevels.map((floor) => stop(`h${floor}`, [[780, 330], [580, 500]])),
        ],
      };
    case "waste":
      return {
        ...flow,
        label: "Этажи 2–5 → зона отходов",
        floorStops: [
          ...wardLevels.map((floor) =>
            stop(`h${floor}`, [[580, floor % 2 === 0 ? 500 : 145], [780, 330]]),
          ),
          stop("h1", [[780, 330], [800, 585], [900, 585]]),
        ],
      };
    default:
      return flow;
  }
}

function airportFloors(scene: SimScene, options: FacilityFloorOptions): SimScene {
  const floorsCount = clampInt(options.floorsCount ?? 2, 1, 6);
  const terminalLevels = Array.from({ length: Math.max(0, floorsCount - 1) }, (_, index) => index + 2);
  const floors: SimFloor[] = [
    {
      id: "a1",
      label: "1 этаж · багаж и перрон",
      level: 1,
      walls: AIRPORT_WALLS,
      zones: [
        zone("baggage-sort", "Сортировка багажа", 40, 60, 300, 220),
        zone("airside", "Перрон / тележки", 40, 420, 300, 220),
        zone("claim", "Выдача багажа", 650, 420, 260, 190),
        zone("service", "Служебная зона", 650, 60, 260, 190),
        zone("charge-a1", "Зарядная", 950, 60, 180, 140),
      ],
      props: [{ sprite: "conveyor", x: 450, y: 500, label: "Багажная линия" }],
      charges: [[1020, 100], [1090, 100]],
    },
    ...terminalLevels.map((level): SimFloor => ({
      id: `a${level}`,
      label: `${level} этаж · ${level === 2 ? "терминал" : "гейты и трансфер"}`,
      level,
      walls: AIRPORT_WALLS,
      zones: [
        zone("checkin", "Регистрация", 40, 60, 280, 180),
        zone("security", "Контроль безопасности", 400, 60, 280, 180),
        zone("gates", "Гейты", 760, 60, 360, 180),
        zone("public-hall", "Пассажирский зал", 40, 400, 640, 230),
        zone("retail", "Коммерческая зона", 760, 400, 360, 150),
        zone("charge-a2", "Сервис / заряд", 950, 570, 170, 90),
      ],
      props: [{ sprite: "conveyor", x: 200, y: 300, label: "Приём багажа" }],
      charges: [[1040, 615]],
    })),
  ];

  return {
    ...scene,
    defaultFloorId: "a1",
    floors,
    verticalLinks: floorsCount > 1 ? [{
      id: "airport-service-lift",
      label: "служебный лифт",
      kind: "elevator",
      floors: floors.map((floor) => floor.id),
      points: Object.fromEntries(floors.map((floor) => [floor.id, [560, 320]])),
      waitSec: 30,
      travelSec: 20,
      capacity: 2,
      enabled: options.elevatorIntegrationReady !== false,
      blockedReason: "BMS/управление служебным лифтом не подтверждено",
    }] : [],
    flows: scene.flows.map((flow) => airportFlow(flow, terminalLevels)),
  };
}

function airportFlow(flow: Flow, terminalLevels: number[]): Flow {
  const primaryTerminalFloor = terminalLevels[0] ?? 1;
  switch (flow.id) {
    case "bags-in":
      return {
        ...flow,
        label: "Сортировка → выдача багажа",
        floorStops: [stop("a1", [[260, 170], [400, 320], [680, 500]])],
      };
    case "bags-out":
      return {
        ...flow,
        label: "Регистрация (2 этаж) → сортировка",
        floorStops: primaryTerminalFloor === 1
          ? [stop("a1", [[200, 150], [360, 300], [220, 170]])]
          : [
              stop(`a${primaryTerminalFloor}`, [[200, 150], [360, 300], [560, 320]]),
              stop("a1", [[560, 320], [360, 300], [220, 170]]),
            ],
      };
    case "carts":
      return {
        ...flow,
        label: "Перрон → служебная зона",
        floorStops: [stop("a1", [[200, 520], [400, 360], [760, 160]])],
      };
    case "clean":
      return {
        ...flow,
        label: "Уборка пассажирского терминала",
        floorStops: terminalLevels.length
          ? terminalLevels.map((level) =>
              stop(`a${level}`, [[1000, 500], [700, 500], [700, 300], [300, 300], [300, 560], [900, 560], [560, 320]]),
            )
          : [stop("a1", flow.waypoints)],
      };
    default:
      return flow;
  }
}

function zone(id: string, label: string, x: number, y: number, w: number, h: number) {
  return { id, label, x, y, w, h };
}

function stop(floorId: string, waypoints: [number, number][]) {
  return { floorId, waypoints };
}

function clampInt(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(Number.isFinite(value) ? value : min)));
}