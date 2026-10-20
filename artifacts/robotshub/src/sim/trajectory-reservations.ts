import type { RobotState, RouteStep } from './sim-engine.ts';

export const TRAJECTORY_DT = 0.1;
export interface TrajectoryFrame {
  x: number;
  y: number;
  floorId: string;
  state: RobotState;
  pathIdx: number;
  verticalLinkId?: string;
  verticalWaiting?: boolean;
  completed?: boolean;
  verticalTrip?: boolean;
}
export interface Trajectory {
  start: number;
  frames: TrajectoryFrame[];
}

/** Compile actual routes and service stages, at a speed no higher than the selected robot's specification. */
export function compileJourney(input: {
  origin: { x: number; y: number; floorId: string };
  pickup: RouteStep[];
  drop?: RouteStep[];
  back: RouteStep[];
  speedPxPerSec: number;
  chargeSeconds?: number;
}): TrajectoryFrame[] {
  const frames: TrajectoryFrame[] = [{
    ...input.origin, state: input.chargeSeconds === undefined ? 'toPickup' : 'toCharge', pathIdx: 0,
  }];
  const push = (patch: Partial<TrajectoryFrame>) => {
    const previous = frames[frames.length - 1];
    frames.push({ x: previous.x, y: previous.y, floorId: previous.floorId,
      state: previous.state, pathIdx: previous.pathIdx, ...patch });
  };
  const pause = (seconds: number, state: RobotState) => {
    for (let i = 0; i < Math.ceil(seconds / TRAJECTORY_DT); i++) push({ state, pathIdx: 0 });
  };
  const path = (steps: RouteStep[], state: RobotState) => {
    for (const [pathIdx, step] of steps.entries()) {
      const origin = frames[frames.length - 1];
      if (step.kind === 'vertical') {
        const waiting = Math.ceil(step.waitSec / TRAJECTORY_DT);
        const ticks = waiting + Math.max(1, Math.ceil(step.travelSec / TRAJECTORY_DT));
        for (let i = 1; i <= ticks; i++) {
          push({ state, pathIdx, verticalLinkId: i < ticks ? step.linkId : undefined,
            verticalWaiting: i <= waiting,
            floorId: i === ticks ? step.toFloor : step.fromFloor,
            x: i === ticks ? step.to[0] : step.from[0],
            y: i === ticks ? step.to[1] : step.from[1], verticalTrip: i === ticks });
        }
      } else {
        const distance = Math.hypot(step.point[0] - origin.x, step.point[1] - origin.y);
        const ticks = Math.max(1, Math.ceil(distance / Math.max(0.01, input.speedPxPerSec) / TRAJECTORY_DT));
        for (let i = 1; i <= ticks; i++) push({
          state, pathIdx, floorId: step.floorId,
          x: origin.x + (step.point[0] - origin.x) * i / ticks,
          y: origin.y + (step.point[1] - origin.y) * i / ticks,
        });
      }
    }
  };
  path(input.pickup, input.chargeSeconds === undefined ? 'toPickup' : 'toCharge');
  if (input.chargeSeconds !== undefined) {
    pause(input.chargeSeconds, 'charging');
  } else {
    pause(3, 'loading');
    path(input.drop ?? [], 'toDrop');
    pause(2, 'unloading');
    frames[frames.length - 1].completed = true;
  }
  frames[frames.length - 1].state = 'returning';
  frames[frames.length - 1].pathIdx = 0;
  path(input.back, 'returning');
  frames[frames.length - 1].state = 'idle';
  return frames;
}

export function frameAt(trajectory: Trajectory, time: number): TrajectoryFrame {
  return trajectory.frames[Math.max(0, Math.min(trajectory.frames.length - 1,
    Math.round((time - trajectory.start) / TRAJECTORY_DT)))];
}

interface Run {
  start: number; end: number; x: number; y: number;
  vx: number; vy: number; floor: string; lift?: string;
}
const runCache = new WeakMap<TrajectoryFrame[], Run[]>();
function runs(frames: TrajectoryFrame[]): Run[] {
  const cached = runCache.get(frames);
  if (cached) return cached;
  const result: Run[] = [];
  for (let i = 0; i < frames.length - 1; i++) {
    const a = frames[i], b = frames[i + 1];
    const sameFloor = a.floorId === b.floorId;
    const run: Run = { start: i * TRAJECTORY_DT, end: (i + 1) * TRAJECTORY_DT,
      x: a.x, y: a.y, floor: a.floorId,
      vx: sameFloor ? (b.x - a.x) / TRAJECTORY_DT : 0,
      vy: sameFloor ? (b.y - a.y) / TRAJECTORY_DT : 0,
      lift: a.verticalLinkId ?? b.verticalLinkId };
    const previous = result[result.length - 1];
    if (previous && previous.floor === run.floor && previous.lift === run.lift &&
      Math.abs(previous.vx - run.vx) < 1e-7 && Math.abs(previous.vy - run.vy) < 1e-7 &&
      Math.abs(previous.end - run.start) < 1e-7) previous.end = run.end;
    else result.push(run);
    if (!sameFloor) result.push({
      start: run.end, end: run.end, x: b.x, y: b.y, vx: 0, vy: 0, floor: b.floorId,
    });
  }
  const last = frames[frames.length - 1];
  result.push({ start: (frames.length - 1) * TRAJECTORY_DT, end: Infinity,
    x: last.x, y: last.y, vx: 0, vy: 0, floor: last.floorId });
  runCache.set(frames, result);
  return result;
}

/** Continuous swept-body reservations, compressed into straight runs; includes future parking and lift landings. */
export function trajectoriesConflict(a: Trajectory, b: Trajectory, gap = 26.1): boolean {
  const earliest = Math.max(a.start, b.start);
  for (const p of runs(a.frames)) for (const q of runs(b.frames)) {
    const start = Math.max(earliest, a.start + p.start, b.start + q.start);
    const end = Math.min(a.start + p.end, b.start + q.end);
    if (end + 1e-8 < start) continue;
    if (p.lift && p.lift === q.lift) return true;
    if (p.floor !== q.floor) continue;
    const x = p.x + p.vx * (start - a.start - p.start)
      - q.x - q.vx * (start - b.start - q.start);
    const y = p.y + p.vy * (start - a.start - p.start)
      - q.y - q.vy * (start - b.start - q.start);
    const vx = p.vx - q.vx, vy = p.vy - q.vy;
    const length2 = vx * vx + vy * vy;
    const t = length2 ? Math.max(0, Math.min(end - start, -(x * vx + y * vy) / length2)) : 0;
    if (Math.hypot(x + t * vx, y + t * vy) < gap) return true;
  }
  return false;
}
