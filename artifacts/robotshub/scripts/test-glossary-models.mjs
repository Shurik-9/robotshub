import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findGridPath, castRay, financeExample, balanceAt, lidarDistanceColor } from '../public/glossary/demo-models.mjs';

test('lidar heat colors use the same fixed near-hot / far-cold distance scale', () => {
  assert.equal(lidarDistanceColor(0), 'hsl(0, 95%, 64%)');
  assert.equal(lidarDistanceColor(-10), lidarDistanceColor(0));
  assert.equal(lidarDistanceColor(225), 'hsl(120, 95%, 64%)');
  assert.equal(lidarDistanceColor(450), 'hsl(240, 95%, 64%)');
  assert.equal(lidarDistanceColor(900), lidarDistanceColor(450));
});

test('A* counts transitions, respects walls and reports an unreachable destination', () => {
  const start = [1, 3], goal = [10, 3], walls = new Set();
  assert.equal(findGridPath(12, 7, walls, start, goal).steps, 9);
  walls.add('6,3');
  const detour = findGridPath(12, 7, walls, start, goal);
  assert.equal(detour.steps, 11);
  assert.ok(detour.path.every(cell => !walls.has(cell.join(','))));
  for (let i = 1; i < detour.path.length; i++) {
    assert.equal(Math.abs(detour.path[i][0] - detour.path[i - 1][0]) + Math.abs(detour.path[i][1] - detour.path[i - 1][1]), 1);
  }
  for (let y = 0; y < 7; y++) walls.add(`6,${y}`);
  assert.equal(findGridPath(12, 7, walls, start, goal).path, null);
  assert.equal(findGridPath(12, 7, walls, start, start).steps, 0);
});

test('A* agrees with independent breadth-first search on deterministic layouts', () => {
  for (let seed = 0; seed < 40; seed++) {
    const walls = new Set();
    for (let y = 0; y < 7; y++) for (let x = 1; x < 11; x++) {
      if ((x * 37 + y * 71 + seed * 13) % 9 < 3) walls.add(`${x},${y}`);
    }
    const queue = [[[0, 3], 0]], seen = new Set(['0,3']);
    let expected = null;
    while (queue.length) {
      const [[x, y], distance] = queue.shift();
      if (x === 11 && y === 3) { expected = distance; break; }
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const next = [x + dx, y + dy], id = next.join(',');
        if (next[0] < 0 || next[0] >= 12 || next[1] < 0 || next[1] >= 7 || seen.has(id) || walls.has(id)) continue;
        seen.add(id); queue.push([next, distance + 1]);
      }
    }
    assert.equal(findGridPath(12, 7, walls, [0, 3], [11, 3]).steps, expected);
  }
});

test('lidar returns the nearest surface and cannot see through a rack', () => {
  const segments = [[10, -10, 10, 10], [5, -5, 5, 5]];
  assert.deepEqual(castRay([0, 0], 0, segments), { x: 5, y: 0, distance: 5 });
  assert.equal(castRay([0, 0], Math.PI, segments), null);
  assert.equal(castRay([0, 0], Math.PI / 2, segments), null);
  const hit = castRay([0, 0], Math.PI / 4, [[10, 0, 10, 20]]);
  assert.ok(Math.abs(hit.distance - Math.sqrt(200)) < 1e-9);
});

const base = { cost: 18, saving: 0.5, advancePercent: 20, markupPercent: 24.4, term: 36 };
test('lease totals, monthly instalment and both break-even times reconcile exactly', () => {
  const model = financeExample(base);
  assert.equal(model.purchasePayback, 36);
  assert.ok(Math.abs(model.advance - 3.6) < 1e-9);
  assert.ok(Math.abs(model.payment - 0.522) < 1e-9);
  assert.ok(Math.abs(model.totalLeaseCost - 22.392) < 1e-9);
  assert.ok(Math.abs(model.leasePayback - 44.784) < 1e-9);
  assert.ok(Math.abs(model.advance + model.payment * model.term - model.totalLeaseCost) < 1e-9);
  assert.ok(Math.abs(balanceAt(model, model.leasePayback).lease) < 1e-9);
  assert.ok(Math.abs(balanceAt(model, 60).lease - 7.608) < 1e-9);
});

test('zero effect never pays back; early positive lease cash flow does not erase future instalments', () => {
  const zero = financeExample({ ...base, saving: 0 });
  assert.equal(zero.purchasePayback, null);
  assert.equal(zero.leasePayback, null);
  assert.equal(balanceAt(zero, 60).lease, -zero.totalLeaseCost);
  const high = financeExample({ ...base, saving: 1 });
  assert.ok(high.leasePayback < high.term);
  assert.ok(Math.abs(balanceAt(high, high.leasePayback).lease) < 1e-9);
  assert.ok(balanceAt(high, high.leasePayback + 1).lease > 0);
  assert.equal(financeExample({ ...base, advancePercent: 0, saving: 1 }).leasePayback, 0);
  assert.throws(() => financeExample({ ...base, term: 0 }), RangeError);
});
