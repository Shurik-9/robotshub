import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { createSim, segmentBlocked } from "../src/sim/sim-engine.ts";
import { buildFleet } from "../src/sim/fleet.ts";
import { withCoverageRoutes } from "../src/sim/coverage-routes.ts";
import { buildScene, getSceneGeometrySummary } from "../src/sim/scene-builder.ts";

const sceneNames = ["warehouse", "airport", "hospital"];

test("report snapshot effect cannot feed provider renders back into its own cleanup", async () => {
  // Source-level lifecycle regression: no DOM harness is used here. The old
  // unstable setter + [persistSimulationKpis] cleanup failed these invariants.
  const page = await readFile(new URL("../src/pages/simulation.tsx", import.meta.url), "utf8");
  const store = await readFile(new URL("../src/store/project.tsx", import.meta.url), "utf8");
  assert.match(store, /const setSimulationKpis = useCallback\([\s\S]*?\}, \[\]\);/,
    "Snapshot setter identity must not change when context state is written");
  assert.match(page, /return \(\) => \{\s*persistSimulationKpisRef\.current\(\);\s*\};\s*\}, \[\]\);/,
    "Only unmount may invoke the snapshot cleanup, not callback identity changes");
  assert.doesNotMatch(page, /\}, \[persistSimulationKpis\]\)/);
  assert.match(page, /persistSimulationKpisRef\.current = persistSimulationKpis/,
    "Unmount must persist the latest scene/signature, not a stale mount closure");
});

test("generated scenes: reserved journeys preserve clearance and progress through charging", () => {
  for (const kind of ["warehouse", "airport", "hospital"]) {
    for (const count of [1, 6, 12]) {
      const scene = buildScene({ kind, areaM2: 10000, floors: 2, elevatorIntegrationReady: true }, 42);
      const options = {
        fleet: [{ sprite: scene.flows[0].sprite, count, speedMps: 2 }],
        tasksPerHour: 180, laborCostPerTaskRub: 100,
        speedMultiplier: 10, seed: 42, chargeTimeMinutes: 1,
      };
      const sim = createSim(scene, options);
      // Exercise a real station visit, occupancy and return, not a test window
      // that stops before charging or excludes parked robots from clearance.
      sim.robots[0].battery = 24;
      let sawCharging = false;
      let sawReturn = false;
      for (let tick = 0; tick < 3600; tick++) {
        sim.update(0.1);
        sawCharging ||= sim.robots[0].state === "charging";
        sawReturn ||= sawCharging && sim.robots[0].state === "returning";
        for (const r of sim.robots) {
          assert.equal(r.blockedSec, 0, `${kind}/${count}: unexpected in-aisle blockage`);
          for (const other of sim.robots) {
            if (r.id >= other.id || r.floorId !== other.floorId) continue;
            assert.ok(Math.hypot(r.x - other.x, r.y - other.y) >= 26,
              `${kind}/${count}: clearance including charging/idle robots`);
          }
        }
      }
      assert.ok(sawCharging && sawReturn, `${kind}/${count}: complete charge cycle`);
      assert.ok(sim.robots.every(r => r.progressM > 0), `${kind}/${count}: every robot gets a turn`);
      const kpis = sim.getKpis();
      assert.ok(kpis.tasksDone > 0);
      assert.equal(Math.round(kpis.elapsedSec), 3600);
      assert.ok(Math.abs(kpis.observedTasksPerHour - kpis.tasksDone) < 0.0001);
      assert.equal(kpis.moneySavedRub, kpis.tasksDone * 100);
    }
  }
});

test("generated model uses actual seconds, conserves demand and repeats with seed 42", () => {
  const scene = buildScene({ kind: "warehouse", areaM2: 10000, floors: 1 }, 42);
  const options = { fleet: [{ sprite: "amr-pallet", count: 6, speedMps: 2 }],
    tasksPerHour: 360, laborCostPerTaskRub: 50, seed: 42 };
  const a = createSim(scene, options), b = createSim(scene, { ...options });
  assert.equal(a.getKpis().queueLen, 0, "No invented starting demand");
  for (let tick = 0; tick < 3000; tick++) { a.update(0.1); b.update(0.1); }
  assert.deepEqual(a.getKpis(), b.getKpis());
  assert.deepEqual(a.robots, b.robots);
  assert.ok(Math.abs(a.getKpis().elapsedSec - 300) < 0.001, "×1 is real seconds, not hidden ×6");
  const activeTasks = a.robots.filter(r => ["toPickup", "loading", "toDrop", "unloading"].includes(r.state)).length;
  assert.equal(a.getKpis().tasksDone + activeTasks + a.getKpis().queueLen, 30);
  const large = buildScene({ kind: "warehouse", areaM2: 40000, floors: 1 }, 42);
  assert.equal(large.mPerPx, scene.mPerPx * 2, "Distances scale with declared floor area");
});

