import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { deflateSync } from 'fflate';
import solutions from '../src/data/solutions.json' with { type: 'json' };
import {
  createProjectSharePayload,
  encodeProjectShare,
  decodeProjectShare,
  createSharedCalculationPayload,
  createSharedCalculationUrl,
  decodeSharedCalculation,
  restoreSharedCalculationFromSearch,
} from '../src/lib/project-sharing.ts';

const solutionId = solutions.items[0].id;
const state = {
  objectType: 'warehouse',
  sectorId: 'warehouse',
  objectParams: { inbound_pallets_per_day: 1300 },
  selectedSolutions: [solutionId],
  activeSolutionId: solutionId,
  assumptionsOverrides: { servicePct: 12 },
  whatIfOverrides: { volumeMultiplier: 1.1 },
  financingScenario: 'leasing',
};

test('demo provenance survives project and report sharing without marking ordinary projects', () => {
  assert.equal(createProjectSharePayload(state).demoProject, undefined);
  const demo = { ...state, demoProject: true };
  assert.equal(decodeProjectShare(encodeProjectShare(demo)).demoProject, true);
  assert.equal(createSharedCalculationPayload(demo).demoProject, true);
});

test('sharing serializes only changed template fields and restores the full project', () => {
  const payload = createProjectSharePayload(state);
  assert.deepEqual(payload.params, { inbound_pallets_per_day: 1300 });
  const decoded = decodeProjectShare(encodeProjectShare(state));
  assert.equal(decoded.objectType, 'warehouse');
  assert.equal(decoded.objectParams.inbound_pallets_per_day, 1300);
  assert.equal(decoded.objectParams.total_area_m2, 20000);
  assert.deepEqual(decoded.selectedSolutions, [solutionId]);
  assert.equal(decoded.activeSolutionId, solutionId);
  assert.deepEqual(decoded.assumptionsOverrides, state.assumptionsOverrides);
  assert.deepEqual(decoded.whatIfOverrides, state.whatIfOverrides);
  assert.equal(decoded.financingScenario, 'leasing');
});

test('sharing uses deterministic base64url and rejects broken or unknown payloads', () => {
  assert.equal(encodeProjectShare(state), encodeProjectShare(state));
  assert.equal(decodeProjectShare('not-json!'), null);
  assert.equal(decodeProjectShare('eyJ2IjoyfQ'), null);
});

test('sharing preserves Unicode and cannot create a link that its decoder rejects', () => {
  const custom = { ...state, objectType: 'custom', objectParams: { description: 'Склад № 7 — смена «Б»' } };
  assert.equal(decodeProjectShare(encodeProjectShare(custom)).objectParams.description, custom.objectParams.description);
  assert.throws(() => encodeProjectShare({ ...state, selectedSolutions: ['unknown'] }));
  assert.throws(() => encodeProjectShare({ ...state, selectedSolutions: Array(21).fill(solutionId) }));
  assert.throws(() => encodeProjectShare({ ...custom, objectParams: { description: 'я'.repeat(6000) } }));
});

test('compressed sharing preserves calculator inputs, active solution, and financing', () => {
  const payload = createSharedCalculationPayload(state);
  assert.deepEqual(Object.keys(payload.params), ['inbound_pallets_per_day']);
  assert.equal(payload.financingScenario, 'leasing');

  const url = createSharedCalculationUrl(state, 'https://robotshub.example', '/robotshub/');
  assert.ok(url.length <= 8000);
  assert.ok(new URL(url).searchParams.get('p').startsWith('z.'));
  assert.equal(new URL(url).pathname, '/robotshub/calc');
  const publicUrl = new URL(createSharedCalculationUrl(state, undefined, '/'));
  assert.equal(publicUrl.origin, 'https://robotshub.ru');
  assert.equal(publicUrl.pathname, '/calc');
  const restored = restoreSharedCalculationFromSearch(new URL(url).search);
  assert.equal(restored?.objectParams.inbound_pallets_per_day, 1300);
  assert.deepEqual(restored?.selectedSolutions, [solutionId]);
  assert.equal(restored?.activeSolutionId, solutionId);
  assert.deepEqual(restored?.assumptionsOverrides, state.assumptionsOverrides);
  assert.deepEqual(restored?.whatIfOverrides, state.whatIfOverrides);
  assert.equal(restored?.financingScenario, 'leasing');
  assert.equal(restored?.simulationKpis, null);
});

test('sharing accepts older uncompressed payloads and rejects invalid or oversized data', () => {
  const payload = createSharedCalculationPayload(state);
  const oldToken = Buffer.from(JSON.stringify(payload)).toString('base64url');
  assert.equal(decodeSharedCalculation(oldToken)?.financingScenario, 'leasing');
  assert.equal(decodeSharedCalculation(null), null);
  assert.equal(decodeSharedCalculation('not-base64!'), null);
  assert.equal(restoreSharedCalculationFromSearch('?p=eyJ2IjoyfQ'), null);

  const oversized = {
    ...state,
    objectType: 'custom',
    objectParams: { note: randomBytes(7000).toString('base64') },
  };
  assert.throws(
    () => createSharedCalculationUrl(oversized, 'https://robotshub.example', '/'),
    /длиннее 8 000 символов/,
  );
});

test('compressed sharing rejects payloads that inflate beyond the size limit', () => {
  const oversizedPayload = {
    ...createSharedCalculationPayload(state),
    objectType: 'custom',
    params: { note: 'x'.repeat(70 * 1024) },
  };
  const token = `z.${Buffer.from(deflateSync(new TextEncoder().encode(JSON.stringify(oversizedPayload)))).toString('base64url')}`;
  assert.equal(decodeSharedCalculation(token), null);
});
