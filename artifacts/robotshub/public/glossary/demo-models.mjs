/** Educational models only. No project state, catalogue claims or measured KPIs. */
export function findGridPath(cols, rows, walls, start, goal) {
  const key = ([x, y]) => `${x},${y}`;
  const heuristic = ([x, y]) => Math.abs(x - goal[0]) + Math.abs(y - goal[1]);
  const open = [{ cell: start, cost: 0, score: heuristic(start) }];
  const costs = new Map([[key(start), 0]]);
  const parents = new Map();
  const closed = new Set();
  const visited = [];
  while (open.length) {
    open.sort((a, b) => a.score - b.score || a.cost - b.cost);
    const current = open.shift();
    const id = key(current.cell);
    if (closed.has(id)) continue;
    closed.add(id);
    visited.push(current.cell);
    if (id === key(goal)) {
      const path = [current.cell];
      let parent = parents.get(id);
      while (parent) {
        path.unshift(parent);
        parent = parents.get(key(parent));
      }
      return { path, visited, steps: path.length - 1 };
    }
    for (const [dx, dy] of [[1, 0], [0, -1], [0, 1], [-1, 0]]) {
      const next = [current.cell[0] + dx, current.cell[1] + dy];
      const nextId = key(next);
      if (next[0] < 0 || next[1] < 0 || next[0] >= cols || next[1] >= rows
        || walls.has(nextId) || closed.has(nextId)) continue;
      const cost = current.cost + 1;
      if (cost >= (costs.get(nextId) ?? Infinity)) continue;
      costs.set(nextId, cost);
      parents.set(nextId, current.cell);
      open.push({ cell: next, cost, score: cost + heuristic(next) });
    }
  }
  return { path: null, visited, steps: null };
}

/** Return the first intersection, never a surface hidden behind another one. */
export function castRay(origin, angle, segments) {
  const dx = Math.cos(angle), dy = Math.sin(angle);
  let closest = null;
  for (const [x1, y1, x2, y2] of segments) {
    const denominator = dx * (y2 - y1) - dy * (x2 - x1);
    if (Math.abs(denominator) < 1e-9) continue;
    const distance = ((x1 - origin[0]) * (y2 - y1) - (y1 - origin[1]) * (x2 - x1)) / denominator;
    const fraction = ((x1 - origin[0]) * dy - (y1 - origin[1]) * dx) / denominator;
    if (distance >= 0 && fraction >= 0 && fraction <= 1
      && (!closest || distance < closest.distance)) {
      closest = { x: origin[0] + dx * distance, y: origin[1] + dy * distance, distance };
    }
  }
  return closest;
}

export function financeExample({ cost, saving, advancePercent, markupPercent, term }) {
  if (![cost, saving, advancePercent, markupPercent, term].every(Number.isFinite)
    || cost <= 0 || saving < 0 || term <= 0
    || advancePercent < 0 || advancePercent > 100 || markupPercent < 0) {
    throw new RangeError('Некорректные вводные учебного расчёта.');
  }
  const advance = cost * advancePercent / 100;
  const totalLeaseCost = cost * (1 + markupPercent / 100);
  const payment = (totalLeaseCost - advance) / term;
  const netDuringLease = saving - payment;
  let leasePayback = null;
  if (saving > 0) {
    const during = netDuringLease > 0 ? advance / netDuringLease : Infinity;
    leasePayback = during <= term
      ? during
      : term + Math.max(0, advance - netDuringLease * term) / saving;
  }
  return {
    cost, saving, term, advance, payment, totalLeaseCost,
    purchasePayback: saving > 0 ? cost / saving : null,
    leasePayback,
  };
}

export function balanceAt(model, month) {
  return {
    purchase: model.saving * month - model.cost,
    lease: model.saving * month - model.advance - model.payment * Math.min(month, model.term),
  };
}

// The scale is fixed across scan positions; it never recolors old points to
// fit the current sample minimum/maximum. Distances are schematic, not metres.
export function lidarDistanceColor(distance) {
  const hue = Math.round(Math.max(0, Math.min(450, distance)) / 450 * 240);
  return `hsl(${hue}, 95%, 64%)`;
}
