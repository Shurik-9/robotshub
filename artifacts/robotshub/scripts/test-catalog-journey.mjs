import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '../src');
const data = JSON.parse(readFileSync(path.join(root, 'data/solutions.json'), 'utf8'));
const cache = new Map();
function load(file, globals = {}) {
  if (cache.has(file) && !Object.keys(globals).length) return cache.get(file);
  const exports = {};
  const code = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(code, {
    exports, console, ...globals,
    require(specifier) {
      if (specifier === 'react') return { useEffect: globals.effect ?? (() => {}) };
      const target = specifier.startsWith('@/') ? path.join(root, specifier.slice(2)) : path.resolve(path.dirname(file), specifier);
      if (target.endsWith('.json')) return JSON.parse(readFileSync(target, 'utf8'));
      return load(target.endsWith('.ts') ? target : target + '.ts');
    },
  }, { filename: file });
  if (!Object.keys(globals).length) cache.set(file, exports);
  return exports;
}

test('direct calculation offers warehouse for Ronavi, never a warehouse formula for drones or water robots', () => {
  const { calculationObjectsFor } = load(path.join(root, 'lib/calculation-objects.ts'));
  const ronavi = data.items.find(item => /Ronavi H1500/i.test(item.name));
  assert.ok(ronavi);
  assert.ok(calculationObjectsFor(ronavi.id).some(option => option.type === 'warehouse'));
  assert.equal(calculationObjectsFor('unknown').length, 0);
  const nonGround = data.items.filter(item => /Геоскан 701|Supercam X4|Херсонес|Барабулька/.test(item.name));
  assert.ok(nonGround.length >= 3);
  for (const item of nonGround) assert.equal(calculationObjectsFor(item.id).length, 0, item.name);
});

test('catalogue restores exact card offset, filters and query after global scroll-to-top', () => {
  const storage = new Map();
  const frames = [];
  let effect;
  const browser = { location: { pathname: '/solutions', search: '?area=warehouse' }, scrollY: 0,
    scrollTo({ top }) { this.scrollY = top; } };
  const navigation = load(path.join(root, 'lib/catalog-navigation.ts'), {
    effect: fn => { effect = fn; },
    sessionStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    window: browser, CSS: { escape: value => value },
    document: { body: {}, querySelector: () => ({ getBoundingClientRect: () => ({ top: 5000 - browser.scrollY }) }) },
    MutationObserver: class { observe() {} disconnect() {} },
    requestAnimationFrame: fn => { frames.push(fn); return frames.length; }, cancelAnimationFrame() {},
  });
  const view = { url: '/solutions?area=warehouse', cardId: 'card-id', scrollY: 5100, cardTop: -100, pending: true,
    filters: { search: 'Ronavi', area: 'warehouse', operation: 'handling', brand: 'all', company: 'all', role: 'all',
      industry: '', warehouse: true, personalized: false, evidence: false, sector: null,
      open: { area: true, operation: true, brand: false, company: false } } };
  navigation.saveCatalogView(view);
  assert.equal(navigation.catalogReturnUrl(), view.url);
  assert.equal(navigation.readCatalogView().filters.operation, 'handling');
  navigation.useRestoreCatalogView(navigation.readCatalogView());
  effect();
  while (frames.length) frames.shift()();
  assert.equal(browser.scrollY, 5100);
  assert.equal(navigation.readCatalogView().pending, false);
});

test('calculation handoff retains model, does not force quick-select, and offers simulation after saving', () => {
  const catalog = readFileSync(path.join(root, 'pages/solutions.tsx'), 'utf8');
  const detail = readFileSync(path.join(root, 'pages/solution-detail.tsx'), 'utf8');
  const intent = readFileSync(path.join(root, 'components/calculation-intent-state.tsx'), 'utf8');
  const object = readFileSync(path.join(root, 'pages/object-setup.tsx'), 'utf8');
  assert.ok(catalog.includes("withCalculationIntent('/calc', id)"));
  assert.ok(detail.includes("withCalculationIntent('/calc', solution.id)"));
  assert.ok(intent.includes("withCalculationIntent('/object', solution.id)"));
  assert.ok(!intent.includes("withCalculationIntent('/quick-select'"));
  assert.ok(intent.includes('window.confirm('), 'destructive object switch requires consent');
  assert.ok(object.includes('selectSolutionForCalculation(requestedSolution.id)'));
  assert.ok(readFileSync(path.join(root, 'pages/calc.tsx'), 'utf8').includes('data-testid="button-go-simulation"'));
  assert.ok(!catalog.includes('Добавить в расчёт'));
  assert.ok(!detail.includes('Добавить в расчёт'));
});

test('cancelling an object change does not touch the project or navigate', () => {
  const filename = path.join(root, 'components/calculation-intent-state.tsx');
  const text = readFileSync(filename, 'utf8');
  const source = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let handler;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'chooseObject') handler = node.initializer.getText(source);
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(handler);
  const state = { objectType: 'warehouse', sectorId: null, objectParams: { area_m2: 20000 },
    selectedSolutions: ['existing-model'] };
  const before = JSON.stringify(state);
  const calls = [];
  let confirmations = 0;
  const sandbox = { state, solution: { id: 'new-model' },
    window: { confirm() { confirmations++; return false; } },
    setObjectType: value => calls.push(['object', value]),
    setSectorId: value => calls.push(['sector', value]),
    setLocation: value => calls.push(['navigate', value]),
    withCalculationIntent: (url, id) => `${url}?solution=${id}`,
  };
  const code = ts.transpileModule(`globalThis.chooseObject = ${handler}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, sandbox);
  sandbox.chooseObject('airport');
  assert.equal(confirmations, 1);
  assert.equal(calls.length, 0);
  assert.equal(JSON.stringify(state), before);
  // Switching to the clinic's dedicated sector must also ask, even if the type is already medical.
  state.objectType = 'medical';
  sandbox.chooseObject('medical');
  assert.equal(confirmations, 2);
  assert.equal(calls.length, 0);
});
