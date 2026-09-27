// ------------------------------------------------------------
// Sim Engine v2 — флот из выбранных решений, маршруты-полилинии
// по проездам, скорость из ТТХ. Робот = тип техники (спрайт).
// ------------------------------------------------------------

export type RobotState =
  | "idle" | "toPickup" | "loading" | "toDrop" | "unloading" | "toCharge" | "charging" | "returning";

export interface FleetEntry {
  sprite: string;      // ключ из registry
  count: number;       // единиц техники
  speedMps: number;    // из ТТХ решения
  title?: string;      // «Ronavi H1500»
}

export interface Flow {
  id: string;
  label: string;
  waypoints: [number, number][]; // маршрут по проездам, от забора до сдачи
  share: number;                 // доля потока
  sprite: string;                // какая техника выполняет поток
  core?: boolean;                // базовый поток (выполняется техникой по умолчанию)
  floorStops?: FlowFloorStop[];
  routeVariants?: FlowRouteVariant[];
}

export interface Rack {
  x: number; y: number; w: number; h: number;
}

export interface FlowFloorStop {
  floorId: string;
  waypoints: [number, number][];
}

export interface FlowRouteVariant {
  label?: string;
  waypoints?: [number, number][];
  floorStops?: FlowFloorStop[];
}

export interface SimFloor {
  id: string;
  label: string;
  level: number;
  zones?: SimScene["zones"];
  racks?: Rack[];
  props?: SimScene["props"];
  charges?: [number, number][];
  walls?: SimScene["walls"];
  doors?: SimScene["doors"];
}

export interface VerticalLink {
  id: string;
  label: string;
  kind: "elevator" | "stair" | "escalator";
  floors: string[];
  points: Record<string, [number, number]>;
  waitSec: number;
  travelSec: number;
  capacity?: number;
  enabled?: boolean;
  blockedReason?: string;
}

export interface SimScene {
  id: string;
  width: number; height: number;
  mPerPx: number;
  walls?: { x: number; y: number; w: number; h: number }; // периметр
  doors?: { x: number; y: number; w: number; h: number; label?: string }[]; // ворота/проёмы
  zones: { id: string; label: string; x: number; y: number; w: number; h: number }[];
  racks?: Rack[];                 // стеллажные ряды
  props?: { sprite: string; x: number; y: number; label?: string }[];
  flows: Flow[];
  charges: [number, number][];
  startClock: string;
  floors?: SimFloor[];
  verticalLinks?: VerticalLink[];
  defaultFloorId?: string;
}

export interface SimOptions {
  fleet: FleetEntry[];             // техника из ВЫБРАННЫХ решений
  tasksPerHour: number;
  laborCostPerTaskRub: number;
  speedMultiplier?: number;
  seed?: number;
  batteryRuntimeHours?: number;
  chargeTimeMinutes?: number;
}

export interface Robot {
  id: number; name: string;
  sprite: string; title: string;
  typeIndex: number;
  assignedFlowId?: string;
  assignedVariantIndex?: number;
  floorId: string;
  speedMps: number;
  state: RobotState;
  x: number; y: number; angle: number;
  battery: number;
  trail: { x: number; y: number }[];
  path: RouteStep[];
  pathIdx: number;
  flow: Flow | null;
  routeVariant?: FlowRouteVariant;
  lastFlowId?: string;
  taskFloorIds?: string[];
  verticalLinkId?: string;
  verticalWaiting?: boolean;
  verticalWaitRemainingSec?: number;
  verticalRemainingSec?: number;
  waitSec: number;
  busySec: number;
  blockedSec: number;
  progressM: number;
  lidar: LidarStatus;
  /**
   * A lower-priority robot temporarily backs up along its own route when it
   * loses a contested passage. The original route is restored after the
   * yield point is reached; no lateral/random offset is introduced.
   */
  yieldResumePath?: RouteStep[];
  yieldResumePathIdx?: number;
}

export type LidarAction = "clear" | "turning" | "waiting";

export interface LidarStatus {
  action: LidarAction;
  obstacleId: number | null;
  distanceM: number | null;
}

export type RouteStep =
  | { kind: "move"; floorId: string; point: [number, number] }
  | {
      kind: "vertical";
      linkId: string;
      fromFloor: string;
      toFloor: string;
      from: [number, number];
      to: [number, number];
      waitSec: number;
      travelSec: number;
    };

export interface FlowStat {
  id: string;
  label: string;
  active: number;
  completed: number;
  available: boolean;
  unavailableReason?: string;
}

export interface SimKpis {
  nextTaskInSec?: number | null;
  elapsedSec?: number;
  observedTasksPerHour?: number;
  waitingRobots?: number;
  tasksDone: number; distanceM: number;
  moneySavedRub: number; utilizationPct: number;
  clock: string; batteryAvg: number; queueLen: number;
  focusRobot: string;
  focusRobotId: number | null;
  focusState: RobotState;
  focusFlow: string;
  focusFloorId: string;
  focusFloor: string;
  focusVertical: string | null;
  activeRobots: number;
  verticalTrips: number;
  floorStats: {
    id: string;
    label: string;
    robots: number;
    active: number;
    tasks: number;
    completed: number;
  }[];
  flowStats: FlowStat[];
}

export type FlowPathMap = Map<string, Map<string, [number, number][]>>;

// The model advances several simulation seconds per real second, but not a
// full half-minute. The previous value made a robot cross the whole scene
// before a person could understand what it was doing.
const SIM_SEC_PER_REAL_SEC = 6;
const TRAIL_LEN = 12;
const LIDAR_RANGE_M = 3;
const LIDAR_FOV_COS = 0.35;
const ROBOT_BODY_RADIUS_PX = 12;
const MIN_PASSING_GAP_PX = ROBOT_BODY_RADIUS_PX * 2 + 2;

