// node --test scripts/test-home-video.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveChromiumPath } from './chromium-path.mjs';

const debugPort = Number(process.env.HOME_VIDEO_DEBUG_PORT ?? 9438);
// Use the shared preview: /news belongs to the API artifact, not the Vite SPA.
const url = process.env.HOME_VIDEO_TEST_URL?.replace(/\/$/, '') ?? 'http://127.0.0.1:80';
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(check, description, timeout = 15000) {
  const limit = Date.now() + timeout;
  while (Date.now() < limit) { if (await check()) return; await wait(80); }
  throw new Error(`Timed out: ${description}`);
}
async function responds(target) {
  try { return (await fetch(target, { signal: AbortSignal.timeout(1000) })).ok; } catch { return false; }
}
async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  try { process.kill(-child.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  await Promise.race([exited, wait(1200)]);
  if (child.exitCode === null && child.signalCode === null) {
    try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
  await exited;
}
class Page {
  pending = new Map(); nextId = 0; errors = [];
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
    const id = ++this.nextId;
    const response = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 10000);
      this.pending.set(id, { resolve, reject, timer });
    });
    this.socket.send(JSON.stringify({ id, method, params }));
    return response;
  }
  async evaluate(fn) {
    const response = await this.command('Runtime.evaluate', { expression: `(${fn})()`, returnByValue: true, awaitPromise: true });
    assert.ok(!response.exceptionDetails, JSON.stringify(response.exceptionDetails));
    return response.result.value;
  }
}

test('hero loops without controls and home links load glossary/news documents without a 404', { timeout: 90000 }, async () => {
  let browser, page;
  const profile = await mkdtemp(path.join(tmpdir(), 'robotshub-home-video-'));
  try {
    await waitFor(() => responds(`${url}/`), 'shared preview');
    const asset = await fetch(`${url}/media/home-hero-loop.mp4`, { method: 'HEAD' });
    assert.equal(asset.status, 200);
    const bytes = Number(asset.headers.get('content-length'));
    assert.ok(bytes > 0 && bytes < 1_500_000, `Encoded video is ${bytes} bytes`);
    assert.equal((await fetch(`${url}/media/home-hero-loop-poster.webp`, { method: 'HEAD' })).status, 200);

    browser = spawn(resolveChromiumPath(), ['--headless', '--no-sandbox', '--disable-dev-shm-usage',
      `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, 'about:blank'], { detached: true, stdio: 'ignore' });
    await waitFor(() => responds(`http://127.0.0.1:${debugPort}/json/version`), 'Chromium');
    const target = await (await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: 'PUT' })).json();
    page = new Page(target.webSocketDebuggerUrl);
    await page.command('Runtime.enable'); await page.command('Page.enable');
    await page.command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    await page.command('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await page.command('Page.navigate', { url });
    await waitFor(() => page.evaluate(() => {
      const video = document.querySelector('[data-testid="hero-video"]');
      return video && !video.paused && video.currentTime > 0.2;
    }), 'autoplay starts in the visible hero');
    const settings = await page.evaluate(() => {
      const video = document.querySelector('[data-testid="hero-video"]');
      return { muted: video.muted, loop: video.loop, inline: video.playsInline, autoplay: video.autoplay, controls: video.controls, poster: video.poster, width: video.videoWidth, height: video.videoHeight };
    });
    assert.deepEqual({ muted: settings.muted, loop: settings.loop, inline: settings.inline }, { muted: true, loop: true, inline: true });
    assert.match(settings.poster, /home-hero-loop-poster\.webp$/);
    assert.equal(settings.width, 1280); assert.equal(settings.height, 696);
    assert.equal(settings.autoplay, true);
    assert.equal(settings.controls, false);
    assert.equal(await page.evaluate(() => document.querySelector('[data-testid="hero-video-frame"]').querySelectorAll('button,input,progress,[role="slider"]').length), 0);
    const heroLayout = await page.evaluate(() => {
      const art = document.querySelector('.ops-hero-art');
      const player = document.querySelector('[data-testid="hero-video-frame"]');
      return {
        artWidth: art.getBoundingClientRect().width,
        playerWidth: player.getBoundingClientRect().width,
        surroundingLabels: document.querySelectorAll('.ops-art-index,.ops-art-caption,.ops-edge-label').length,
      };
    });
    assert.ok(heroLayout.playerWidth >= heroLayout.artWidth * 0.98, JSON.stringify(heroLayout));
    assert.equal(heroLayout.surroundingLabels, 0);
    assert.equal(await page.evaluate(() => document.querySelectorAll('a[href$="/vendors"],a[href$="/vendors/"]').length), 0);
    await page.evaluate(() => {
      const video = document.querySelector('[data-testid="hero-video"]');
      video.currentTime = video.duration - 0.2;
    });
    await wait(300);
    await waitFor(() => page.evaluate(() => {
      const video = document.querySelector('[data-testid="hero-video"]');
      return !video.paused && video.currentTime < 2;
    }), 'native loop returns to the start of the clip');

    await page.command('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: true });
    await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
    await wait(250);
    await page.evaluate(() => document.querySelector('[data-testid="hero-video"]').scrollIntoView({ behavior: 'instant', block: 'center' }));
    await waitFor(() => page.evaluate(() => !document.querySelector('[data-testid="hero-video"]').paused), 'video continues automatically when the hero is visible');
    const mobile = await page.evaluate(() => ({
      width: innerWidth,
      pageWidth: document.documentElement.scrollWidth,
      videoWidth: document.querySelector('[data-testid="hero-video"]').getBoundingClientRect().width,
    }));
    assert.ok(mobile.pageWidth <= mobile.width + 1, JSON.stringify(mobile));
    assert.ok(mobile.videoWidth > 0);

    await page.evaluate(() => document.querySelector('[data-testid="footer-glossary-link"]').click());
    await waitFor(() => page.evaluate(() => document.title.includes('Глоссарий') && document.getElementById('demoLidar')?.dataset.samples === '15'), 'glossary loads its own document after a single click');
    await page.command('Page.navigate', { url });
    await waitFor(() => page.evaluate(() => Boolean(document.querySelector('[data-testid="footer-news-link"]'))), 'back to homepage');
    await page.evaluate(() => document.querySelector('[data-testid="footer-news-link"]').click());
    await waitFor(() => page.evaluate(() => location.pathname.startsWith('/news') && document.title.startsWith('Новости роботизации')), 'news loads the news server document, not the SPA 404');
    assert.deepEqual(page.errors, []);
  } finally {
    page?.socket.close();
    await stop(browser);
    await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
});
