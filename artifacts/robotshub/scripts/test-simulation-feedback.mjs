import { test } from 'node:test';
import assert from 'node:assert/strict';
import solutions from '../src/data/solutions.json' with { type: 'json' };
import { SIMULATION_DEMO, SIMULATION_DEMO_FLEET_COUNT, SIMULATION_DEMO_INITIAL_TASKS, simulationFlowCoverage } from '../src/lib/simulation-demo.ts';
import { calculateEconomics, calculateSimulationInputs } from '../src/lib/calc.ts';
import { buildScene } from '../src/sim/scene-builder.ts';
import { buildFleet } from '../src/sim/fleet.ts';
import { createSim, segmentBlocked } from '../src/sim/sim-engine.ts';
import { compileJourney, trajectoriesConflict } from '../src/sim/trajectory-reservations.ts';

const solution = solutions.items.find(item => item.id === SIMULATION_DEMO.activeSolutionId);
const inputs = { objectParams: SIMULATION_DEMO.objectParams, solution,
  whatIf: { salaryMultiplier: 1, priceMultiplier: 1, volumeMultiplier: 1 }, assumptionsOverrides: {} };

test('45.5 оп/ч: старт без минутного ожидания, три машины работают параллельно и не ездят между этажами ради стоянки', () => {
  for (const floors of [1, 2, 3]) {
    const scene = buildScene({ kind: 'warehouse', areaM2: 10000, floors, elevatorIntegrationReady: true }, 42);
    const sim = createSim(scene, { fleet: [{ sprite: 'amr-pallet', count: 3, speedMps: 1.5 }],
      initialTasks: 3, tasksPerHour: 45.5, laborCostPerTaskRub: 100, speedMultiplier: 10, seed: 42 });
    const firstMove = new Map();
    let simultaneous = 0;
    for (let tick = 0; tick < 600; tick++) {
      const before = sim.robots.map(robot => robot.progressM);
      sim.update(0.1);
      let moving = 0;
      for (const robot of sim.robots) {
        if (robot.progressM > before[robot.id] + 0.001) {
          moving++;
          if (!firstMove.has(robot.id)) firstMove.set(robot.id, (tick + 1) / 10);
        }
        assert.notEqual(robot.state, 'toCharge', 'полный аккумулятор не требует поездки на зарядку');
        assert.notEqual(robot.state, 'charging');
        if (robot.state === 'returning') {
          assert.ok(robot.path.every(step => step.kind === 'move' && step.floorId === robot.floorId),
            'после доставки стоянка должна быть на том же этаже');
        }
      }
      simultaneous = Math.max(simultaneous, moving);
    }
    assert.equal(firstMove.size, 3, 'работу получил каждый экземпляр, а не один из парка');
    assert.ok(Math.max(...firstMove.values()) < 10, 'все машины должны начать движение за первые 10 секунд просмотра ×10');
    assert.ok(simultaneous >= 2, 'должно быть реальное параллельное движение');
    assert.ok(sim.getKpis().tasksDone > 0);
    const active = sim.robots.filter(r => ['toPickup', 'loading', 'toDrop', 'unloading'].includes(r.state)).length;
    assert.equal(sim.getKpis().tasksDone + active + sim.getKpis().queueLen, 3 + Math.floor(600 * 45.5 / 3600));
    console.log(`${floors} этаж.: начало движения экземпляров через ${[...firstMove.values()].join(', ')} с просмотра; одновременно двигались ${simultaneous}`);
  }
});

test('временные резервы обнаруживают пересечение между кадрами и учитывают будущую стоянку', () => {
  const frame = (x, y, floorId = 'floor-1') => ({ x, y, floorId, state: 'toDrop', pathIdx: 0 });
  const a = { start: 0, frames: [frame(0, 0), frame(100, 0)] };
  const b = { start: 0, frames: [frame(50, -50), frame(50, 50)] };
  assert.equal(trajectoriesConflict(a, b), true, 'машины сталкиваются между безопасными конечными кадрами');
  assert.equal(trajectoriesConflict(a, { ...b, start: 2 }), false, 'одно пересечение допускает проезд в разное время');
  assert.equal(trajectoriesConflict(a, { start: 0, frames: [frame(50, 0)] }), true);
  const liftA = { start: 0, frames: [{ ...frame(0, 0), verticalLinkId: 'lift' }] };
  const liftB = { start: 0, frames: [{ ...frame(0, 0, 'floor-2'), verticalLinkId: 'lift' }] };
  // Real lift reservations have duration, not a parked terminal frame.
  liftA.frames.push({ ...frame(0, 0), verticalLinkId: 'lift' });
  liftB.frames.push({ ...frame(0, 0, 'floor-2'), verticalLinkId: 'lift' });
  assert.equal(trajectoriesConflict(liftA, liftB), true);
});

