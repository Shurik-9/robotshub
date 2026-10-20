import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveChromiumPath } from "./chromium-path.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const port = Number(process.env.SIM_TUNER_PORT ?? 4196);
const debugPort = Number(process.env.SIM_TUNER_DEBUG_PORT ?? 9409);
const baseUrl = process.env.SIM_TUNER_URL?.replace(/\/$/, "")
  ?? `http://127.0.0.1:${port}`;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitFor(check, description, timeout = 25_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await check()) return;
    await delay(100);
  }
  throw new Error(`Timed out: ${description}`);
}

async function ready(url) {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(1500) })).ok;
  } catch {
    return false;
  }
}

async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  const signal = name => {
    try {
      process.kill(-child.pid, name);
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  };
  signal("SIGTERM");
  const finished = await Promise.race([
    exited.then(() => true),
    delay(1500).then(() => false),
  ]);
  if (!finished) {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const killed = once(child, "exit");
    signal("SIGKILL");
    await killed;
  }
}

class Page {
  pending = new Map();
  id = 0;
  errors = [];

  constructor(url) {
    this.socket = new WebSocket(url);
    this.opened = new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", ({ data }) => {
      const message = JSON.parse(data);
      if (message.method === "Runtime.exceptionThrown") {
        this.errors.push(message.params.exceptionDetails.text);
      }
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
  }