test("explicit fast-forward conserves model time and rare demand has an exact countdown", () => {
  const scene = buildScene({ kind: "warehouse", areaM2: 30000, floors: 2, rackRows: 12, docks: 4 }, 42);
  const options = { fleet: [{ sprite: "amr-pallet", count: 4, speedMps: 2 }],
    tasksPerHour: 150, laborCostPerTaskRub: 50, seed: 42 };
  const fast = createSim(scene, { ...options, speedMultiplier: 60 });
  const normal = createSim(scene, { ...options, speedMultiplier: 1 });
  for (let i = 0; i < 100; i++) fast.update(0.1);
  for (let i = 0; i < 6000; i++) normal.update(0.1);
  assert.deepEqual(fast.robots, normal.robots, "×60 runs identical integration, not longer jumps");
  assert.deepEqual(fast.getKpis(), normal.getKpis());
  assert.ok(Math.abs(fast.getKpis().elapsedSec - 600) < 0.001);
  assert.ok(fast.getKpis().tasksDone > 0);
  const rare = createSim(scene, { ...options, tasksPerHour: 0.1 });
  assert.equal(rare.getKpis().nextTaskInSec, 36000);
  rare.update(0.1);
  assert.ok(Math.abs(rare.getKpis().nextTaskInSec - 35999.9) < 0.001);
  assert.equal(rare.getKpis().tasksDone, 0, "No fabricated demand");
  const zero = createSim(scene, { ...options, tasksPerHour: 0 });
  assert.equal(zero.getKpis().nextTaskInSec, null);
});

test("generated mixed fleet, dense layout and 24 machines include station contention", () => {
  const scene = buildScene({ kind: "warehouse", areaM2: 40000, floors: 3, rackRows: 20, chargeStations: 2 }, 42);
  const sim = createSim(scene, {
    fleet: ["amr-pallet", "fmr-forklift", "scrubber"].map(sprite => ({ sprite, count: 8, speedMps: 2 })),
    tasksPerHour: 300, laborCostPerTaskRub: 50, speedMultiplier: 10, seed: 42, chargeTimeMinutes: 1,
  });
  sim.robots[0].battery = 24;
  sim.robots[1].battery = 24;
  for (let tick = 0; tick < 12000; tick++) {
    const before = sim.robots.map(r => ({ floor: r.floorId, point: [r.x, r.y], inLift: Boolean(r.verticalLinkId) }));
    sim.update(0.1);
    for (const r of sim.robots) {
      const floor = scene.floors.find(f => f.id === r.floorId);
      const old = before[r.id];
      if (old.floor === r.floorId && !old.inLift && !r.verticalLinkId) {
        assert.equal(segmentBlocked(old.point, [r.x, r.y], { ...scene, racks: floor.racks }), false);
      }
      assert.equal(r.blockedSec, 0);
      for (const other of sim.robots) {
        if (other.id > r.id && other.floorId === r.floorId) {
          assert.ok(Math.hypot(r.x - other.x, r.y - other.y) >= 26);
        }
      }
    }
  }
  assert.ok(sim.robots.every(r => r.progressM > 0), "No fleet member starves");
  assert.ok(sim.getKpis().flowStats.filter(f => f.available).every(f => f.completed > 0));
  assert.ok(sim.getKpis().verticalTrips > 0);
});
const scenes = Object.fromEntries(
  await Promise.all(
    sceneNames.map(async (name) => [
      name,
      JSON.parse(await readFile(new URL(`../src/sim/scenes/${name}.json`, import.meta.url))),
    ]),
  ),
);

let randomState = 0x18;
Math.random = () => {
  randomState = (randomState * 1664525 + 1013904223) >>> 0;
  return randomState / 0x100000000;
};

