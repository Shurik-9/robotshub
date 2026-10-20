// Uses the running shared preview; no browser package or app data required.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveChromiumPath } from '../../robotshub/scripts/chromium-path.mjs';

const base = 'http://127.0.0.1:80/__mockup/preview/robotshub-entry';
const debugPort = 9441;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(check, label, timeout = 12000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) { if (await check()) return; await delay(60); }
  throw new Error(`Timed out: ${label}`);
}
class Page {
  pending = new Map(); id = 0; errors = [];
  constructor(url) {
    this.socket = new WebSocket(url);
    this.opened = new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    this.socket.addEventListener('message', ({ data }) => {
      const msg = JSON.parse(data);
      if (msg.method === 'Runtime.exceptionThrown') this.errors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
      const request = this.pending.get(msg.id);
      if (!request) return;
      this.pending.delete(msg.id); clearTimeout(request.timer);
      msg.error ? request.reject(new Error(msg.error.message)) : request.resolve(msg.result);
    });
  }
  async command(method, params = {}) {
    await this.opened;
    const id = ++this.id;
    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(method)); }, 10000);
      this.pending.set(id, { resolve, reject, timer });
    });
    this.socket.send(JSON.stringify({ id, method, params }));
    return promise;
  }
  async evaluate(fn, arg) {
    const result = await this.command('Runtime.evaluate', { expression: `(${fn})(${JSON.stringify(arg)})`, returnByValue: true, awaitPromise: true });
    assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
  async visible(id) {
    await waitFor(() => this.evaluate(id => Boolean(document.querySelector(`[data-testid="${id}"]`)), id), id);
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
    const sizes = await this.evaluate(() => ({ width: innerWidth, page: document.documentElement.scrollWidth }));
    assert.ok(sizes.page <= sizes.width + 1, JSON.stringify(sizes));
  }
}

