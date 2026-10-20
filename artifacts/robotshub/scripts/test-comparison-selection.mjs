import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_COMPARISON_SOLUTIONS,
  parseComparisonIds,
  toggleComparisonId,
} from '../src/lib/comparisonSelection.ts';
import {
  areComparisonValuesEqual,
  normalizeComparisonValue,
} from '../src/lib/comparisonValues.ts';

test('comparison selection is deduplicated, capped and safe for malformed storage', () => {
  assert.deepEqual(parseComparisonIds(JSON.stringify(['a', 'a', '', 'b', 'c', 'd'])), ['a', 'b', 'c']);
  assert.deepEqual(parseComparisonIds('{broken'), []);
  assert.deepEqual(parseComparisonIds(JSON.stringify({ ids: ['a'] })), []);
  assert.equal(MAX_COMPARISON_SOLUTIONS, 3);
});

test('toggle removes an existing entry and rejects a fourth without mutating selection', () => {
  assert.deepEqual(toggleComparisonId(['a', 'b'], 'a'), { ids: ['b'], limitReached: false });
  assert.deepEqual(toggleComparisonId(['a', 'b', 'c'], 'd'), { ids: ['a', 'b', 'c'], limitReached: true });
  assert.deepEqual(toggleComparisonId(['a', 'b'], 'c'), { ids: ['a', 'b', 'c'], limitReached: false });
});

test('comparison equality trims, collapses whitespace and ignores case', () => {
  assert.equal(normalizeComparisonValue('  Точность \n  ± 5 мм '), 'точность ± 5 мм');
  assert.equal(areComparisonValuesEqual(['  SLAM  ', 'slam']), true);
  assert.equal(areComparisonValuesEqual(['1500 кг', '1500  кг']), true);
  assert.equal(areComparisonValuesEqual(['—', 'не указано']), false);
});