function fleetFor(scene) {
  const counts = new Map();
  for (const flow of scene.flows) counts.set(flow.sprite, (counts.get(flow.sprite) ?? 0) + 1);
  return [...counts].map(([sprite, count]) => ({ sprite, count, speedMps: 3 }));
}

function run(sim, steps, onStep) {
  for (let step = 0; step < steps; step++) {
    sim.update(0.1);
    onStep?.(step);
  }
}

function assertSafePath(path, scene, label) {
  assert.ok(path?.length > 1, `${label}: маршрут пустой`);
  for (let index = 1; index < path.length; index++) {
    assert.equal(
      segmentBlocked(path[index - 1], path[index], scene),
      false,
      `${label}: сегмент ${index - 1} пересекает стеллаж`,
    );
  }
}

test("перестроение сцены отражает параметры склада, аэропорта и медучреждения", { concurrency: false }, () => {
  const cases = [
    {
      kind: "warehouse",
      areaM2: 36_000,
      floors: 3,
      rackRows: 11,
      docks: 5,
      chargeStations: 4,
      expectedRacks: 11,
      expectedDocks: 5,
    },
    {
      kind: "airport",
      areaM2: 120_000,
      floors: 2,
      rackRows: 99,
      docks: 4,
      chargeStations: 5,
      expectedRacks: 0,
      expectedDocks: 4,
    },
    {
      kind: "hospital",
      areaM2: 60_000,
      floors: 3,
      rackRows: 99,
      docks: 6,
      chargeStations: 2,
      expectedRacks: 0,
      expectedDocks: 0,
    },
  ];

  for (const config of cases) {
    const scene = buildScene(config, 42);
    assert.equal(scene.floors?.length, config.floors, `${config.kind}: неверное число этажей`);
    assert.equal(scene.racks?.length, config.expectedRacks, `${config.kind}: неверное число рядов`);
    assert.equal(scene.doors?.length, config.expectedDocks, `${config.kind}: неверное число постов`);
    assert.equal(scene.charges.length, config.chargeStations, `${config.kind}: неверное число зарядок на первом этаже`);
    assert.ok(
      scene.floors?.every((floor) => floor.charges?.length === config.chargeStations),
      `${config.kind}: число зарядок должно быть одинаковым на каждом этаже`,
    );
    assert.ok(
      scene.floors?.every((floor) => floor.racks?.length === config.expectedRacks),
      `${config.kind}: число рядов должно быть одинаковым на каждом этаже`,
    );
    assert.equal(
      scene.verticalLinks?.length,
      config.floors > 1 ? 1 : 0,
      `${config.kind}: межэтажная связь должна соответствовать этажности`,
    );

    const areaChanged = buildScene({ ...config, areaM2: config.areaM2 / 2 }, 42);
    const geometryZoneId = config.kind === "warehouse"
      ? "storage"
      : config.kind === "airport"
        ? "terminal"
        : "corridor";
    const currentZone = scene.floors?.[0]?.zones?.find((zone) => zone.id === geometryZoneId);
    const changedZone = areaChanged.floors?.[0]?.zones?.find((zone) => zone.id === geometryZoneId);
    assert.ok(currentZone && changedZone, `${config.kind}: зона масштаба должна существовать`);
    assert.notEqual(
      currentZone.w,
      changedZone.w,
      `${config.kind}: изменение площади должно менять ширину зоны, а не только подпись`,
    );
  }
});

test("сводка геометрии считает построенные элементы и отмечает неприменимые категории", { concurrency: false }, () => {
  const warehouse = getSceneGeometrySummary(buildScene({
    kind: "warehouse",
    areaM2: 36_000,
    floors: 3,
    rackRows: 11,
    docks: 5,
    chargeStations: 4,
  }), "warehouse");
  assert.deepEqual(warehouse, {
    floors: 3,
    rows: { applicable: true, perFloor: 11, total: 33 },
    posts: { applicable: true, total: 5 },
    charges: { applicable: true, perFloor: 4, total: 12 },
  });

  const airport = getSceneGeometrySummary(buildScene({
    kind: "airport",
    areaM2: 120_000,
    floors: 2,
    rackRows: 11,
    docks: 4,
    chargeStations: 5,
  }), "airport");
  assert.equal(airport.rows.applicable, false);
  assert.equal(airport.rows.total, 0);
  assert.equal(airport.posts.total, 4);
  assert.equal(airport.charges.total, 10);

  const hospital = getSceneGeometrySummary(buildScene({
    kind: "hospital",
    areaM2: 60_000,
    floors: 3,
    docks: 4,
    chargeStations: 2,
  }), "hospital");
  assert.equal(hospital.rows.applicable, false);
  assert.equal(hospital.posts.applicable, false);
  assert.equal(hospital.charges.total, 6);
});