  async command(method, params = {}) {
    await this.opened;
    const id = ++this.id;
    const result = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, 12_000);
      this.pending.set(id, { resolve, reject, timer });
    });
    this.socket.send(JSON.stringify({ id, method, params }));
    return result;
  }

  async evaluate(expression) {
    const result = await this.command("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
}

function modelElapsedSeconds() {
  const details = document.querySelector('[data-testid="simulation-model-explanation"] details');
  if (!details) return null;
  details.open = true;
  const match = details.innerText.match(/Прошло\s+(\d+)\s+мин\s+(\d+)\s+с модельного времени/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

test("simulation tuner keeps live flow, commits fleet, and fits mobile", { timeout: 120_000 }, async t => {
  let server;
  let browser;
  let page;
  const profile = await mkdtemp(path.join(tmpdir(), "robotshub-sim-tuner-"));

  try {
    if (!process.env.SIM_TUNER_URL) {
      server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--config", "vite.config.ts"], {
        cwd: root,
        env: { ...process.env, PORT: String(port), BASE_PATH: "/" },
        detached: true,
        stdio: "ignore",
      });
    }
    await waitFor(() => ready(`${baseUrl}/`), "Vite");

    browser = spawn(resolveChromiumPath(), [
      "--headless",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${profile}`,
      "about:blank",
    ], { detached: true, stdio: "ignore" });
    await waitFor(() => ready(`http://127.0.0.1:${debugPort}/json/version`), "Chromium");

    const target = await (
      await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: "PUT" })
    ).json();
    page = new Page(target.webSocketDebuggerUrl);
    await page.command("Page.enable");
    await page.command("Runtime.enable");

    const openDemo = async ({ width, height, mobile }) => {
      await page.command("Emulation.setDeviceMetricsOverride", {
        width,
        height,
        deviceScaleFactor: 1,
        mobile,
      });
      await page.command("Page.navigate", { url: `${baseUrl}/simulation` });
      await waitFor(
        () => page.evaluate(`!!document.querySelector('[data-testid="button-simulation-demo"]')`),
        "simulation demo entry",
      );
      await page.evaluate(`document.querySelector('[data-testid="button-simulation-demo"]').click()`);
      await waitFor(
        () => page.evaluate(`!!document.querySelector('[data-testid="sim-tuner"]')`),
        "simulation tuner",
      );
    };

    await openDemo({ width: 1440, height: 1000, mobile: false });
    const desktop = await page.evaluate(`(() => {
      const canvas = document.querySelector('[data-testid="simulation-canvas"]').getBoundingClientRect();
      const tuner = document.querySelector('[data-testid="sim-tuner"]').getBoundingClientRect();
      const ranges = document.querySelectorAll('[data-testid="sim-tuner"] input[type="range"]').length;
      return {
        ranges,
        canvas: { right: canvas.right, height: canvas.height },
        tuner: { left: tuner.left, width: tuner.width },
        overflow: document.documentElement.scrollWidth > innerWidth + 1,
      };
    })()`);
    assert.equal(desktop.ranges, 4, JSON.stringify(desktop));
    assert.ok(desktop.tuner.left >= desktop.canvas.right - 1, JSON.stringify(desktop));
    assert.equal(desktop.overflow, false, JSON.stringify(desktop));
    assert.equal(
      await page.evaluate(`document.querySelector('[data-testid="formula-vs-sim-tone"]').innerText.trim()`),
      "считаем",
    );
    assert.match(
      await page.evaluate(`document.querySelector('[data-testid="formula-vs-sim-run"]').innerText`),
      /—/,
    );

    await waitFor(
      () => page.evaluate(`(${modelElapsedSeconds.toString()})() >= 65`),
      "model time to pass one minute",
      30_000,
    );
    const beforeFlow = await page.evaluate(`(${modelElapsedSeconds.toString()})()`);
    await page.evaluate(`(() => {
      const input = document.querySelector('[data-testid="sim-tune-flow"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '240');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await waitFor(
      () => page.evaluate(`document.querySelector('[data-testid="sim-tune-flow-value"]').value === '240'`),
      "flow value to update",
    );
    await waitFor(
      () => page.evaluate(
        `document.querySelector('[data-testid="simulation-model-explanation"]').innerText.includes('240 оп/ч')`,
      ),
      "debounced flow setting to reach the running model",
    );
    const flowState = await page.evaluate(`(() => ({
      elapsed: (${modelElapsedSeconds.toString()})(),
      explanation: document.querySelector('[data-testid="simulation-model-explanation"]').innerText,
    }))()`);
    assert.ok(flowState.elapsed >= beforeFlow, JSON.stringify({ beforeFlow, flowState }));
    assert.match(flowState.explanation, /240 оп\/ч/, flowState.explanation);
    await waitFor(
      () => page.evaluate(`document.querySelector('[data-testid="formula-vs-sim-tone"]').innerText.trim() !== 'считаем'`),
      "post-warmup formula comparison",
      60_000,
    );
    assert.match(
      await page.evaluate(`document.querySelector('[data-testid="formula-vs-sim-detail"]').innerText`),
      /В прогоне было 3 ед/,
    );

    await page.evaluate(`(() => {
      const input = document.querySelector('[data-testid="sim-tune-battery-hours"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '7.5');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await waitFor(
      () => page.evaluate(`document.querySelector('#sim-tune-battery-hours-number').value === '7.5'`),
      "battery value to update",
    );
    await delay(350);
    const batteryState = await page.evaluate(`(${modelElapsedSeconds.toString()})()`);
    assert.ok(batteryState >= flowState.elapsed, JSON.stringify({ flowState, batteryState }));
    assert.equal(
      await page.evaluate(`document.querySelector('[data-testid="formula-vs-sim-tone"]').innerText.trim()`),
      "считаем",
    );

    await page.evaluate(`(() => {
      const input = document.querySelector('[data-testid="sim-tune-charge-min"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '28');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await waitFor(
      () => page.evaluate(`document.querySelector('#sim-tune-charge-min-number').value === '28'`),
      "charge duration to update",
    );
    await delay(350);
    const chargeState = await page.evaluate(`(${modelElapsedSeconds.toString()})()`);
    assert.ok(chargeState >= batteryState, JSON.stringify({ batteryState, chargeState }));

    await page.evaluate(`(() => {
      const input = document.querySelector('[data-testid="sim-tune-fleet"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '4');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));
    })()`);
    await waitFor(
      () => page.evaluate(`document.querySelector('[data-testid="sim-tune-fleet-value"]').value === '4'`),
      "fleet value to update",
    );
    await waitFor(
      () => page.evaluate(`(${modelElapsedSeconds.toString()})() < 60`),
      "fleet change to restart the model",
    );

    await waitFor(
      () => page.evaluate(`(${modelElapsedSeconds.toString()})() >= 65`),
      "model time after fleet restart",
      30_000,
    );
    await page.evaluate(`document.querySelector('[data-testid="sim-seed-next"]').click()`);
    await waitFor(
      () => page.evaluate(
        `document.querySelector('[data-testid="sim-seed-next"]').innerText.includes('seed 7')`,
      ),
      "day seed to advance",
    );
    await waitFor(
      () => page.evaluate(`(${modelElapsedSeconds.toString()})() < 60`),
      "day change to restart the model",
    );

    await openDemo({ width: 390, height: 844, mobile: true });
    const mobile = await page.evaluate(`(() => {
      const canvas = document.querySelector('[data-testid="simulation-canvas"]').getBoundingClientRect();
      const tuner = document.querySelector('[data-testid="sim-tuner"]').getBoundingClientRect();
      const chargeRange = document.querySelector('[data-testid="sim-tune-charge-min"]');
      const chargeValue = document.querySelector('#sim-tune-charge-min-number');
      return {
        width: innerWidth,
        canvas: { height: canvas.height, bottom: canvas.bottom },
        tuner: { top: tuner.top, width: tuner.width },
        panelBelowCanvas: tuner.top > canvas.bottom,
        overflow: document.documentElement.scrollWidth > innerWidth + 1,
        rangeCount: document.querySelectorAll('[data-testid="sim-tuner"] input[type="range"]').length,
        chargeMin: chargeRange.min,
        chargeValue: chargeValue?.value ?? null,
      };
    })()`);
    assert.equal(mobile.width, 390, JSON.stringify(mobile));
    assert.ok(mobile.canvas.height >= 240, JSON.stringify(mobile));
    assert.ok(mobile.panelBelowCanvas, JSON.stringify(mobile));
    assert.equal(mobile.overflow, false, JSON.stringify(mobile));
    assert.equal(mobile.rangeCount, 4, JSON.stringify(mobile));
    assert.equal(mobile.chargeMin, mobile.chargeValue, JSON.stringify(mobile));
    assert.deepEqual(page.errors, []);
  } finally {
    page?.socket.close();
    await stop(browser);
    await stop(server);
    await rm(profile, { recursive: true, force: true });
  }
});