test('both entry prototypes are clickable, legible, responsive and isolated from project storage', { timeout: 90000 }, async () => {
  const profile = await mkdtemp(path.join(tmpdir(), 'robotshub-entry-'));
  let browser, page;
  try {
    browser = spawn(resolveChromiumPath(), ['--headless', '--no-sandbox', '--disable-dev-shm-usage', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, 'about:blank'], { detached: true, stdio: 'ignore' });
    await waitFor(async () => { try { return (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).ok; } catch { return false; } }, 'Chromium');
    const target = await (await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: 'PUT' })).json();
    page = new Page(target.webSocketDebuggerUrl);
    await page.command('Runtime.enable'); await page.command('Page.enable');
    await page.command('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await page.command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await page.command('Page.navigate', { url: `${base}/TaskFirst` });
    await page.visible('task-operation-transport');
    await page.evaluate(() => localStorage.setItem('robotshub-prototype-guard', 'unchanged-project'));
    await page.layout();
    assert.ok(await page.evaluate(() => document.querySelector('[data-testid="task-operation-other"]').getBoundingClientRect().bottom <= innerHeight), 'all initial operation choices fit the first mobile viewport');
    assert.ok(await page.evaluate(() => Number.parseFloat(getComputedStyle(document.querySelector('.tf-op-copy strong')).fontSize) >= 16), 'readable action labels');
    await page.click('task-operation-transport');
    await page.click('task-continue-context');
    assert.ok(await page.evaluate(() => Boolean(document.querySelector('[role="alert"]'))), 'missing context is explained');
    await page.click('task-context-warehouse'); await page.click('task-continue-context');
    await page.fill('task-input-volume', '120'); await page.fill('task-input-hours', '0');
    await page.click('task-build-summary');
    assert.ok(await page.evaluate(() => Boolean(document.querySelector('[role="alert"]'))), 'zero duration is rejected');
    await page.fill('task-input-hours', 'Infinity'); await page.click('task-build-summary');
    assert.ok(await page.evaluate(() => Boolean(document.querySelector('[role="alert"]'))), 'non-finite data is rejected');
    await page.fill('task-input-hours', '8');
    await page.click('task-back-context'); await page.click('task-continue-context');
    assert.equal(await page.evaluate(() => document.querySelector('[data-testid="task-input-volume"]').value), '120', 'back without a context change retains answers');
    await page.click('task-build-summary'); await page.visible('task-summary');
    assert.match(await page.evaluate(() => document.querySelector('[data-testid="task-summary"]').textContent), /120/);
    await page.layout(); await page.click('task-edit-inputs');
    await page.click('task-back-context'); await page.click('task-context-airport'); await page.click('task-continue-context');
    assert.equal(await page.evaluate(() => document.querySelector('[data-testid="task-input-volume"]').value), '', 'a different context clears the old answers');
    await page.click('task-unknown-volume'); await page.click('task-unknown-hours');
    await page.click('task-build-summary'); await page.visible('task-summary');
    assert.match(await page.evaluate(() => document.querySelector('[data-testid="task-summary"]').textContent), /неизвестно/i);
    await page.click('task-restart');
    for (const [operation, context, fields] of [
      ['cleaning', 'medical', [['area', '1200'], ['hours', '6']]],
      ['inspection', 'office', [['volume', '10'], ['hours', '30']]],
    ]) {
      await page.click(`task-operation-${operation}`); await page.click(`task-context-${context}`); await page.click('task-continue-context');
      for (const [key, value] of fields) await page.fill(`task-input-${key}`, value);
      await page.click('task-build-summary'); await page.visible('task-summary');
      await page.layout(); await page.click('task-restart');
    }
    await page.click('task-operation-other'); await page.click('task-context-office'); await page.click('task-continue-context');
    await page.fill('task-input-task', 'Перекладывать тару'); await page.click('task-unknown-volume');
    await page.click('task-build-summary'); await page.visible('task-summary');
    assert.match(await page.evaluate(() => document.querySelector('[data-testid="task-summary"]').textContent), /Перекладывать тару/);

    await page.command('Page.navigate', { url: `${base}/ExampleFirst` });
    await page.visible('choice-robot'); await page.layout();
    assert.ok(await page.evaluate(() => document.querySelector('[data-testid="cta-next-step-1"]').getBoundingClientRect().bottom <= innerHeight), 'the first lesson action fits the mobile viewport');
    assert.ok(await page.evaluate(() => Number.parseFloat(getComputedStyle(document.querySelector('.ef-lead')).fontSize) >= 16), 'readable explanatory body text');
    await page.click('choice-robot');
    assert.equal(await page.evaluate(() => document.querySelector('[data-testid="choice-robot"]').getAttribute('aria-pressed')), 'true');
    await page.click('choice-manual');
    assert.equal(await page.evaluate(() => document.querySelector('[data-testid="choice-manual"]').getAttribute('aria-pressed')), 'true');
    await page.click('cta-replay-route');
    await page.click('cta-next-step-1'); await page.click('cta-next-step-2');
    await page.click('cta-own-task'); await page.click('cta-save-task');
    assert.ok(await page.evaluate(() => Boolean(document.querySelector('[role="alert"]'))), 'an empty task description is rejected');
    await page.fill('field-operation', 'Перевозка контейнеров');
    await page.fill('field-start', 'Лаборатория'); await page.fill('field-finish', 'Пункт приёма');
    await page.click('cta-save-task'); await page.visible('task-summary');
    const summary = await page.evaluate(() => document.querySelector('[data-testid="task-summary"]').textContent);
    assert.match(summary, /Перевозка контейнеров/); assert.match(summary, /Неизвестно/);
    await page.click('cta-edit-task');
    assert.equal(await page.evaluate(() => document.querySelector('[data-testid="field-start"]').value), 'Лаборатория');
    await page.layout(); await page.click('cta-restart'); await page.visible('choice-robot');
    assert.equal(await page.evaluate(() => localStorage.getItem('robotshub-prototype-guard')), 'unchanged-project');
    for (const component of ['TaskFirst', 'ExampleFirst']) {
      await page.command('Emulation.setDeviceMetricsOverride', { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false });
      await page.command('Page.navigate', { url: `${base}/${component}` });
      await page.visible(component === 'TaskFirst' ? 'task-operation-transport' : 'choice-robot');
      await page.layout();
    }
    assert.deepEqual(page.errors, []);
  } finally {
    page?.socket.close();
    if (browser && browser.exitCode === null && browser.signalCode === null) {
      const exit = once(browser, 'exit');
      try { process.kill(-browser.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
      await Promise.race([exit, delay(1500)]);
      if (browser.exitCode === null && browser.signalCode === null) process.kill(-browser.pid, 'SIGKILL');
      await exit;
    }
    await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
});

test('object-first supports whole objects, multiple areas, single and unknown scope', { timeout: 90000 }, async () => {
  const profile = await mkdtemp(path.join(tmpdir(), 'robotshub-object-scope-'));
  let browser, page;
  try {
    browser = spawn(resolveChromiumPath(), ['--headless', '--no-sandbox', '--disable-dev-shm-usage', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, 'about:blank'], { detached: true, stdio: 'ignore' });
    await waitFor(async () => { try { return (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).ok; } catch { return false; } }, 'Chromium');
    const target = await (await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: 'PUT' })).json();
    page = new Page(target.webSocketDebuggerUrl);
    await page.command('Runtime.enable'); await page.command('Page.enable');
    await page.command('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await page.command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await page.command('Page.navigate', { url: `${base}/ObjectFirst` });
    await page.visible('object-warehouse'); await page.layout();
    await page.evaluate(() => localStorage.setItem('robotshub-prototype-guard', 'unchanged'));
    assert.ok(await page.evaluate(() => document.querySelector('[data-testid="object-warehouse"]').getBoundingClientRect().bottom <= innerHeight));
    await page.click('object-warehouse'); await page.click('object-continue');
    await page.click('scope-whole'); await page.click('scope-continue');
    const cardCount = () => page.evaluate(() => document.querySelectorAll('.of-process-card').length);
    const rowCount = () => page.evaluate(() => document.querySelectorAll('.of-project-row').length);
    assert.equal(await cardCount(), 8);
    await page.fill('custom-process-name', 'Маркировка возвратной тары'); await page.click('process-add-custom');
    assert.equal(await cardCount(), 9);
    await page.click('process-open-receiving');
    const fieldId = await page.evaluate(() => document.querySelector('.of-detail input[inputmode="decimal"]').getAttribute('data-testid'));
    await page.fill(fieldId, 'Infinity'); await page.click('process-detail-save');
    assert.ok(await page.evaluate(() => Boolean(document.querySelector('[role="alert"]'))));
    await page.click('process-detail-back'); await page.click('map-build-project'); await page.visible('project-map');
    assert.equal(await rowCount(), 9, 'opening one detail never narrows whole-object coverage');
    assert.match(await page.evaluate(() => document.querySelector('.of-project-row').textContent), /Известно: 0.*нужно исправить: 1/);
    await page.click('project-edit-receiving'); await page.fill(fieldId, '120'); await page.click('process-detail-save');
    await page.visible('process-detail-saved'); await page.click('process-detail-back');
    await page.click('process-open-picking'); await page.click('process-detail-back');
    await page.click('process-open-receiving');
    assert.equal(await page.evaluate(id => document.querySelector(`[data-testid="${id}"]`).value, fieldId), '120');
    await page.click('process-detail-back'); await page.click('map-back-scope'); await page.click('scope-whole'); await page.click('scope-continue');
    assert.equal(await cardCount(), 9, 'back with the same scope retains custom processes');
    await page.layout();
    await page.command('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
    await page.layout();
    const capture = await page.command('Page.captureScreenshot', { format: 'png' });
    await writeFile('/tmp/robotshub-object-scope-map.png', Buffer.from(capture.data, 'base64'));
    await page.click('map-back-scope'); await page.click('scope-multiple'); await page.click('scope-continue');
    await page.click('process-select-picking'); await page.click('process-select-cleaning'); await page.click('map-build-project');
    await page.visible('project-map'); assert.equal(await rowCount(), 2);
    await page.click('project-map-back'); await page.click('map-back-scope');
    await page.click('scope-single'); await page.click('scope-continue');
    await page.click('process-select-receiving'); await page.click('process-select-picking');
    await page.click('map-build-project'); await page.visible('project-map');
    assert.equal(await rowCount(), 1); await page.visible('project-edit-picking');
    await page.click('project-map-back'); await page.click('map-back-scope');
    await page.click('scope-unsure'); await page.click('scope-continue'); await page.click('map-build-project');
    await page.visible('project-map'); assert.equal(await rowCount(), 9, 'unknown scope provides exploratory directions, not an empty loop');
    assert.match(await page.evaluate(() => document.querySelector('.of-project-summary-head').textContent), /для изучения/);
    await page.click('project-map-back'); await page.click('object-change-map'); await page.click('object-change-cancel');
    await page.visible('process-picking');
    await page.click('object-change-map'); await page.click('object-change-confirm');
    await page.click('object-medical'); await page.click('object-continue'); await page.click('scope-whole'); await page.click('scope-continue');
    await page.visible('process-lab-samples');
    assert.equal(await page.evaluate(() => Boolean(document.querySelector('[data-testid="process-picking"]'))), false);
    assert.ok(await page.evaluate(() => [...document.querySelectorAll('.of-process-meta')].every(node => node.textContent.includes('пока не уточнены'))));
    await page.click('map-build-project'); await page.visible('project-map'); await page.click('object-restart');
    await page.click('object-other'); await page.click('object-continue');
    assert.ok(await page.evaluate(() => Boolean(document.querySelector('[role="alert"]'))));
    await page.fill('object-custom-name', 'Гостиничный комплекс'); await page.click('object-continue');
    await page.click('scope-multiple'); await page.click('scope-continue');
    await page.fill('custom-process-name', 'Доставка багажа гостей'); await page.click('process-add-custom');
    await page.click('process-select-custom-1'); await page.click('map-build-project'); await page.visible('project-map');
    assert.match(await page.evaluate(() => document.querySelector('[data-testid="project-map"]').textContent), /Гостиничный комплекс.*Доставка багажа гостей/s);
    assert.equal(await page.evaluate(() => localStorage.getItem('robotshub-prototype-guard')), 'unchanged');
    await page.layout(); assert.deepEqual(page.errors, []);
  } finally {
    page?.socket.close();
    if (browser && browser.exitCode === null && browser.signalCode === null) {
      const exit = once(browser, 'exit');
      try { process.kill(-browser.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
      await Promise.race([exit, delay(1500)]);
      if (browser.exitCode === null && browser.signalCode === null) process.kill(-browser.pid, 'SIGKILL');
      await exit;
    }
    await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
});