test("одинаковые параметры сцены дают одинаковую геометрию при seed=42", { concurrency: false }, () => {
  const config = {
    kind: "warehouse",
    areaM2: 42_000,
    floors: 2,
    rackRows: 9,
    docks: 3,
    chargeStations: 4,
    stationarySolutions: ["AutoStore", "Конвейер"],
  };

  assert.deepEqual(
    buildScene(config, 42),
    buildScene(config, 42),
    "повторная сборка после перезагрузки должна быть детерминированной",
  );
});

test("KPI межэтажной логистики воспроизводимы и отражают этажность", { concurrency: false }, () => {
  const config = {
    kind: "warehouse",
    areaM2: 42_000,
    floors: 2,
    rackRows: 9,
    docks: 3,
    chargeStations: 4,
  };
  const fleet = [{ sprite: "amr-pallet", count: 2, speedMps: 3 }];
  const options = { fleet, tasksPerHour: 720, laborCostPerTaskRub: 100, speedMultiplier: 3, seed: 42 };
  const twoFloor = createSim(buildScene(config, 42), options);
  const sameTwoFloor = createSim(buildScene(config, 42), options);
  const threeFloor = createSim(buildScene({ ...config, floors: 3 }, 42), options);

  run(twoFloor, 2_000);
  run(sameTwoFloor, 2_000);
  run(threeFloor, 2_000);

  const twoFloorKpis = twoFloor.getKpis();
  const sameTwoFloorKpis = sameTwoFloor.getKpis();
  const threeFloorKpis = threeFloor.getKpis();
  assert.deepEqual(
    {
      verticalTrips: twoFloorKpis.verticalTrips,
      floorStats: twoFloorKpis.floorStats.map(({ id, tasks, completed }) => ({ id, tasks, completed })),
    },
    {
      verticalTrips: sameTwoFloorKpis.verticalTrips,
      floorStats: sameTwoFloorKpis.floorStats.map(({ id, tasks, completed }) => ({ id, tasks, completed })),
    },
    "KPI должны быть детерминированными при seed=42",
  );
  assert.ok(twoFloorKpis.verticalTrips > 0, "двухэтажная сцена должна использовать вертикальный переход");
  assert.equal(twoFloorKpis.floorStats.length, 2);
  assert.equal(threeFloorKpis.floorStats.length, 3);
  assert.notDeepEqual(
    threeFloorKpis.floorStats.map(({ id, tasks, completed }) => ({ id, tasks, completed })),
    twoFloorKpis.floorStats.map(({ id, tasks, completed }) => ({ id, tasks, completed })),
    "изменение этажности должно менять распределение задач",
  );
});

test("каждый рассчитанный маршрут проходит вне препятствий", { concurrency: false }, () => {
  for (const name of sceneNames) {
    const sim = createSim(scenes[name], {
      fleet: fleetFor(scenes[name]),
      tasksPerHour: 720,
      laborCostPerTaskRub: 100,
      speedMultiplier: 3,
    });
    for (const flow of sim.flows) {
      assertSafePath(sim.flowPaths.get(flow.id), scenes[name], `${name}/${flow.id}`);
    }
  }
});

test("продолжительный прогон использует каждый доступный core-поток", { concurrency: false }, () => {
  for (const name of sceneNames) {
    const sim = createSim(scenes[name], {
      fleet: fleetFor(scenes[name]),
      tasksPerHour: 720,
      laborCostPerTaskRub: 100,
      speedMultiplier: 3,
    });
    run(sim, 14000);
    const core = sim.getKpis().flowStats.filter(
      (flow) => flow.available && scenes[name].flows.find((item) => item.id === flow.id)?.core,
    );
    assert.ok(core.length > 0, `${name}: нет доступных core-потоков`);
    assert.ok(core.every((flow) => flow.completed > 0), `${name}: core-поток не получил завершённый рейс`);
  }
});