export function createSim(scene: SimScene, opts: SimOptions) {
  const managed = scene.id.startsWith("generated-");
  let simTimeSec = clockToSec(scene.startClock);
  let acc = 0, idSeq = 0;
  const random = mulberry32(opts.seed ?? 42);
  const rand = (a: number, b: number) => a + random() * (b - a);
  let tasksDone = 0, distanceM = 0, moneySavedRub = 0;
  let utilBusy = 0, utilTotal = 0;
  const events: string[] = [];
  const queue: number[] = [];
  const flowScores = new Map<string, number>();
  const flowCompleted = new Map<string, number>();
  const robotAssignments = new Map<number, number>();
  const robotAssignmentOrder = new Map<number, number>();
  let assignmentSequence = 0;
  let verticalTrips = 0;
  const floorTaskStats = new Map<string, { tasks: number; completed: number }>();
  const verticalOccupancy = new Map<string, Set<number>>();
  const defaultFloorId = scene.defaultFloorId ?? scene.floors?.[0]?.id ?? "floor-1";
  let activeFloorId = defaultFloorId;
  for (const floorId of floorIds(scene, defaultFloorId)) {
    floorTaskStats.set(floorId, { tasks: 0, completed: 0 });
  }

  const fleet: FleetEntry[] = managed || opts.fleet.length
    ? opts.fleet
    : [{ sprite: "amr-pallet", count: 1, speedMps: 1.5, title: "демо" }];

  // Поток может быть назначен только технике своего типа. Даже core-поток
  // нельзя подменять другим роботом: иначе в журнале появляется фиктивный
  // рейс, а KPI показывают работу несовместимой машины.
  const safeFlows = scene.flows.filter(
    (flow) =>
      fleet.some((entry) => entry.sprite === flow.sprite) &&
      !flowUnavailableReason(flow, scene, defaultFloorId),
  );
  const availableFlowIds = new Set(safeFlows.map((flow) => flow.id));
  const floorFlowPaths = new Map(
    scene.flows.map((flow) => [
      flow.id,
      new Map(
        flowStopsFor(flow, defaultFloorId).map((stop) => [
          stop.floorId,
          routeThroughWaypoints(stop.waypoints, scene, stop.floorId),
        ]),
      ),
    ]),
  );

  const robots: Robot[] = [];
  for (const entry of fleet) {
    for (let i = 0; i < entry.count; i++) {
      const compatibleFlows = safeFlows.filter((flow) => flow.sprite === entry.sprite);
      const assignedFlow = scene.id === "warehouse-v2"
        ? compatibleFlows[i % Math.max(1, compatibleFlows.length)]
        : undefined;
      const assignedVariantIndex = assignedFlow?.routeVariants?.length
        ? i % assignedFlow.routeVariants.length
        : undefined;
      const assignedVariant = assignedVariantIndex === undefined
        ? undefined
        : assignedFlow?.routeVariants?.[assignedVariantIndex];
      const home = homeFor(entry.sprite, safeFlows, scene, assignedFlow, assignedVariant);
      const spawn = safeSpawnPoint(
        home.point,
        sceneForFloor(scene, home.floorId),
        robots.map((robot) => [robot.x, robot.y]),
      );
      robots.push({
        id: idSeq,
        name: `${shortType(entry.sprite)}-${idSeq + 1}`,
        sprite: entry.sprite, title: entry.title ?? "",
        typeIndex: i,
        assignedFlowId: assignedFlow?.id,
        assignedVariantIndex,
        floorId: home.floorId, speedMps: entry.speedMps,
        state: "idle", x: spawn[0], y: spawn[1],
        angle: 0, battery: managed ? 100 : 60 + rand(0, 40), trail: [],
        path: [], pathIdx: 0, flow: null, routeVariant: undefined,
        taskFloorIds: undefined,
        waitSec: rand(0, 2.5), busySec: 0,
        blockedSec: 0, progressM: 0,
        lidar: { action: "clear", obstacleId: null, distanceM: null },
      });
      idSeq++;
    }
  }
  // Reserve complete journeys before departure, including the return to a
  // physical waiting bay. Waiting robots never occupy a pickup point or lift.
  // This conservative admission policy allows disjoint journeys in parallel;
  // intersecting journeys wait in stable FIFO order, not inside a junction.
  type Segment = { floor: string; a: [number, number]; b: [number, number] };
  const bays = new Map<number, { floor: string; point: [number, number] }>();
  const missions = new Map<number, { segments: Segment[]; drop: RouteStep[]; back: RouteStep[] }>();
  const missionPlans = new Map<string, { segments: Segment[]; pickup: RouteStep[]; drop: RouteStep[]; back: RouteStep[] }>();
  let nextDispatchSec = 0;
  if (managed) {
    const availableFloors = scene.verticalLinks?.some(link => link.enabled !== false)
      ? floorIds(scene, defaultFloorId) : [defaultFloorId];
    robots.forEach((r, index) => {
      const slot = Math.floor(index / availableFloors.length);
      if (slot >= 56) throw new Error("Слишком большой парк для схемы: не хватает безопасных мест ожидания.");
      const point: [number, number] = [60 + (slot % 28) * 40, slot < 28 ? 48 : 672];
      const floor = availableFloors[index % availableFloors.length];
      if (segmentBlocked(point, point, sceneForFloor(scene, floor))) {
        throw new Error("Место ожидания пересекает препятствие. Проверьте геометрию объекта.");
      }
      bays.set(r.id, { floor, point });
      r.floorId = floor;
      [r.x, r.y] = point;
    });
  }
  function planningScene(r: Robot): SimScene {
    const occupied = (floor: string) => [...bays.entries()]
      .filter(([id, bay]) => id !== r.id && bay.floor === floor)
      .map(([, bay]) => ({ x: bay.point[0] - 19, y: bay.point[1] - 19, w: 38, h: 38 }));
    return {
      ...scene,
      racks: [...(scene.racks ?? []), ...occupied(defaultFloorId)],
      floors: scene.floors?.map(f => ({ ...f, racks: [...(f.racks ?? []), ...occupied(f.id)] })),
    };
  }
  function segmentsFor(r: Robot, steps: RouteStep[]): Segment[] {
    let floor = r.floorId;
    let point: [number, number] = [r.x, r.y];
    const segments: Segment[] = [];
    for (const step of steps) {
      if (step.kind === "vertical") {
        segments.push({ floor, a: point, b: step.from });
        floor = step.toFloor;
        point = step.to;
        segments.push({ floor, a: point, b: point });
      } else {
        segments.push({ floor: step.floorId, a: point, b: step.point });
        point = step.point;
        floor = step.floorId;
      }
    }
    return segments;
  }
  function canReserve(segments: Segment[], ignoreId?: number) {
    return [...missions.entries()].filter(([id]) => id !== ignoreId).every(([, m]) => m.segments.every(a =>
      segments.every(b => a.floor !== b.floor || segmentDistance(a.a, a.b, b.a, b.b) >= MIN_PASSING_GAP_PX + 2),
    ));
  }
  // Стартовый операционный задел: техника начинает работу сразу, а затем
  // новые задания поступают уже с расчётной частотой.
  if (!managed && safeFlows.length > 0) {
    for (let i = 0; i < robots.length; i++) {
      queue.push(1);
    }
  }

  function homeFor(
    sprite: string,
    fl: Flow[],
    sc: SimScene,
    assignedFlow?: Flow,
    assignedVariant?: FlowRouteVariant,
  ): { floorId: string; point: [number, number] } {
    const mine = fl.filter((f) => f.sprite === sprite);
    const f = assignedFlow ?? mine[idSeq % Math.max(1, mine.length)] ?? fl[0];
    const stop = f
      ? flowStopsForVariant(f, assignedVariant, defaultFloorId)[0]
      : undefined;
    if (stop) return { floorId: stop.floorId, point: stop.waypoints[0] };
    return { floorId: defaultFloorId, point: [sc.width / 2, sc.height / 2] };
  }

  function pushEvent(text: string) {
    events.unshift(`${secToClock(simTimeSec)} · ${text}`);
    if (events.length > 40) events.pop();
  }

  function planPickupPath(r: Robot, f: Flow, routingScene = scene): RouteStep[] {
    const firstStop = flowStopsForVariant(f, r.routeVariant, defaultFloorId)[0];
    if (
      scene.id === "warehouse-v2" &&
      firstStop.floorId === r.floorId &&
      firstStop.waypoints.length > 1
    ) {
      const lastPoint = firstStop.waypoints[firstStop.waypoints.length - 1];
      if (Math.hypot(r.x - lastPoint[0], r.y - lastPoint[1]) <= 4) {
        const reversePath = routeThroughWaypoints(
          [...firstStop.waypoints].reverse(),
          scene,
          r.floorId,
        );
        return reversePath.slice(1).map((point) => ({
          kind: "move" as const,
          floorId: r.floorId,
          point,
        }));
      }
    }
    return routeToPoint(
      r.floorId,
      [r.x, r.y],
      firstStop.floorId,
      firstStop.waypoints[0],
      routingScene,
    );
  }

  function planDropPath(r: Robot, f: Flow, routingScene = scene): RouteStep[] {
    const stops = flowStopsForVariant(f, r.routeVariant, defaultFloorId);
    const route: RouteStep[] = [];
    let floorId = r.floorId;
    let point: [number, number] = [r.x, r.y];

    for (let stopIndex = 0; stopIndex < stops.length; stopIndex++) {
      const stop = stops[stopIndex];
      const points = stopIndex === 0 ? stop.waypoints.slice(1) : stop.waypoints;
      if (floorId !== stop.floorId) {
        const transition = routeToFloor(floorId, point, stop.floorId, routingScene);
        route.push(...transition.steps);
        floorId = transition.floorId;
        point = transition.point;
      }
      for (const target of points) {
        const connector = safeConnectorPath(point, target, routingScene, floorId);
        route.push(...connector.slice(1).map((next) => ({
          kind: "move" as const,
          floorId,
          point: next,
        })));
        point = target;
      }
    }
    return route;
  }

  function update(dtReal: number) {
    const dtSim = Math.min(dtReal, 0.1) * (managed ? 1 : SIM_SEC_PER_REAL_SEC) * (opts.speedMultiplier ?? 1);
    if (!Number.isFinite(dtSim) || dtSim <= 0) return;
    // Explicit fast-forward advances the same state machine in small model
    // steps; it never makes a robot jump six seconds past a junction.
    const steps = managed ? Math.max(1, Math.ceil(dtSim / 0.1)) : 1;
    for (let i = 0; i < steps; i++) updateStep(dtSim / steps);
  }

  function updateStep(dtSim: number) {
    simTimeSec += dtSim;
    const totalRobots = robots.length;
    const rate = opts.tasksPerHour / 3600;
    acc += rate * dtSim;
    while (acc >= 1 && (managed || queue.length < 60 * totalRobots)) { queue.push(1); acc -= 1; }
    if (!managed && acc >= 1) acc = 1;

    for (const r of robots) {
      utilTotal += dtSim;
      if (r.state !== "idle" && r.state !== "charging") utilBusy += dtSim;

      if (r.state === "charging") r.battery = Math.min(100, r.battery + dtSim * (managed ? 100 / (Math.max(1, opts.chargeTimeMinutes ?? 120) * 60) : 0.12));
      else if (r.state !== "idle") r.battery = Math.max(0, r.battery - dtSim * (managed ? 100 / (Math.max(0.1, opts.batteryRuntimeHours ?? 8) * 3600) : 0.005));

      if (
        !managed && r.battery < 18 &&
        r.state !== "charging" &&
        r.state !== "toCharge" &&
        !r.verticalLinkId
      ) {
        r.state = "toCharge";
        const c = chargeSlotFor(r, sceneForFloor(scene, r.floorId).charges);
        r.path = routeToChargePoint(r.floorId, [r.x, r.y], c, scene);
        r.pathIdx = 0; r.flow = null;
      r.yieldResumePath = undefined;
      r.yieldResumePathIdx = undefined;
        pushEvent(`${r.name}: батарея ${r.battery.toFixed(0)}% — убыл на зарядку`);
      }

      switch (r.state) {
        case "idle":
          r.waitSec -= dtSim;
          if (r.waitSec > 0) break;
          r.waitSec = 0;
          break;
        case "toPickup":
          if (advance(r, dtSim)) { r.state = "loading"; r.waitSec = rand(2, 3.5); }
          break;
        case "loading":
          r.waitSec -= dtSim;
          if (r.waitSec <= 0 && r.flow) {
            r.path = missions.get(r.id)?.drop ?? planDropPath(r, r.flow);
            r.pathIdx = 0;
            r.state = "toDrop";
          }
          break;
        case "toDrop":
          if (advance(r, dtSim)) { r.state = "unloading"; r.waitSec = rand(1.5, 2.5); }
          break;
        case "unloading":
          r.waitSec -= dtSim;
          if (r.waitSec <= 0) {
            tasksDone++;
            moneySavedRub += opts.laborCostPerTaskRub;
            if (r.flow) {
              flowCompleted.set(r.flow.id, (flowCompleted.get(r.flow.id) ?? 0) + 1);
              pushEvent(`${r.name}: рейс выполнен (${r.flow.label})`);
            }
            for (const floorId of r.taskFloorIds ?? []) {
              const stats = floorTaskStats.get(floorId);
              if (stats) stats.completed++;
            }
            r.taskFloorIds = undefined;
            if (managed) {
              r.path = missions.get(r.id)!.back;
              r.pathIdx = 0;
              r.state = "returning";
              r.flow = null;
            } else { r.state = "idle"; r.waitSec = rand(0.4, 1.4); }
          }
          break;
        case "toCharge":
          if (advance(r, dtSim)) {
            r.state = "charging";
            if (managed) {
              const mission = missions.get(r.id)!;
              // A parked charger owns its berth, not the approach aisle for
              // the whole charging duration. Its departure is reserved anew.
              mission.segments = [{ floor: r.floorId, a: [r.x, r.y], b: [r.x, r.y] }];
            }
          }
          break;
        case "charging":
          if (r.battery >= 96) {
            if (managed) {
              const mission = missions.get(r.id)!;
              const segments = segmentsFor(r, mission.back);
              if (!canReserve(segments, r.id)) break;
              mission.segments = segments;
              r.path = mission.back;
              r.pathIdx = 0;
              r.state = "returning";
            } else { r.state = "idle"; r.waitSec = 0; }
            pushEvent(`${r.name}: зарядка завершена`);
          }
          break;
        case "returning":
          if (advance(r, dtSim)) {
            missions.delete(r.id);
            r.state = "idle";
            r.waitSec = 0;
          }
          break;
      }
    }
    dispatchQueuedFlows();
  }

  function assignQueuedFlow(r: Robot): boolean {
    const f = pickFlowFor(r, safeFlows);
    if (!f) return false;
    r.flow = f;
    r.routeVariant = pickRouteVariant(r, f);
    let pickup: RouteStep[] | undefined;
    if (managed) {
      const planKey = `${r.id}:${f.id}:${JSON.stringify(r.routeVariant)}`;
      let plan = missionPlans.get(planKey);
      if (!plan) {
        const routing = planningScene(r);
        const stops = flowStopsForVariant(f, r.routeVariant, defaultFloorId);
        const first = stops[0];
        const last = stops[stops.length - 1];
        const start = first.waypoints[0];
        const end = last.waypoints[last.waypoints.length - 1];
        pickup = planPickupPath(r, f, routing);
        const drop = planDropPath({ ...r, floorId: first.floorId, x: start[0], y: start[1] }, f, routing);
        const bay = bays.get(r.id)!;
        const back = routeToPoint(last.floorId, end, bay.floor, bay.point, routing);
        const segments = segmentsFor(r, [...pickup, ...drop, ...back]);
        plan = { segments, pickup, drop, back };
        missionPlans.set(planKey, plan);
      }
      if (!canReserve(plan.segments)) { r.flow = null; return false; }
      pickup = plan.pickup;
      missions.set(r.id, plan);
    }
    queue.pop();
    r.taskFloorIds = taskFloorIdsFor(f, r.routeVariant, defaultFloorId);
    for (const floorId of r.taskFloorIds) {
      const stats = floorTaskStats.get(floorId);
      if (stats) stats.tasks++;
    }
    // Запоминаем маршрут в момент назначения, а не после
    // разгрузки: рейс может прерваться из-за разряда батареи.
    r.lastFlowId = f.id;
    r.path = pickup ?? planPickupPath(r, f); r.pathIdx = 0;
    r.yieldResumePath = undefined;
    r.yieldResumePathIdx = undefined;
    r.trail = [{ x: r.x, y: r.y }];
    r.state = "toPickup";
    robotAssignments.set(r.id, (robotAssignments.get(r.id) ?? 0) + 1);
    robotAssignmentOrder.set(r.id, assignmentSequence++);
    pushEvent(`${r.name}: назначен рейс «${f.label}»`);
    return true;
  }

  function dispatchQueuedFlows() {
    if (managed && simTimeSec < nextDispatchSec) return;
    nextDispatchSec = simTimeSec + 1;
    if (managed) {
      for (const r of robots.filter(r => r.state === "idle" && r.battery < 25)) {
        const routing = planningScene(r);
        const charge = sceneForFloor(scene, r.floorId).charges[r.id % sceneForFloor(scene, r.floorId).charges.length];
        if (!charge) continue;
        const path = routeToPoint(r.floorId, [r.x, r.y], r.floorId, charge, routing);
        const bay = bays.get(r.id)!;
        const back = routeToPoint(r.floorId, charge, bay.floor, bay.point, routing);
        const segments = segmentsFor(r, [...path, ...back]);
        if (!canReserve(segments)) continue;
        missions.set(r.id, { segments, drop: [], back });
        r.path = path; r.pathIdx = 0; r.state = "toCharge"; r.flow = null;
        pushEvent(`${r.name}: направлен на зарядную станцию`);
      }
    }
    while (queue.length > 0) {
      const candidates = robots
        .filter((robot) =>
          robot.state === "idle" &&
          robot.waitSec <= 0 &&
          robot.battery > (managed ? 25 : 18) &&
          safeFlows.some((flow) => flow.sprite === robot.sprite),
        )
        .sort((first, second) => {
          const assignmentDelta =
            (robotAssignments.get(first.id) ?? 0) - (robotAssignments.get(second.id) ?? 0);
          if (assignmentDelta !== 0) return assignmentDelta;
          return (robotAssignmentOrder.get(first.id) ?? -1)
            - (robotAssignmentOrder.get(second.id) ?? -1);
        });
      if (managed) {
        if (!candidates.some(robot => assignQueuedFlow(robot))) break;
      } else {
        const robot = candidates[0];
        if (!robot || !assignQueuedFlow(robot)) break;
      }
    }
  }

  function pickFlowFor(r: Robot, fl: Flow[]): Flow | null {
    const use = fl.filter((f) => f.sprite === r.sprite);
    if (!use.length) return null;
    if (scene.id === "warehouse-v2" && r.assignedFlowId) {
      return use.find((flow) => flow.id === r.assignedFlowId) ?? use[0];
    }

    const totalShare = use.reduce((sum, flow) => sum + Math.max(0.01, flow.share), 0);
    for (const flow of use) {
      flowScores.set(
        flow.id,
        (flowScores.get(flow.id) ?? 0) + Math.max(0.01, flow.share) / totalShare,
      );
    }
    const candidates = use.length > 1
      ? use.filter((flow) => flow.id !== r.lastFlowId)
      : use;
    let selected = candidates[0] ?? use[0];
    let selectedScore = -Infinity;
    for (const flow of candidates) {
      const score = flowScores.get(flow.id) ?? 0;
      if (score > selectedScore) {
        selected = flow;
        selectedScore = score;
      }
    }
    flowScores.set(selected.id, (flowScores.get(selected.id) ?? 0) - 1);
    return selected;
  }

  const routeVariantCursors = new Map<string, number>();

  function pickRouteVariant(r: Robot, flow: Flow): FlowRouteVariant | undefined {
    if (!flow.routeVariants?.length) return undefined;
    if (
      scene.id === "warehouse-v2" &&
      r.assignedFlowId === flow.id &&
      r.assignedVariantIndex !== undefined
    ) {
      return flow.routeVariants[r.assignedVariantIndex % flow.routeVariants.length];
    }
    const cursor = routeVariantCursors.get(flow.id) ?? 0;
    routeVariantCursors.set(flow.id, cursor + 1);
    return flow.routeVariants[cursor % flow.routeVariants.length];
  }

  function advance(r: Robot, dtSim: number): boolean {
    if (r.pathIdx >= r.path.length) {
      if (r.yieldResumePath) {
        r.path = r.yieldResumePath;
        r.pathIdx = r.yieldResumePathIdx ?? 0;
        r.yieldResumePath = undefined;
        r.yieldResumePathIdx = undefined;
        r.blockedSec = 0;
        return false;
      }
      return true;
    }
    let step = r.path[r.pathIdx];
    if (step.kind === "vertical") {
      return advanceVertical(r, step, dtSim);
    }

    if (step.floorId !== r.floorId) {
      r.floorId = step.floorId;
      r.trail = [];
    }
    const [tx, ty] = step.point;
    const distPx = Math.hypot(tx - r.x, ty - r.y);
    const stepPx = (r.speedMps / scene.mPerPx) * dtSim;
    const nextPoint: [number, number] = distPx <= stepPx
      ? [tx, ty]
      : [
          r.x + ((tx - r.x) / Math.max(1, distPx)) * stepPx,
          r.y + ((ty - r.y) / Math.max(1, distPx)) * stepPx,
        ];
    const movement = movementDecision(r, nextPoint);
    setLidarStatus(r, movement.lidar);
    if (!movement.allowed) {
      r.blockedSec += dtSim;
      const obstacle = movement.lidar.obstacleId === null
        ? undefined
        : robots.find((robot) => robot.id === movement.lidar.obstacleId);
      // Lower IDs own the contested passage. Only the losing robot yields;
      // the winner waits at the safety radius until the loser has cleared it.
      if (
        r.blockedSec >= 1.2 &&
        obstacle &&
        r.id > obstacle.id &&
        !r.yieldResumePath && !managed
      ) {
        beginYield(r);
      }
      return false;
    }

    r.blockedSec = 0;
    if (distPx <= stepPx) {
      r.x = tx; r.y = ty; r.pathIdx++;
      r.progressM += distPx * scene.mPerPx;
      distanceM += distPx * scene.mPerPx;
      if (r.pathIdx >= r.path.length && r.yieldResumePath) {
        r.path = r.yieldResumePath;
        r.pathIdx = r.yieldResumePathIdx ?? 0;
        r.yieldResumePath = undefined;
        r.yieldResumePathIdx = undefined;
        r.blockedSec = 0;
        return false;
      }
      return r.pathIdx >= r.path.length;
    }
    const desired = Math.atan2(ty - r.y, tx - r.x);
    r.angle = lerpAngle(r.angle, desired, Math.min(1, dtSim * 6));
    const movedPx = Math.hypot(nextPoint[0] - r.x, nextPoint[1] - r.y);
    r.x = nextPoint[0];
    r.y = nextPoint[1];
    r.progressM += movedPx * scene.mPerPx;
    distanceM += movedPx * scene.mPerPx;
    r.trail.push({ x: r.x, y: r.y });
    if (r.trail.length > TRAIL_LEN) r.trail.shift();
    return false;
  }

  function advanceVertical(
    r: Robot,
    step: Extract<RouteStep, { kind: "vertical" }>,
    dtSim: number,
  ): boolean {
    if (r.verticalLinkId !== step.linkId) {
      r.verticalLinkId = step.linkId;
      r.verticalWaiting = true;
      r.verticalWaitRemainingSec = step.waitSec;
      r.verticalRemainingSec = undefined;
      const link = scene.verticalLinks?.find((item) => item.id === step.linkId);
      pushEvent(`${r.name}: ожидает ${link?.label ?? "межэтажный переход"} · ${floorLabel(scene, step.fromFloor)} → ${floorLabel(scene, step.toFloor)}`);
    }

    if ((r.verticalWaitRemainingSec ?? 0) > 0) {
      r.verticalWaitRemainingSec = Math.max(0, (r.verticalWaitRemainingSec ?? 0) - dtSim);
      return false;
    }

    const occupants = verticalOccupancy.get(step.linkId) ?? new Set<number>();
    verticalOccupancy.set(step.linkId, occupants);
    const link = scene.verticalLinks?.find((item) => item.id === step.linkId);
    const capacity = Math.max(1, link?.capacity ?? 1);
    if (r.verticalRemainingSec === undefined) {
      if (occupants.size >= capacity) return false;
      occupants.add(r.id);
      r.verticalWaiting = false;
      r.verticalRemainingSec = step.travelSec;
      verticalTrips++;
      pushEvent(`${r.name}: вошёл в ${link?.label ?? "межэтажный переход"}`);
    }
    r.verticalRemainingSec = Math.max(0, (r.verticalRemainingSec ?? step.travelSec) - dtSim);
    if (r.verticalRemainingSec > 0) return false;
    occupants.delete(r.id);
    r.floorId = step.toFloor;
    r.x = step.to[0];
    r.y = step.to[1];
    r.trail = [];
    r.verticalLinkId = undefined;
    r.verticalWaiting = undefined;
    r.verticalWaitRemainingSec = undefined;
    r.verticalRemainingSec = undefined;
    r.pathIdx++;
    return r.pathIdx >= r.path.length;
  }

  function beginYield(r: Robot) {
    // The first robot wins a contested passage by stable ID order. A robot
    // that has no history to backtrack to simply waits; this only applies to
    // robots already moving on a route, so normal task endpoints stay intact.
    const history = r.trail;
    if (history.length < 3) return;
    const target = history[Math.max(0, history.length - 7)];
    if (!target || Math.hypot(target.x - r.x, target.y - r.y) < MIN_PASSING_GAP_PX) return;

    r.yieldResumePath = r.path;
    r.yieldResumePathIdx = r.pathIdx;
    r.path = [{
      kind: "move",
      floorId: r.floorId,
      point: [target.x, target.y],
    }];
    r.pathIdx = 0;
    r.blockedSec = 0;
    pushEvent(`${r.name}: уступает проезд — отходит по своей трассе`);
  }

  function movementDecision(
    r: Robot,
    nextPoint: [number, number],
  ): { allowed: boolean; lidar: LidarStatus } {
    const detection = scanLidar(r, nextPoint);
    const clearStatus: LidarStatus = detection
      ? {
          action: "turning",
          obstacleId: detection.robot.id,
          distanceM: detection.distancePx * scene.mPerPx,
        }
      : { action: "clear", obstacleId: null, distanceM: null };

    for (const other of robots) {
      if (other === r || other.floorId !== r.floorId) continue;
      const headingLength = Math.hypot(nextPoint[0] - r.x, nextPoint[1] - r.y);
      if (headingLength > 0.001) {
        const headingX = (nextPoint[0] - r.x) / headingLength;
        const headingY = (nextPoint[1] - r.y) / headingLength;
        const otherAhead =
          (other.x - r.x) * headingX + (other.y - r.y) * headingY;
        // A robot following behind cannot block the leader. Without this
        // directional check two robots on one fixed corridor stop forever:
        // the leader sees the follower, while the follower sees the leader.
        if (otherAhead < -MIN_PASSING_GAP_PX) continue;
      }
      const currentGap = Math.hypot(r.x - other.x, r.y - other.y);
      const predictedGap = Math.hypot(nextPoint[0] - other.x, nextPoint[1] - other.y);
      if (managed && pointSegmentDistance([other.x, other.y], [r.x, r.y], nextPoint) < MIN_PASSING_GAP_PX) {
        return { allowed: false, lidar: lidarStatusFor(other, r, "waiting") };
      }
      if (predictedGap < MIN_PASSING_GAP_PX) {
        // A single total order removes circular waiting. The winner still
        // cannot enter the safety radius; the loser will backtrack after the
        // bounded wait above, allowing the winner to clear the conflict.
        if (predictedGap <= currentGap + 0.25 || currentGap >= MIN_PASSING_GAP_PX) {
          return {
            allowed: false,
            lidar: lidarStatusFor(other, r, "waiting"),
          };
        }
      }
    }
    return { allowed: true, lidar: clearStatus };
  }

  function scanLidar(
    r: Robot,
    nextPoint: [number, number],
  ): { robot: Robot; distancePx: number; lateralPx: number } | null {
    const heading = Math.atan2(nextPoint[1] - r.y, nextPoint[0] - r.x);
    const rangePx = Math.max(40, LIDAR_RANGE_M / scene.mPerPx);
    let closest: { robot: Robot; distancePx: number; lateralPx: number } | null = null;

    for (const other of robots) {
      if (other === r || other.floorId !== r.floorId) continue;
      const dx = other.x - r.x;
      const dy = other.y - r.y;
      const distancePx = Math.hypot(dx, dy);
      if (distancePx > rangePx || distancePx < 0.001) continue;
      const bearing = Math.atan2(dy, dx);
      if (Math.cos(bearing - heading) < LIDAR_FOV_COS) continue;
      const lateralPx = Math.abs(dx * Math.sin(heading) - dy * Math.cos(heading));
      if (lateralPx >= MIN_PASSING_GAP_PX) continue;
      const candidate = { robot: other, distancePx, lateralPx };
      if (!closest || candidate.distancePx < closest.distancePx) closest = candidate;
    }
    return closest;
  }

  function lidarStatusFor(
    obstacle: Robot,
    r: Robot,
    action: LidarAction,
  ): LidarStatus {
    return {
      action,
      obstacleId: obstacle.id,
      distanceM: Math.hypot(obstacle.x - r.x, obstacle.y - r.y) * scene.mPerPx,
    };
  }

  function setLidarStatus(r: Robot, next: LidarStatus) {
    const previous = r.lidar;
    const changed = previous.action !== next.action || previous.obstacleId !== next.obstacleId;
    r.lidar = next;
    if (!changed) return;
    if (next.action === "waiting" && next.obstacleId !== null) {
      pushEvent(`${r.name}: лидар обнаружил ${robots.find((robot) => robot.id === next.obstacleId)?.name ?? "помеху"} — ожидает проезда`);
    } else if (next.action === "turning" && next.obstacleId !== null) {
      pushEvent(`${r.name}: лидар обнаружил помеху — корректирует курс`);
    } else if (previous.action !== "clear") {
      pushEvent(`${r.name}: лидарный коридор свободен — продолжает движение`);
    }
  }

  function getKpis(): SimKpis {
    const active = robots.filter((robot) => robot.state !== "idle" && robot.state !== "charging");
    const focus = active.length
      ? active[0]
      : robots.find((robot) => robot.state !== "idle") ?? robots[0];
    return {
      tasksDone, distanceM, moneySavedRub,
      nextTaskInSec: opts.tasksPerHour > 0 ? Math.max(0, (1 - acc) * 3600 / opts.tasksPerHour) : null,
      elapsedSec: simTimeSec - clockToSec(scene.startClock),
      observedTasksPerHour: simTimeSec > clockToSec(scene.startClock) ? tasksDone * 3600 / (simTimeSec - clockToSec(scene.startClock)) : 0,
      waitingRobots: robots.filter(r => r.state === "idle").length,
      utilizationPct: utilTotal > 0 ? (utilBusy / utilTotal) * 100 : 0,
      clock: secToClock(simTimeSec),
      batteryAvg: robots.reduce((s, r) => s + r.battery, 0) / Math.max(1, robots.length),
      queueLen: queue.length,
      focusRobot: focus?.name ?? "Нет мобильной техники",
      focusRobotId: focus?.id ?? null,
      focusState: focus?.state ?? "idle",
      focusFlow: focus?.flow?.label ?? (focus?.state === "returning"
        ? "Освобождает проезды и возвращается на стоянку"
        : focus?.state === "charging" || focus?.state === "toCharge"
          ? "Сервис парка"
          : queue.length ? "Ожидание допуска к маршруту" : "Ожидание нового задания"),
      focusFloorId: focus?.floorId ?? defaultFloorId,
      focusFloor: focus ? floorLabel(scene, focus.floorId) : floorLabel(scene, defaultFloorId),
      focusVertical: focus?.verticalLinkId
        ? `${scene.verticalLinks?.find((link) => link.id === focus.verticalLinkId)?.label ?? "Межэтажный переход"} · ${focus.verticalWaiting ? "ожидание" : "в пути"}`
        : null,
      activeRobots: active.length,
      verticalTrips,
      floorStats: (scene.floors?.length
        ? scene.floors
        : [{ id: defaultFloorId, label: "Этаж 1", level: 1 }]
      ).map((floor) => ({
        id: floor.id,
        label: floor.label,
        robots: robots.filter((robot) => robot.floorId === floor.id).length,
        active: active.filter((robot) => robot.floorId === floor.id).length,
        tasks: floorTaskStats.get(floor.id)?.tasks ?? 0,
        completed: floorTaskStats.get(floor.id)?.completed ?? 0,
      })),
      flowStats: scene.flows.map((flow) => ({
        id: flow.id,
        label: flow.label,
        active: robots.filter((robot) => robot.flow?.id === flow.id && robot.state !== "idle").length,
        completed: flowCompleted.get(flow.id) ?? 0,
        available: availableFlowIds.has(flow.id),
        unavailableReason: availableFlowIds.has(flow.id)
          ? undefined
          : flowUnavailableReason(flow, scene, defaultFloorId) ?? "Нет совместимой техники",
      })),
    };
  }

  return {
    robots, update, getKpis,
    getEvents: () => events.slice(0, 8),
    getFocusRobot: () => {
      const id = getKpis().focusRobotId;
      return robots.find((robot) => robot.id === id);
    },
    getFloorScene: () => sceneForFloor(scene, activeFloorId),
    getFlowPath: (flowId: string, floorId = activeFloorId) =>
      floorFlowPaths.get(flowId)?.get(floorId) ?? [],
    getFlowPaths: (flowId: string, floorId = activeFloorId) => {
      const flow = scene.flows.find((item) => item.id === flowId);
      if (!flow) return [];
      if (scene.id === "warehouse-v2") {
        const assignedPaths = robots
          .filter((robot) =>
            robot.assignedFlowId === flowId &&
            robot.assignedVariantIndex !== undefined,
          )
          .map((robot) => flow.routeVariants?.[robot.assignedVariantIndex!])
          .filter((variant): variant is FlowRouteVariant => Boolean(variant))
          .map((variant) => flowStopsForVariant(flow, variant, defaultFloorId))
          .map((stops) => stops.find((stop) => stop.floorId === floorId))
          .filter((stop): stop is FlowFloorStop => Boolean(stop))
          .map((stop) => routeThroughWaypoints(stop.waypoints, scene, floorId))
          .filter((path) => path.length > 1);
        if (assignedPaths.length) return assignedPaths;
      }
      return routeVariantsFor(flow, defaultFloorId)
        .map((stops) => stops.find((stop) => stop.floorId === floorId))
        .filter((stop): stop is FlowFloorStop => Boolean(stop))
        .map((stop) => routeThroughWaypoints(stop.waypoints, scene, floorId))
        .filter((path) => path.length > 1);
    },
    // Совместимость с диагностикой плоских сцен: этажные потребители
    // используют getFlowPath, а старые проверки получают маршрут этажа по
    // умолчанию без потери новой модели переходов.
    flowPaths: new Map(
      scene.flows.map((flow) => [
        flow.id,
        floorFlowPaths.get(flow.id)?.get(defaultFloorId) ?? [],
      ]),
    ),
    get activeFloorId() { return activeFloorId; },
    setActiveFloor: (floorId: string) => {
      if (floorIds(scene, defaultFloorId).includes(floorId)) activeFloorId = floorId;
    },
    floors: scene.floors?.length
      ? scene.floors
      : [{ id: defaultFloorId, label: "Этаж 1", level: 1 }],
    fleet, flows: safeFlows, scene, opts,
  };
}