test('счётчики этажей — участия в рейсе, а не дополнительные задания сверх начальной очереди', () => {
  const scene = buildScene({ kind: 'warehouse', areaM2: 10000, floors: 2, elevatorIntegrationReady: true }, 42);
  const sim = createSim(scene, { fleet: [{ sprite: 'amr-pallet', count: 3, speedMps: 1.5 }],
    initialTasks: 3, tasksPerHour: 45.5, laborCostPerTaskRub: 100 });
  for (let i = 0; i < 90; i++) sim.update(0.1);
  const assigned = sim.robots.filter(robot => robot.taskFloorIds).length;
  assert.equal(assigned + sim.getKpis().queueLen, 3);
  assert.equal(sim.getKpis().floorStats.reduce((sum, floor) => sum + floor.tasks, 0), assigned * 2);
});

test('план сохраняет подъезд, погрузку, доставку и разгрузку; выполнение не засчитывается заранее', () => {
  const frames = compileJourney({
    origin: { x: 0, y: 0, floorId: 'floor-1' }, speedPxPerSec: 10,
    pickup: [{ kind: 'move', floorId: 'floor-1', point: [10, 0] }],
    drop: [{ kind: 'move', floorId: 'floor-1', point: [100, 0] }],
    back: [{ kind: 'move', floorId: 'floor-1', point: [100, 40] }],
  });
  const completed = frames.findIndex(frame => frame.completed);
  assert.ok(frames.slice(0, completed).some(frame => frame.state === 'loading'));
  assert.ok(frames.slice(0, completed).some(frame => frame.state === 'toDrop'));
  assert.ok(frames.slice(0, completed).some(frame => frame.state === 'unloading'));
  assert.equal(frames[completed].x, 100);
  assert.equal(frames[completed].state, 'returning');
  assert.equal(frames.at(-1).state, 'idle');
  assert.equal(frames.filter(frame => frame.completed).length, 1);
});

test('demo has the requested geometry, fleet, arrival rate and an explicit initial backlog', () => {
  const simInputs = calculateSimulationInputs(inputs);
  assert.equal(SIMULATION_DEMO.objectParams.total_area_m2, 5200);
  assert.equal(SIMULATION_DEMO.objectParams.floors_count, 1);
  assert.equal(simInputs.tasksPerHour, 140 / 8);
  assert.equal(buildFleet([solution], SIMULATION_DEMO_FLEET_COUNT).fleet[0].count, 3);
  assert.equal(SIMULATION_DEMO_INITIAL_TASKS, 3);
});

test('five 60-second demo runs preserve clearances, avoid aisle deadlocks and actually move', () => {
  const utilizations = [];
  for (let seed = 42; seed < 47; seed++) {
    const scene = buildScene({ kind: 'warehouse', areaM2: 5200, floors: 1, rackRows: 6, docks: 2, chargeStations: 3 }, 42);
    const sim = createSim(scene, {
      fleet: buildFleet([solution], 3).fleet, tasksPerHour: 17.5, laborCostPerTaskRub: 0,
      initialTasks: 3, seed,
    });
    for (let tick = 0; tick < 600; tick++) {
      const previous = sim.robots.map(robot => [robot.x, robot.y]);
      sim.update(0.1);
      for (const robot of sim.robots) {
        assert.ok(robot.blockedSec < 4, `seed ${seed}: ${robot.name} blocked ${robot.blockedSec}s`);
        assert.equal(segmentBlocked(previous[robot.id], [robot.x, robot.y], scene), false);
        for (const other of sim.robots) if (robot.id < other.id) {
          assert.ok(Math.hypot(robot.x - other.x, robot.y - other.y) >= 26);
        }
      }
    }
    assert.ok(sim.robots.some(robot => robot.progressM > 0));
    utilizations.push(Number(sim.getKpis().utilizationPct.toFixed(1)));
    // At this real speed a full warehouse trip can exceed 60 seconds.
    // Do not shorten routes or invent completed tasks to satisfy a UI demo.
    for (let tick = 0; tick < 5400; tick++) sim.update(0.1);
    assert.ok(sim.robots.every(robot => robot.progressM > 0), 'all three robots receive a turn');
    assert.ok(sim.getKpis().tasksDone > 0);
  }
  console.log('Measured demo utilization at 60 model seconds (%):', utilizations.join(', '));
});