test("стартовая очередь выводит из idle весь расчетный флот", { concurrency: false }, () => {
  const { fleet } = buildFleet(
    [{ id: "amr-demo", name: "Транспортный AMR", subtype: "AMR" }],
    4,
  );
  assert.equal(fleet.reduce((total, entry) => total + entry.count, 0), 4);
  const sim = createSim(scenes.airport, {
    fleet,
    tasksPerHour: 1,
    laborCostPerTaskRub: 100,
    speedMultiplier: 1,
  });
  assert.equal(sim.robots.length, 4);
  assert.ok(sim.robots.every((robot) => robot.state === "idle"));
  run(sim, 10);
  assert.ok(sim.robots.every((robot) => robot.flow !== null && robot.state !== "idle"));
  assert.equal(sim.getKpis().activeRobots, 4);
});

test("смешанный флот получает только совместимые стартовые потоки", { concurrency: false }, () => {
  const { fleet } = buildFleet(
    [
      { id: "amr-demo", name: "Транспортный AMR", subtype: "AMR" },
      { id: "tug-demo", name: "Автономный тягач", subtype: "тягач" },
    ],
    5,
  );
  assert.equal(
    fleet.reduce((total, entry) => total + entry.count, 0),
    5,
    "распределение потеряло машину из нечётного флота",
  );
  assert.deepEqual(
    fleet.map(({ sprite, count }) => ({ sprite, count })),
    [
      { sprite: "amr-pallet", count: 3 },
      { sprite: "tug", count: 2 },
    ],
  );
  const sim = createSim(scenes.airport, {
    fleet,
    tasksPerHour: 1,
    laborCostPerTaskRub: 100,
    speedMultiplier: 1,
  });
  run(sim, 10);
  assert.ok(sim.robots.every(
    (robot) => robot.flow !== null && robot.state !== "idle" && robot.flow.sprite === robot.sprite,
  ));
  assert.equal(sim.robots.length, 5);
  assert.equal(sim.getKpis().activeRobots, 5);
});

test("смешанный флот получает совместимые рейсы после завершения первого цикла", { concurrency: false }, () => {
  const previousRandomState = randomState;
  try {
    randomState = 0x18;
    const sim = createSim(scenes.airport, {
      fleet: fleetFor(scenes.airport),
      tasksPerHour: 720,
      laborCostPerTaskRub: 100,
      speedMultiplier: 1,
    });
    const previousStates = new Map(sim.robots.map((robot) => [robot.id, robot.state]));
    const completedBySprite = new Map();
    const followUpAssignmentsBySprite = new Map();

    run(sim, 14000, () => {
      for (const robot of sim.robots) {
        if (robot.flow) {
          assert.equal(
            robot.flow.sprite,
            robot.sprite,
            `${robot.name}: назначен поток другого типа техники`,
          );
        }

        const previousState = previousStates.get(robot.id);
        if (previousState === "unloading" && robot.state === "idle") {
          completedBySprite.set(
            robot.sprite,
            (completedBySprite.get(robot.sprite) ?? 0) + 1,
          );
        }
        if (previousState !== "toPickup" && robot.state === "toPickup") {
          if ((completedBySprite.get(robot.sprite) ?? 0) > 0) {
            followUpAssignmentsBySprite.set(
              robot.sprite,
              (followUpAssignmentsBySprite.get(robot.sprite) ?? 0) + 1,
            );
          }
          assert.equal(
            robot.flow?.sprite,
            robot.sprite,
            `${robot.name}: повторно назначен поток другого типа техники`,
          );
        }
        previousStates.set(robot.id, robot.state);
      }
    });

    const availableSprites = [...new Set(sim.robots.map((robot) => robot.sprite))];
    for (const sprite of availableSprites) {
      assert.ok(
        (completedBySprite.get(sprite) ?? 0) > 0,
        `${sprite}: не завершил ни одного рейса`,
      );
      assert.ok(
        (followUpAssignmentsBySprite.get(sprite) ?? 0) > 0,
        `${sprite}: не получил задание после завершения рейса`,
      );
    }
  } finally {
    randomState = previousRandomState;
  }
});

