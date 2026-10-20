import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveChromiumPath } from './chromium-path.mjs';
import { objectProcesses } from '../src/lib/start-processes.ts';
import {
  parseStartScopeDraft, readStartScopeDraft, saveStartScopeDraft,
  startScopeProcesses, startScopeSelectionPath, START_SCOPE_STORAGE_KEY,
} from '../src/lib/start-scope.ts';

const warehouse = () => ({
  version: 1, step: 4, objectId: 'warehouse', customObject: '', scope: 'whole',
  processes: objectProcesses.warehouse, selectedIds: objectProcesses.warehouse.map(item => item.id),
  details: {}, activeProcess: null,
});

test('all six object maps restore their full scope without invented inputs', () => {
  for (const [objectId, processes] of Object.entries(objectProcesses)) {
    const restored = parseStartScopeDraft({
      ...warehouse(), objectId, processes, selectedIds: [], customObject: objectId === 'other' ? 'Мой объект' : '',
    });
    assert.ok(restored, objectId);
    assert.equal(startScopeProcesses(restored).length, processes.length);
    assert.deepEqual(restored.details, {});
    assert.equal(new Set(restored.selectedIds).size, processes.length);
  }
});

test('custom areas and explicit unknowns survive restoration', () => {
  const draft = warehouse();
  draft.processes = [...draft.processes, {
    id: 'custom-1', name: 'Возвратная тара', kind: 'custom', summary: '', focus: '',
  }];
  draft.details.receiving = { values: { volume: '120', hours: '' }, unknown: { hours: true } };
  const restored = parseStartScopeDraft(draft);
  assert.equal(startScopeProcesses(restored).length, 9);
  assert.equal(restored.details.receiving.values.volume, '120');
  assert.equal(restored.details.receiving.unknown.hours, true);
  assert.equal(restored.processes.at(-1).name, 'Возвратная тара');
});

test('one, several and exploratory scopes remain distinct', () => {
  for (const [scope, selectedIds, count] of [
    ['single', ['receiving'], 1], ['multiple', ['receiving', 'picking'], 2], ['unsure', [], 8],
  ]) {
    assert.equal(startScopeProcesses(parseStartScopeDraft({ ...warehouse(), scope, selectedIds })).length, count);
  }
  assert.equal(parseStartScopeDraft({ ...warehouse(), scope: 'multiple', selectedIds: ['receiving'] }), null);
});

test('malformed drafts cannot supply arbitrary processes or invalid saved selections', () => {
  for (const change of [
    { version: 2 }, { step: 5 }, { objectId: 'submarine' }, { scope: 'automatic' },
    { selectedIds: ['missing'] }, { activeProcess: 'missing' },
    { processes: [] }, { processes: [objectProcesses.warehouse[0], objectProcesses.warehouse[0]] },
    { details: { receiving: { values: { volume: Infinity }, unknown: {} } } },
    { details: { receiving: { values: {}, unknown: { volume: 'false' } } } },
  ]) assert.equal(parseStartScopeDraft({ ...warehouse(), ...change }), null);
});

test('scope navigation does not pretend that production and public buildings are warehouse models', () => {
  assert.match(startScopeSelectionPath('warehouse'), /objectType=warehouse/);
  assert.match(startScopeSelectionPath('medical'), /objectType=medical/);
  assert.match(startScopeSelectionPath('airport'), /objectType=airport/);
  assert.match(startScopeSelectionPath('production'), /objectType=custom/);
  assert.match(startScopeSelectionPath('public'), /objectType=custom/);
});

