// node --test scripts/test-glossary-demos.mjs (Chromium, no browser package needed)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveChromiumPath } from './chromium-path.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const port = Number(process.env.GLOSSARY_PORT ?? 4196);
const debugPort = Number(process.env.GLOSSARY_DEBUG_PORT ?? 9437);
const url = process.env.GLOSSARY_TEST_URL?.replace(/\/$/, '') ?? `http://127.0.0.1:${port}`;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(check, name, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await check()) return; await delay(70); }
  throw new Error(`Timed out: ${name}`);
}
async function ready(address) {
  try { return (await fetch(address, { signal: AbortSignal.timeout(1000) })).ok; } catch { return false; }
}
async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  const kill = signal => { try { process.kill(-child.pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; } };
  kill('SIGTERM');
  await Promise.race([exited, delay(1200)]);
  if (child.exitCode === null && child.signalCode === null) kill('SIGKILL');
  await exited;
}
class Page {
  pending = new Map(); id = 0; errors = [];
  constructor(address) {
    this.socket = new WebSocket(address);
    this.opened = new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    this.socket.addEventListener('message', ({ data }) => {
      const message = JSON.parse(data);
      if (message.method === 'Runtime.exceptionThrown') this.errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id); clearTimeout(pending.timer);
      message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result);
    });
  }
  async command(method, params = {}) {
    await this.opened;
    const id = ++this.id;
    const result = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 10000);
      this.pending.set(id, { resolve, reject, timer });
    });
    this.socket.send(JSON.stringify({ id, method, params }));
    return result;
  }
  async evaluate(fn, argument) {
    const response = await this.command('Runtime.evaluate', {
      expression: `(${fn})(${JSON.stringify(argument)})`, returnByValue: true, awaitPromise: true,
    });
    assert.ok(!response.exceptionDetails, JSON.stringify(response.exceptionDetails));
    return response.result.value;
  }
  async click(id) { await this.evaluate(id => document.getElementById(id).click(), id); }
  async show(id) {
    await this.evaluate(id => {
      document.documentElement.style.scrollBehavior = 'auto';
      document.getElementById(id).scrollIntoView({ behavior: 'instant', block: 'center' });
    }, id);
    await delay(120);
  }
}