test("каждый одинаковый робот получает продолжение работы после своего рейса", { concurrency: false }, () => {
  const previousRandomState = randomState;
  try {
    randomState = 0x18;
    const sim = createSim(scenes.airport, {
      fleet: [
        { sprite: "amr-pallet", count: 2, speedMps: 3 },
        { sprite: "tug", count: 1, speedMps: 3 },
      ],
      tasksPerHour: 720,
      laborCostPerTaskRub: 100,
      speedMultiplier: 1,
    });
    const previousStates = new Map(sim.robots.map((robot) => [robot.id, robot.state]));
    const completedByRobot = new Map();
    const followUpAssignmentsByRobot = new Map();

    run(sim, 14000, () => {
      for (const robot of sim.robots) {
        if (robot.flow) {
          assert.equal(
            robot.flow.sprite,
            robot.sprite,
            `${robot.name}: назначен поток другого типа техники`,
          );
        }

        const previousState = previousStates.get(robot.id);
        if (previousState === "unloading" && robot.state === "idle") {
          completedByRobot.set(robot.id, (completedByRobot.get(robot.id) ?? 0) + 1);
        }
        if (previousState !== "toPickup" && robot.state === "toPickup") {
          if ((completedByRobot.get(robot.id) ?? 0) > 0) {
            followUpAssignmentsByRobot.set(
              robot.id,
              (followUpAssignmentsByRobot.get(robot.id) ?? 0) + 1,
            );
          }
          assert.equal(
            robot.flow?.sprite,
            robot.sprite,
            `${robot.name}: повторно назначен поток другого типа техники`,
          );
        }
        previousStates.set(robot.id, robot.state);
      }
    });

    const duplicateTypeRobots = sim.robots.filter((robot) => robot.sprite === "amr-pallet");
    assert.equal(duplicateTypeRobots.length, 2);
    for (const robot of duplicateTypeRobots) {
      assert.ok(
        (completedByRobot.get(robot.id) ?? 0) > 0,
        `${robot.name}: не завершил ни одного рейса`,
      );
      assert.ok(
        (followUpAssignmentsByRobot.get(robot.id) ?? 0) > 0,
        `${robot.name}: после завершения не получил новое задание`,
      );
    }
  } finally {
    randomState = previousRandomState;
  }
});

test("после зарядки робот сразу возвращается на совместимый рейс и в KPI", { concurrency: false }, () => {
  const previousRandomState = randomState;
  try {
    randomState = 0x30;
    const scene = {
      id: "charge-recovery",
      width: 320,
      height: 220,
      mPerPx: 0.1,
      zones: [],
      flows: [
        {
          id: "warehouse-transfer",
          label: "Складской трансфер",
          waypoints: [[20, 100], [280, 100]],
          share: 1,
          sprite: "amr-pallet",
          core: true,
        },
      ],
      charges: [[20, 20]],
      startClock: "08:00",
    };
    const sim = createSim(scene, {
      fleet: [{ sprite: "amr-pallet", count: 1, speedMps: 3 }],
      tasksPerHour: 0,
      laborCostPerTaskRub: 100,
      speedMultiplier: 100,
    });
    const robot = sim.robots[0];
    robot.battery = 17;

    let sawCharging = false;
    for (let step = 0; step < 10; step++) {
      sim.update(0.1);
      sawCharging ||= robot.state === "charging";
      if (sawCharging) break;
    }
    assert.equal(sawCharging, true, "робот не дошел до состояния зарядки");
    assert.equal(robot.flow, null, "на зарядку нельзя уводить незавершенный рейс");

    let recovered = false;
    for (let step = 0; step < 30; step++) {
      sim.update(0.1);
      if (robot.state === "toPickup") {
        recovered = true;
        break;
      }
    }

    assert.equal(recovered, true, "после зарядки робот остался в idle");
    assert.ok(robot.battery >= 96, "робот получил рейс до восстановления батареи");
    assert.equal(robot.flow?.id, "warehouse-transfer", "после зарядки назначен неверный рейс");
    assert.equal(
      robot.flow?.sprite,
      robot.sprite,
      "после зарядки назначен несовместимый поток",
    );
    assert.equal(
      sim.getKpis().activeRobots,
      1,
      "вернувшийся робот не учтен как активный в KPI",
    );
    assert.equal(
      sim.getKpis().flowStats.find((flow) => flow.id === "warehouse-transfer")?.active,
      1,
      "вернувшийся робот не учтен активным по потоку",
    );
  } finally {
    randomState = previousRandomState;
  }
});

