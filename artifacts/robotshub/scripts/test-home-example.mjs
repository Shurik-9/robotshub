// Run: node --test scripts/test-home-example.mjs (requires Chromium on PATH).
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
const port = Number(process.env.HOME_EXAMPLE_PORT ?? 4188);
const debugPort = Number(process.env.HOME_EXAMPLE_DEBUG_PORT ?? 9398);
const baseUrl = process.env.HOME_EXAMPLE_URL?.replace(/\/$/, "") ?? `http://127.0.0.1:${port}`;
const viewports = [
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
  { width: 844, height: 390 },
  { width: 667, height: 375 },
];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitFor(check, description, timeout = 20_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await check()) return;
    await delay(80);
  }
  throw new Error(`Timed out: ${description}`);
}

async function ready(url) {
  try { return (await fetch(url, { signal: AbortSignal.timeout(1500) })).ok; }
  catch { return false; }
}

async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  const signal = name => {
    try { process.kill(-child.pid, name); }
    catch (error) { if (error.code !== "ESRCH") throw error; }
  };
  signal("SIGTERM");
  await Promise.race([exited, delay(1500)]);
  signal("SIGKILL");
  await exited;
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
      }, 10_000);
      this.pending.set(id, { resolve, reject, timer });
    });
    this.socket.send(JSON.stringify({ id, method, params }));
    return result;
  }

  async evaluate(fn, argument) {
    const result = await this.command("Runtime.evaluate", {
      expression: `(${fn})(${JSON.stringify(argument)})`,
      returnByValue: true,
      awaitPromise: true,
    });
    assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }

  async click({ x, y }) {
    await this.command("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    for (const type of ["mousePressed", "mouseReleased"]) {
      await this.command("Input.dispatchMouseEvent", {
        type, x, y, button: "left", clickCount: 1,
      });
    }
  }
}

function inspectLayout() {
  const iframe = document.querySelector('[data-testid="iframe-robotization-map"]');
  const doc = iframe.contentDocument;
  const frame = iframe.getBoundingClientRect();
  const section = document.querySelector('[data-testid="page-robotization-map"]').getBoundingClientRect();
  return {
    iframe: { x: frame.x, y: frame.y, width: frame.width, height: frame.height },
    section: { width: section.width, height: section.height },
    viewport: { width: visualViewport.width, height: visualViewport.height },
    exampleVisible: !!document.querySelector('[data-testid="home-case-example-overlay"]'),
    exampleTextVisible: doc.body.innerText.includes("Найдите свою отрасль:")
      || doc.body.innerText.includes("Кликните на любой элемент"),
    mapRecords: doc.querySelectorAll(".map [data-id]").length,
    tabsPresent: !!doc.querySelector(".tabs"),
  };
}