export type Sim = ReturnType<typeof createSim>;

function pointSegmentDistance(p: [number, number], a: [number, number], b: [number, number]) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

function segmentDistance(a: [number, number], b: [number, number], c: [number, number], d: [number, number]) {
  const cross = (p: [number, number], q: [number, number], r: [number, number]) =>
    (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  if (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) return 0;
  return Math.min(pointSegmentDistance(a, c, d), pointSegmentDistance(b, c, d),
    pointSegmentDistance(c, a, b), pointSegmentDistance(d, a, b));
}

function flowStopsFor(flow: Flow, defaultFloorId: string): FlowFloorStop[] {
  return flow.floorStops?.length
    ? flow.floorStops
    : [{ floorId: defaultFloorId, waypoints: flow.waypoints }];
}

function flowStopsForVariant(
  flow: Flow,
  variant: FlowRouteVariant | undefined,
  defaultFloorId: string,
): FlowFloorStop[] {
  if (variant?.floorStops?.length) return variant.floorStops;
  if (variant?.waypoints?.length) {
    return [{ floorId: defaultFloorId, waypoints: variant.waypoints }];
  }
  return flowStopsFor(flow, defaultFloorId);
}

function taskFloorIdsFor(
  flow: Flow,
  variant: FlowRouteVariant | undefined,
  defaultFloorId: string,
): string[] {
  return [...new Set(flowStopsForVariant(flow, variant, defaultFloorId).map((stop) => stop.floorId))];
}

function routeVariantsFor(
  flow: Flow,
  defaultFloorId: string,
): FlowFloorStop[][] {
  return [
    flowStopsFor(flow, defaultFloorId),
    ...(flow.routeVariants ?? []).map((variant) =>
      flowStopsForVariant(flow, variant, defaultFloorId),
    ),
  ];
}

function floorIds(scene: SimScene, defaultFloorId: string): string[] {
  return scene.floors?.length ? scene.floors.map((floor) => floor.id) : [defaultFloorId];
}

function floorLabel(scene: SimScene, floorId: string): string {
  return scene.floors?.find((floor) => floor.id === floorId)?.label ?? "Этаж 1";
}

function safeSpawnPoint(
  point: [number, number],
  scene: SimScene,
  occupied: [number, number][] = [],
): [number, number] {
  const candidates: [number, number][] = [
    point,
    [point[0] - 24, point[1]],
    [point[0] + 24, point[1]],
    [point[0], point[1] - 24],
    [point[0], point[1] + 24],
    [point[0] - 24, point[1] - 24],
    [point[0] + 24, point[1] + 24],
    [point[0] - 24, point[1] + 24],
    [point[0] + 24, point[1] - 24],
  ];
  return candidates.find((candidate) =>
    !segmentBlocked(candidate, candidate, scene) &&
    occupied.every(([x, y]) =>
      Math.hypot(candidate[0] - x, candidate[1] - y) >= MIN_PASSING_GAP_PX,
    ),
  ) ?? point;
}

function sceneForFloor(scene: SimScene, floorId: string): SimScene {
  const floor = scene.floors?.find((item) => item.id === floorId);
  if (!floor) return scene;
  return {
    ...scene,
    zones: floor.zones ?? scene.zones,
    racks: floor.racks ?? scene.racks,
    props: floor.props ?? scene.props,
    charges: floor.charges ?? scene.charges,
    walls: floor.walls ?? scene.walls,
    doors: floor.doors ?? scene.doors,
  };
}

function routeToPoint(
  fromFloor: string,
  fromPoint: [number, number],
  toFloor: string,
  toPoint: [number, number],
  scene: SimScene,
): RouteStep[] {
  const route: RouteStep[] = [];
  let floorId = fromFloor;
  let point = fromPoint;
  if (fromFloor !== toFloor) {
    const transition = routeToFloor(fromFloor, fromPoint, toFloor, scene);
    route.push(...transition.steps);
    floorId = transition.floorId;
    point = transition.point;
  }
  const connector = safeConnectorPath(point, toPoint, scene, floorId);
  route.push(...connector.slice(1).map((next) => ({
    kind: "move" as const,
    floorId,
    point: next,
  })));
  return route;
}

function routeToChargePoint(
  floorId: string,
  fromPoint: [number, number],
  target: [number, number],
  scene: SimScene,
): RouteStep[] {
  const floorScene = sceneForFloor(scene, floorId);
  const stagingY = floorScene.walls
    ? floorScene.walls.y + floorScene.walls.h - 26
    : floorScene.height - 26;
  // Descend to the staging row before moving horizontally to the robot's
  // fixed charge lane. Approaching a slot from the side could cross an
  // occupied charging point; using the staging row keeps all approaches
  // ordered and prevents head-on convergence.
  const entryPoint: [number, number] = [fromPoint[0], stagingY];
  const staging: [number, number] = [target[0], stagingY];
  return [
    ...routeToPoint(floorId, fromPoint, floorId, entryPoint, scene),
    ...routeToPoint(floorId, entryPoint, floorId, staging, scene),
    ...routeToPoint(floorId, staging, floorId, target, scene),
  ];
}

function routeToFloor(
  fromFloor: string,
  fromPoint: [number, number],
  toFloor: string,
  scene: SimScene,
): { steps: RouteStep[]; floorId: string; point: [number, number] } {
  const link = scene.verticalLinks?.find(
    (item) => item.enabled !== false && item.floors.includes(fromFloor) && item.floors.includes(toFloor),
  );
  if (!link) return { steps: [], floorId: fromFloor, point: fromPoint };
  const from = link.points[fromFloor];
  const to = link.points[toFloor];
  if (!from || !to) return { steps: [], floorId: fromFloor, point: fromPoint };
  const connector = safeConnectorPath(fromPoint, from, scene, fromFloor);
  const steps: RouteStep[] = [
    ...connector.slice(1).map((next) => ({
      kind: "move" as const,
      floorId: fromFloor,
      point: next,
    })),
    {
      kind: "vertical",
      linkId: link.id,
      fromFloor,
      toFloor,
      from,
      to,
      waitSec: link.waitSec,
      travelSec: link.travelSec * Math.max(1, Math.abs(floorLevel(scene, toFloor) - floorLevel(scene, fromFloor))),
    },
  ];
  return { steps, floorId: toFloor, point: to };
}

function flowUnavailableReason(
  flow: Flow,
  scene: SimScene,
  defaultFloorId: string,
): string | null {
  const stops = flowStopsFor(flow, defaultFloorId);
  const requiredFloors = Array.from(new Set(stops.map((stop) => stop.floorId)));
  if (requiredFloors.length <= 1) return null;
  const hasEnabledLink = scene.verticalLinks?.some(
    (link) =>
      link.enabled !== false &&
      requiredFloors.every((floorId) => link.floors.includes(floorId)),
  );
  if (hasEnabledLink) return null;
  return scene.verticalLinks?.find((link) => link.enabled === false)?.blockedReason
    ?? "Нет доступной межэтажной связи";
}

function floorLevel(scene: SimScene, floorId: string): number {
  return scene.floors?.find((floor) => floor.id === floorId)?.level ?? 1;
}

export function routeThroughWaypoints(
  waypoints: [number, number][],
  scene: SimScene,
  floorId?: string,
): [number, number][] {
  if (!waypoints.length) return [];
  const path: [number, number][] = [waypoints[0]];
  let cursor = waypoints[0];
  for (const waypoint of waypoints.slice(1)) {
    const connector = safeConnectorPath(cursor, waypoint, scene, floorId);
    path.push(...connector.slice(1));
    cursor = waypoint;
  }
  return path;
}

export function safeConnectorPath(
  start: [number, number],
  target: [number, number],
  scene: SimScene,
  floorId?: string,
): [number, number][] {
  const candidates: [number, number][][] = [
    [start, target],
    [start, [start[0], target[1]], target],
    [start, [target[0], start[1]], target],
  ];
  const floorScene = floorId ? sceneForFloor(scene, floorId) : scene;
  const wall = floorScene.walls;
  const xCandidates = [
    ...(floorScene.racks ?? []).flatMap((rack) => [rack.x - 18, rack.x + rack.w + 18]),
    wall ? wall.x + 26 : 24,
    wall ? wall.x + wall.w - 26 : floorScene.width - 24,
  ];
  const yCandidates = [
    ...(floorScene.racks ?? []).flatMap((rack) => [rack.y - 18, rack.y + rack.h + 18]),
    wall ? wall.y + 26 : 24,
    wall ? wall.y + wall.h - 26 : floorScene.height - 24,
  ];
  for (const x of xCandidates) {
    candidates.push([start, [x, start[1]], [x, target[1]], target]);
  }
  for (const y of yCandidates) {
    candidates.push([start, [start[0], y], [target[0], y], target]);
  }
  // Если оба объекта находятся по разные стороны ряда, двух сегментов
  // недостаточно: сначала нужно выйти в продольный внешний проезд, а уже
  // потом пересечь карту. Эти обходы не требуют ручного перечисления всех
  // сочетаний стеллажей и не создают тупик у зарядной зоны.
  for (const x of xCandidates) {
    for (const y of yCandidates) {
      candidates.push([
        start,
        [x, start[1]],
        [x, y],
        [target[0], y],
        target,
      ]);
      candidates.push([
        start,
        [start[0], y],
        [x, y],
        [x, target[1]],
        target,
      ]);
    }
  }

  const safe = candidates.find((path) =>
    path.every((point, index) => index === 0 || !segmentBlocked(path[index - 1], point, floorScene)),
  );
  if (safe) return safe;

  const gridRoute = gridConnectorPath(start, target, floorScene);
  if (gridRoute) return gridRoute;

  throw new Error(
    `Не удалось построить безопасный маршрут в сцене «${scene.id}» ` +
    `от [${start.join(", ")}] до [${target.join(", ")}]`,
  );
}

export function segmentBlocked(
  start: [number, number],
  end: [number, number],
  scene: SimScene,
): boolean {
  const clearance = scene.id.startsWith("generated-") ? ROBOT_BODY_RADIUS_PX : 8;
  return (scene.racks ?? []).some((rack) =>
    segmentIntersectsRect(start, end, {
      x: rack.x - clearance,
      y: rack.y - clearance,
      w: rack.w + clearance * 2,
      h: rack.h + clearance * 2,
    }),
  );
}

function gridConnectorPath(
  start: [number, number],
  target: [number, number],
  scene: SimScene,
): [number, number][] | null {
  const step = 24;
  const margin = scene.walls ? 26 : 12;
  const minX = scene.walls ? scene.walls.x + margin : margin;
  const minY = scene.walls ? scene.walls.y + margin : margin;
  const maxX = scene.walls ? scene.walls.x + scene.walls.w - margin : scene.width - margin;
  const maxY = scene.walls ? scene.walls.y + scene.walls.h - margin : scene.height - margin;
  const columns = Math.floor((maxX - minX) / step) + 1;
  const rows = Math.floor((maxY - minY) / step) + 1;
  const pointFor = (i: number, j: number): [number, number] => [
    Math.min(maxX, minX + i * step),
    Math.min(maxY, minY + j * step),
  ];
  const safeCell = (i: number, j: number) => {
    const point = pointFor(i, j);
    return !segmentBlocked(point, point, scene);
  };
  const cellFor = (point: [number, number]): [number, number] => [
    Math.min(columns - 1, Math.max(0, Math.round((point[0] - minX) / step))),
    Math.min(rows - 1, Math.max(0, Math.round((point[1] - minY) / step))),
  ];
  const nearestSafeCell = (point: [number, number]): [number, number] | null => {
    const [baseI, baseJ] = cellFor(point);
    for (let radius = 0; radius <= 12; radius++) {
      for (let i = baseI - radius; i <= baseI + radius; i++) {
        for (let j = baseJ - radius; j <= baseJ + radius; j++) {
          if (i < 0 || j < 0 || i >= columns || j >= rows) continue;
          if (Math.max(Math.abs(i - baseI), Math.abs(j - baseJ)) !== radius) continue;
          if (safeCell(i, j)) return [i, j];
        }
      }
    }
    return null;
  };

  const startCell = nearestSafeCell(start);
  const targetCell = nearestSafeCell(target);
  if (!startCell || !targetCell) return null;

  const key = (i: number, j: number) => `${i}:${j}`;
  const startKey = key(startCell[0], startCell[1]);
  const targetKey = key(targetCell[0], targetCell[1]);
  const previous = new Map<string, string>();
  const queue: Array<[number, number]> = [startCell];
  const visited = new Set<string>([startKey]);
  const directions = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

  while (queue.length) {
    const current = queue.shift()!;
    const currentKey = key(current[0], current[1]);
    if (currentKey === targetKey) break;
    for (const [di, dj] of directions) {
      const next: [number, number] = [current[0] + di, current[1] + dj];
      if (
        next[0] < 0 || next[1] < 0 ||
        next[0] >= columns || next[1] >= rows
      ) continue;
      const nextKey = key(next[0], next[1]);
      if (visited.has(nextKey) || !safeCell(next[0], next[1])) continue;
      const from = pointFor(current[0], current[1]);
      const to = pointFor(next[0], next[1]);
      if (segmentBlocked(from, to, scene)) continue;
      visited.add(nextKey);
      previous.set(nextKey, currentKey);
      queue.push(next);
    }
  }

  if (!visited.has(targetKey)) return null;
  const cells: Array<[number, number]> = [];
  let cursor = targetKey;
  while (cursor !== startKey) {
    const [i, j] = cursor.split(":").map(Number);
    cells.push([i, j]);
    const parent = previous.get(cursor);
    if (!parent) return null;
    cursor = parent;
  }
  cells.push(startCell);
  cells.reverse();

  const route: [number, number][] = [start];
  for (const [i, j] of cells.slice(1)) route.push(pointFor(i, j));
  if (route[route.length - 1][0] !== target[0] || route[route.length - 1][1] !== target[1]) {
    route.push(target);
  }
  return simplifyRoute(route);
}

function simplifyRoute(path: [number, number][]): [number, number][] {
  if (path.length < 3) return path;
  const result: [number, number][] = [path[0]];
  for (let i = 1; i < path.length - 1; i++) {
    const a = result[result.length - 1];
    const b = path[i];
    const c = path[i + 1];
    if ((b[0] - a[0]) * (c[1] - b[1]) !== (b[1] - a[1]) * (c[0] - b[0])) {
      result.push(b);
    }
  }
  result.push(path[path.length - 1]);
  return result;
}

function segmentIntersectsRect(
  start: [number, number],
  end: [number, number],
  rect: { x: number; y: number; w: number; h: number },
): boolean {
  const minX = rect.x;
  const maxX = rect.x + rect.w;
  const minY = rect.y;
  const maxY = rect.y + rect.h;
  if (
    start[0] >= minX && start[0] <= maxX &&
    start[1] >= minY && start[1] <= maxY
  ) return true;
  if (
    end[0] >= minX && end[0] <= maxX &&
    end[1] >= minY && end[1] <= maxY
  ) return true;

  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const hitsVertical = (x: number) => {
    if (dx === 0) return false;
    const t = (x - start[0]) / dx;
    const y = start[1] + t * dy;
    return t >= 0 && t <= 1 && y >= minY && y <= maxY;
  };
  const hitsHorizontal = (y: number) => {
    if (dy === 0) return false;
    const t = (y - start[1]) / dy;
    const x = start[0] + t * dx;
    return t >= 0 && t <= 1 && x >= minX && x <= maxX;
  };
  return hitsVertical(minX) || hitsVertical(maxX) || hitsHorizontal(minY) || hitsHorizontal(maxY);
}
function chargeSlotFor(
  r: Robot,
  charges: [number, number][],
): [number, number] {
  if (!charges.length) return [r.x, r.y];
  // Зарядная зона — это несколько физических мест, а не одна точка
  // «ближайшая к роботу». Раскладываем слоты сеткой над станциями, чтобы
  // подъезд к одной станции не перекрывал подъезд к соседней.
  const minX = Math.min(...charges.map(([x]) => x));
  const minY = Math.min(...charges.map(([, y]) => y));
  const columns = Math.max(6, charges.length);
  const column = r.id % columns;
  const row = Math.floor(r.id / columns);
  return [minX - 30 + column * 32, minY + row * 36];
}
function lerpAngle(a: number, b: number, t: number): number {
  const d = ((b - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  return a + d * t;
}

function clockToSec(s: string): number {
  const [h, m] = s.split(":").map(Number);
  return h * 3600 + (m || 0) * 60;
}
function secToClock(sec: number): string {
  const s = Math.floor(sec) % 86400;
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
function mulberry32(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value |= 0;
    value = (value + 0x6D2B79F5) | 0;
    let t = Math.imul(value ^ (value >>> 15), 1 | value);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shortType(sprite: string): string {
  const map: Record<string, string> = {
    "amr-pallet": "AMR", "fmr-forklift": "FMR", "scrubber": "УБР",
    "tug": "ТЯГ", "truck": "ГРУЗ", "delivery-bot": "ДОС", "medical-amr": "MED",
    "shuttle": "SHT",
  };
  return map[sprite] ?? "РБТ";
}