test("рейс проходит подъезд, загрузку, доставку и разгрузку отдельно", { concurrency: false }, () => {
  const sim = createSim(scenes.airport, {
    fleet: [{ sprite: "amr-pallet", count: 1, speedMps: 3 }],
    tasksPerHour: 720,
    laborCostPerTaskRub: 100,
    speedMultiplier: 3,
  });
  const robot = sim.robots[0];
  const visited = [];
  let previousState = robot.state;
  run(sim, 8000, () => {
    if (robot.state !== previousState) {
      visited.push(robot.state);
      previousState = robot.state;
    }
  });
  for (const state of ["toPickup", "loading", "toDrop", "unloading"]) {
    assert.ok(visited.includes(state), `этап «${state}» не был выполнен`);
  }
  assert.ok(sim.getKpis().tasksDone > 0);
});

test("несовместимая техника не получает фиктивный поток", { concurrency: false }, () => {
  const sim = createSim(scenes.warehouse, {
    fleet: [{ sprite: "amr-pallet", count: 1, speedMps: 3 }],
    tasksPerHour: 720,
    laborCostPerTaskRub: 100,
    speedMultiplier: 3,
  });
  assert.deepEqual(sim.flows.map((flow) => flow.id), ["putaway", "picking"]);
  run(sim, 8000, () => {
    for (const robot of sim.robots) {
      if (robot.flow) assert.equal(robot.flow.sprite, robot.sprite);
    }
  });
  const unavailable = sim.getKpis().flowStats.filter((flow) => !flow.available);
  assert.ok(unavailable.length > 0);
  assert.ok(unavailable.every((flow) => flow.completed === 0));
});

test("склад закрепляет за каждой машиной отдельный поток и вариант маршрута", { concurrency: false }, () => {
  const scene = withCoverageRoutes(scenes.warehouse);
  const sim = createSim(scene, {
    fleet: [
      { sprite: "amr-pallet", count: 2, speedMps: 3 },
      { sprite: "fmr-forklift", count: 2, speedMps: 3 },
    ],
    tasksPerHour: 720,
    laborCostPerTaskRub: 100,
    speedMultiplier: 3,
  });
  const assignments = sim.robots.map((robot) => `${robot.assignedFlowId}:${robot.assignedVariantIndex}`);
  assert.equal(new Set(assignments).size, 4);
  assert.deepEqual(
    sim.robots.map((robot) => robot.assignedFlowId),
    ["putaway", "picking", "shipping", "replenish"],
  );
  run(sim, 14000);
  assert.ok(sim.robots.every((robot) => robot.progressM > 1), "машина не продвинулась по закрепленной трассе");
  assert.ok(sim.robots.every((robot) => robot.blockedSec === 0), "машина получила блокировку на своей трассе");
});

test("складской флот сохраняет зазор и не собирается в одном участке", { concurrency: false }, () => {
  const scene = withCoverageRoutes(scenes.warehouse);
  const sim = createSim(scene, {
    fleet: [
      { sprite: "amr-pallet", count: 4, speedMps: 3 },
      { sprite: "fmr-forklift", count: 2, speedMps: 3 },
    ],
    tasksPerHour: 720,
    laborCostPerTaskRub: 100,
    speedMultiplier: 3,
  });
  let minGap = Infinity;
  const visited = new Set();
  run(sim, 8000, () => {
    for (const robot of sim.robots) visited.add(`${Math.floor(robot.x / 150)}:${Math.floor(robot.y / 120)}`);
    for (let first = 0; first < sim.robots.length; first++) {
      for (let second = first + 1; second < sim.robots.length; second++) {
        minGap = Math.min(
          minGap,
          Math.hypot(
            sim.robots[first].x - sim.robots[second].x,
            sim.robots[first].y - sim.robots[second].y,
          ),
        );
      }
    }
  });
  assert.ok(minGap >= 26, `минимальный зазор стал ${minGap.toFixed(1)} px`);
  assert.ok(visited.size >= 20, `флот посетил только ${visited.size} участков карты`);
  assert.ok(sim.robots.every((robot) => robot.blockedSec === 0));
});