test('draft storage preserves the financial project and backs up unreadable scope data', t => {
  const prior = globalThis.window;
  t.after(() => { if (prior === undefined) delete globalThis.window; else globalThis.window = prior; });
  const stored = new Map([['robotshub_project', 'existing-project'], [START_SCOPE_STORAGE_KEY, '{broken']]);
  globalThis.window = { localStorage: {
    getItem: key => stored.get(key) ?? null,
    setItem: (key, value) => stored.set(key, value),
  } };
  assert.ok(readStartScopeDraft().warning);
  assert.equal(saveStartScopeDraft(warehouse()), true);
  assert.equal(stored.get(`${START_SCOPE_STORAGE_KEY}_recovery`), '{broken');
  assert.equal(stored.get('robotshub_project'), 'existing-project');
  assert.equal(readStartScopeDraft().draft.processes.length, 8);
  globalThis.window = { localStorage: {
    getItem() { throw new Error('storage blocked'); },
    setItem() { throw new Error('storage blocked'); },
  } };
  assert.ok(readStartScopeDraft().warning);
  assert.equal(saveStartScopeDraft(warehouse()), false);
});

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(check, label) {
  const until = Date.now() + 15000;
  let lastError;
  while (Date.now() < until) {
    try { if (await check()) return; } catch (error) { lastError = error; }
    await delay(60);
  }
  throw new Error(`Timed out: ${label}${lastError ? `: ${lastError.message}` : ''}`);
}
class Page {
  pending = new Map(); id = 0; errors = [];
  constructor(url) {
    this.socket = new WebSocket(url);
    this.opened = once(this.socket, 'open');
    this.socket.addEventListener('message', ({ data }) => {
      const msg = JSON.parse(data);
      if (msg.method === 'Runtime.exceptionThrown') this.errors.push(msg.params.exceptionDetails.text);
      const pending = this.pending.get(msg.id);
      if (!pending) return;
      this.pending.delete(msg.id); clearTimeout(pending.timer);
      msg.error ? pending.reject(new Error(msg.error.message)) : pending.resolve(msg.result);
    });
  }
  async command(method, params = {}) {
    await this.opened;
    const id = ++this.id;
    const result = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`CDP: ${method}`)), 10000);
      this.pending.set(id, { resolve, reject, timer });
    });
    this.socket.send(JSON.stringify({ id, method, params }));
    return result;
  }
  async evaluate(fn, arg) {
    const result = await this.command('Runtime.evaluate', {
      expression: `(${fn})(${JSON.stringify(arg)})`, returnByValue: true, awaitPromise: true,
    });
    assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
  async visible(id) {
    await waitFor(() => this.evaluate(id => !!document.querySelector(`[data-testid="${id}"]`), id), id);
  }
  async click(id) {
    await this.visible(id);
    await this.evaluate(id => document.querySelector(`[data-testid="${id}"]`).click(), id);
  }
  async fill(id, value) {
    await this.visible(id);
    await this.evaluate(({ id, value }) => {
      const input = document.querySelector(`[data-testid="${id}"]`);
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }, { id, value });
  }
  async layout() {
    assert.ok(await this.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no horizontal overflow');
  }
}

test('working /start gives a result first, preserves answers and never overwrites the financial project', {
  skip: !process.env.START_SCOPE_BROWSER_TEST, timeout: 90000,
}, async () => {
  const profile = await mkdtemp(path.join(tmpdir(), 'robotshub-start-'));
  let browser, page;
  try {
    browser = spawn(resolveChromiumPath(), [
      '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--no-first-run',
      '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
    ], { stdio: 'ignore', detached: true });
    let port;
    await waitFor(async () => {
      port = (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0];
      return port;
    }, 'Chromium port');
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    page = new Page(targets.find(item => item.type === 'page').webSocketDebuggerUrl);
    await page.command('Runtime.enable');
    await page.command('Page.enable');
    const base = 'http://127.0.0.1:80';
    await page.command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await page.command('Page.navigate', { url: `${base}/start` });
    await page.visible('object-screen');
    await page.evaluate(() => {
      localStorage.setItem('robotshub_project', JSON.stringify({
        demoProject: false, questionnaireEvidence: {}, objectType: 'warehouse',
        sectorId: 'Транспорт и логистика', objectParams: { area_m2: 10000 },
        selectedSolutions: [], activeSolutionId: null, whatIfOverrides: {},
        assumptionsOverrides: {}, financingScenario: 'purchase', simulationKpis: null,
      }));
    });
    await page.command('Page.navigate', { url: `${base}/start` });
    await page.visible('object-screen');
    await delay(150);
    const financial = await page.evaluate(() => JSON.parse(localStorage.getItem('robotshub_project')));
    await page.layout();
    assert.ok(await page.evaluate(() => {
      const rect = document.querySelector('[data-testid="object-warehouse"]').getBoundingClientRect();
      return rect.top >= 0 && rect.bottom <= innerHeight;
    }), 'Warehouse is visible on a phone');
    assert.doesNotMatch(await page.evaluate(() => document.querySelector('[data-testid="page-start"]').textContent), /МОДЕЛЬНЫЙ ПРИМЕР|5 200|5 200/);
    await page.click('object-warehouse');
    await page.click('scope-whole'); await page.click('scope-continue');
    await page.visible('project-map');
    assert.equal(await page.evaluate(() => document.querySelectorAll('.sb-node').length), 8);
    assert.equal(await page.evaluate(() => document.querySelectorAll('[data-testid^="process-input-"]').length), 0);
    await page.click('project-edit-map');
    await page.fill('custom-process-name', 'Возвратная тара'); await page.click('process-add-custom');
    await page.click('map-build-project');
    await page.click('brief-refine-receiving');
    const field = await page.evaluate(() => document.querySelector('[data-testid^="process-input-receiving-"]').dataset.testid);
    const unknown = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="process-unknown-receiving-"]')].at(-1).dataset.testid);
    await page.fill(field, 'Infinity'); await page.click('process-detail-save');
    assert.ok(await page.evaluate(() => !!document.querySelector('.of-errors')), 'non-finite input rejected');
    await page.fill(field, '120'); await page.click(unknown); await page.click('process-detail-save');
    await page.visible('brief-saved-notice');
    await page.command('Page.navigate', { url: `${base}/start` });
    await page.visible('project-map');
    await page.click('brief-refine-receiving');
    assert.equal(await page.evaluate(id => document.querySelector(`[data-testid="${id}"]`).value, field), '120');
    assert.equal(await page.evaluate(id => document.querySelector(`[data-testid="${id}"]`).classList.contains('active'), unknown), true);
    await page.click('process-detail-back');
    await page.visible('project-map');
    assert.match(await page.evaluate(() => document.querySelector('[data-testid="brief-process-map"]').textContent), /Возвратная тара/);
    await page.layout();
    await page.click('brief-copy-link');
    await page.visible('brief-share-url');
    assert.match(await page.evaluate(() => document.querySelector('[data-testid="brief-share-url"]').value), /^https:\/\/robotshub\.ru\/start#brief=/);
    await page.command('Page.navigate', { url: `${base}/quick-select?from=start&objectType=warehouse` });
    await page.visible('project-map');
    assert.equal(await page.evaluate(() => location.pathname), '/start');
    await page.click('object-restart'); await page.click('start-scope-reset-cancel'); await page.visible('project-map');
    await page.click('object-restart'); await page.click('start-scope-reset-confirm'); await page.visible('object-screen');
    await page.click('object-medical');
    await page.click('scope-multiple'); await page.click('scope-continue');
    await page.click('process-select-lab-samples'); await page.click('map-build-project');
    assert.ok(await page.evaluate(() => !!document.querySelector('.of-errors')), 'several requires two areas');
    await page.click('process-select-medical-cleaning'); await page.click('map-build-project');
    assert.equal(await page.evaluate(() => document.querySelectorAll('.sb-node').length), 2);
    await page.command('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await page.layout();
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('robotshub_project'))), financial);
    await page.command('Page.navigate', { url: `${base}/start?industry=${encodeURIComponent('Транспорт и логистика')}` });
    await page.visible('start-area-input');
    assert.deepEqual(page.errors, []);
  } finally {
    page?.socket.close();
    if (browser && browser.exitCode === null && browser.signalCode === null) {
      const exited = once(browser, 'exit');
      process.kill(-browser.pid, 'SIGTERM');
      await Promise.race([exited, delay(1500)]);
      if (browser.exitCode === null && browser.signalCode === null) process.kill(-browser.pid, 'SIGKILL');
      await exited;
    }
    await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
});