test('head-on conflict clears through a real zone-edge pocket without a teleport or rack crossing', () => {
  const scene = {
    id: 'feedback-pockets', width: 400, height: 300, mPerPx: 0.1,
    walls: { x: 0, y: 0, w: 400, h: 300 },
    zones: [{ id: 'lane', label: 'Проезд и боксы', x: 20, y: 20, w: 360, h: 260 }],
    racks: [{ x: 220, y: 65, w: 60, h: 35 }],
    charges: [[340, 260]], startClock: '08:00',
    flows: [{ id: 'forward', label: 'Рейс', share: 1, sprite: 'amr-pallet', waypoints: [[60, 150], [340, 150]] }],
  };
  const sim = createSim(scene, { fleet: [{ sprite: 'amr-pallet', count: 2, speedMps: 1 }],
    tasksPerHour: 0, laborCostPerTaskRub: 0, seed: 42 });
  for (const [index, robot] of sim.robots.entries()) {
    Object.assign(robot, { x: index ? 190 : 160, y: 150, state: 'toDrop',
      path: [{ kind: 'move', floorId: robot.floorId, point: [index ? 60 : 340, 150] }],
      pathIdx: 0, flow: scene.flows[0], battery: 100, waitSec: 0 });
  }
  let sawPocket = false;
  let maxBlocked = 0;
  for (let tick = 0; tick < 600; tick++) {
    const previous = sim.robots.map(robot => [robot.x, robot.y]);
    sim.update(0.01); // legacy scenes advance six model seconds per real second
    for (const robot of sim.robots) {
      const old = previous[robot.id];
      assert.ok(Math.hypot(robot.x - old[0], robot.y - old[1]) <= 0.61);
      assert.equal(segmentBlocked(old, [robot.x, robot.y], scene), false);
      maxBlocked = Math.max(maxBlocked, robot.blockedSec);
      sawPocket ||= !!robot.yieldPocket;
    }
    assert.ok(Math.hypot(sim.robots[0].x - sim.robots[1].x, sim.robots[0].y - sim.robots[1].y) >= 26);
  }
  assert.ok(sawPocket, 'the losing robot used a geometry-checked waiting pocket');
  assert.ok(maxBlocked < 4, `blocking lasted ${maxBlocked}s`);
  assert.ok(sim.getKpis().tasksDone >= 2);
});

test('economics and simulation use the same What-If, fleet and labor assumptions', () => {
  for (const volumeMultiplier of [1, 1.8]) {
    const modified = { ...inputs, whatIf: { salaryMultiplier: 1.2, priceMultiplier: 0.9, volumeMultiplier } };
    const sim = calculateSimulationInputs(modified);
    const economics = calculateEconomics(modified);
    assert.equal(sim.robotCount, economics.find(item => item.id === 'purchase').robotCount);
    assert.equal(sim.currentStaffCost, economics.find(item => item.id === 'as_is').opexAnnual);
    assert.equal(sim.laborEquivalent, 5);
    assert.equal(sim.requiredThroughputPerHour, 17.5 * volumeMultiplier);
  }
  assert.equal(simulationFlowCoverage(35, 17.5), 200);
  assert.equal(simulationFlowCoverage(0, 17.5), 0);
  assert.equal(simulationFlowCoverage(35, 0), null);
});