test("Removed map introduction leaves the whole map visible and interactive at all breakpoints", { timeout: 120_000 }, async t => {
  let server, browser, page;
  const profile = await mkdtemp(path.join(tmpdir(), "robotshub-home-example-"));
  try {
    if (!process.env.HOME_EXAMPLE_URL) {
      server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--config", "vite.config.ts"], {
        cwd: root, env: { ...process.env, PORT: String(port), BASE_PATH: "/" },
        detached: true, stdio: "ignore",
      });
    }
    await waitFor(() => ready(`${baseUrl}/`), "Vite");
    browser = spawn(resolveChromiumPath(), [
      "--headless", "--no-sandbox", "--disable-dev-shm-usage",
      `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, "about:blank",
    ], { detached: true, stdio: "ignore" });
    await waitFor(() => ready(`http://127.0.0.1:${debugPort}/json/version`), "Chromium");
    const target = await (await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: "PUT" })).json();
    page = new Page(target.webSocketDebuggerUrl);
    await page.command("Page.enable");
    await page.command("Runtime.enable");

    for (const viewport of viewports) {
      await t.test(`${viewport.width}×${viewport.height}`, async () => {
        await page.command("Emulation.setDeviceMetricsOverride", {
          ...viewport, deviceScaleFactor: 1, mobile: viewport.width < 768,
        });
        await page.command("Page.navigate", { url: `${baseUrl}/map` });
        await waitFor(() => page.evaluate(() => {
          const doc = document.querySelector("iframe")?.contentDocument;
          return !!doc?.querySelector(".map [data-id]") && !!doc?.querySelector(".partners-strip");
        }), "home and map loaded");
        await page.evaluate(async () => {
          await document.fonts.ready;
          await document.querySelector("iframe").contentDocument.fonts.ready;
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        });

        const layout = await page.evaluate(inspectLayout);
        assert.equal(layout.exampleVisible, false);
        assert.equal(layout.exampleTextVisible, false);
        assert.ok(layout.mapRecords > 0);
        assert.equal(layout.tabsPresent, true);
        assert.ok(layout.iframe.height > 0, JSON.stringify(layout));
        assert.ok(Math.abs(layout.iframe.height - layout.section.height) < 1, JSON.stringify(layout));

        // A real pointer event outside the button must reach the map document.
        const point = await page.evaluate(() => {
          const iframe = document.querySelector("iframe");
          const frame = iframe.getBoundingClientRect();
          const x = frame.right - 3;
          const y = frame.y + frame.height / 2;
          iframe.contentDocument.addEventListener("pointerdown", () => { window.__mapPointerReceived = true; }, { once: true });
          return { x, y, hitsIframe: document.elementFromPoint(x, y) === iframe };
        });
        assert.ok(point.hitsIframe, "Map area outside the button must hit the iframe");
        await page.click(point);
        assert.equal(await page.evaluate(() => window.__mapPointerReceived), true);

        // Exercise an actual map control and verify its state change.
        const control = await page.evaluate(() => {
          const iframe = document.querySelector("iframe");
          const button = iframe.contentDocument.querySelector('.tab[data-v="trl"]');
          button.scrollIntoView({ block: "center" });
          const frame = iframe.getBoundingClientRect(), rect = button.getBoundingClientRect();
          return { x: frame.x + rect.x + rect.width / 2, y: frame.y + rect.y + rect.height / 2 };
        });
        await page.click(control);
        await waitFor(() => page.evaluate(() =>
          document.querySelector("iframe").contentDocument.querySelector('.tab[data-v="trl"]').classList.contains("on")
            && document.querySelector("iframe").contentDocument.querySelector("#v-trl").classList.contains("on")
        ), "map maturity tab responds with the full map area available");
        const scrolled = await page.evaluate(inspectLayout);
        assert.equal(scrolled.exampleVisible, false);
        assert.equal(scrolled.exampleTextVisible, false);
        assert.ok(Math.abs(scrolled.iframe.height - scrolled.section.height) < 1, JSON.stringify(scrolled));

        if (viewport.width === 1440) {
          await page.command("Page.navigate", { url: `${baseUrl}/` });
          await waitFor(() => page.evaluate(() =>
            !!document.querySelector('[data-testid="page-home"] .ops-partner-logo')
          ), "home partner strip renders");
          await page.command("Emulation.setEmulatedMedia", {
            features: [{ name: "prefers-reduced-motion", value: "reduce" }],
          });
          const before = await page.evaluate(() => ({
            x: document.querySelector(".ops-partner-logo").getBoundingClientRect().x,
            duration: getComputedStyle(document.querySelector(".ops-partners-track")).animationDuration,
            pauseButton: !!document.querySelector('[data-testid="button-pause-partners"]'),
            removedHeading: document.body.innerText.includes("Организации, упомянутые в открытых материалах"),
          }));
          await new Promise(resolve => setTimeout(resolve, 1000));
          const after = await page.evaluate(() => document.querySelector(".ops-partner-logo").getBoundingClientRect().x);
          assert.equal(before.duration, "36s");
          assert.equal(before.pauseButton, true);
          assert.equal(before.removedHeading, false);
          assert.ok(Math.abs(after - before.x) > 10 && Math.abs(after - before.x) < 100,
            `Partner logos should move smoothly with reduced motion enabled: ${before.x} → ${after}`);
        }
      });
    }
    assert.deepEqual(page.errors, [], "Unhandled browser exceptions");
  } finally {
    page?.socket.close();
    await stop(browser);
    await stop(server);
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