test('all four glossary demos respond to controls, including reduced-motion and mobile', { timeout: 90000 }, async () => {
  let server, browser, page;
  const profile = await mkdtemp(path.join(tmpdir(), 'robotshub-glossary-'));
  try {
    if (!process.env.GLOSSARY_TEST_URL) server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--config', 'vite.config.ts'], {
      cwd: root, env: { ...process.env, PORT: String(port), BASE_PATH: '/' }, detached: true, stdio: 'ignore',
    });
    await waitFor(() => ready(`${url}/glossary/`), 'Vite');
    browser = spawn(resolveChromiumPath(), ['--headless', '--no-sandbox', '--disable-dev-shm-usage',
      `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, 'about:blank'], { detached: true, stdio: 'ignore' });
    await waitFor(() => ready(`http://127.0.0.1:${debugPort}/json/version`), 'Chromium');
    const target = await (await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: 'PUT' })).json();
    page = new Page(target.webSocketDebuggerUrl);
    await page.command('Runtime.enable'); await page.command('Page.enable');
    await page.command('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await page.command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    await page.command('Page.navigate', { url: `${url}/glossary/` });
    await waitFor(() => page.evaluate(() => document.getElementById('demoFinance')?.dataset.purchasePayback === '36'), 'all demo modules initialized');
    await page.evaluate(() => localStorage.setItem('robotshub_project', 'keep-existing-project'));
    assert.equal(await page.evaluate(() => document.getElementById('comparePlay').textContent), 'Пуск');

    await page.show('w-agv');
    await page.click('comparePlay');
    await waitFor(() => page.evaluate(() => document.querySelector('[data-agent="AGV"]').dataset.state === 'blocked'
      && document.querySelector('[data-agent="AMR"]').dataset.state === 'delivered'), 'AGV waits; AMR delivers around obstacle', 8000);
    await page.click('compareSeal');
    await waitFor(() => page.evaluate(() => document.querySelector('[data-agent="AMR"]').dataset.state === 'no-path'
      && document.querySelector('[data-agent="AGV"]').dataset.state === 'blocked'), 'both policies respect closed corridor');
    await page.click('compareObstacle');
    await waitFor(() => page.evaluate(() => [...document.querySelectorAll('[data-agent]')].every(node => node.dataset.state === 'delivered')), 'both deliver when route is clear', 8000);
    await page.click('compareReset'); await page.click('comparePlay');
    const paused = await page.evaluate(() => document.querySelector('[data-agent="AMR"]').dataset.position);
    await delay(300);
    assert.equal(await page.evaluate(() => document.querySelector('[data-agent="AMR"]').dataset.position), paused);

    await page.show('w-lidar');
    await page.click('lidarReset');
    assert.equal(await page.evaluate(() => document.getElementById('demoLidar').dataset.samples), '0');
    await page.click('lidarStep');
    assert.equal(await page.evaluate(() => document.getElementById('demoLidar').dataset.samples), '15');
    const colors = await page.evaluate(() => [...document.querySelectorAll('#demoLidar circle[data-distance]')].map(dot => ({
      distance: Number(dot.dataset.distance), fill: dot.getAttribute('fill'),
    })));
    assert.ok(new Set(colors.map(dot => dot.fill)).size > 1);
    for (const dot of colors) {
      const hue = Math.round(Math.max(0, Math.min(450, dot.distance)) / 450 * 240);
      assert.equal(dot.fill, `hsl(${hue}, 95%, 64%)`);
    }
    await page.click('lidarMove');
    assert.equal(await page.evaluate(() => document.getElementById('demoLidar').dataset.origin), 'Б');
    await page.click('lidarPlay');
    await waitFor(() => page.evaluate(() => Number(document.getElementById('demoLidar').dataset.samples) > 15), 'manual scan animates despite reduced motion');
    await page.click('lidarPlay');
    const samples = await page.evaluate(() => document.getElementById('demoLidar').dataset.samples);
    await delay(200);
    assert.equal(await page.evaluate(() => document.getElementById('demoLidar').dataset.samples), samples);

    await page.show('w-astar');
    await page.click('routeClear');
    assert.equal(await page.evaluate(() => document.getElementById('demoRoute').dataset.steps), '9');
    await page.evaluate(() => document.querySelector('#demoRoute [data-cell="6,3"]').click());
    assert.equal(await page.evaluate(() => document.getElementById('demoRoute').dataset.steps), '11');
    await page.click('routeSeal');
    assert.equal(await page.evaluate(() => document.getElementById('demoRoute').dataset.found), 'false');
    await page.click('routeExample'); await page.click('routeStep');
    assert.equal(await page.evaluate(() => document.getElementById('demoRoute').dataset.visited), '1');
    await page.click('routeAnimate');
    await waitFor(() => page.evaluate(() => Number(document.getElementById('demoRoute').dataset.visited) > 2), 'A* trace advances');
    await page.evaluate(() => document.querySelector('#demoRoute [data-cell="2,2"]').focus());
    await page.command('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', text: ' ', unmodifiedText: ' ', windowsVirtualKeyCode: 32 });
    await page.command('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
    await waitFor(() => page.evaluate(() => document.querySelector('#demoRoute [data-cell="2,2"]').dataset.wall === 'true'), 'keyboard editing works');

    await page.show('w-payback');
    const finance = await page.evaluate(() => ({ ...document.getElementById('demoFinance').dataset }));
    assert.equal(Number(finance.purchasePayback), 36);
    assert.ok(Math.abs(Number(finance.payment) - 0.522) < 1e-9);
    assert.ok(Math.abs(Number(finance.leasePayback) - 44.784) < 1e-9);
    await page.evaluate(() => { const input = document.getElementById('financeSaving'); input.value = '0'; input.dispatchEvent(new Event('input', { bubbles: true })); });
    assert.equal(await page.evaluate(() => document.getElementById('demoFinance').dataset.purchasePayback), 'null');
    assert.equal(await page.evaluate(() => document.getElementById('demoFinance').dataset.leasePayback), 'null');
    assert.equal(await page.evaluate(() => localStorage.getItem('robotshub_project')), 'keep-existing-project');

    await page.command('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: true });
    for (const id of ['w-agv', 'w-lidar', 'w-astar', 'w-payback']) {
      await page.show(id);
      const layout = await page.evaluate(id => {
        const box = document.getElementById(id).getBoundingClientRect();
        return { id, left: box.left, right: box.right, width: innerWidth, pageWidth: document.documentElement.scrollWidth };
      }, id);
      assert.ok(layout.left >= -1 && layout.right <= layout.width + 1, JSON.stringify(layout));
      assert.ok(layout.pageWidth <= layout.width + 1, JSON.stringify(layout));
    }
    assert.deepEqual(page.errors, []);
  } finally {
    page?.socket.close();
    await stop(browser); await stop(server);
    await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
});
