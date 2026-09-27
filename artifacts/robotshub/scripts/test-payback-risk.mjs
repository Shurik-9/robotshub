import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { test } from "node:test";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveChromiumPath } from "./chromium-path.mjs";
import warehouseTemplate from "../src/data/object-templates/warehouse.json" with { type: "json" };
import airportTemplate from "../src/data/object-templates/airport.json" with { type: "json" };
import medicalTemplate from "../src/data/object-templates/medical.json" with { type: "json" };
import solutionsData from "../src/data/solutions.json" with { type: "json" };

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const port = Number(process.env.PAYBACK_RISK_BROWSER_PORT ?? 4176);
const baseUrl = process.env.PAYBACK_RISK_BROWSER_URL?.replace(/\/$/, "") ?? `http://127.0.0.1:${port}`;

class DevToolsPage {
  #nextId = 1;
  #pending = new Map();
  #browserErrors = [];
  #ready;

  constructor(webSocketUrl) {
    this.socket = new WebSocket(webSocketUrl);
    this.#ready = new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", ({ data }) => {
      const message = JSON.parse(data);
      if (!message.id) {
        if (message.method === "Runtime.exceptionThrown") {
          this.#browserErrors.push(
            message.params?.exceptionDetails?.exception?.description
              ?? message.params?.exceptionDetails?.text
              ?? "Необработанное исключение браузера",
          );
        }
        if (message.method === "Log.entryAdded" && message.params?.entry?.level === "error") {
          this.#browserErrors.push(message.params.entry.text ?? "Ошибка браузера");
        }
        return;
      }
      const pending = this.#pending.get(message.id);
      if (!pending) return;
      this.#pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
  }

  async command(method, params = {}) {
    await this.#ready;
    const id = this.#nextId++;
    const result = new Promise((resolve, reject) => this.#pending.set(id, { resolve, reject }));
    this.socket.send(JSON.stringify({ id, method, params }));
    return result;
  }

  async enableBrowserDiagnostics() {
    await this.command("Runtime.enable");
    await this.command("Log.enable");
  }

  clearBrowserErrors() {
    this.#browserErrors = [];
  }

  browserErrors() {
    return [...this.#browserErrors];
  }

  async evaluate(fn, argument) {
    const result = await this.command("Runtime.evaluate", {
      expression: `(${fn.toString()})(${JSON.stringify(argument)})`,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(
        result.exceptionDetails.exception?.description
          ?? result.exceptionDetails.exception?.value
          ?? result.exceptionDetails.text
          ?? "Ошибка браузера",
      );
    }
    return result.result?.value;
  }

  async waitFor(fn, argument, timeoutMs = 10_000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (await this.evaluate(fn, argument)) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error(`Браузер не дождался состояния за ${timeoutMs} мс`);
  }

  async pressKey(key, code, keyCode) {
    await this.command("Input.dispatchKeyEvent", {
      type: "keyDown",
      key,
      code,
      windowsVirtualKeyCode: keyCode,
      nativeVirtualKeyCode: keyCode,
    });
    await this.command("Input.dispatchKeyEvent", {
      type: "keyUp",
      key,
      code,
      windowsVirtualKeyCode: keyCode,
      nativeVirtualKeyCode: keyCode,
    });
  }

  close() {
    this.socket.close();
  }
}

async function waitForUrl(url, timeoutMs = 20_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // Сервер ещё запускается.
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Сервер RobotsHub не ответил: ${url}`);
}

async function openDevToolsPage(debugPort, url) {
  const response = await fetch(
    `http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(url)}`,
    { method: "PUT" },
  );
  if (!response.ok) {
    throw new Error(`Chromium не открыл новую вкладку: HTTP ${response.status}`);
  }
  return response.json();
}

async function stopChild(child, killProcessGroup = false) {
  if (!child || child.exitCode !== null) return;
  const sendSignal = (signal) => {
    try {
      if (killProcessGroup && child.pid) {
        process.kill(-child.pid, signal);
      } else {
        child.kill(signal);
      }
    } catch {
      // Процесс мог завершиться между проверкой и отправкой сигнала.
    }
  };
  try {
    sendSignal("SIGTERM");
  } catch {}
  await Promise.race([once(child, "exit"), new Promise(resolve => setTimeout(resolve, 1_000))]);
  if (child.exitCode === null) {
    sendSignal("SIGKILL");
    await Promise.race([once(child, "exit"), new Promise(resolve => setTimeout(resolve, 1_000))]);
  }
}

async function startApp() {
  try {
    await waitForUrl(`${baseUrl}/`);
    return null;
  } catch {
    if (process.env.PAYBACK_RISK_BROWSER_URL) {
      throw new Error(`PAYBACK_RISK_BROWSER_URL недоступен: ${baseUrl}`);
    }
  }

  const server = spawn("pnpm", ["run", "dev"], {
    cwd: projectRoot,
    env: { ...process.env, BASE_PATH: "/", PORT: String(port) },
    stdio: "ignore",
  });
  try {
    await waitForUrl(`${baseUrl}/`);
  } catch (error) {
    await stopChild(server);
    throw error;
  }
  return server;
}

async function startChromium(extraArgs = [], debugPortOverride) {
  const debugPort = debugPortOverride ?? Number(process.env.PAYBACK_RISK_DEBUG_PORT ?? 9226);
  const userDataDir = await mkdtemp(path.join(tmpdir(), "robotshub-payback-risk-"));
  const chromium = resolveChromiumPath();
  const browser = spawn(chromium, [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${userDataDir}`,
    ...extraArgs,
    "about:blank",
    ], { stdio: "ignore", detached: true });

  try {
    await waitForUrl(`http://127.0.0.1:${debugPort}/json/list`);
    const pages = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
    const pageInfo = pages.find(({ type }) => type === "page");
    assert.ok(pageInfo?.webSocketDebuggerUrl, "Chromium не открыл страницу DevTools");
    return {
      browser,
      userDataDir,
      debugPort,
      page: new DevToolsPage(pageInfo.webSocketDebuggerUrl),
    };
  } catch (error) {
    await stopChild(browser, true);
    await rm(userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    throw error;
  }
}

async function setMobileViewport(chromium) {
  await chromium.page.command("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await chromium.page.command("Emulation.setTouchEmulationEnabled", {
    enabled: true,
    maxTouchPoints: 5,
  });
}

async function setViewport(chromium, { width, height, mobile }) {
  await chromium.page.command("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile,
  });
  await chromium.page.command(
    "Emulation.setTouchEmulationEnabled",
    mobile ? { enabled: true, maxTouchPoints: 5 } : { enabled: false },
  );
}

async function assertObjectSetupFitsViewport(chromium, templateName, groupId) {
  const layout = await chromium.page.evaluate(() => {
    const viewport = window.innerWidth;
    const page = document.querySelector('[data-testid="page-object-setup"]');
    const groups = document.querySelector('[data-testid="object-groups"]');
    const content = [
      document.querySelector('[data-testid="object-setup-form"]'),
      document.querySelector('[data-testid="object-setup-card"]'),
      ...document.querySelectorAll('[data-testid^="object-field-"]'),
      ...document.querySelectorAll('[data-testid="object-next-step"], [data-testid="object-submit"]'),
    ].filter(Boolean);
    const measure = (element) => {
      const rect = element.getBoundingClientRect();
      return {
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        left: rect.left,
        right: rect.right,
      };
    };

    return {
      viewport,
      documentScrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      hasErrorBoundary: document.body.textContent?.includes("Something went wrong") ?? false,
      page: page ? measure(page) : null,
      groups: groups ? measure(groups) : null,
      content: content.map(measure),
    };
  });
  const tolerance = 1;
  const boundaryWidths = [
    layout.page,
    layout.groups,
    ...layout.content,
  ].filter(Boolean);
  const overflowing = boundaryWidths.some(item => (
    item.left < -tolerance
      || item.right > layout.viewport + tolerance
  ));
  const contentOverflowing = layout.content.some(item => item.scrollWidth > item.clientWidth + tolerance);
  assert.equal(
    overflowing || contentOverflowing,
    false,
    `${templateName}, группа ${groupId}: содержимое должно помещаться в viewport 390px (${JSON.stringify(layout)})`,
  );
  assert.ok(
    layout.documentScrollWidth <= layout.viewport + tolerance,
    `${templateName}, группа ${groupId}: document не должен иметь горизонтального overflow (${JSON.stringify(layout)})`,
  );
  assert.ok(
    layout.bodyScrollWidth <= layout.viewport + tolerance,
    `${templateName}, группа ${groupId}: body не должен иметь горизонтального overflow (${JSON.stringify(layout)})`,
  );
  assert.equal(
    layout.hasErrorBoundary,
    false,
    `${templateName}, группа ${groupId}: страница параметров не должна показывать ErrorBoundary`,
  );
}

async function assertInfoTooltipFitsViewport(chromium, templateName, fieldKey, expectedNote) {
  const selector = `[data-testid="object-field-${fieldKey}"]`;
  await chromium.page.evaluate(fieldSelector => {
    const trigger = document.querySelector(`${fieldSelector} label button`);
    if (!(trigger instanceof HTMLButtonElement)) {
      throw new Error(`Подсказка параметра не найдена: ${fieldSelector}`);
    }
    trigger.focus();
    trigger.dispatchEvent(new PointerEvent("pointermove", {
      bubbles: true,
      pointerId: 1,
      pointerType: "mouse",
    }));
    trigger.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
  }, selector);
  await chromium.page.waitFor(
    () => document.querySelector('[role="tooltip"]') !== null,
  );

  const layout = await chromium.page.evaluate(fieldSelector => {
    const viewport = window.innerWidth;
    const tooltip = document.querySelector(`${fieldSelector} [role="tooltip"]`)
      ?? document.querySelector('[role="tooltip"]');
    const rect = tooltip?.getBoundingClientRect();
    return {
      viewport,
      tooltip: tooltip && rect ? {
        text: tooltip.textContent?.trim() ?? "",
        clientWidth: tooltip.clientWidth,
        scrollWidth: tooltip.scrollWidth,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
      } : null,
      documentScrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      hasErrorBoundary: document.body.textContent?.includes("Something went wrong") ?? false,
    };
  }, selector);

  const tolerance = 1;
  assert.ok(
    layout.tooltip,
    `${templateName}, ${fieldKey}: подсказка должна открываться на мобильной ширине`,
  );
  assert.equal(
    layout.tooltip.text,
    expectedNote,
    `${templateName}, ${fieldKey}: подсказка должна содержать заметку параметра`,
  );
  assert.ok(
    layout.tooltip.left >= -tolerance && layout.tooltip.right <= layout.viewport + tolerance,
    `${templateName}, ${fieldKey}: подсказка должна оставаться в пределах viewport (${JSON.stringify(layout)})`,
  );
  assert.ok(
    layout.tooltip.scrollWidth <= layout.tooltip.clientWidth + tolerance,
    `${templateName}, ${fieldKey}: текст подсказки должен переноситься внутри блока (${JSON.stringify(layout)})`,
  );
  assert.ok(
    layout.documentScrollWidth <= layout.viewport + tolerance,
    `${templateName}, ${fieldKey}: подсказка не должна создавать горизонтальный overflow документа (${JSON.stringify(layout)})`,
  );
  assert.ok(
    layout.bodyScrollWidth <= layout.viewport + tolerance,
    `${templateName}, ${fieldKey}: подсказка не должна создавать горизонтальный overflow body (${JSON.stringify(layout)})`,
  );
  assert.equal(
    layout.hasErrorBoundary,
    false,
    `${templateName}, ${fieldKey}: открытая подсказка не должна показывать ErrorBoundary`,
  );
}

async function assertEnumDropdownFitsViewport(chromium, templateName, fieldKey, expectedValue) {
  const selector = `[data-testid="object-field-${fieldKey}"]`;
  await chromium.page.evaluate(fieldSelector => {
    const trigger = document.querySelector(`${fieldSelector} [role="combobox"]`);
    if (!(trigger instanceof HTMLElement)) {
      throw new Error(`Список параметров не найден: ${fieldSelector}`);
    }
    trigger.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true,
      button: 0,
      pointerId: 1,
      pointerType: "mouse",
    }));
    trigger.dispatchEvent(new PointerEvent("pointerup", {
      bubbles: true,
      button: 0,
      pointerId: 1,
      pointerType: "mouse",
    }));
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  }, selector);
  await chromium.page.waitFor(
    fieldSelector => document.querySelector(`${fieldSelector} [role="combobox"]`)?.getAttribute("aria-expanded") === "true"
      && document.querySelector('[role="listbox"]') !== null,
    selector,
  );

  const layout = await chromium.page.evaluate(({ fieldSelector, value }) => {
    const viewport = window.innerWidth;
    const trigger = document.querySelector(`${fieldSelector} [role="combobox"]`);
    const listbox = document.querySelector('[role="listbox"]');
    const option = [...document.querySelectorAll('[role="option"]')]
      .find(candidate => candidate.textContent?.trim() === value);
    const measure = (element) => {
      if (!(element instanceof HTMLElement)) return null;
      const rect = element.getBoundingClientRect();
      return {
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      };
    };

    return {
      viewport,
      selectedValue: trigger?.textContent?.trim() ?? "",
      trigger: measure(trigger),
      listbox: measure(listbox),
      option: measure(option),
      documentScrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      hasErrorBoundary: document.body.textContent?.includes("Something went wrong") ?? false,
    };
  }, { fieldSelector: selector, value: expectedValue });

  const tolerance = 1;
  for (const [name, bounds] of [["trigger", layout.trigger], ["listbox", layout.listbox], ["option", layout.option]]) {
    assert.ok(bounds, `${templateName}, ${fieldKey}: ${name} должен оставаться доступным при открытом списке`);
    assert.ok(
      bounds.left >= -tolerance && bounds.right <= layout.viewport + tolerance,
      `${templateName}, ${fieldKey}: ${name} не должен выходить за viewport (${JSON.stringify(layout)})`,
    );
  }
  assert.ok(
    layout.listbox.scrollWidth <= layout.viewport + tolerance,
    `${templateName}, ${fieldKey}: открытый список не должен создавать горизонтальный overflow (${JSON.stringify(layout)})`,
  );
  assert.ok(
    layout.documentScrollWidth <= layout.viewport + tolerance,
    `${templateName}, ${fieldKey}: document не должен иметь горизонтального overflow при открытом списке (${JSON.stringify(layout)})`,
  );
  assert.ok(
    layout.bodyScrollWidth <= layout.viewport + tolerance,
    `${templateName}, ${fieldKey}: body не должен иметь горизонтального overflow при открытом списке (${JSON.stringify(layout)})`,
  );
  assert.ok(
    layout.selectedValue.length > 0,
    `${templateName}, ${fieldKey}: текущее выбранное значение должно быть видно при открытом списке (${JSON.stringify(layout)})`,
  );
  assert.equal(
    layout.hasErrorBoundary,
    false,
    `${templateName}, ${fieldKey}: открытый список не должен показывать ErrorBoundary`,
  );

  await chromium.page.evaluate(value => {
    const option = [...document.querySelectorAll('[role="option"]')]
      .find(candidate => candidate.textContent?.trim() === value);
    if (!(option instanceof HTMLElement)) {
      throw new Error(`Вариант списка не найден: ${value}`);
    }
    option.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true,
      button: 0,
      pointerId: 1,
      pointerType: "mouse",
    }));
    option.dispatchEvent(new PointerEvent("pointerup", {
      bubbles: true,
      button: 0,
      pointerId: 1,
      pointerType: "mouse",
    }));
    option.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  }, expectedValue);
  await chromium.page.waitFor(
    ({ fieldSelector, value }) => document.querySelector(`${fieldSelector} [role="combobox"]`)?.getAttribute("aria-expanded") !== "true"
      && document.querySelector(`${fieldSelector} [role="combobox"]`)?.textContent?.includes(value),
    { fieldSelector: selector, value: expectedValue },
  );
}

async function assertEnumDropdownAtViewportBottom(chromium, templateName, field, expectedValue) {
  const selector = `[data-testid="object-field-${field.key}"]`;
  const positioned = await chromium.page.evaluate(fieldSelector => {
    const trigger = document.querySelector(`${fieldSelector} [role="combobox"]`);
    if (!(trigger instanceof HTMLElement)) {
      throw new Error(`Список параметров не найден: ${fieldSelector}`);
    }
    trigger.scrollIntoView({ block: "end", inline: "nearest" });
    const rect = trigger.getBoundingClientRect();
    return {
      scrollY: window.scrollY,
      triggerBottom: rect.bottom,
      viewportHeight: window.innerHeight,
    };
  }, selector);
  assert.ok(
    positioned.triggerBottom > positioned.viewportHeight / 2,
    `${templateName}, ${field.key}: enum-триггер должен находиться в нижней части viewport после прокрутки (${JSON.stringify(positioned)})`,
  );

  await chromium.page.evaluate(fieldSelector => {
    const trigger = document.querySelector(`${fieldSelector} [role="combobox"]`);
    if (!(trigger instanceof HTMLElement)) {
      throw new Error(`Список параметров не найден: ${fieldSelector}`);
    }
    trigger.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true,
      button: 0,
      pointerId: 1,
      pointerType: "touch",
    }));
    trigger.dispatchEvent(new PointerEvent("pointerup", {
      bubbles: true,
      button: 0,
      pointerId: 1,
      pointerType: "touch",
    }));
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  }, selector);
  await chromium.page.waitFor(
    fieldSelector => document.querySelector(`${fieldSelector} [role="combobox"]`)?.getAttribute("aria-expanded") === "true"
      && document.querySelector('[role="listbox"]') !== null,
    selector,
  );

  const layout = await chromium.page.evaluate(({ fieldSelector }) => {
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const trigger = document.querySelector(`${fieldSelector} [role="combobox"]`);
    const listbox = document.querySelector('[role="listbox"]');
    const measure = (element) => {
      if (!(element instanceof HTMLElement)) return null;
      const rect = element.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
      };
    };
    return {
      viewport,
      trigger: measure(trigger),
      listbox: measure(listbox),
      options: [...document.querySelectorAll('[role="listbox"] [role="option"]')]
        .map(option => ({ value: option.textContent?.trim() ?? "", bounds: measure(option) })),
      documentScrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      scrollY: window.scrollY,
      hasErrorBoundary: document.body.textContent?.includes("Something went wrong") ?? false,
    };
  }, { fieldSelector: selector });

  const tolerance = 1;
  assert.equal(
    layout.options.length,
    field.options.length,
    `${templateName}, ${field.key}: открытый список должен содержать все варианты (${JSON.stringify(layout)})`,
  );
  for (const option of layout.options) {
    assert.ok(
      option.bounds
        && option.bounds.left >= -tolerance
        && option.bounds.right <= layout.viewport.width + tolerance
        && option.bounds.top >= -tolerance
        && option.bounds.bottom <= layout.viewport.height + tolerance,
      `${templateName}, ${field.key}: вариант «${option.value}» должен быть видимым в viewport (${JSON.stringify(layout)})`,
    );
  }
  assert.ok(
    layout.listbox
      && layout.listbox.left >= -tolerance
      && layout.listbox.right <= layout.viewport.width + tolerance
      && layout.listbox.top >= -tolerance
      && layout.listbox.bottom <= layout.viewport.height + tolerance,
    `${templateName}, ${field.key}: список должен открыться полностью или перевернуться вверх у нижнего края (${JSON.stringify(layout)})`,
  );
  assert.ok(
    layout.documentScrollWidth <= layout.viewport.width + tolerance
      && layout.bodyScrollWidth <= layout.viewport.width + tolerance,
    `${templateName}, ${field.key}: открытие списка не должно создавать горизонтальный overflow (${JSON.stringify(layout)})`,
  );
  assert.equal(
    layout.hasErrorBoundary,
    false,
    `${templateName}, ${field.key}: открытый список не должен показывать ErrorBoundary`,
  );

  await chromium.page.evaluate(value => {
    const option = [...document.querySelectorAll('[role="option"]')]
      .find(candidate => candidate.textContent?.trim() === value);
    if (!(option instanceof HTMLElement)) {
      throw new Error(`Вариант списка не найден: ${value}`);
    }
    option.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true,
      button: 0,
      pointerId: 1,
      pointerType: "touch",
    }));
    option.dispatchEvent(new PointerEvent("pointerup", {
      bubbles: true,
      button: 0,
      pointerId: 1,
      pointerType: "touch",
    }));
    option.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  }, expectedValue);
  await chromium.page.waitFor(
    ({ fieldSelector, value }) => document.querySelector(`${fieldSelector} [role="combobox"]`)?.getAttribute("aria-expanded") !== "true"
      && document.querySelector(`${fieldSelector} [role="combobox"]`)?.textContent?.includes(value),
    { fieldSelector: selector, value: expectedValue },
  );

  const afterSelection = await chromium.page.evaluate(fieldSelector => ({
    scrollY: window.scrollY,
    hasErrorBoundary: document.body.textContent?.includes("Something went wrong") ?? false,
    listboxOpen: document.querySelector(`${fieldSelector} [role="combobox"]`)?.getAttribute("aria-expanded") === "true",
  }), selector);
  assert.ok(
    Math.abs(afterSelection.scrollY - positioned.scrollY) <= 1,
    `${templateName}, ${field.key}: выбор значения не должен менять scroll-позицию (${JSON.stringify({ positioned, afterSelection })})`,
  );
  assert.equal(
    afterSelection.listboxOpen,
    false,
    `${templateName}, ${field.key}: выбор значения должен закрыть список`,
  );
  assert.equal(
    afterSelection.hasErrorBoundary,
    false,
    `${templateName}, ${field.key}: после выбора не должен показываться ErrorBoundary`,
  );
}

async function assertEnumKeyboardControls(chromium, templateName, fieldKey) {
  const selector = `[data-testid="object-field-${fieldKey}"]`;
  const focused = await chromium.page.evaluate(fieldSelector => {
    const trigger = document.querySelector(`${fieldSelector} [role="combobox"]`);
    if (!(trigger instanceof HTMLElement)) {
      throw new Error(`Список параметров не найден: ${fieldSelector}`);
    }
    trigger.focus();
    return document.activeElement === trigger;
  }, selector);
  assert.equal(
    focused,
    true,
    `${templateName}, ${fieldKey}: trigger enum-списка должен получать фокус`,
  );

  await chromium.page.pressKey("Enter", "Enter", 13);
  await chromium.page.waitFor(
    fieldSelector => document.querySelector(`${fieldSelector} [role="combobox"]`)?.getAttribute("aria-expanded") === "true"
      && document.querySelector('[role="listbox"]') !== null,
    selector,
  );
  await chromium.page.waitFor(
    () => document.activeElement?.getAttribute("role") === "option",
  );

  const opened = await chromium.page.evaluate(fieldSelector => {
    const trigger = document.querySelector(`${fieldSelector} [role="combobox"]`);
    const listbox = document.querySelector('[role="listbox"]');
    const activeId = trigger?.getAttribute("aria-activedescendant");
    const activeOption = (activeId && document.getElementById(activeId))
      ?? listbox?.querySelector('[role="option"][data-highlighted]')
      ?? (document.activeElement?.getAttribute("role") === "option" ? document.activeElement : null);
    return {
      selected: trigger?.textContent?.trim() ?? "",
      active: activeOption?.textContent?.trim() ?? "",
      options: [...(listbox?.querySelectorAll('[role="option"]') ?? [])]
        .map(option => option.textContent?.trim() ?? ""),
    };
  }, selector);
  assert.ok(
    opened.options.length > 1,
    `${templateName}, ${fieldKey}: enum-список должен содержать несколько вариантов`,
  );
  const initialActive = opened.options.find(option => opened.selected.includes(option)) ?? opened.active;

  await chromium.page.pressKey("ArrowDown", "ArrowDown", 40);
  await chromium.page.waitFor(
    ({ fieldSelector, previousActive }) => {
      const trigger = document.querySelector(`${fieldSelector} [role="combobox"]`);
      const activeId = trigger?.getAttribute("aria-activedescendant");
      const active = (
        (activeId && document.getElementById(activeId))
          ?? document.querySelector('[role="listbox"] [role="option"][data-highlighted]')
          ?? (document.activeElement?.getAttribute("role") === "option" ? document.activeElement : null)
      )?.textContent?.trim() ?? "";
      return active.length > 0 && active !== previousActive;
    },
    { fieldSelector: selector, previousActive: initialActive },
  );
  const moved = await chromium.page.evaluate(fieldSelector => {
    const trigger = document.querySelector(`${fieldSelector} [role="combobox"]`);
    const activeId = trigger?.getAttribute("aria-activedescendant");
    const active = (activeId && document.getElementById(activeId))
      ?? document.querySelector('[role="listbox"] [role="option"][data-highlighted]')
      ?? (document.activeElement?.getAttribute("role") === "option" ? document.activeElement : null);
    return {
      active: active?.textContent?.trim() ?? "",
      options: [...document.querySelectorAll('[role="listbox"] [role="option"]')]
        .map(option => option.textContent?.trim() ?? ""),
    };
  }, selector);
  assert.ok(
    moved.options.includes(moved.active),
    `${templateName}, ${fieldKey}: ArrowDown должен переместить активный вариант`,
  );
  assert.notEqual(
    moved.active,
    opened.active,
    `${templateName}, ${fieldKey}: ArrowDown должен изменить активный вариант`,
  );

  await chromium.page.pressKey("Enter", "Enter", 13);
  await chromium.page.waitFor(
    ({ fieldSelector, value }) => document.querySelector(`${fieldSelector} [role="combobox"]`)?.getAttribute("aria-expanded") !== "true"
      && document.querySelector(`${fieldSelector} [role="combobox"]`)?.textContent?.includes(value),
    { fieldSelector: selector, value: moved.active },
  );

  const keyboardLayout = await chromium.page.evaluate(fieldSelector => {
    const trigger = document.querySelector(`${fieldSelector} [role="combobox"]`);
    if (!(trigger instanceof HTMLElement)) {
      throw new Error(`Список параметров не найден после выбора: ${fieldSelector}`);
    }
    trigger.focus();
    return {
      focused: document.activeElement === trigger,
      selected: trigger.textContent?.trim() ?? "",
    };
  }, selector);
  assert.equal(
    keyboardLayout.focused,
    true,
    `${templateName}, ${fieldKey}: после выбора trigger должен вернуть фокус`,
  );
  assert.ok(
    keyboardLayout.selected.includes(moved.active),
    `${templateName}, ${fieldKey}: выбранный вариант должен сохраниться в trigger`,
  );

  await chromium.page.pressKey(" ", "Space", 32);
  await chromium.page.waitFor(
    fieldSelector => document.querySelector(`${fieldSelector} [role="combobox"]`)?.getAttribute("aria-expanded") === "true",
    selector,
  );
  const openLayout = await chromium.page.evaluate(fieldSelector => {
    const listbox = document.querySelector('[role="listbox"]');
    const rect = listbox?.getBoundingClientRect();
    return {
      viewport: window.innerWidth,
      listbox: rect ? { left: rect.left, right: rect.right, scrollWidth: listbox.scrollWidth } : null,
      documentScrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      hasErrorBoundary: document.body.textContent?.includes("Something went wrong") ?? false,
    };
  }, selector);
  const tolerance = 1;
  assert.ok(
    openLayout.listbox,
    `${templateName}, ${fieldKey}: Space должен открыть список`,
  );
  assert.ok(
    openLayout.listbox.left >= -tolerance && openLayout.listbox.right <= openLayout.viewport + tolerance,
    `${templateName}, ${fieldKey}: список, открытый клавиатурой, должен помещаться в viewport (${JSON.stringify(openLayout)})`,
  );
  assert.ok(
    openLayout.listbox.scrollWidth <= openLayout.viewport + tolerance,
    `${templateName}, ${fieldKey}: список, открытый клавиатурой, не должен создавать горизонтальный overflow (${JSON.stringify(openLayout)})`,
  );
  assert.ok(
    openLayout.documentScrollWidth <= openLayout.viewport + tolerance
      && openLayout.bodyScrollWidth <= openLayout.viewport + tolerance,
    `${templateName}, ${fieldKey}: клавиатурное открытие не должно создавать горизонтальный overflow страницы (${JSON.stringify(openLayout)})`,
  );
  assert.equal(
    openLayout.hasErrorBoundary,
    false,
    `${templateName}, ${fieldKey}: клавиатурное открытие не должно показывать ErrorBoundary`,
  );

  await chromium.page.pressKey("Escape", "Escape", 27);
  await chromium.page.waitFor(
    ({ fieldSelector, value }) => document.querySelector(`${fieldSelector} [role="combobox"]`)?.getAttribute("aria-expanded") !== "true"
      && document.querySelector(`${fieldSelector} [role="combobox"]`)?.textContent?.includes(value),
    { fieldSelector: selector, value: moved.active },
  );
}

const objectParams = Object.fromEntries(
  warehouseTemplate.groups.flatMap(group => group.fields.map(field => [field.key, field.base])),
);
const templateParams = template => Object.fromEntries(
  template.groups.flatMap(group => group.fields.map(field => [field.key, field.base])),
);
const selectedSolution = solutionsData.items.find(solution => solution.name === "Геоскан 701 Видео");
assert.ok(selectedSolution?.id, "в каталоге должна быть тестовая модель «Геоскан 701 Видео»");
const alternativeSolution = solutionsData.items.find(
  solution => solution.name === "Ronavi H1500 (грузоподъемность до 1 500 кг)",
);
assert.ok(
  alternativeSolution?.id,
  "в каталоге должна быть альтернативная модель «Ronavi H1500 (грузоподъемность до 1 500 кг)»",
);
const thirdSolution = solutionsData.items.find(
  solution => solution.name === "Ronavi H2000 (грузоподъемность до 2 000 кг)",
);
assert.ok(
  thirdSolution?.id,
  "в каталоге должна быть третья модель «Ronavi H2000 (грузоподъемность до 2 000 кг)»",
);

function parseCsvLine(row) {
  const cells = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < row.length; index++) {
    const character = row[index];
    if (character === '"') {
      if (quoted && row[index + 1] === '"') {
        cell += '"';
        index++;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      cells.push(cell);
      cell = "";
    } else {
      cell += character;
    }
  }

  cells.push(cell);
  return cells;
}

function parseCsvRows(csv) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < csv.length; index++) {
    const character = csv[index];
    if (character === '"') {
      if (quoted && csv[index + 1] === '"') {
        cell += '"';
        index++;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if (character === "\n" && !quoted) {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (character === "\r" && !quoted && csv[index + 1] === "\n") {
      continue;
    } else {
      cell += character;
    }
  }

  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows;
}

function parseGeometryCsvRows(csv) {
  const geometrySection = csv
    .split("\nРиск окупаемости покупки\n", 1)[0]
    .split("\nСостав геометрии сцены\n")[1];
  assert.ok(geometrySection, "CSV должен содержать раздел состава геометрии сцены");

  const rows = geometrySection
    .trim()
    .split("\n")
    .slice(1)
    .map(parseCsvLine);
  return Object.fromEntries(rows.map(row => [row[0], row]));
}

function parseSimulationKpiCsvRows(csv) {
  const simulationSection = csv
    .split("\nСостав геометрии сцены\n", 1)[0]
    .split("\nМежэтажная логистика\n")[1];
  assert.ok(simulationSection, "CSV должен содержать раздел межэтажной логистики");

  const rows = parseCsvRows(simulationSection.trim());
  return {
    header: rows[0],
    rows: rows.slice(1),
  };
}

async function exportReportCsv(chromium) {
  return chromium.page.evaluate(() => {
    URL.createObjectURL = blob => {
      if (!(blob instanceof Blob)) throw new Error("Экспорт должен передавать Blob в URL.createObjectURL");
      window.__robotshubExportedCsv = blob.text();
      return "blob:robotshub-export-intercepted";
    };
    HTMLAnchorElement.prototype.click = function click() {
      if (this.download.endsWith(".csv")) return;
    };

    const button = document.querySelector('[data-testid="button-export-csv"]');
    if (!(button instanceof HTMLButtonElement)) throw new Error("Кнопка экспорта CSV не найдена");
    button.click();

    return window.__robotshubExportedCsv;
  });
}

async function downloadReportCsv(chromium, downloadDir) {
  const existingFiles = new Set(await readdir(downloadDir));
  await chromium.page.command("Page.setDownloadBehavior", {
    behavior: "allow",
    downloadPath: downloadDir,
  });
  const buttonPoint = await chromium.page.evaluate(() => {
    const button = document.querySelector('[data-testid="button-export-csv"]');
    if (!(button instanceof HTMLButtonElement)) throw new Error("Кнопка экспорта CSV не найдена");
    const bounds = button.getBoundingClientRect();
    return {
      x: bounds.left + bounds.width / 2,
      y: bounds.top + bounds.height / 2,
    };
  });
  await chromium.page.command("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: buttonPoint.x,
    y: buttonPoint.y,
    button: "left",
    clickCount: 1,
  });
  await chromium.page.command("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: buttonPoint.x,
    y: buttonPoint.y,
    button: "left",
    clickCount: 1,
  });

  const startedAt = Date.now();
  while (Date.now() - startedAt < 10_000) {
    const downloadedFile = (await readdir(downloadDir)).find(file => (
      file.endsWith(".csv") && !existingFiles.has(file)
    ));
    if (downloadedFile) {
      return readFile(path.join(downloadDir, downloadedFile), "utf8");
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Chromium не скачал CSV отчёта за 10 секунд (файлы: ${(await readdir(downloadDir)).join(", ") || "нет"})`);
}

async function assertAvailableRoute(chromium, { route, selector, title }) {
  await chromium.page.waitFor(
    expectedRoute => window.location.pathname === expectedRoute,
    route,
  );
  await chromium.page.waitFor(
    targetSelector => Boolean(document.querySelector(targetSelector)),
    selector,
  );

  const pageState = await chromium.page.evaluate(() => ({
    title: document.querySelector("h1, h2")?.textContent?.trim() ?? "",
    storageNotice: Boolean(document.querySelector('[data-testid="alert-project-storage"]')),
    bodyText: document.body.textContent?.replace(/\s+/g, " ").trim() ?? "",
    hasErrorBoundary: document.body.textContent?.includes("Something went wrong") ?? false,
  }));
  assert.equal(pageState.title, title, `${route} должна показать заголовок страницы`);
  assert.equal(pageState.storageNotice, true, `${route} должна объяснить недоступность localStorage`);
  assert.ok(pageState.bodyText.length > 0, `${route} не должна показывать пустое содержимое`);
  assert.equal(pageState.hasErrorBoundary, false, `${route} не должна показывать ErrorBoundary`);
  assert.deepEqual(chromium.page.browserErrors(), [], `${route} не должна оставлять ошибки браузера`);
}

test("выбранная модель и её TCO сохраняются после возврата с соседнего шага", { concurrency: false }, async () => {
  const server = await startApp();
  const chromium = await startChromium();
  try {
    await chromium.page.command("Page.navigate", { url: `${baseUrl}/` });
    await chromium.page.waitFor(() => document.readyState === "complete");
    await chromium.page.evaluate(state => {
      localStorage.setItem("robotshub_project", JSON.stringify(state));
    }, {
      objectType: "warehouse",
      objectParams,
      selectedSolutions: [selectedSolution.id, alternativeSolution.id, thirdSolution.id],
      assumptionsOverrides: {},
    });
    await chromium.page.command("Page.navigate", { url: `${baseUrl}/calc` });
    await chromium.page.waitFor(
      selector => Boolean(document.querySelector(selector)),
      `[data-testid="button-calc-solution-${alternativeSolution.id}"]`,
    );

    await chromium.page.evaluate(selector => {
      const button = document.querySelector(selector);
      if (!(button instanceof HTMLButtonElement)) {
        throw new Error(`Кнопка решения не найдена: ${selector}`);
      }
      button.focus();
      button.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
      button.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, button: 0 }));
      button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    }, `[data-testid="button-calc-solution-${alternativeSolution.id}"]`);
    await chromium.page.waitFor(
      name => document.querySelector('[data-testid="calc-active-solution-name"]')?.textContent?.trim() === name,
      alternativeSolution.name,
    );

    await chromium.page.evaluate(() => {
      const tab = document.querySelector('[data-testid="tab-tco-chart"]');
      tab?.focus();
      tab?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
      tab?.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, button: 0 }));
      tab?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
    });
    await chromium.page.waitFor(() => document.querySelector('[data-testid="tab-tco-chart"]')?.getAttribute("aria-selected") === "true");
    await chromium.page.waitFor(() => Boolean(document.querySelector('[data-testid="tco-chart-accessible-table"]')));
    const expectedTcoTable = await chromium.page.evaluate(() => {
      const table = document.querySelector('[data-testid="tco-chart-accessible-table"]');
      return {
        headers: [...(table?.querySelectorAll("thead th") ?? [])].map(cell => cell.textContent?.trim() ?? ""),
        rows: [...(table?.querySelectorAll("tbody tr") ?? [])].map(row => (
          [...row.querySelectorAll("th, td")].map(cell => cell.textContent?.trim() ?? "")
        )),
      };
    });

    await chromium.page.command("Page.navigate", { url: `${baseUrl}/simulation` });
    await chromium.page.waitFor(() => Boolean(document.querySelector('[data-testid="page-simulation"]')));
    await chromium.page.command("Page.navigate", { url: `${baseUrl}/calc` });
    await chromium.page.waitFor(
      name => document.querySelector('[data-testid="calc-active-solution-name"]')?.textContent?.trim() === name,
      alternativeSolution.name,
    );
    assert.equal(
      await chromium.page.evaluate(selector => document.querySelector(selector)?.getAttribute("aria-pressed"), `[data-testid="button-calc-solution-${alternativeSolution.id}"]`),
      "true",
      "после возврата на расчёт второй вариант должен остаться активным",
    );

    await chromium.page.evaluate(() => {
      const tab = document.querySelector('[data-testid="tab-tco-chart"]');
      tab?.focus();
      tab?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
      tab?.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, button: 0 }));
      tab?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
    });
    await chromium.page.waitFor(() => document.querySelector('[data-testid="tab-tco-chart"]')?.getAttribute("aria-selected") === "true");
    await chromium.page.waitFor(() => Boolean(document.querySelector('[data-testid="tco-chart-accessible-table"]')));
    const returnedTcoTable = await chromium.page.evaluate(() => {
      const table = document.querySelector('[data-testid="tco-chart-accessible-table"]');
      return {
        headers: [...(table?.querySelectorAll("thead th") ?? [])].map(cell => cell.textContent?.trim() ?? ""),
        rows: [...(table?.querySelectorAll("tbody tr") ?? [])].map(row => (
          [...row.querySelectorAll("th, td")].map(cell => cell.textContent?.trim() ?? "")
        )),
      };
    });
    assert.deepEqual(
      returnedTcoTable,
      expectedTcoTable,
      "после возврата заголовок и все строки TCO должны соответствовать выбранной модели",
    );
  } finally {
    chromium.page.close();
    await stopChild(chromium.browser, true);
    await rm(chromium.userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    await stopChild(server);
  }
});

test("legacy-проект без What-If открывает расчёт с базовыми значениями", { concurrency: false }, async () => {
  const server = await startApp();
  const chromium = await startChromium();
  try {
    await chromium.page.command("Page.navigate", { url: `${baseUrl}/` });
    await chromium.page.waitFor(() => document.readyState === "complete");
    await chromium.page.evaluate(state => {
      localStorage.setItem("robotshub_project", JSON.stringify(state));
    }, {
      objectType: "warehouse",
      objectParams,
      selectedSolutions: [selectedSolution.id],
    });

    await chromium.page.command("Page.navigate", { url: `${baseUrl}/calc` });
    await chromium.page.waitFor(
      name => document.querySelector('[data-testid="calc-active-solution-name"]')?.textContent?.trim() === name,
      selectedSolution.name,
    );
    await chromium.page.waitFor(() => Boolean(document.querySelector('[data-testid="slider-what-if-volume"]')));

    const whatIfValues = await chromium.page.evaluate(() => Object.fromEntries(
      ["salary", "price", "volume"].map(key => [
        key,
        document.querySelector(`[data-testid="slider-what-if-${key}"] [role="slider"]`)?.getAttribute("aria-valuenow") ?? null,
      ]),
    ));
    assert.deepEqual(
      whatIfValues,
      { salary: "1", price: "1", volume: "1" },
      "legacy-проект без What-If должен получить базовые значения всех ползунков",
    );

    await chromium.page.evaluate(() => {
      const tab = document.querySelector('[data-testid="tab-tco-chart"]');
      tab?.focus();
      tab?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
      tab?.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, button: 0 }));
      tab?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
    });
    await chromium.page.waitFor(
      () => document.querySelector('[data-testid="tab-tco-chart"]')?.getAttribute("aria-selected") === "true",
    );
    await chromium.page.waitFor(() => Boolean(document.querySelector('[data-testid="tco-chart-accessible-table"]')));

    const tcoTable = await chromium.page.evaluate(() => {
      const table = document.querySelector('[data-testid="tco-chart-accessible-table"]');
      return {
        headers: [...(table?.querySelectorAll("thead th") ?? [])].map(cell => cell.textContent?.trim() ?? ""),
        rows: [...(table?.querySelectorAll("tbody tr") ?? [])].map(row => (
          [...row.querySelectorAll("th, td")].map(cell => cell.textContent?.trim() ?? "")
        )),
      };
    });
    assert.equal(
      tcoTable.rows.length,
      4,
      "legacy-проект должен открыть таблицу TCO с четырьмя сценариями",
    );
    assert.deepEqual(
      tcoTable.headers,
      ["Сценарий", "CAPEX", "OPEX за 5 лет", "TCO за 5 лет"],
      "legacy-проект должен открыть таблицу TCO с полными заголовками",
    );
    assert.ok(
      tcoTable.rows.every(row => row.length === 4 && row.every(Boolean)),
      "legacy-проект должен получить заполненные значения по каждому сценарию TCO",
    );
  } finally {
    chromium.page.close();
    await stopChild(chromium.browser, true);
    await rm(chromium.userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    await stopChild(server);
  }
});

test("повреждённый сохранённый проект безопасно возвращает пользователя к выбору решения", { concurrency: false }, async () => {
  const server = await startApp();
  const chromium = await startChromium();
  try {
    await chromium.page.command("Page.navigate", { url: `${baseUrl}/` });
    await chromium.page.waitFor(() => document.readyState === "complete");
    await chromium.page.evaluate(() => {
      localStorage.setItem("robotshub_project", JSON.stringify({
        objectType: "warehouse",
        objectParams: null,
        selectedSolutions: ["solution-that-no-longer-exists", 42],
        activeSolutionId: { broken: true },
        whatIfOverrides: ["broken"],
        assumptionsOverrides: "broken",
      }));
    });

    await chromium.page.command("Page.navigate", { url: `${baseUrl}/calc` });
    await chromium.page.waitFor(() => window.location.pathname === "/solutions");
    await chromium.page.waitFor(() => Boolean(document.querySelector('[data-testid="page-solutions"]')));

    assert.equal(
      await chromium.page.evaluate(() => document.querySelector('[data-testid="text-page-title"]')?.textContent?.trim()),
      "Каталог решений",
      "при невозможности продолжить расчёт должен открываться каталог решений",
    );
    assert.equal(
      await chromium.page.evaluate(() => document.querySelector('h1')?.textContent?.trim()),
      "Каталог решений",
      "повреждённое состояние не должно показывать пустой экран или ErrorBoundary",
    );
    assert.equal(
      await chromium.page.evaluate(() => document.querySelector('[data-testid="alert-project-recovery"]')?.textContent?.replace(/\s+/g, " ").trim()),
      "Сохранённый расчёт нельзя продолжитьМы начали новый расчёт. Выберите решение, чтобы собрать его заново.",
      "каталог должен объяснить, почему старый расчёт сброшен",
    );
    assert.deepEqual(
      await chromium.page.evaluate(() => {
        const saved = JSON.parse(localStorage.getItem("robotshub_project") ?? "{}");
        return {
          objectType: saved.objectType,
          objectParams: saved.objectParams,
          selectedSolutions: saved.selectedSolutions,
          activeSolutionId: saved.activeSolutionId,
          whatIfOverrides: saved.whatIfOverrides,
          assumptionsOverrides: saved.assumptionsOverrides,
        };
      }),
      {
        objectType: "warehouse",
        objectParams: {},
        selectedSolutions: [],
        activeSolutionId: null,
        whatIfOverrides: {},
        assumptionsOverrides: {},
      },
      "провайдер должен сохранить безопасную нормализованную структуру проекта",
    );

    await chromium.page.command("Page.reload", { ignoreCache: true });
    await chromium.page.waitFor(() => document.readyState === "complete");
    await chromium.page.waitFor(() => Boolean(document.querySelector('[data-testid="page-solutions"]')));
    assert.equal(
      await chromium.page.evaluate(() => Boolean(document.querySelector('[data-testid="alert-project-recovery"]'))),
      true,
      "после обновления каталога уведомление должно оставаться до выбора решения",
    );

    await chromium.page.evaluate(() => {
      const button = document.querySelector('[data-testid^="button-calculate-"]');
      if (!(button instanceof HTMLButtonElement)) throw new Error("Кнопка расчёта решения не найдена");
      button.click();
    });
    await chromium.page.waitFor(() => window.location.pathname === "/calc");
    assert.equal(
      await chromium.page.evaluate(() => localStorage.getItem("robotshub_project_recovery_notice")),
      null,
      "после выбора решения сохранённое уведомление должно быть очищено",
    );

    await chromium.page.command("Page.navigate", { url: `${baseUrl}/solutions` });
    await chromium.page.waitFor(() => Boolean(document.querySelector('[data-testid="page-solutions"]')));
    assert.equal(
      await chromium.page.evaluate(() => Boolean(document.querySelector('[data-testid="alert-project-recovery"]'))),
      false,
      "после перехода из расчёта в каталог уведомление не должно возвращаться",
    );
    await chromium.page.command("Page.reload", { ignoreCache: true });
    await chromium.page.waitFor(() => document.readyState === "complete");
    await chromium.page.waitFor(() => Boolean(document.querySelector('[data-testid="page-solutions"]')));
    assert.equal(
      await chromium.page.evaluate(() => Boolean(document.querySelector('[data-testid="alert-project-recovery"]'))),
      false,
      "после следующего открытия каталога уведомление не должно возвращаться",
    );
  } finally {
    chromium.page.close();
    await stopChild(chromium.browser, true);
    await rm(chromium.userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    await stopChild(server);
  }
});

test("уведомление о восстановлении синхронизируется между вкладками", { concurrency: false }, async () => {
  const server = await startApp();
  const chromium = await startChromium();
  let secondPage;
  try {
    await chromium.page.command("Page.navigate", { url: `${baseUrl}/solutions` });
    await chromium.page.waitFor(() => document.readyState === "complete");
    await chromium.page.waitFor(() => Boolean(document.querySelector('[data-testid="page-solutions"]')));
    await chromium.page.evaluate(() => {
      localStorage.removeItem("robotshub_project");
      localStorage.removeItem("robotshub_project_recovery_notice");
    });

    const secondPageInfo = await openDevToolsPage(chromium.debugPort, `${baseUrl}/solutions`);
    secondPage = new DevToolsPage(secondPageInfo.webSocketDebuggerUrl);
    await secondPage.waitFor(() => document.readyState === "complete");
    await secondPage.waitFor(() => Boolean(document.querySelector('[data-testid="page-solutions"]')));
    assert.equal(
      await secondPage.evaluate(() => Boolean(document.querySelector('[data-testid="alert-project-recovery"]'))),
      false,
      "вторая вкладка должна начать без уведомления",
    );

    await chromium.page.evaluate(() => {
      localStorage.setItem("robotshub_project", "{not-json");
    });
    await chromium.page.command("Page.reload", { ignoreCache: true });
    await chromium.page.waitFor(() => document.readyState === "complete");
    await chromium.page.waitFor(() => Boolean(document.querySelector('[data-testid="alert-project-recovery"]')));
    await secondPage.waitFor(() => Boolean(document.querySelector('[data-testid="alert-project-recovery"]')));
    assert.equal(
      await secondPage.evaluate(() => Boolean(document.querySelector('[data-testid="alert-project-recovery"]'))),
      true,
      "повреждённое сохранение должно показать уведомление в уже открытой вкладке",
    );

    await chromium.page.evaluate(() => {
      const button = document.querySelector('[data-testid^="button-calculate-"]');
      if (!(button instanceof HTMLButtonElement)) throw new Error("Кнопка расчёта решения не найдена");
      button.click();
    });
    await chromium.page.waitFor(() => window.location.pathname === "/calc");
    await secondPage.waitFor(() => !document.querySelector('[data-testid="alert-project-recovery"]'));
    assert.equal(
      await secondPage.evaluate(() => Boolean(document.querySelector('[data-testid="alert-project-recovery"]'))),
      false,
      "выбор решения в одной вкладке должен скрыть уведомление в другой",
    );
  } finally {
    secondPage?.close();
    chromium.page.close();
    await stopChild(chromium.browser, true);
    await rm(chromium.userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    await stopChild(server);
  }
});

test("полностью нечитаемое сохранение безопасно возвращает пользователя к выбору решения", { concurrency: false }, async () => {
  const server = await startApp();
  const chromium = await startChromium();
  try {
    await chromium.page.command("Page.navigate", { url: `${baseUrl}/` });
    await chromium.page.waitFor(() => document.readyState === "complete");
    await chromium.page.evaluate(() => {
      localStorage.setItem("robotshub_project", "{not-json");
    });

    await chromium.page.command("Page.navigate", { url: `${baseUrl}/calc` });
    await chromium.page.waitFor(() => window.location.pathname === "/solutions");
    await chromium.page.waitFor(() => Boolean(document.querySelector('[data-testid="page-solutions"]')));

    assert.equal(
      await chromium.page.evaluate(() => document.querySelector('h1')?.textContent?.trim()),
      "Каталог решений",
      "нечитаемое сохранение не должно показывать пустой экран или ErrorBoundary",
    );
    assert.equal(
      await chromium.page.evaluate(() => document.querySelector('[data-testid="alert-project-recovery"]')?.textContent?.replace(/\s+/g, " ").trim()),
      "Сохранённый расчёт нельзя продолжитьМы начали новый расчёт. Выберите решение, чтобы собрать его заново.",
      "после ошибки JSON каталог должен показать понятную причину сброса",
    );

    await chromium.page.evaluate(() => {
      const button = document.querySelector('[data-testid^="button-calculate-"]');
      if (!(button instanceof HTMLButtonElement)) throw new Error("Кнопка расчёта решения не найдена");
      button.click();
    });
    await chromium.page.waitFor(() => window.location.pathname === "/calc");
    assert.equal(
      await chromium.page.evaluate(() => localStorage.getItem("robotshub_project_recovery_notice")),
      null,
      "после выбора решения уведомление о восстановлении должно быть очищено",
    );

    await chromium.page.command("Page.navigate", { url: `${baseUrl}/solutions` });
    await chromium.page.waitFor(() => Boolean(document.querySelector('[data-testid="page-solutions"]')));
    assert.equal(
      await chromium.page.evaluate(() => Boolean(document.querySelector('[data-testid="alert-project-recovery"]'))),
      false,
      "после выбора решения уведомление не должно возвращаться",
    );
  } finally {
    chromium.page.close();
    await stopChild(chromium.browser, true);
    await rm(chromium.userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    await stopChild(server);
  }
});

test("полностью нечитаемое сохранение безопасно открывает симуляцию и отчёт", { concurrency: false }, async () => {
  const server = await startApp();
  const chromium = await startChromium();
  try {
    await chromium.page.enableBrowserDiagnostics();

    for (const route of ["/simulation", "/report"]) {
      await chromium.page.command("Page.navigate", { url: `${baseUrl}/` });
      await chromium.page.waitFor(() => document.readyState === "complete");
      await chromium.page.evaluate(() => {
        localStorage.clear();
        localStorage.setItem("robotshub_project", "{not-json");
      });
      chromium.page.clearBrowserErrors();

      await chromium.page.command("Page.navigate", { url: `${baseUrl}${route}` });
      await chromium.page.waitFor(() => window.location.pathname === "/solutions");
      await chromium.page.waitFor(() => Boolean(document.querySelector('[data-testid="page-solutions"]')));

      const pageState = await chromium.page.evaluate(() => ({
        title: document.querySelector('[data-testid="text-page-title"]')?.textContent?.trim() ?? "",
        recoveryNotice: document.querySelector('[data-testid="alert-project-recovery"]')?.textContent?.replace(/\s+/g, " ").trim() ?? "",
        bodyText: document.body.textContent?.replace(/\s+/g, " ").trim() ?? "",
        hasErrorBoundary: document.body.textContent?.includes("Something went wrong") ?? false,
      }));
      assert.equal(
        pageState.title,
        "Каталог решений",
        `${route} должна вернуть повреждённое сохранение в каталог решений`,
      );
      assert.equal(
        pageState.recoveryNotice,
        "Сохранённый расчёт нельзя продолжитьМы начали новый расчёт. Выберите решение, чтобы собрать его заново.",
        `${route} должна показать объяснение восстановления`,
      );
      assert.ok(pageState.bodyText.length > 0, `${route} не должна показывать пустое содержимое`);
      assert.equal(pageState.hasErrorBoundary, false, `${route} не должна показывать ErrorBoundary`);
      assert.deepEqual(
        chromium.page.browserErrors(),
        [],
        `${route} не должна оставлять необработанные ошибки браузера`,
      );
    }
  } finally {
    chromium.page.close();
    await stopChild(chromium.browser, true);
    await rm(chromium.userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    await stopChild(server);
  }
});

test("блокировка чтения localStorage оставляет каталог доступным и объясняет ограничение", { concurrency: false }, async () => {
  const server = await startApp();
  const chromium = await startChromium(["--disable-local-storage"]);
  try {
    await chromium.page.enableBrowserDiagnostics();
    await chromium.page.command("Page.navigate", { url: `${baseUrl}/solutions` });
    await chromium.page.waitFor(() => Boolean(document.querySelector('[data-testid="page-solutions"]')));
    await chromium.page.waitFor(() => Boolean(document.querySelector('[data-testid="alert-project-storage"]')));

    const pageState = await chromium.page.evaluate(() => ({
      title: document.querySelector('[data-testid="text-page-title"]')?.textContent?.trim() ?? "",
      storageNotice: document.querySelector('[data-testid="alert-project-storage"]')?.textContent?.replace(/\s+/g, " ").trim() ?? "",
      hasErrorBoundary: document.body.textContent?.includes("Something went wrong") ?? false,
    }));
    assert.equal(pageState.title, "Каталог решений", "при блокировке чтения каталог должен оставаться доступным");
    assert.equal(
      pageState.storageNotice,
      "Сохранение недоступноБраузер запретил доступ к локальному хранилищу. Объект, каталог, экономика, симуляция и отчёт доступны, но изменения не сохранятся после обновления страницы.Повторить проверку сохранения",
      "каталог должен объяснить последствия блокировки localStorage",
    );
    assert.equal(
      await chromium.page.evaluate(() => Boolean(document.querySelector('[data-testid="button-retry-project-storage"]'))),
      true,
      "предупреждение должно дать возможность повторить проверку localStorage",
    );
    assert.equal(pageState.hasErrorBoundary, false, "ошибка чтения localStorage не должна показывать ErrorBoundary");
    assert.deepEqual(chromium.page.browserErrors(), [], "ошибка чтения localStorage не должна становиться необработанной ошибкой");
  } finally {
    chromium.page.close();
    await stopChild(chromium.browser, true);
    await rm(chromium.userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    await stopChild(server);
  }
});

test("повторная проверка localStorage сохраняет текущий проект после восстановления доступа", { concurrency: false }, async () => {
  const server = await startApp();
  const chromium = await startChromium();
  try {
    await chromium.page.command("Page.navigate", { url: `${baseUrl}/solutions` });
    await chromium.page.waitFor(() => Boolean(document.querySelector('[data-testid="page-solutions"]')));
    await chromium.page.evaluate(() => {
      const originalSetItem = Storage.prototype.setItem;
      window.__robotshubOriginalSetItem = originalSetItem;
      Storage.prototype.setItem = function(key, value) {
        if (key === "robotshub_project") {
          throw new DOMException("Квота localStorage исчерпана", "QuotaExceededError");
        }
        return originalSetItem.call(this, key, value);
      };
    });

    await chromium.page.evaluate(() => {
      const button = document.querySelector('[data-testid^="button-calculate-"]');
      if (!(button instanceof HTMLButtonElement)) throw new Error("Кнопка расчёта решения не найдена");
      button.click();
    });
    await chromium.page.waitFor(() => window.location.pathname === "/calc");
    await chromium.page.waitFor(() => Boolean(document.querySelector('[data-testid="alert-project-storage"]')));

    await chromium.page.clearBrowserErrors();
    await chromium.page.evaluate(() => {
      const button = document.querySelector('[data-testid="button-retry-project-storage"]');
      if (!(button instanceof HTMLButtonElement)) throw new Error("Кнопка повторной проверки не найдена");
      button.click();
    });
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(
      await chromium.page.evaluate(() => Boolean(document.querySelector('[data-testid="alert-project-storage"]'))),
      true,
      "при повторной ошибке предупреждение должно остаться доступным",
    );
    assert.equal(
      await chromium.page.evaluate(() => document.body.textContent?.includes("Something went wrong") ?? false),
      false,
      "повторная ошибка localStorage не должна показывать ErrorBoundary",
    );
    assert.deepEqual(
      chromium.page.browserErrors(),
      [],
      "повторная ошибка localStorage не должна становиться необработанной ошибкой",
    );

    await chromium.page.evaluate(() => {
      Storage.prototype.setItem = window.__robotshubOriginalSetItem;
    });
    await chromium.page.evaluate(() => {
      const button = document.querySelector('[data-testid="button-retry-project-storage"]');
      if (!(button instanceof HTMLButtonElement)) throw new Error("Кнопка повторной проверки не найдена");
      button.click();
    });
    await chromium.page.waitFor(() => !document.querySelector('[data-testid="alert-project-storage"]'));

    const savedProject = await chromium.page.evaluate(() => {
      const saved = localStorage.getItem("robotshub_project");
      return saved ? JSON.parse(saved) : null;
    });
    assert.ok(savedProject?.selectedSolutions?.length > 0, "повторная запись должна сохранить выбранное решение");
    assert.equal(
      savedProject.activeSolutionId,
      savedProject.selectedSolutions[0],
      "повторная запись должна сохранить активное решение текущего проекта",
    );
  } finally {
    chromium.page.close();
    await stopChild(chromium.browser, true);
    await rm(chromium.userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    await stopChild(server);
  }
});

test("повторная проверка localStorage восстанавливает проект прямо на странице объекта", { concurrency: false }, async () => {
  const server = await startApp();
  const chromium = await startChromium();
  const editedArea = 21000;
  const initialProject = {
    objectType: "warehouse",
    objectParams,
    selectedSolutions: [selectedSolution.id, alternativeSolution.id],
    activeSolutionId: alternativeSolution.id,
    whatIfOverrides: {
      salaryMultiplier: 0.8,
      priceMultiplier: 1.1,
      volumeMultiplier: 1.5,
    },
    assumptionsOverrides: {},
  };

  try {
    await chromium.page.command("Page.navigate", { url: `${baseUrl}/` });
    await chromium.page.waitFor(() => document.readyState === "complete");
    await chromium.page.evaluate(project => {
      localStorage.clear();
      localStorage.setItem("robotshub_project", JSON.stringify(project));
    }, initialProject);

    await chromium.page.command("Page.navigate", { url: `${baseUrl}/object` });
    await chromium.page.waitFor(() => window.location.pathname === "/object");
    await chromium.page.waitFor(() => Boolean(document.querySelector('input[name="total_area_m2"]')));

    await chromium.page.evaluate(() => {
      const originalSetItem = Storage.prototype.setItem;
      window.__robotshubOriginalSetItem = originalSetItem;
      Storage.prototype.setItem = function(key, value) {
        if (key === "robotshub_project") {
          throw new DOMException("Квота localStorage исчерпана", "QuotaExceededError");
        }
        return originalSetItem.call(this, key, value);
      };

      const input = document.querySelector('input[name="total_area_m2"]');
      if (!(input instanceof HTMLInputElement)) {
        throw new Error("Поле площади объекта не найдено");
      }
      const setValue = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      if (!setValue) throw new Error("Нельзя изменить значение поля площади объекта");
      setValue.call(input, "21000");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await chromium.page.evaluate(() => {
      const button = [...document.querySelectorAll("button")].find(
        candidate => candidate.textContent?.trim() === "Далее",
      );
      if (!(button instanceof HTMLButtonElement)) throw new Error("Кнопка сохранения объекта не найдена");
      button.click();
    });
    await chromium.page.waitFor(() => Boolean(document.querySelector('[data-testid="alert-project-storage"]')));

    await chromium.page.evaluate(() => {
      Storage.prototype.setItem = window.__robotshubOriginalSetItem;
      const button = document.querySelector('[data-testid="button-retry-project-storage"]');
      if (!(button instanceof HTMLButtonElement)) throw new Error("Кнопка повторной проверки не найдена");
      button.click();
    });
    await chromium.page.waitFor(() => !document.querySelector('[data-testid="alert-project-storage"]'));

    assert.deepEqual(
      await chromium.page.evaluate(() => JSON.parse(localStorage.getItem("robotshub_project") ?? "{}")),
      {
        ...initialProject,
        objectParams: {
          ...objectParams,
          total_area_m2: editedArea,
        },
      },
      "повторная запись со страницы объекта должна сохранить изменённые параметры и текущий расчёт",
    );

    await chromium.page.command("Page.navigate", { url: `${baseUrl}/calc` });
    await chromium.page.waitFor(
      name => document.querySelector('[data-testid="calc-active-solution-name"]')?.textContent?.trim() === name,
      alternativeSolution.name,
    );
    await chromium.page.waitFor(() => Boolean(document.querySelector('[data-testid="slider-what-if-volume"]')));
    assert.deepEqual(
      await chromium.page.evaluate(() => Object.fromEntries(
        ["salary", "price", "volume"].map(key => [
          key,
          document.querySelector(`[data-testid="slider-what-if-${key}"] [role="slider"]`)?.getAttribute("aria-valuenow") ?? null,
        ]),
      )),
      { salary: "0.8", price: "1.1", volume: "1.5" },
      "после восстановления на объекте What-If должен остаться доступным в экономике",
    );
    assert.equal(
      await chromium.page.evaluate(selector => document.querySelector(selector)?.getAttribute("aria-pressed"), `[data-testid="button-calc-solution-${alternativeSolution.id}"]`),
      "true",
      "после восстановления на объекте активным должно остаться выбранное решение",
    );

    await chromium.page.command("Page.navigate", { url: `${baseUrl}/object` });
    await chromium.page.waitFor(() => Boolean(document.querySelector('input[name="total_area_m2"]')));
    assert.equal(
      await chromium.page.evaluate(() => document.querySelector('input[name="total_area_m2"]')?.value),
      String(editedArea),
      "после восстановления параметр объекта должен остаться доступным без перезагрузки",
    );
  } finally {
    chromium.page.close();
    await stopChild(chromium.browser, true);
    await rm(chromium.userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    await stopChild(server);
  }
});

test("повторная проверка localStorage восстанавливает проект прямо в экономике", { concurrency: false }, async () => {
  const server = await startApp();
  const chromium = await startChromium();
  const initialProject = {
    objectType: "warehouse",
    objectParams: {
      ...objectParams,
      total_area_m2: 23000,
    },
    selectedSolutions: [selectedSolution.id, alternativeSolution.id],
    activeSolutionId: alternativeSolution.id,
    whatIfOverrides: {
      salaryMultiplier: 0.8,
      priceMultiplier: 1,
      volumeMultiplier: 1.5,
    },
    assumptionsOverrides: {},
  };

  try {
    await chromium.page.command("Page.navigate", { url: `${baseUrl}/` });
    await chromium.page.waitFor(() => document.readyState === "complete");
    await chromium.page.evaluate(project => {
      localStorage.clear();
      localStorage.setItem("robotshub_project", JSON.stringify(project));
    }, initialProject);

    await chromium.page.command("Page.navigate", { url: `${baseUrl}/calc` });
    await chromium.page.waitFor(
      name => document.querySelector('[data-testid="calc-active-solution-name"]')?.textContent?.trim() === name,
      alternativeSolution.name,
    );
    await chromium.page.waitFor(() => Boolean(document.querySelector('[data-testid="slider-what-if-salary"]')));

    await chromium.page.evaluate(() => {
      const originalSetItem = Storage.prototype.setItem;
      window.__robotshubOriginalSetItem = originalSetItem;
      Storage.prototype.setItem = function(key, value) {
        if (key === "robotshub_project") {
          throw new DOMException("Квота localStorage исчерпана", "QuotaExceededError");
        }
        return originalSetItem.call(this, key, value);
      };
      const slider = document.querySelector('[data-testid="slider-what-if-salary"] [role="slider"]');
      if (!(slider instanceof HTMLElement)) throw new Error("Ползунок роста ФОТ не найден");
      slider.focus();
    });
    await chromium.page.pressKey("ArrowRight", "ArrowRight", 39);
    await chromium.page.waitFor(
      () => document.querySelector('[data-testid="slider-what-if-salary"] [role="slider"]')?.getAttribute("aria-valuenow") === "0.85",
    );
    await chromium.page.waitFor(() => Boolean(document.querySelector('[data-testid="alert-project-storage"]')));

    await chromium.page.evaluate(() => {
      Storage.prototype.setItem = window.__robotshubOriginalSetItem;
      const button = document.querySelector('[data-testid="button-retry-project-storage"]');
      if (!(button instanceof HTMLButtonElement)) throw new Error("Кнопка повторной проверки не найдена");
      button.click();
    });
    await chromium.page.waitFor(() => !document.querySelector('[data-testid="alert-project-storage"]'));

    const savedProject = await chromium.page.evaluate(() => {
      const saved = localStorage.getItem("robotshub_project");
      return saved ? JSON.parse(saved) : null;
    });
    assert.deepEqual(
      savedProject,
      {
        ...initialProject,
        whatIfOverrides: {
          salaryMultiplier: 0.85,
          priceMultiplier: 1,
          volumeMultiplier: 1.5,
        },
      },
      "повторная запись из экономики должна сохранить изменённый What-If и объект",
    );
    assert.deepEqual(
      await chromium.page.evaluate(() => Object.fromEntries(
        ["salary", "price", "volume"].map(key => [
          key,
          document.querySelector(`[data-testid="slider-what-if-${key}"] [role="slider"]`)?.getAttribute("aria-valuenow") ?? null,
        ]),
      )),
      { salary: "0.85", price: "1", volume: "1.5" },
      "после восстановления активные What-If должны остаться доступными без перезагрузки",
    );
    assert.equal(
      await chromium.page.evaluate(selector => document.querySelector(selector)?.getAttribute("aria-pressed"), `[data-testid="button-calc-solution-${alternativeSolution.id}"]`),
      "true",
      "после восстановления в экономике активным должно остаться выбранное решение",
    );

    await chromium.page.command("Page.navigate", { url: `${baseUrl}/object` });
    await chromium.page.waitFor(() => Boolean(document.querySelector('input[name="total_area_m2"]')));
    assert.equal(
      await chromium.page.evaluate(() => document.querySelector('input[name="total_area_m2"]')?.value),
      String(initialProject.objectParams.total_area_m2),
      "после восстановления в экономике параметры объекта должны остаться доступными",
    );
  } finally {
    chromium.page.close();
    await stopChild(chromium.browser, true);
    await rm(chromium.userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    await stopChild(server);
  }
});

test("заполнение параметров объекта сохраняется на мобильной ширине до каталога", { concurrency: false }, async () => {
  const server = await startApp();
  const chromium = await startChromium();
  const editedArea = 21001;

  try {
    await chromium.page.enableBrowserDiagnostics();
    await setMobileViewport(chromium);
    await chromium.page.command("Page.navigate", { url: `${baseUrl}/quick-select` });
    await chromium.page.waitFor(() => Boolean(document.querySelector("h1")));

    await chromium.page.evaluate(() => {
      const button = [...document.querySelectorAll("button")].find(
        candidate => candidate.textContent?.trim() === "Выбрать объект",
      );
      if (!(button instanceof HTMLButtonElement)) throw new Error("Кнопка выбора объекта не найдена");
      button.click();
    });
    await chromium.page.waitFor(
      () => window.location.pathname === "/object"
        && Boolean(document.querySelector('[data-testid="page-object-setup"]')),
    );
    await chromium.page.waitFor(() => Boolean(document.querySelector('input[name="total_area_m2"]')));

    assert.deepEqual(
      await chromium.page.evaluate(() => {
        const input = document.querySelector('input[name="total_area_m2"]');
        const rect = input?.getBoundingClientRect();
        return {
          width: window.innerWidth,
          inputVisible: Boolean(rect && rect.width > 0 && rect.left >= 0 && rect.right <= window.innerWidth),
        };
      }),
      { width: 390, inputVisible: true },
      "числовое поле должно оставаться доступным в мобильном viewport",
    );

    await chromium.page.evaluate(() => {
      const input = document.querySelector('input[name="total_area_m2"]');
      if (!(input instanceof HTMLInputElement)) throw new Error("Поле площади объекта не найдено");
      input.focus();
      input.select();
    });
    await chromium.page.command("Input.insertText", { text: String(editedArea) });
    await chromium.page.waitFor(
      expected => document.querySelector('input[name="total_area_m2"]')?.value === String(expected),
      editedArea,
    );

    await chromium.page.evaluate(() => {
      const button = document.querySelector('[data-testid="object-next-step"]');
      if (!(button instanceof HTMLButtonElement)) throw new Error("Кнопка следующего шага не найдена");
      button.click();
    });
    await chromium.page.waitFor(
      () => document.querySelector('[data-testid="object-group-mode"][aria-current="step"]') !== null,
    );

    await chromium.page.evaluate(() => {
      const button = document.querySelector('[data-testid="object-group-general"]');
      if (!(button instanceof HTMLButtonElement)) throw new Error("Шаг общих параметров не найден");
      button.click();
    });
    await chromium.page.waitFor(
      expected => document.querySelector('input[name="total_area_m2"]')?.value === String(expected),
      editedArea,
    );

    await chromium.page.evaluate(() => {
      const button = document.querySelector('[data-testid="object-group-infra"]');
      if (!(button instanceof HTMLButtonElement)) throw new Error("Шаг инфраструктуры не найден");
      button.click();
    });
    await chromium.page.waitFor(() => Boolean(document.querySelector('[data-testid="object-submit"]')));
    assert.equal(
      await chromium.page.evaluate(() => {
        const button = document.querySelector('[data-testid="object-submit"]');
        const rect = button?.getBoundingClientRect();
        return Boolean(rect && rect.width > 0 && rect.left >= 0 && rect.right <= window.innerWidth);
      }),
      true,
      "кнопка перехода в каталог должна помещаться в мобильном viewport",
    );

    await chromium.page.evaluate(() => {
      const button = document.querySelector('[data-testid="object-submit"]');
      if (!(button instanceof HTMLButtonElement)) throw new Error("Кнопка перехода в каталог не найдена");
      button.click();
    });
    await chromium.page.waitFor(() => Boolean(document.querySelector('[data-testid="page-solutions"]')));
    await chromium.page.waitFor(
      () => Number(document.querySelector('[data-testid="text-results-count"]')?.textContent?.trim() ?? 0) > 0,
    );

    const catalogState = await chromium.page.evaluate(() => ({
      resultCount: Number(document.querySelector('[data-testid="text-results-count"]')?.textContent?.trim() ?? 0),
      bodyText: document.body.textContent?.replace(/\s+/g, " ").trim() ?? "",
      hasErrorBoundary: document.body.textContent?.includes("Something went wrong") ?? false,
    }));
    assert.ok(catalogState.resultCount > 0, "каталог не должен показывать пустое состояние");
    assert.ok(catalogState.bodyText.length > 0, "каталог не должен быть пустым");
    assert.equal(catalogState.hasErrorBoundary, false, "каталог не должен показывать ErrorBoundary");
    assert.deepEqual(chromium.page.browserErrors(), [], "мобильный сценарий не должен оставлять ошибки браузера");
  } finally {
    chromium.page.close();
    await stopChild(chromium.browser, true);
    await rm(chromium.userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    await stopChild(server);
  }
});

async function runMobileTemplateSmoke({ choiceTitle, template, nextGroupId, editedValue }) {
  const server = await startApp();
  const chromium = await startChromium();
  const numericField = template.groups[0].fields.find(field => field.type === "number");
  assert.ok(numericField?.key, `${template.name} должен содержать числовое поле в первой группе`);
  const lastGroupId = template.groups.at(-1)?.id;
  assert.ok(lastGroupId, `${template.name} должен содержать последнюю группу параметров`);
  const interactiveFieldsByGroup = template.groups
    .map(group => ({
      group,
      fields: group.fields.filter(field => field.type === "enum" || field.type === "bool"),
    }))
    .filter(({ fields }) => fields.length > 0);
  assert.ok(
    interactiveFieldsByGroup.some(({ fields }) => fields.some(field => field.type === "enum")),
    `${template.name} должен содержать enum-поле для мобильной проверки`,
  );
  assert.ok(
    interactiveFieldsByGroup.some(({ fields }) => fields.some(field => field.type === "bool")),
    `${template.name} должен содержать bool-поле для мобильной проверки`,
  );

  try {
    await chromium.page.enableBrowserDiagnostics();
    await setMobileViewport(chromium);
    await chromium.page.command("Page.navigate", { url: `${baseUrl}/quick-select` });
    await chromium.page.waitFor(() => Boolean(document.querySelector("h1")));

    await chromium.page.evaluate(title => {
      const button = [...document.querySelectorAll("button")].find(candidate => {
        if (!candidate.textContent?.trim().includes("Выбрать объект")) return false;
        let card = candidate.parentElement;
        for (let depth = 0; depth < 2 && card; depth += 1, card = card.parentElement) {
          if (card.textContent?.includes(title)) return true;
        }
        return false;
      });
      if (!(button instanceof HTMLButtonElement)) {
        throw new Error(`Карточка объекта не найдена: ${title}`);
      }
      button.click();
    }, choiceTitle);

    await chromium.page.waitFor(
      fieldName => window.location.pathname === "/object"
        && Boolean(document.querySelector(`[data-testid="page-object-setup"] input[name="${fieldName}"]`)),
      numericField.key,
    );
    assert.equal(
      await chromium.page.evaluate(() => document.querySelector("h2")?.textContent?.trim()),
      template.name,
      `${template.name} должен открыть свой шаблон параметров`,
    );

    assert.deepEqual(
      await chromium.page.evaluate(fieldName => {
        const input = document.querySelector(`input[name="${fieldName}"]`);
        const rect = input?.getBoundingClientRect();
        return {
          width: window.innerWidth,
          inputVisible: Boolean(rect && rect.width > 0 && rect.left >= 0 && rect.right <= window.innerWidth),
        };
      }, numericField.key),
      { width: 390, inputVisible: true },
      `числовое поле ${numericField.key} должно оставаться доступным в мобильном viewport`,
    );
    await assertObjectSetupFitsViewport(chromium, template.name, template.groups[0].id);

    for (const group of template.groups.slice(1)) {
      await chromium.page.evaluate(groupId => {
        const button = document.querySelector(`[data-testid="object-group-${groupId}"]`);
        if (!(button instanceof HTMLButtonElement)) {
          throw new Error(`Группа параметров не найдена при проверке ширины: ${groupId}`);
        }
        button.click();
      }, group.id);
      await chromium.page.waitFor(
        groupId => document.querySelector(`[data-testid="object-group-${groupId}"][aria-current="step"]`) !== null,
        group.id,
      );
      await assertObjectSetupFitsViewport(chromium, template.name, group.id);
    }

    await chromium.page.evaluate(groupId => {
      const button = document.querySelector(`[data-testid="object-group-${groupId}"]`);
      if (!(button instanceof HTMLButtonElement)) {
        throw new Error(`Первая группа параметров не найдена при возврате: ${groupId}`);
      }
      button.click();
    }, template.groups[0].id);
    await chromium.page.waitFor(
      groupId => document.querySelector(`[data-testid="object-group-${groupId}"][aria-current="step"]`) !== null,
      template.groups[0].id,
    );

    await chromium.page.evaluate(fieldName => {
      const input = document.querySelector(`input[name="${fieldName}"]`);
      if (!(input instanceof HTMLInputElement)) {
        throw new Error(`Числовое поле не найдено: ${fieldName}`);
      }
      input.focus();
      input.select();
    }, numericField.key);
    await chromium.page.command("Input.insertText", { text: String(editedValue) });
    await chromium.page.waitFor(
      expected => document.querySelector(`input[name="${expected.fieldName}"]`)?.value === String(expected.value),
      { fieldName: numericField.key, value: editedValue },
    );

    await chromium.page.evaluate(() => {
      const button = document.querySelector('[data-testid="object-next-step"]');
      if (!(button instanceof HTMLButtonElement)) throw new Error("Кнопка следующего шага не найдена");
      button.click();
    });
    await chromium.page.waitFor(
      groupId => document.querySelector(`[data-testid="object-group-${groupId}"][aria-current="step"]`) !== null,
      nextGroupId,
    );

    const editedInteractiveValues = new Map();
    for (const { group, fields } of interactiveFieldsByGroup) {
      await chromium.page.evaluate(groupId => {
        const button = document.querySelector(`[data-testid="object-group-${groupId}"]`);
        if (!(button instanceof HTMLButtonElement)) {
          throw new Error(`Группа параметров не найдена: ${groupId}`);
        }
        button.click();
      }, group.id);
      await chromium.page.waitFor(
        groupId => document.querySelector(`[data-testid="object-group-${groupId}"][aria-current="step"]`) !== null,
        group.id,
      );

      for (const field of fields) {
        const selector = `[data-testid="object-field-${field.key}"]`;
        if (field.type === "enum") {
          const editedValue = field.options.find(option => option !== field.base) ?? field.options[0];
          assert.ok(editedValue, `${template.name}: enum ${field.key} должен иметь варианты`);
          await chromium.page.evaluate(fieldSelector => {
            const trigger = document.querySelector(`${fieldSelector} [role="combobox"]`);
            if (!(trigger instanceof HTMLElement)) {
              throw new Error(`Список параметров не найден: ${fieldSelector}`);
            }
            trigger.dispatchEvent(new PointerEvent("pointerdown", {
              bubbles: true,
              button: 0,
              pointerId: 1,
              pointerType: "mouse",
            }));
            trigger.dispatchEvent(new PointerEvent("pointerup", {
              bubbles: true,
              button: 0,
              pointerId: 1,
              pointerType: "mouse",
            }));
            trigger.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
          }, selector);
          await chromium.page.waitFor(
            () => document.querySelector('[role="listbox"]') !== null,
          );
          await chromium.page.evaluate(value => {
            const option = [...document.querySelectorAll('[role="option"]')]
              .find(candidate => candidate.textContent?.trim() === value);
            if (!(option instanceof HTMLElement)) {
              throw new Error(`Вариант списка не найден: ${value}`);
            }
            option.dispatchEvent(new PointerEvent("pointerdown", {
              bubbles: true,
              button: 0,
              pointerId: 1,
              pointerType: "mouse",
            }));
            option.dispatchEvent(new PointerEvent("pointerup", {
              bubbles: true,
              button: 0,
              pointerId: 1,
              pointerType: "mouse",
            }));
            option.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
          }, editedValue);
          await chromium.page.waitFor(
            expected => document.querySelector(`${expected.selector} [role="combobox"]`)?.textContent?.includes(expected.value),
            { selector, value: editedValue },
          );
          editedInteractiveValues.set(field.key, editedValue);
        } else {
          const editedValue = !Boolean(field.base);
          await chromium.page.evaluate(fieldSelector => {
            const toggle = document.querySelector(`${fieldSelector} [role="switch"]`);
            if (!(toggle instanceof HTMLElement)) {
              throw new Error(`Переключатель параметров не найден: ${fieldSelector}`);
            }
            toggle.dispatchEvent(new PointerEvent("pointerdown", {
              bubbles: true,
              button: 0,
              pointerId: 1,
              pointerType: "mouse",
            }));
            toggle.dispatchEvent(new PointerEvent("pointerup", {
              bubbles: true,
              button: 0,
              pointerId: 1,
              pointerType: "mouse",
            }));
            toggle.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
          }, selector);
          await chromium.page.waitFor(
            expected => document.querySelector(`${expected.selector} [role="switch"]`)?.getAttribute("aria-checked") === String(expected.value),
            { selector, value: editedValue },
          );
          editedInteractiveValues.set(field.key, editedValue);
        }
      }

      if (group.id !== lastGroupId) {
        await chromium.page.evaluate(() => {
          const button = document.querySelector('[data-testid="object-next-step"]');
          if (!(button instanceof HTMLButtonElement)) throw new Error("Кнопка следующего шага не найдена");
          button.click();
        });
        const nextGroupIndex = template.groups.findIndex(candidate => candidate.id === group.id) + 1;
        const nextGroup = template.groups[nextGroupIndex];
        await chromium.page.waitFor(
          groupId => document.querySelector(`[data-testid="object-group-${groupId}"][aria-current="step"]`) !== null,
          nextGroup.id,
        );
      }
    }

    for (const { group, fields } of interactiveFieldsByGroup) {
      await chromium.page.evaluate(groupId => {
        const button = document.querySelector(`[data-testid="object-group-${groupId}"]`);
        if (!(button instanceof HTMLButtonElement)) {
          throw new Error(`Группа параметров не найдена при повторной проверке: ${groupId}`);
        }
        button.click();
      }, group.id);
      await chromium.page.waitFor(
        groupId => document.querySelector(`[data-testid="object-group-${groupId}"][aria-current="step"]`) !== null,
        group.id,
      );
      for (const field of fields) {
        const selector = `[data-testid="object-field-${field.key}"]`;
        const editedValue = editedInteractiveValues.get(field.key);
        if (field.type === "enum") {
          await chromium.page.waitFor(
            expected => document.querySelector(`${expected.selector} [role="combobox"]`)?.textContent?.includes(expected.value),
            { selector, value: editedValue },
          );
        } else {
          await chromium.page.waitFor(
            expected => document.querySelector(`${expected.selector} [role="switch"]`)?.getAttribute("aria-checked") === String(expected.value),
            { selector, value: editedValue },
          );
        }
      }
    }

    await chromium.page.evaluate(() => {
      const button = document.querySelector('[data-testid="object-group-general"]');
      if (!(button instanceof HTMLButtonElement)) throw new Error("Шаг общих параметров не найден");
      button.click();
    });
    await chromium.page.waitFor(
      expected => document.querySelector(`input[name="${expected.fieldName}"]`)?.value === String(expected.value),
      { fieldName: numericField.key, value: editedValue },
    );

    await chromium.page.evaluate(groupId => {
      const button = document.querySelector(`[data-testid="object-group-${groupId}"]`);
      if (!(button instanceof HTMLButtonElement)) {
        throw new Error(`Последняя группа параметров не найдена: ${groupId}`);
      }
      button.click();
    }, lastGroupId);
    await chromium.page.waitFor(() => Boolean(document.querySelector('[data-testid="object-submit"]')));
    assert.equal(
      await chromium.page.evaluate(() => {
        const button = document.querySelector('[data-testid="object-submit"]');
        const rect = button?.getBoundingClientRect();
        return Boolean(rect && rect.width > 0 && rect.left >= 0 && rect.right <= window.innerWidth);
      }),
      true,
      "кнопка перехода в каталог должна помещаться в мобильном viewport",
    );

    await chromium.page.evaluate(() => {
      const button = document.querySelector('[data-testid="object-submit"]');
      if (!(button instanceof HTMLButtonElement)) throw new Error("Кнопка перехода в каталог не найдена");
      button.click();
    });
    await chromium.page.waitFor(() => Boolean(document.querySelector('[data-testid="page-solutions"]')));
    await chromium.page.waitFor(
      () => Number(document.querySelector('[data-testid="text-results-count"]')?.textContent?.trim() ?? 0) > 0,
    );

    const catalogState = await chromium.page.evaluate(() => ({
      resultCount: Number(document.querySelector('[data-testid="text-results-count"]')?.textContent?.trim() ?? 0),
      bodyText: document.body.textContent?.replace(/\s+/g, " ").trim() ?? "",
      hasErrorBoundary: document.body.textContent?.includes("Something went wrong") ?? false,
    }));
    assert.ok(catalogState.resultCount > 0, `${template.name}: каталог не должен показывать пустое состояние`);
    assert.ok(catalogState.bodyText.length > 0, `${template.name}: каталог не должен быть пустым`);
    assert.equal(catalogState.hasErrorBoundary, false, `${template.name}: каталог не должен показывать ErrorBoundary`);
    assert.deepEqual(
      chromium.page.browserErrors(),
      [],
      `${template.name}: мобильный сценарий не должен оставлять ошибки браузера`,
    );
  } finally {
    chromium.page.close();
    await stopChild(chromium.browser, true);
    await rm(chromium.userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    await stopChild(server);
  }
}

test("длинные подсказки параметров переносятся на мобильной ширине", { concurrency: false }, async () => {
  const server = await startApp();
  const cases = [
    {
      choiceTitle: "Аэропорт",
      template: airportTemplate,
      field: airportTemplate.groups
        .flatMap(group => group.fields)
        .filter(field => field.note)
        .sort((left, right) => right.note.length - left.note.length)[0],
    },
    {
      choiceTitle: "Медучреждение",
      template: medicalTemplate,
      field: medicalTemplate.groups
        .flatMap(group => group.fields)
        .filter(field => field.note)
        .sort((left, right) => right.note.length - left.note.length)[0],
    },
  ];

  try {
    for (const { choiceTitle, template, field } of cases) {
      const chromium = await startChromium();
      try {
        await chromium.page.enableBrowserDiagnostics();
        await setMobileViewport(chromium);
        await chromium.page.command("Page.navigate", { url: `${baseUrl}/quick-select` });
        await chromium.page.waitFor(() => Boolean(document.querySelector("h1")));
        chromium.page.clearBrowserErrors();

        await chromium.page.evaluate(title => {
          const button = [...document.querySelectorAll("button")].find(candidate => {
            if (!candidate.textContent?.includes("Выбрать объект")) return false;
            let card = candidate.parentElement;
            for (let depth = 0; depth < 2 && card; depth += 1, card = card.parentElement) {
              if (card.textContent?.includes(title)) return true;
            }
            return false;
          });
          if (!(button instanceof HTMLButtonElement)) {
            throw new Error(`Карточка объекта не найдена: ${title}`);
          }
          button.click();
        }, choiceTitle);
        await chromium.page.waitFor(
          () => window.location.pathname === "/object"
            && Boolean(document.querySelector('[data-testid="page-object-setup"]')),
        );

        const group = template.groups.find(candidate => candidate.fields.some(item => item.key === field.key));
        assert.ok(group, `${template.name}: группа для поля ${field.key} должна существовать`);
        await chromium.page.evaluate(groupId => {
          const button = document.querySelector(`[data-testid="object-group-${groupId}"]`);
          if (!(button instanceof HTMLButtonElement)) {
            throw new Error(`Группа параметров не найдена: ${groupId}`);
          }
          button.click();
        }, group.id);
        await chromium.page.waitFor(
          groupId => document.querySelector(`[data-testid="object-group-${groupId}"][aria-current="step"]`) !== null,
          group.id,
        );
        await chromium.page.waitFor(
          fieldKey => Boolean(document.querySelector(`[data-testid="object-field-${fieldKey}"] label button`)),
          field.key,
        );

        await assertInfoTooltipFitsViewport(chromium, template.name, field.key, field.note);
        assert.deepEqual(
          chromium.page.browserErrors(),
          [],
          `${template.name}, ${field.key}: открытие подсказки не должно оставлять ошибок браузера`,
        );
      } finally {
        chromium.page.close();
        await stopChild(chromium.browser, true);
        await rm(chromium.userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      }
    }
  } finally {
    await stopChild(server);
  }
});

test("параметры аэропорта сохраняются на мобильной ширине до каталога", { concurrency: false }, async () => {
  await runMobileTemplateSmoke({
    choiceTitle: "Аэропорт",
    template: airportTemplate,
    nextGroupId: "pax",
    editedValue: 91001,
  });
});

test("параметры медучреждения сохраняются на мобильной ширине до каталога", { concurrency: false }, async () => {
  await runMobileTemplateSmoke({
    choiceTitle: "Медучреждение",
    template: medicalTemplate,
    nextGroupId: "mode",
    editedValue: 47001,
  });
});

test("списки параметров аэропорта и медучреждения доступны у края мобильного viewport", { concurrency: false }, async () => {
  const server = await startApp();
  const cases = [
    { choiceTitle: "Аэропорт", template: airportTemplate },
    { choiceTitle: "Медучреждение", template: medicalTemplate },
  ];

  try {
    for (const { choiceTitle, template } of cases) {
      const chromium = await startChromium();
      try {
        await chromium.page.enableBrowserDiagnostics();
        await setMobileViewport(chromium);
        await chromium.page.command("Page.navigate", { url: `${baseUrl}/quick-select` });
        await chromium.page.waitFor(() => Boolean(document.querySelector("h1")));
        chromium.page.clearBrowserErrors();

        await chromium.page.evaluate(title => {
          const button = [...document.querySelectorAll("button")].find(candidate => {
            if (!candidate.textContent?.includes("Выбрать объект")) return false;
            let card = candidate.parentElement;
            for (let depth = 0; depth < 2 && card; depth += 1, card = card.parentElement) {
              if (card.textContent?.includes(title)) return true;
            }
            return false;
          });
          if (!(button instanceof HTMLButtonElement)) {
            throw new Error(`Карточка объекта не найдена: ${title}`);
          }
          button.click();
        }, choiceTitle);
        await chromium.page.waitFor(
          () => window.location.pathname === "/object"
            && Boolean(document.querySelector('[data-testid="page-object-setup"]')),
        );

        const enumFields = template.groups.flatMap(group => (
          group.fields
            .filter(field => field.type === "enum")
            .map(field => ({ group, field }))
        ));
        assert.ok(enumFields.length > 0, `${template.name} должен содержать enum-параметры`);

        for (const { group, field } of enumFields) {
          await chromium.page.evaluate(groupId => {
            const button = document.querySelector(`[data-testid="object-group-${groupId}"]`);
            if (!(button instanceof HTMLButtonElement)) {
              throw new Error(`Группа параметров не найдена: ${groupId}`);
            }
            button.click();
          }, group.id);
          await chromium.page.waitFor(
            groupId => document.querySelector(`[data-testid="object-group-${groupId}"][aria-current="step"]`) !== null,
            group.id,
          );

          const selectedValue = field.options.find(option => option !== field.base) ?? field.options[0];
          assert.ok(selectedValue, `${template.name}: enum ${field.key} должен иметь варианты`);
          await chromium.page.waitFor(
            ({ fieldKey, value }) => document.querySelector(`[data-testid="object-field-${fieldKey}"] [role="combobox"]`)?.textContent?.includes(value),
            { fieldKey: field.key, value: field.base },
          );
          await assertEnumDropdownFitsViewport(chromium, template.name, field.key, selectedValue);
          await assertEnumKeyboardControls(chromium, template.name, field.key);
        }

        assert.deepEqual(
          chromium.page.browserErrors(),
          [],
          `${template.name}: раскрытие списков на мобильной ширине не должно оставлять ошибок браузера`,
        );
      } finally {
        chromium.page.close();
        await stopChild(chromium.browser, true);
        await rm(chromium.userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      }
    }
  } finally {
    await stopChild(server);
  }
});

test("длинные списки параметров переворачиваются вверх у нижнего края мобильного viewport", { concurrency: false }, async () => {
  const server = await startApp();
  const cases = [
    {
      choiceTitle: "Аэропорт",
      template: airportTemplate,
      field: airportTemplate.groups
        .flatMap(group => group.fields)
        .filter(field => field.type === "enum")
        .at(-1),
    },
    {
      choiceTitle: "Медучреждение",
      template: medicalTemplate,
      field: medicalTemplate.groups
        .flatMap(group => group.fields)
        .find(field => field.type === "enum"),
    },
  ];

  try {
    for (const { choiceTitle, template, field } of cases) {
      assert.ok(field, `${template.name} должен содержать enum-параметр для проверки нижнего края`);
      const chromium = await startChromium();
      try {
        await chromium.page.enableBrowserDiagnostics();
        await setMobileViewport(chromium);
        await chromium.page.command("Page.navigate", { url: `${baseUrl}/quick-select` });
        await chromium.page.waitFor(() => Boolean(document.querySelector("h1")));
        chromium.page.clearBrowserErrors();

        await chromium.page.evaluate(title => {
          const button = [...document.querySelectorAll("button")].find(candidate => {
            if (!candidate.textContent?.includes("Выбрать объект")) return false;
            let card = candidate.parentElement;
            for (let depth = 0; depth < 2 && card; depth += 1, card = card.parentElement) {
              if (card.textContent?.includes(title)) return true;
            }
            return false;
          });
          if (!(button instanceof HTMLButtonElement)) {
            throw new Error(`Карточка объекта не найдена: ${title}`);
          }
          button.click();
        }, choiceTitle);
        await chromium.page.waitFor(
          () => window.location.pathname === "/object"
            && Boolean(document.querySelector('[data-testid="page-object-setup"]')),
        );

        const group = template.groups.find(candidate => candidate.fields.some(item => item.key === field.key));
        assert.ok(group, `${template.name}: группа для поля ${field.key} должна существовать`);
        await chromium.page.evaluate(groupId => {
          const button = document.querySelector(`[data-testid="object-group-${groupId}"]`);
          if (!(button instanceof HTMLButtonElement)) {
            throw new Error(`Группа параметров не найдена: ${groupId}`);
          }
          button.click();
        }, group.id);
        await chromium.page.waitFor(
          groupId => document.querySelector(`[data-testid="object-group-${groupId}"][aria-current="step"]`) !== null,
          group.id,
        );
        await chromium.page.waitFor(
          fieldKey => Boolean(document.querySelector(`[data-testid="object-field-${fieldKey}"] [role="combobox"]`)),
          field.key,
        );

        const selectedValue = field.options.find(option => option !== field.base) ?? field.options[0];
        assert.ok(selectedValue, `${template.name}: enum ${field.key} должен иметь варианты`);
        await assertEnumDropdownAtViewportBottom(chromium, template.name, field, selectedValue);
        assert.deepEqual(
          chromium.page.browserErrors(),
          [],
          `${template.name}, ${field.key}: проверка списка у нижнего края не должна оставлять ошибок браузера`,
        );
      } finally {
        chromium.page.close();
        await stopChild(chromium.browser, true);
        await rm(chromium.userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      }
    }
  } finally {
    await stopChild(server);
  }
});

test("смена аэропорта на медучреждение сбрасывает enum и bool параметры", { concurrency: false }, async () => {
  const server = await startApp();
  const chromium = await startChromium();
  try {
    await chromium.page.command("Page.navigate", { url: `${baseUrl}/quick-select` });
    await chromium.page.waitFor(() => Boolean(document.querySelector("button")));
    await chromium.page.enableBrowserDiagnostics();
    chromium.page.clearBrowserErrors();

    await chromium.page.evaluate(() => {
      const airport = [...document.querySelectorAll("button")].find((candidate) => {
        if (!candidate.textContent?.includes("Выбрать объект")) return false;
        let card = candidate.parentElement;
        for (let depth = 0; depth < 2 && card; depth += 1, card = card.parentElement) {
          if (card.textContent?.includes("Аэропорт")) return true;
        }
        return false;
      });
      if (!(airport instanceof HTMLButtonElement)) {
        throw new Error("Карточка аэропорта не найдена");
      }
      airport.click();
    });
    await chromium.page.waitFor(
      () => window.location.pathname === "/object"
        && Boolean(document.querySelector('[data-testid="page-object-setup"]')),
    );

    const airportEnum = airportTemplate.groups
      .flatMap(group => group.fields)
      .find(field => field.type === "enum" && field.options.some(option => option !== field.base));
    assert.ok(airportEnum, "в шаблоне аэропорта должно быть изменяемое enum-поле");
    const airportEnumValue = airportEnum.options.find(option => option !== airportEnum.base);

    await chromium.page.evaluate(() => {
      const button = document.querySelector('[data-testid="object-group-safety"]');
      if (!(button instanceof HTMLButtonElement)) {
        throw new Error("Группа безопасности аэропорта не найдена");
      }
      button.click();
    });
    await chromium.page.waitFor(
      fieldKey => document.querySelector(`[data-testid="object-field-${fieldKey}"]`) !== null,
      airportEnum.key,
    );
    await chromium.page.evaluate(fieldKey => {
      const trigger = document.querySelector(`[data-testid="object-field-${fieldKey}"] [role="combobox"]`);
      if (!(trigger instanceof HTMLElement)) {
        throw new Error(`Enum-поле аэропорта не найдено: ${fieldKey}`);
      }
      trigger.dispatchEvent(new PointerEvent("pointerdown", {
        bubbles: true,
        button: 0,
        pointerId: 1,
        pointerType: "mouse",
      }));
      trigger.dispatchEvent(new PointerEvent("pointerup", {
        bubbles: true,
        button: 0,
        pointerId: 1,
        pointerType: "mouse",
      }));
      trigger.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    }, airportEnum.key);
    await chromium.page.waitFor(() => document.querySelector('[role="listbox"]') !== null);
    await chromium.page.evaluate(value => {
      const option = [...document.querySelectorAll('[role="option"]')]
        .find(candidate => candidate.textContent?.trim() === value);
      if (!(option instanceof HTMLElement)) {
        throw new Error(`Вариант enum аэропорта не найден: ${value}`);
      }
      option.dispatchEvent(new PointerEvent("pointerdown", {
        bubbles: true,
        button: 0,
        pointerId: 1,
        pointerType: "mouse",
      }));
      option.dispatchEvent(new PointerEvent("pointerup", {
        bubbles: true,
        button: 0,
        pointerId: 1,
        pointerType: "mouse",
      }));
      option.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    }, airportEnumValue);
    await chromium.page.waitFor(
      expected => document.querySelector(
        `[data-testid="object-field-${expected.key}"] [role="combobox"]`,
      )?.textContent?.includes(expected.value),
      { key: airportEnum.key, value: airportEnumValue },
    );

    await chromium.page.evaluate(() => {
      const button = document.querySelector('[data-testid="object-next-step"]');
      if (!(button instanceof HTMLButtonElement)) {
        throw new Error("Переход к инфраструктуре аэропорта не найден");
      }
      button.click();
    });
    await chromium.page.waitFor(
      () => document.querySelector('[data-testid="object-group-infra"][aria-current="step"]') !== null,
    );

    const airportBools = airportTemplate.groups
      .flatMap(group => group.fields)
      .filter(field => field.type === "bool");
    assert.ok(airportBools.length > 0, "в шаблоне аэропорта должно быть bool-поле");
    for (const field of airportBools) {
      await chromium.page.evaluate(fieldKey => {
        const toggle = document.querySelector(`[data-testid="object-field-${fieldKey}"] [role="switch"]`);
        if (!(toggle instanceof HTMLElement)) {
          throw new Error(`Bool-поле аэропорта не найдено: ${fieldKey}`);
        }
        toggle.dispatchEvent(new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          pointerId: 1,
          pointerType: "mouse",
        }));
        toggle.dispatchEvent(new PointerEvent("pointerup", {
          bubbles: true,
          button: 0,
          pointerId: 1,
          pointerType: "mouse",
        }));
        toggle.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      }, field.key);
      await chromium.page.waitFor(
        expected => document.querySelector(
          `[data-testid="object-field-${expected.key}"] [role="switch"]`,
        )?.getAttribute("aria-checked") === String(!expected.base),
        { key: field.key, base: field.base },
      );
    }

    await chromium.page.evaluate(() => {
      const button = document.querySelector('[data-testid="object-submit"]');
      if (!(button instanceof HTMLButtonElement)) {
        throw new Error("Сохранение аэропорта не найдено");
      }
      button.click();
    });
    await chromium.page.waitFor(() => Boolean(document.querySelector('[data-testid="page-solutions"]')));
    await chromium.page.waitFor(
      () => Number(document.querySelector('[data-testid="text-results-count"]')?.textContent?.trim() ?? 0) > 0,
    );

    const savedAirport = await chromium.page.evaluate(() => JSON.parse(
      localStorage.getItem("robotshub_project") ?? "{}",
    ));
    assert.equal(savedAirport.objectType, "airport", "перед сменой типа должен сохраниться аэропорт");
    assert.equal(
      savedAirport.objectParams[airportEnum.key],
      airportEnumValue,
      "изменённый enum аэропорта должен сохраниться до смены типа",
    );
    for (const field of airportBools) {
      assert.equal(
        savedAirport.objectParams[field.key],
        !field.base,
        `изменённый bool аэропорта должен сохраниться до смены типа: ${field.key}`,
      );
    }

    await chromium.page.command("Page.navigate", { url: `${baseUrl}/quick-select` });
    await chromium.page.waitFor(() => Boolean(document.querySelector("button")));
    await chromium.page.evaluate(() => {
      const medical = [...document.querySelectorAll("button")].find((candidate) => {
        if (!candidate.textContent?.includes("Выбрать объект")) return false;
        let card = candidate.parentElement;
        for (let depth = 0; depth < 2 && card; depth += 1, card = card.parentElement) {
          if (card.textContent?.includes("Медучреждение")) return true;
        }
        return false;
      });
      if (!(medical instanceof HTMLButtonElement)) {
        throw new Error("Карточка медучреждения не найдена");
      }
      medical.click();
    });
    await chromium.page.waitFor(
      () => window.location.pathname === "/object"
        && Boolean(document.querySelector('[data-testid="object-field-facility_type"]')),
    );

    const medicalDefaults = Object.fromEntries(
      medicalTemplate.groups.flatMap(group => group.fields.map(field => [field.key, field.base])),
    );
    await chromium.page.waitFor(
      expected => JSON.parse(localStorage.getItem("robotshub_project") ?? "{}").objectType === "medical"
        && JSON.parse(localStorage.getItem("robotshub_project") ?? "{}").objectParams?.facility_type === expected.facilityType,
      { facilityType: medicalDefaults.facility_type },
    );

    const medicalState = await chromium.page.evaluate(() => JSON.parse(
      localStorage.getItem("robotshub_project") ?? "{}",
    ));
    assert.equal(medicalState.objectType, "medical", "после выбора должен сохраниться новый тип объекта");
    const medicalFieldKeys = new Set(
      medicalTemplate.groups.flatMap(group => group.fields.map(field => field.key)),
    );
    for (const field of airportTemplate.groups.flatMap(group => group.fields)) {
      if (!medicalFieldKeys.has(field.key)) {
        assert.equal(
          medicalState.objectParams[field.key],
          undefined,
          `параметр аэропорта не должен попасть в медучреждение: ${field.key}`,
        );
      }
    }
    for (const field of medicalTemplate.groups.flatMap(group => group.fields)) {
      assert.equal(
        medicalState.objectParams[field.key],
        field.base,
        `новый объект должен получить базовое значение: ${field.key}`,
      );
    }

    for (const field of medicalTemplate.groups.flatMap(group => group.fields).filter(field => field.type === "bool")) {
      const group = medicalTemplate.groups.find(candidate => candidate.fields.some(item => item.key === field.key));
      await chromium.page.evaluate(groupId => {
        const button = document.querySelector(`[data-testid="object-group-${groupId}"]`);
        if (!(button instanceof HTMLButtonElement)) {
          throw new Error(`Группа медучреждения не найдена: ${groupId}`);
        }
        button.click();
      }, group.id);
      await chromium.page.waitFor(
        fieldKey => document.querySelector(`[data-testid="object-field-${fieldKey}"] [role="switch"]`) !== null,
        field.key,
      );
      assert.equal(
        await chromium.page.evaluate(fieldKey => document.querySelector(
          `[data-testid="object-field-${fieldKey}"] [role="switch"]`,
        )?.getAttribute("aria-checked"), field.key),
        String(field.base),
        `bool-поле нового объекта должно показывать базовое значение: ${field.key}`,
      );
    }

    await chromium.page.evaluate(() => {
      const button = document.querySelector('[data-testid="object-group-infra"]');
      if (!(button instanceof HTMLButtonElement)) throw new Error("Группа инфраструктуры медучреждения не найдена");
      button.click();
    });
    await chromium.page.waitFor(() => Boolean(document.querySelector('[data-testid="object-submit"]')));
    await chromium.page.evaluate(() => document.querySelector('[data-testid="object-submit"]')?.click());
    await chromium.page.waitFor(() => Boolean(document.querySelector('[data-testid="page-solutions"]')));
    await chromium.page.waitFor(
      () => Number(document.querySelector('[data-testid="text-results-count"]')?.textContent?.trim() ?? 0) > 0,
    );

    assert.deepEqual(
      chromium.page.browserErrors(),
      [],
      "смена типа объекта не должна оставлять ошибок браузера",
    );
  } finally {
    chromium.page.close();
    await stopChild(chromium.browser, true);
    await rm(chromium.userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    await stopChild(server);
  }
});

test("блокировка записи localStorage не мешает открыть симуляцию, отчёт и каталог", { concurrency: false }, async () => {
  const server = await startApp();
  const chromium = await startChromium();
  try {
    await chromium.page.command("Page.navigate", { url: `${baseUrl}/solutions` });
    await chromium.page.waitFor(() => Boolean(document.querySelector('[data-testid="page-solutions"]')));
    await chromium.page.evaluate(() => {
      const originalSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function(key, value) {
        if (key === "robotshub_project" || key === "robotshub_project_recovery_notice") {
          throw new DOMException("Квота localStorage исчерпана", "QuotaExceededError");
        }
        return originalSetItem.call(this, key, value);
      };
    });
    await chromium.page.evaluate(() => {
      const button = document.querySelector('[data-testid^="button-calculate-"]');
      if (!(button instanceof HTMLButtonElement)) throw new Error("Кнопка расчёта решения не найдена");
      button.click();
    });
    await chromium.page.waitFor(() => window.location.pathname === "/calc");
    await chromium.page.evaluate(() => {
      const button = [...document.querySelectorAll("button")].find(
        candidate => candidate.textContent?.includes("Перейти к симуляции"),
      );
      if (!(button instanceof HTMLButtonElement)) throw new Error("Кнопка симуляции не найдена");
      button.click();
    });
    await chromium.page.waitFor(() => Boolean(document.querySelector('[data-testid="page-simulation"]')));
    await chromium.page.waitFor(() => Boolean(document.querySelector('[data-testid="alert-project-storage"]')));
    assert.equal(
      await chromium.page.evaluate(() => document.querySelector('[data-testid="text-page-title"]')?.textContent?.trim()),
      "Имитационная модель",
      "при блокировке записи симуляция должна оставаться доступной",
    );

    await chromium.page.evaluate(() => {
      const button = document.querySelector('[data-testid="button-go-report"]');
      if (!(button instanceof HTMLButtonElement)) throw new Error("Кнопка отчёта не найдена");
      button.click();
    });
    await chromium.page.waitFor(() => document.querySelector("h1")?.textContent?.trim() === "Отчет об оценке");
    assert.equal(
      await chromium.page.evaluate(() => Boolean(document.querySelector('[data-testid="alert-project-storage"]'))),
      true,
      "предупреждение о localStorage должно оставаться в отчёте",
    );

    await chromium.page.evaluate(() => {
      const link = [...document.querySelectorAll("a")].find(
        candidate => candidate.textContent?.trim() === "Каталог",
      );
      if (!(link instanceof HTMLAnchorElement)) throw new Error("Ссылка каталога не найдена");
      link.click();
    });
    await chromium.page.waitFor(() => Boolean(document.querySelector('[data-testid="page-solutions"]')));
    assert.equal(
      await chromium.page.evaluate(() => Boolean(document.querySelector('[data-testid="alert-project-storage"]'))),
      true,
      "предупреждение о localStorage должно оставаться в каталоге",
    );
  } finally {
    chromium.page.close();
    await stopChild(chromium.browser, true);
    await rm(chromium.userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    await stopChild(server);
  }
});

test("блокировка чтения localStorage не мешает открыть объект", { concurrency: false }, async () => {
  const server = await startApp();
  const chromium = await startChromium(["--disable-local-storage"]);
  try {
    await chromium.page.enableBrowserDiagnostics();
    await chromium.page.command("Page.navigate", { url: `${baseUrl}/quick-select` });
    await chromium.page.waitFor(() => Boolean(document.querySelector("h1")));
    await chromium.page.evaluate(() => {
      const button = [...document.querySelectorAll("button")].find(
        candidate => candidate.textContent?.trim() === "Выбрать объект",
      );
      if (!(button instanceof HTMLButtonElement)) throw new Error("Кнопка выбора объекта не найдена");
      button.click();
    });

    await assertAvailableRoute(chromium, {
      route: "/object",
      selector: "h2",
      title: "Склад",
    });
  } finally {
    chromium.page.close();
    await stopChild(chromium.browser, true);
    await rm(chromium.userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    await stopChild(server);
  }
});

test("блокировка записи localStorage не теряет введённый параметр объекта при переходе в каталог", { concurrency: false }, async () => {
  const server = await startApp();
  const chromium = await startChromium();
  const editedPayload = 1501;
  try {
    await chromium.page.enableBrowserDiagnostics();
    await chromium.page.command("Page.navigate", { url: `${baseUrl}/quick-select` });
    await chromium.page.waitFor(() => Boolean(document.querySelector("h1")));
    await chromium.page.evaluate(() => {
      const originalSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function(key, value) {
        if (key === "robotshub_project" || key === "robotshub_project_recovery_notice") {
          throw new DOMException("Квота localStorage исчерпана", "QuotaExceededError");
        }
        return originalSetItem.call(this, key, value);
      };
      const button = [...document.querySelectorAll("button")].find(
        candidate => candidate.textContent?.trim() === "Выбрать объект",
      );
      if (!(button instanceof HTMLButtonElement)) throw new Error("Кнопка выбора объекта не найдена");
      button.click();
    });

    await assertAvailableRoute(chromium, {
      route: "/object",
      selector: "h2",
      title: "Склад",
    });
    await chromium.page.evaluate(() => {
      const button = [...document.querySelectorAll("button")].find(
        candidate => candidate.textContent?.trim() === "Хранение и характеристики грузов",
      );
      if (!(button instanceof HTMLButtonElement)) throw new Error("Шаг характеристик грузов не найден");
      button.click();
    });
    await chromium.page.waitFor(
      () => document.querySelector('input[name="pallet_weight_kg"]')?.value === "800",
    );
    await chromium.page.evaluate(() => {
      const input = document.querySelector('input[name="pallet_weight_kg"]');
      if (!(input instanceof HTMLInputElement)) throw new Error("Поле массы паллеты не найдено");
      input.focus();
      input.select();
    });
    await chromium.page.command("Input.insertText", { text: String(editedPayload) });
    assert.equal(
      await chromium.page.evaluate(() => document.querySelector('input[name="pallet_weight_kg"]')?.value),
      String(editedPayload),
      "изменённое числовое поле должно принять значение",
    );

    await chromium.page.evaluate(() => {
      const button = [...document.querySelectorAll("button")].find(
        candidate => candidate.textContent?.trim() === "Инфраструктура и ограничения",
      );
      if (!(button instanceof HTMLButtonElement)) throw new Error("Последний шаг объекта не найден");
      button.click();
    });
    await chromium.page.waitFor(
      () => Boolean(document.querySelector('input[name="capex_budget_mln"]')),
    );
    await chromium.page.evaluate(() => {
      const button = [...document.querySelectorAll("button")].find(
        candidate => candidate.textContent?.trim() === "Сохранить и выбрать решения",
      );
      if (!(button instanceof HTMLButtonElement)) throw new Error("Кнопка перехода в каталог не найдена");
      button.click();
    });

    await chromium.page.waitFor(() => Boolean(document.querySelector('[data-testid="page-solutions"]')));
    await chromium.page.waitFor(() => Boolean(document.querySelector('[data-testid="alert-project-storage"]')));
    await chromium.page.evaluate(() => {
      const button = document.querySelector('[data-testid="button-personalized-ranking"]');
      if (!(button instanceof HTMLButtonElement)) throw new Error("Кнопка персонального скоринга не найдена");
      button.click();
    });
    await chromium.page.waitFor(
      (solutionId) => Boolean(document.querySelector(`[data-testid="text-critical-mismatch-${solutionId}"]`)),
      alternativeSolution.id,
    );

    const catalogState = await chromium.page.evaluate((solutionId) => ({
      title: document.querySelector('[data-testid="text-page-title"]')?.textContent?.trim() ?? "",
      mismatch: document.querySelector(`[data-testid="text-critical-mismatch-${solutionId}"]`)?.textContent?.replace(/\s+/g, " ").trim() ?? "",
      bodyText: document.body.textContent?.replace(/\s+/g, " ").trim() ?? "",
      hasErrorBoundary: document.body.textContent?.includes("Something went wrong") ?? false,
    }), alternativeSolution.id);
    assert.equal(catalogState.title, "Каталог решений", "введённый объект должен открыть каталог решений");
    assert.match(
      catalogState.mismatch,
      /Грузоподъёмность 1 500 кг ниже требуемых 1 501 кг/,
      "каталог должен использовать введённую массу паллеты в персональном скоринге",
    );
    assert.ok(catalogState.bodyText.length > 0, "каталог не должен показывать пустое содержимое");
    assert.equal(catalogState.hasErrorBoundary, false, "переход в каталог не должен показывать ErrorBoundary");
    assert.deepEqual(
      chromium.page.browserErrors(),
      [],
      "ввод параметра и переход в каталог не должны оставлять необработанные ошибки браузера",
    );
  } finally {
    chromium.page.close();
    await stopChild(chromium.browser, true);
    await rm(chromium.userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    await stopChild(server);
  }
});

test("блокировка чтения localStorage не мешает открыть экономику", { concurrency: false }, async () => {
  const server = await startApp();
  const chromium = await startChromium(["--disable-local-storage"]);
  try {
    await chromium.page.enableBrowserDiagnostics();
    await chromium.page.command("Page.navigate", { url: `${baseUrl}/solutions` });
    await chromium.page.waitFor(() => Boolean(document.querySelector('[data-testid="page-solutions"]')));
    await chromium.page.evaluate(() => {
      const button = document.querySelector('[data-testid^="button-calculate-"]');
      if (!(button instanceof HTMLButtonElement)) throw new Error("Кнопка расчёта решения не найдена");
      button.click();
    });

    await assertAvailableRoute(chromium, {
      route: "/calc",
      selector: "h1",
      title: "Экономический расчет",
    });
  } finally {
    chromium.page.close();
    await stopChild(chromium.browser, true);
    await rm(chromium.userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    await stopChild(server);
  }
});

test("блокировка записи localStorage не мешает открыть объект", { concurrency: false }, async () => {
  const server = await startApp();
  const chromium = await startChromium();
  try {
    await chromium.page.enableBrowserDiagnostics();
    await chromium.page.command("Page.navigate", { url: `${baseUrl}/quick-select` });
    await chromium.page.waitFor(() => Boolean(document.querySelector("h1")));
    await chromium.page.evaluate(() => {
      const originalSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function(key, value) {
        if (key === "robotshub_project" || key === "robotshub_project_recovery_notice") {
          throw new DOMException("Квота localStorage исчерпана", "QuotaExceededError");
        }
        return originalSetItem.call(this, key, value);
      };
      const button = [...document.querySelectorAll("button")].find(
        candidate => candidate.textContent?.trim() === "Выбрать объект",
      );
      if (!(button instanceof HTMLButtonElement)) throw new Error("Кнопка выбора объекта не найдена");
      button.click();
    });

    await assertAvailableRoute(chromium, {
      route: "/object",
      selector: "h2",
      title: "Склад",
    });
  } finally {
    chromium.page.close();
    await stopChild(chromium.browser, true);
    await rm(chromium.userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    await stopChild(server);
  }
});

test("блокировка записи localStorage не мешает открыть экономику", { concurrency: false }, async () => {
  const server = await startApp();
  const chromium = await startChromium();
  try {
    await chromium.page.enableBrowserDiagnostics();
    await chromium.page.command("Page.navigate", { url: `${baseUrl}/solutions` });
    await chromium.page.waitFor(() => Boolean(document.querySelector('[data-testid="page-solutions"]')));
    await chromium.page.evaluate(() => {
      const originalSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function(key, value) {
        if (key === "robotshub_project" || key === "robotshub_project_recovery_notice") {
          throw new DOMException("Квота localStorage исчерпана", "QuotaExceededError");
        }
        return originalSetItem.call(this, key, value);
      };
      const button = document.querySelector('[data-testid^="button-calculate-"]');
      if (!(button instanceof HTMLButtonElement)) throw new Error("Кнопка расчёта решения не найдена");
      button.click();
    });

    await assertAvailableRoute(chromium, {
      route: "/calc",
      selector: "h1",
      title: "Экономический расчет",
    });
  } finally {
    chromium.page.close();
    await stopChild(chromium.browser, true);
    await rm(chromium.userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    await stopChild(server);
  }
});

test("новый расчёт сбрасывает What-If и очищает сохранённые overrides", { concurrency: false }, async () => {
  const server = await startApp();
  const chromium = await startChromium();
  try {
    await chromium.page.command("Page.navigate", { url: `${baseUrl}/` });
    await chromium.page.waitFor(() => document.readyState === "complete");
    await chromium.page.evaluate(state => {
      localStorage.setItem("robotshub_project", JSON.stringify(state));
    }, {
      objectType: "warehouse",
      objectParams,
      selectedSolutions: [selectedSolution.id],
      activeSolutionId: selectedSolution.id,
      whatIfOverrides: {
        salaryMultiplier: 0.8,
        priceMultiplier: 1.3,
        volumeMultiplier: 2,
      },
      assumptionsOverrides: {},
    });
    await chromium.page.command("Page.navigate", { url: `${baseUrl}/calc` });
    await chromium.page.waitFor(
      selector => Boolean(document.querySelector(selector)),
      '[data-testid="button-new-calculation"]',
    );

    await chromium.page.evaluate(() => {
      const button = document.querySelector('[data-testid="button-new-calculation"]');
      if (!(button instanceof HTMLButtonElement)) {
        throw new Error("Кнопка нового расчёта не найдена");
      }
      button.focus();
      button.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
      button.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, button: 0 }));
      button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    await chromium.page.waitFor(() => {
      const saved = JSON.parse(localStorage.getItem("robotshub_project") ?? "{}");
      return Array.isArray(saved.selectedSolutions)
        && saved.selectedSolutions.length === 0
        && JSON.stringify(saved.whatIfOverrides) === JSON.stringify({});
    });
    assert.deepEqual(
      await chromium.page.evaluate(() => JSON.parse(localStorage.getItem("robotshub_project") ?? "{}").whatIfOverrides),
      {},
      "после создания нового расчёта в localStorage не должны остаться старые What-If overrides",
    );

    await chromium.page.command("Page.navigate", { url: `${baseUrl}/solutions` });
    await chromium.page.waitFor(() => Boolean(document.querySelector('[data-testid="page-solutions"]')));
    await chromium.page.evaluate(solutionId => {
      const button = document.querySelector(`[data-testid="button-calculate-${solutionId}"]`);
      if (!(button instanceof HTMLButtonElement)) {
        throw new Error(`Кнопка расчёта не найдена для модели: ${solutionId}`);
      }
      button.focus();
      button.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
      button.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, button: 0 }));
      button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    }, selectedSolution.id);
    await chromium.page.waitFor(() => Boolean(document.querySelector('[data-testid="slider-what-if-salary"]')));

    const values = await chromium.page.evaluate(() => Object.fromEntries(
      ["salary", "price", "volume"].map(key => [
        key,
        document.querySelector(`[data-testid="slider-what-if-${key}"] [role="slider"]`)?.getAttribute("aria-valuenow") ?? null,
      ]),
    ));
    assert.deepEqual(
      values,
      { salary: "1", price: "1", volume: "1" },
      "новый расчёт должен показывать базовые значения What-If 1.0 для всех ползунков",
    );
  } finally {
    chromium.page.close();
    await stopChild(chromium.browser, true);
    await rm(chromium.userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    await stopChild(server);
  }
});

test("доступный список риска обновляет все интервалы после повторного расчёта", { concurrency: false }, async () => {
  const server = await startApp();
  const chromium = await startChromium();
  try {
    await chromium.page.command("Page.navigate", { url: `${baseUrl}/` });
    await chromium.page.waitFor(() => document.readyState === "complete");
    await chromium.page.evaluate(state => {
      localStorage.setItem("robotshub_project", JSON.stringify(state));
    }, {
      objectType: "warehouse",
      objectParams,
      selectedSolutions: [selectedSolution.id, alternativeSolution.id, thirdSolution.id],
      assumptionsOverrides: {},
    });
    await chromium.page.command("Page.navigate", { url: `${baseUrl}/calc` });
    await chromium.page.waitFor(() => Boolean(document.querySelector('[data-testid="payback-risk-bin-accessible-list"]')));

    const readAccessibleBins = () => chromium.page.evaluate(() => {
      const list = document.querySelector('[data-testid="payback-risk-bin-accessible-list"]');
      return {
        listLabel: list?.getAttribute("aria-label") ?? "",
        items: [...(list?.querySelectorAll('[data-testid^="payback-risk-bin-sr-"]') ?? [])].map(bin => ({
          text: bin.textContent?.trim() ?? "",
          ariaLabel: bin.getAttribute("aria-label") ?? "",
        })),
      };
    });

    const bins = await readAccessibleBins();
    assert.equal(
      bins.listLabel,
      "Все интервалы и количество сценариев по сроку окупаемости",
      "screen reader должен получить название доступного списка",
    );
    assert.equal(
      await chromium.page.evaluate(() => document.querySelector('[data-testid="payback-risk-bin-labels"]')?.getAttribute("aria-hidden")),
      "true",
      "видимая сетка не должна дублироваться в screen reader",
    );
    assert.equal(
      await chromium.page.evaluate(() => document.querySelector('[data-testid="chart-payback-risk"]')?.getAttribute("aria-hidden")),
      "true",
      "декоративный график не должен дублироваться в screen reader",
    );
    assert.equal(bins.items.length, 10, "screen reader должен получить все десять интервалов");
    assert.ok(bins.items.some(bin => bin.ariaLabel.endsWith("0 сценариев")), "screen reader должен получить пустую корзину");
    const expectedLabels = ["0–1", "1–2", "2–3", "3–4", "4–5", "5–6", "6–8", "8–10", ">10", "Не окупается"];
    for (const label of expectedLabels) {
      assert.ok(bins.items.some(bin => bin.text.includes(label)), `screen reader должен получить интервал ${label}`);
    }

    await chromium.page.waitFor(() => Boolean(document.querySelector('[data-testid="tab-tco-chart"]')));
    await chromium.page.evaluate(() => {
      const tab = document.querySelector('[data-testid="tab-tco-chart"]');
      tab?.focus();
      tab?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
      tab?.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, button: 0 }));
      tab?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
    });
    await chromium.page.waitFor(() => document.querySelector('[data-testid="tab-tco-chart"]')?.getAttribute("aria-selected") === "true");
    await chromium.page.waitFor(() => Boolean(document.querySelector('[data-testid="tco-chart-accessible-table"]')));

    const readTcoTable = () => chromium.page.evaluate(() => {
      const table = document.querySelector('[data-testid="tco-chart-accessible-table"]');
      return {
        caption: table?.querySelector("caption")?.textContent?.trim() ?? "",
        headers: [...(table?.querySelectorAll("thead th") ?? [])].map(cell => cell.textContent?.trim() ?? ""),
        rows: [...(table?.querySelectorAll("tbody tr") ?? [])].map(row => ({
          cells: [...row.querySelectorAll("th, td")].map(cell => cell.textContent?.trim() ?? ""),
          testId: row.getAttribute("data-testid") ?? "",
        })),
      };
    });
    const readWhatIfValues = () => chromium.page.evaluate(() => Object.fromEntries(
      ["salary", "price", "volume"].map(key => [
        key,
        document.querySelector(`[data-testid="slider-what-if-${key}"] [role="slider"]`)?.getAttribute("aria-valuenow") ?? null,
      ]),
    ));

    const initialTcoTable = await readTcoTable();
    assert.match(
      initialTcoTable.caption,
      /^Распределение TCO по сценариям за \d+ лет$/,
      "таблица TCO должна иметь отдельное семантическое описание горизонта",
    );
    assert.deepEqual(
      initialTcoTable.headers,
      ["Сценарий", "CAPEX", "OPEX за 5 лет", "TCO за 5 лет"],
      "screen reader должен получить подписи всех серий и периода",
    );
    assert.equal(
      initialTcoTable.rows.length,
      4,
      "первоначально screen reader должен получить строку для каждого сценария на графике",
    );
    assert.ok(
      initialTcoTable.rows.every(row => row.testId.startsWith("tco-chart-sr-row-") && row.cells.length === 4 && row.cells.every(Boolean)),
      "первоначально screen reader должен получить название сценария и значение каждой серии для каждой строки",
    );
    assert.equal(
      await chromium.page.evaluate(() => document.querySelector('[data-testid="chart-tco"]')?.getAttribute("aria-hidden")),
      "true",
      "декоративный график TCO не должен дублироваться в screen reader",
    );

    await chromium.page.evaluate(() => {
      const tab = document.querySelector('[data-testid="tab-tco-cards"]');
      tab?.focus();
      tab?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
      tab?.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, button: 0 }));
      tab?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
    });
    await chromium.page.waitFor(() => document.querySelector('[data-testid="tab-tco-cards"]')?.getAttribute("aria-selected") === "true");
    await chromium.page.waitFor(() => Boolean(document.querySelector('[data-testid="payback-risk-bin-accessible-list"]')));

    const initialBinsText = bins.items.map(bin => bin.text).join("|");
    const updateSlider = async (selector, expectedValue, key, code, keyCode, steps) => {
      const initialValue = await chromium.page.evaluate(targetSelector => {
        const slider = document.querySelector(targetSelector);
        slider?.focus();
        return slider?.getAttribute("aria-valuenow") ?? null;
      }, selector);
      assert.equal(initialValue, "1", `сценарий должен сфокусировать ползунок ${selector}`);
      for (let step = 0; step < steps; step += 1) {
        await chromium.page.pressKey(key, code, keyCode);
      }
      await chromium.page.waitFor(
        value => document.querySelector(value.selector)?.getAttribute("aria-valuenow") === value.expectedValue,
        { selector, expectedValue },
      );
    };

    await updateSlider(
      '[role="slider"][aria-valuemin="0.8"][aria-valuemax="1.5"]',
      "0.8",
      "ArrowLeft",
      "ArrowLeft",
      37,
      4,
    );
    await updateSlider(
      '[role="slider"][aria-valuemin="0.7"][aria-valuemax="1.3"]',
      "1.3",
      "ArrowRight",
      "ArrowRight",
      39,
      6,
    );
    await updateSlider(
      '[role="slider"][aria-valuemin="0.5"][aria-valuemax="2"]',
      "2",
      "ArrowRight",
      "ArrowRight",
      39,
      10,
    );

    await chromium.page.waitFor(
      initialText => {
        const list = document.querySelector('[data-testid="payback-risk-bin-accessible-list"]');
        const currentText = [...(list?.querySelectorAll('[data-testid^="payback-risk-bin-sr-"]') ?? [])]
          .map(bin => bin.textContent?.trim() ?? "")
          .join("|");
        return currentText !== "" && currentText !== initialText;
      },
      initialBinsText,
    );

    const recalculatedBins = await readAccessibleBins();
    assert.notEqual(
      recalculatedBins.items.map(bin => bin.text).join("|"),
      initialBinsText,
      "после изменения What-If screen reader должен получить новые количества",
    );
    assert.equal(recalculatedBins.items.length, 10, "после повторного расчёта должны остаться все десять интервалов");
    assert.ok(
      recalculatedBins.items.some(bin => bin.ariaLabel.endsWith("0 сценариев")),
      "после повторного расчёта screen reader должен получить пустую корзину",
    );
    for (const label of expectedLabels) {
      assert.ok(
        recalculatedBins.items.some(bin => bin.text.includes(label)),
        `после повторного расчёта screen reader должен получить интервал ${label}`,
      );
    }
    assert.ok(
      recalculatedBins.items.every(bin => bin.text === bin.ariaLabel),
      "screen reader должен озвучивать количество из обновлённого текста интервала",
    );
    const recalculatedTotal = recalculatedBins.items.reduce((total, bin) => {
      const match = bin.text.match(/: ([\d\s]+) сценариев$/);
      assert.ok(match, `у интервала должно быть озвучиваемое количество: ${bin.text}`);
      return total + Number(match[1].replace(/\s/g, ""));
    }, 0);
    assert.equal(recalculatedTotal, 1_000, "количества всех интервалов должны покрывать все сценарии расчёта");
    const changedWhatIfValues = await readWhatIfValues();
    assert.deepEqual(
      changedWhatIfValues,
      { salary: "0.8", price: "1.3", volume: "2" },
      "до смены модели должны быть зафиксированы изменённые значения What-If",
    );

    await chromium.page.evaluate(() => {
      const tab = document.querySelector('[data-testid="tab-tco-chart"]');
      tab?.focus();
      tab?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
      tab?.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, button: 0 }));
      tab?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
    });
    await chromium.page.waitFor(() => document.querySelector('[data-testid="tab-tco-chart"]')?.getAttribute("aria-selected") === "true");
    await chromium.page.waitFor(() => Boolean(document.querySelector('[data-testid="tco-chart-accessible-table"]')));

    await chromium.page.waitFor(
      initialRows => {
        const table = document.querySelector('[data-testid="tco-chart-accessible-table"]');
        const currentRows = [...(table?.querySelectorAll("tbody tr") ?? [])].map(row => ({
          cells: [...row.querySelectorAll("th, td")].map(cell => cell.textContent?.trim() ?? ""),
          testId: row.getAttribute("data-testid") ?? "",
        }));
        return currentRows.length === initialRows.length
          && JSON.stringify(currentRows) !== JSON.stringify(initialRows);
      },
      initialTcoTable.rows,
    );

    const tcoTable = await readTcoTable();
    assert.match(
      tcoTable.caption,
      /^Распределение TCO по сценариям за \d+ лет$/,
      "таблица TCO должна иметь отдельное семантическое описание горизонта",
    );
    assert.deepEqual(
      tcoTable.headers,
      ["Сценарий", "CAPEX", "OPEX за 5 лет", "TCO за 5 лет"],
      "screen reader должен получить подписи всех серий и периода",
    );
    assert.equal(
      tcoTable.rows.length,
      4,
      "после повторного расчёта screen reader должен получить строку для каждого сценария на графике",
    );
    assert.ok(
      tcoTable.rows.every(row => row.testId.startsWith("tco-chart-sr-row-") && row.cells.length === 4 && row.cells.every(Boolean)),
      "после повторного расчёта screen reader должен получить название сценария и значение каждой серии для каждой строки",
    );
    assert.deepEqual(
      tcoTable.headers,
      initialTcoTable.headers,
      "после повторного расчёта должны сохраниться подписи всех серий и периода",
    );
    assert.deepEqual(
      tcoTable.rows.map(row => row.cells[0]),
      initialTcoTable.rows.map(row => row.cells[0]),
      "после повторного расчёта должны сохраниться все строки сценариев",
    );
    assert.ok(
      tcoTable.rows.some((row, index) => row.cells[3] !== initialTcoTable.rows[index]?.cells[3]),
      "после изменения What-If screen reader должен получить новые суммы TCO",
    );
    assert.equal(
      await chromium.page.evaluate(() => document.querySelector('[data-testid="chart-tco"]')?.getAttribute("aria-hidden")),
      "true",
      "декоративный график TCO не должен дублироваться в screen reader",
    );

    await chromium.page.waitFor(
      expectedValues => {
        const saved = JSON.parse(localStorage.getItem("robotshub_project") ?? "{}");
        return JSON.stringify(saved.whatIfOverrides) === JSON.stringify({
          salaryMultiplier: Number(expectedValues.salary),
          priceMultiplier: Number(expectedValues.price),
          volumeMultiplier: Number(expectedValues.volume),
        });
      },
      changedWhatIfValues,
    );
    await chromium.page.command("Page.reload", { ignoreCache: true });
    await chromium.page.waitFor(() => document.readyState === "complete");
    await chromium.page.waitFor(
      expectedValues => JSON.stringify(Object.fromEntries(
        ["salary", "price", "volume"].map(key => [
          key,
          document.querySelector(`[data-testid="slider-what-if-${key}"] [role="slider"]`)?.getAttribute("aria-valuenow") ?? null,
        ]),
      )) === JSON.stringify(expectedValues),
      changedWhatIfValues,
    );
    assert.deepEqual(
      await readWhatIfValues(),
      changedWhatIfValues,
      "после обновления /calc должны восстановиться изменённые значения What-If",
    );

    await chromium.page.evaluate(() => {
      const tab = document.querySelector('[data-testid="tab-tco-chart"]');
      tab?.focus();
      tab?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
      tab?.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, button: 0 }));
      tab?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
    });
    await chromium.page.waitFor(() => document.querySelector('[data-testid="tab-tco-chart"]')?.getAttribute("aria-selected") === "true");
    await chromium.page.waitFor(() => Boolean(document.querySelector('[data-testid="tco-chart-accessible-table"]')));
    const restoredTcoTable = await readTcoTable();
    assert.equal(
      restoredTcoTable.rows.length,
      4,
      "после обновления /calc таблица TCO должна снова содержать четыре сценария",
    );
    assert.deepEqual(
      restoredTcoTable,
      tcoTable,
      "после обновления /calc должны сохраниться серии и пересчитанные значения TCO",
    );

    const expectedScenarioNames = [
      "Как есть (Ручной труд)",
      "Покупка (Собственные средства)",
      "Лизинг",
      "RaaS (Подписка)",
    ];
    assert.deepEqual(
      initialTcoTable.rows.map(row => row.cells[0]),
      expectedScenarioNames,
      "первоначально таблица TCO должна содержать названия всех сценариев",
    );

    const assertModelSwitchTable = (nextTable, previousTable, modelName) => {
      assert.deepEqual(
        nextTable.headers,
        previousTable.headers,
        `после перехода на модель «${modelName}» должны сохраниться подписи всех серий и периода`,
      );
      assert.equal(
        nextTable.rows.length,
        4,
        `после перехода на модель «${modelName}» таблица должна содержать четыре сценария`,
      );
      assert.ok(
        nextTable.rows.every(row => (
          row.testId.startsWith("tco-chart-sr-row-")
          && row.cells.length === 4
          && row.cells.every(Boolean)
        )),
        `после перехода на модель «${modelName}» должны сохраниться все серии TCO для каждого сценария`,
      );
      assert.deepEqual(
        nextTable.rows.map(row => row.cells[0]),
        expectedScenarioNames,
        `после перехода на модель «${modelName}» должны сохраниться названия всех сценариев`,
      );

      const parseCurrency = text => Number(text.replace(/[^\d-]/g, ""));
      const previousTcoTotal = previousTable.rows.reduce((total, row) => total + parseCurrency(row.cells[3]), 0);
      const nextTcoTotal = nextTable.rows.reduce((total, row) => total + parseCurrency(row.cells[3]), 0);
      assert.notEqual(
        nextTcoTotal,
        previousTcoTotal,
        `после перехода на модель «${modelName}» сумма TCO должна измениться`,
      );
    };

    const switchModelAndAssert = async (model, previousTable) => {
      await chromium.page.evaluate(({ selector }) => {
        const button = document.querySelector(selector);
        if (!(button instanceof HTMLButtonElement)) {
          throw new Error(`Кнопка решения не найдена: ${selector}`);
        }
        button.focus();
        button.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
        button.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, button: 0 }));
        button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      }, {
        selector: `[data-testid="button-calc-solution-${model.id}"]`,
      });
      await chromium.page.waitFor(
        selector => document.querySelector(selector)?.getAttribute("aria-pressed") === "true",
        `[data-testid="button-calc-solution-${model.id}"]`,
      );
      await chromium.page.waitFor(
        name => document.querySelector('[data-testid="calc-active-solution-name"]')?.textContent?.trim() === name,
        model.name,
      );
      await chromium.page.waitFor(
        initialRows => {
          const table = document.querySelector('[data-testid="tco-chart-accessible-table"]');
          const currentRows = [...(table?.querySelectorAll("tbody tr") ?? [])].map(row => ({
            cells: [...row.querySelectorAll("th, td")].map(cell => cell.textContent?.trim() ?? ""),
            testId: row.getAttribute("data-testid") ?? "",
          }));
          return currentRows.length === initialRows.length
            && JSON.stringify(currentRows) !== JSON.stringify(initialRows);
        },
        previousTable.rows,
      );

      const nextTable = await readTcoTable();
      assertModelSwitchTable(nextTable, previousTable, model.name);
      assert.deepEqual(
        await readWhatIfValues(),
        changedWhatIfValues,
        `после перехода на модель «${model.name}» должны сохраниться изменённые значения What-If`,
      );
      return nextTable;
    };

    const tcoBeforeModelSwitch = await readTcoTable();
    assert.equal(
      tcoBeforeModelSwitch.rows.length,
      4,
      "до повторных переходов таблица TCO должна содержать четыре сценария",
    );
    let currentTcoTable = tcoBeforeModelSwitch;
    for (const model of [alternativeSolution, thirdSolution, selectedSolution, alternativeSolution, thirdSolution]) {
      currentTcoTable = await switchModelAndAssert(model, currentTcoTable);
    }

    const tcoBeforeAssumptionChange = await readTcoTable();
    await chromium.page.evaluate(({ selector, value }) => {
      const input = document.querySelector(selector);
      if (!(input instanceof HTMLInputElement)) {
        throw new Error(`Поле допущения не найдено: ${selector}`);
      }
      const setNativeValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      if (!setNativeValue) throw new Error("Не удалось изменить значение числового поля");
      setNativeValue.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }, {
      selector: '[data-testid="input-assumption-servicePct"]',
      value: "25",
    });
    await chromium.page.waitFor(
      () => document.querySelector('[data-testid="input-assumption-servicePct"]')?.value === "25",
    );
    await chromium.page.waitFor(
      initialRows => {
        const table = document.querySelector('[data-testid="tco-chart-accessible-table"]');
        const currentRows = [...(table?.querySelectorAll("tbody tr") ?? [])].map(row => ({
          cells: [...row.querySelectorAll("th, td")].map(cell => cell.textContent?.trim() ?? ""),
          testId: row.getAttribute("data-testid") ?? "",
        }));
        return currentRows.length === initialRows.length
          && JSON.stringify(currentRows) !== JSON.stringify(initialRows);
      },
      tcoBeforeAssumptionChange.rows,
    );

    const tcoAfterAssumption = await readTcoTable();
    assert.equal(
      await chromium.page.evaluate(() => document.querySelector('[data-testid="input-assumption-servicePct"]')?.value),
      "25",
      "поле допущения должно сохранить введённый сервисный процент",
    );
    assert.deepEqual(
      tcoAfterAssumption.headers,
      tcoBeforeAssumptionChange.headers,
      "после изменения допущения должны сохраниться подписи всех серий и периода",
    );
    assert.equal(
      tcoAfterAssumption.rows.length,
      tcoBeforeAssumptionChange.rows.length,
      "после изменения допущения должна сохраниться строка для каждого сценария",
    );
    assert.ok(
      tcoAfterAssumption.rows.every(row => (
        row.testId.startsWith("tco-chart-sr-row-")
        && row.cells.length === 4
        && row.cells.every(Boolean)
      )),
      "после изменения допущения screen reader должен получить название сценария и все серии каждой строки",
    );
    assert.deepEqual(
      tcoAfterAssumption.rows.map(row => row.cells[0]),
      tcoBeforeAssumptionChange.rows.map(row => row.cells[0]),
      "после изменения допущения должны сохраниться все строки сценариев",
    );
    assert.ok(
      tcoAfterAssumption.rows.some((row, index) => row.cells[3] !== tcoBeforeAssumptionChange.rows[index]?.cells[3]),
      "после изменения сервисного процента screen reader должен получить новые суммы TCO",
    );
  } finally {
    chromium.page.close();
    await stopChild(chromium.browser, true);
    await rm(chromium.userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    await stopChild(server);
  }
});

test("симуляция перестраивает canvas после изменения сохранённых параметров объекта", { concurrency: false }, async () => {
  const server = await startApp();
  const chromium = await startChromium();
  const baseObjectParams = {
    ...objectParams,
    total_area_m2: 20_000,
    floors_count: 2,
    rack_rows: 8,
    docks_count: 4,
    charge_stations: 3,
  };
  const changedObjectParams = {
    ...baseObjectParams,
    total_area_m2: 60_000,
    floors_count: 3,
    rack_rows: 14,
    docks_count: 1,
    charge_stations: 6,
  };
  const project = (params) => ({
    objectType: "warehouse",
    objectParams: params,
    selectedSolutions: [selectedSolution.id],
    activeSolutionId: selectedSolution.id,
    whatIfOverrides: {},
    assumptionsOverrides: {},
  });
  const pauseAndSnapshot = async () => {
    await chromium.page.waitFor(() => Boolean(document.querySelector('[data-testid="simulation-canvas"]')));
    await chromium.page.evaluate(() => {
      const button = document.querySelector('[data-testid="sim-toggle-running"]');
      if (!(button instanceof HTMLButtonElement)) throw new Error("Кнопка паузы симуляции не найдена");
      button.click();
    });
    await chromium.page.waitFor(
      () => document.querySelector('[data-testid="sim-toggle-running"]')?.textContent?.includes("Пуск") ?? false,
    );
    await new Promise(resolve => setTimeout(resolve, 100));
    return chromium.page.evaluate(() => {
      const canvas = document.querySelector('[data-testid="simulation-canvas"]');
      if (!(canvas instanceof HTMLCanvasElement)) throw new Error("Canvas симуляции не найден");
      const context = canvas.getContext("2d");
      if (!context) throw new Error("2D-контекст canvas недоступен");
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let hash = 2166136261;
      for (let index = 0; index < pixels.length; index += 4) {
        hash ^= pixels[index];
        hash = Math.imul(hash, 16777619);
        hash ^= pixels[index + 1];
        hash = Math.imul(hash, 16777619);
        hash ^= pixels[index + 2];
        hash = Math.imul(hash, 16777619);
      }
      return {
        hash: hash >>> 0,
      };
    });
  };

  try {
    await chromium.page.command("Page.navigate", { url: `${baseUrl}/` });
    await chromium.page.waitFor(() => document.readyState === "complete");
    await chromium.page.evaluate(state => {
      localStorage.setItem("robotshub_project", JSON.stringify(state));
    }, project(baseObjectParams));
    await chromium.page.command("Page.navigate", { url: `${baseUrl}/simulation` });
    await chromium.page.waitFor(() => Boolean(document.querySelector('[data-testid="page-simulation"]')));
    const initial = await pauseAndSnapshot();

    const initialGeometry = await chromium.page.evaluate(() => ({
      title: document.querySelector('[data-testid="page-simulation"]')?.textContent?.replace(/\s+/g, " ") ?? "",
      floors: document.querySelectorAll('[data-testid^="simulation-floor-"]').length,
    }));
    assert.match(initialGeometry.title, /20 000/, "симуляция должна показывать площадь из сохранённого проекта");
    assert.equal(initialGeometry.floors, 2, "начальная сцена должна показать два этажа");

    await chromium.page.evaluate(state => {
      localStorage.setItem("robotshub_project", JSON.stringify(state));
    }, project(changedObjectParams));
    await chromium.page.command("Page.navigate", { url: `${baseUrl}/simulation` });
    await chromium.page.waitFor(() => Boolean(document.querySelector('[data-testid="page-simulation"]')));
    const changed = await pauseAndSnapshot();

    const changedGeometry = await chromium.page.evaluate(() => ({
      title: document.querySelector('[data-testid="page-simulation"]')?.textContent?.replace(/\s+/g, " ") ?? "",
      floors: document.querySelectorAll('[data-testid^="simulation-floor-"]').length,
    }));
    assert.match(changedGeometry.title, /60 000/, "после перезагрузки должна быть видна новая площадь");
    assert.notEqual(
      changed.hash,
      initial.hash,
      "после изменения площади, этажности, рядов, постов и зарядок должен измениться рисунок canvas",
    );
    assert.equal(changedGeometry.floors, 3, "сцена с дополнительным этажом должна показать три контроля этажа");
    assert.deepEqual(chromium.page.browserErrors(), [], "перестроение сцены не должно оставлять ошибок браузера");
  } finally {
    chromium.page.close();
    await stopChild(chromium.browser, true);
    await rm(chromium.userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    await stopChild(server);
  }
});

test("отчёт не показывает KPI старой этажности после изменения объекта", { concurrency: false }, async () => {
  const server = await startApp();
  const chromium = await startChromium();
  const twoFloorParams = {
    ...objectParams,
    total_area_m2: 20_000,
    floors_count: 2,
    rack_rows: 8,
    docks_count: 4,
    charge_stations: 3,
  };
  const oneFloorParams = {
    ...twoFloorParams,
    floors_count: 1,
  };
  const project = (params) => ({
    objectType: "warehouse",
    objectParams: params,
    selectedSolutions: [selectedSolution.id],
    activeSolutionId: selectedSolution.id,
    whatIfOverrides: {},
    assumptionsOverrides: {},
  });

  try {
    await chromium.page.command("Page.navigate", { url: `${baseUrl}/` });
    await chromium.page.waitFor(() => document.readyState === "complete");
    await chromium.page.evaluate(state => {
      localStorage.clear();
      localStorage.setItem("robotshub_project", JSON.stringify(state));
    }, project(twoFloorParams));

    await chromium.page.command("Page.navigate", { url: `${baseUrl}/simulation` });
    await chromium.page.waitFor(() => Boolean(document.querySelector('[data-testid="page-simulation"]')));
    await chromium.page.waitFor(
      () => document.querySelectorAll('[data-testid^="simulation-floor-warehouse-"]').length === 2,
    );
    await chromium.page.evaluate(() => {
      const button = document.querySelector('[data-testid="button-go-report"]');
      if (!(button instanceof HTMLButtonElement)) throw new Error("Кнопка отчёта не найдена");
      button.click();
    });
    await chromium.page.waitFor(() => window.location.pathname === "/report");
    await chromium.page.waitFor(() => Boolean(document.querySelector('[data-testid="report-floor-kpis-warehouse-2"]')));

    const savedTwoFloorReport = await chromium.page.evaluate(() => ({
      rows: document.querySelectorAll('[data-testid^="report-floor-kpis-warehouse-"]').length,
      geometry: document.querySelector('[data-testid="report-geometry-floors"]')?.textContent?.replace(/\s+/g, " ").trim() ?? "",
    }));
    assert.equal(savedTwoFloorReport.rows, 2, "после запуска двухэтажной симуляции отчёт должен показать два этажа");
    assert.match(savedTwoFloorReport.geometry, /2/, "снимок двухэтажной сцены должен сохранить её геометрию");

    await chromium.page.command("Page.navigate", { url: `${baseUrl}/object` });
    await chromium.page.waitFor(() => Boolean(document.querySelector('input[name="floors_count"]')));
    await chromium.page.evaluate(() => {
      const input = document.querySelector('input[name="floors_count"]');
      if (!(input instanceof HTMLInputElement)) throw new Error("Поле этажности не найдено");
      input.focus();
      input.select();
    });
    await chromium.page.command("Input.insertText", { text: "1" });
    await chromium.page.waitFor(
      () => document.querySelector('input[name="floors_count"]')?.value === "1",
    );
    await chromium.page.evaluate(() => {
      const button = document.querySelector('[data-testid="object-next-step"]');
      if (!(button instanceof HTMLButtonElement)) throw new Error("Кнопка сохранения параметров не найдена");
      button.click();
    });
    await chromium.page.waitFor(() => Boolean(document.querySelector('[data-testid="object-group-mode"]')));

    await chromium.page.command("Page.navigate", { url: `${baseUrl}/report` });
    await chromium.page.waitFor(() => Boolean(document.querySelector('[data-testid="card-report-floor-kpis"]')));
    const staleReport = await chromium.page.evaluate(() => ({
      rows: document.querySelectorAll('[data-testid^="report-floor-kpis-warehouse-"]').length,
      cardText: document.querySelector('[data-testid="card-report-floor-kpis"]')?.textContent?.replace(/\s+/g, " ").trim() ?? "",
      geometry: Boolean(document.querySelector('[data-testid="report-geometry-floors"]')),
    }));
    assert.equal(staleReport.rows, 0, "после изменения этажности старые строки этажей нельзя показывать");
    assert.match(staleReport.cardText, /Снимок симуляции для этого состава объекта недоступен/, "отчёт должен попросить новый снимок");
    assert.equal(staleReport.geometry, false, "геометрия старой двухэтажной сцены не должна попасть в отчёт");

    await chromium.page.command("Page.navigate", { url: `${baseUrl}/simulation` });
    await chromium.page.waitFor(() => Boolean(document.querySelector('[data-testid="page-simulation"]')));
    await chromium.page.waitFor(() => {
      const geometry = document.querySelector('[data-testid="simulation-geometry-floors"]');
      return geometry?.textContent?.includes("1") ?? false;
    });
    await chromium.page.evaluate(() => {
      const button = document.querySelector('[data-testid="button-go-report"]');
      if (!(button instanceof HTMLButtonElement)) throw new Error("Кнопка отчёта не найдена");
      button.click();
    });
    await chromium.page.waitFor(() => window.location.pathname === "/report");
    await chromium.page.waitFor(() => Boolean(document.querySelector('[data-testid="report-floor-kpis-warehouse-1"]')));

    const refreshedReport = await chromium.page.evaluate(() => ({
      rows: [...document.querySelectorAll('[data-testid^="report-floor-kpis-warehouse-"]')]
        .map(row => row.textContent?.replace(/\s+/g, " ").trim() ?? ""),
      verticalTrips: document.querySelector('[data-testid="report-vertical-trips"]')?.textContent?.trim() ?? "",
      geometry: document.querySelector('[data-testid="report-geometry-floors"]')?.textContent?.replace(/\s+/g, " ").trim() ?? "",
    }));
    assert.equal(refreshedReport.rows.length, 1, "после повторного запуска отчёт должен показать один актуальный этаж");
    assert.match(refreshedReport.rows[0], /1 этаж/, "новый снимок должен содержать первый этаж");
    assert.doesNotMatch(refreshedReport.rows[0], /2 этаж/, "новый снимок не должен содержать второй этаж");
    assert.equal(refreshedReport.verticalTrips, "0", "для одного этажа вертикальные поездки должны быть нулевыми");
    assert.match(refreshedReport.geometry, /1/, "геометрия нового снимка должна быть одноэтажной");
    assert.deepEqual(chromium.page.browserErrors(), [], "сценарий изменения этажности не должен оставлять ошибок браузера");
  } finally {
    chromium.page.close();
    await stopChild(chromium.browser, true);
    await rm(chromium.userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    await stopChild(server);
  }
});

test("экспорт отчёта явно отмечает неприменимые элементы сцены", { concurrency: false }, async () => {
  const server = await startApp();
  const chromium = await startChromium();
  const reportCases = [
    {
      name: "склад",
      objectType: "warehouse",
      template: warehouseTemplate,
      expected: {
        rows: ["Ряды", "16", "8", "применяется"],
        posts: ["Посты", "4", "-", "применяется"],
      },
    },
    {
      name: "аэропорт",
      objectType: "airport",
      template: airportTemplate,
      expected: {
        rows: ["Ряды", "-", "-", "не применяется"],
        posts: ["Посты", "2", "-", "применяется"],
      },
    },
    {
      name: "медучреждение",
      objectType: "medical",
      template: medicalTemplate,
      expected: {
        rows: ["Ряды", "-", "-", "не применяется"],
        posts: ["Посты", "-", "-", "не применяется"],
      },
    },
  ];

  try {
    await chromium.page.command("Page.navigate", { url: `${baseUrl}/` });
    await chromium.page.waitFor(() => document.readyState === "complete");

    for (const reportCase of reportCases) {
      await chromium.page.evaluate(state => {
        localStorage.clear();
        localStorage.setItem("robotshub_project", JSON.stringify(state));
      }, {
        objectType: reportCase.objectType,
        objectParams: templateParams(reportCase.template),
        selectedSolutions: [selectedSolution.id],
        activeSolutionId: selectedSolution.id,
        whatIfOverrides: {},
        assumptionsOverrides: {},
        simulationKpis: null,
      });
      await chromium.page.command("Page.reload", { ignoreCache: true });
      await chromium.page.waitFor(() => document.readyState === "complete");
      await chromium.page.command("Page.navigate", { url: `${baseUrl}/simulation` });
      await chromium.page.waitFor(() => Boolean(document.querySelector('[data-testid="page-simulation"]')));
      await chromium.page.waitFor(() => Boolean(document.querySelector('[data-testid="simulation-geometry"]')));
      await chromium.page.waitFor(() => Boolean(document.querySelector('[data-testid="simulation-canvas"]')));

      await chromium.page.evaluate(() => {
        const button = document.querySelector('[data-testid="button-go-report"]');
        if (!(button instanceof HTMLButtonElement)) throw new Error("Кнопка отчёта не найдена");
        button.click();
      });
      await chromium.page.waitFor(() => window.location.pathname === "/report");
      await chromium.page.waitFor(() => Boolean(document.querySelector('[data-testid="button-export-csv"]')));

      const csv = await exportReportCsv(chromium);
      const geometryRows = parseGeometryCsvRows(csv);
      assert.deepEqual(
        geometryRows["Ряды"],
        reportCase.expected.rows,
        `${reportCase.name}: CSV должен сохранить применимость рядов и их количество`,
      );
      assert.deepEqual(
        geometryRows["Посты"],
        reportCase.expected.posts,
        `${reportCase.name}: CSV должен сохранить применимость постов и их количество`,
      );
      assert.deepEqual(
        geometryRows["Зарядки"],
        ["Зарядки", "6", "3", "применяется"],
        `${reportCase.name}: CSV должен содержать фактическое количество зарядок`,
      );
    }

    assert.deepEqual(chromium.page.browserErrors(), [], "экспорт отчёта не должен оставлять ошибок браузера");
  } finally {
    chromium.page.close();
    await stopChild(chromium.browser, true);
    await rm(chromium.userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    await stopChild(server);
  }
});

test("скачивание CSV отчёта сохраняет seed, поездки и все этажи", { concurrency: false }, async () => {
  const downloadDirs = [];
  const server = await startApp();
  let chromium = await startChromium();
  const reportCases = [
    {
      name: "многоэтажный отчёт с пользовательским названием этажа",
      floors: 2,
      customFloorLabel: '2 этаж,\nзона "B", пользовательская',
    },
    { name: "одноэтажный отчёт", floors: 1 },
  ];
  const project = floors => ({
    objectType: "warehouse",
    objectParams: {
      ...templateParams(warehouseTemplate),
      floors_count: floors,
    },
    selectedSolutions: [selectedSolution.id],
    activeSolutionId: selectedSolution.id,
    whatIfOverrides: {},
    assumptionsOverrides: {},
    simulationKpis: null,
  });
  const localizedNumber = value => Number(value.replace(/[^\d-]/g, ""));
  const normalizeCsvText = value => value.replaceAll("\u00a0", " ");

  try {
    for (const [reportCaseIndex, reportCase] of reportCases.entries()) {
      const downloadDir = await mkdtemp(path.join(tmpdir(), "robotshub-report-download-"));
      downloadDirs.push(downloadDir);
      await chromium.page.command("Page.navigate", { url: `${baseUrl}/` });
      await chromium.page.waitFor(() => document.readyState === "complete");
      await chromium.page.evaluate(state => {
        localStorage.clear();
        localStorage.setItem("robotshub_project", JSON.stringify(state));
      }, project(reportCase.floors));
      await chromium.page.command("Page.reload", { ignoreCache: true });
      await chromium.page.waitFor(() => document.readyState === "complete");
      await chromium.page.command("Page.navigate", { url: `${baseUrl}/simulation` });
      await chromium.page.waitFor(() => Boolean(document.querySelector('[data-testid="page-simulation"]')));
      await chromium.page.waitFor(() => Boolean(document.querySelector('[data-testid="simulation-canvas"]')));
      if (reportCase.floors > 1) {
        await chromium.page.waitFor(
          floorCount => document.querySelectorAll('[data-testid^="simulation-floor-warehouse-"]').length === floorCount,
          reportCase.floors,
        );
      } else {
        await chromium.page.waitFor(() => Boolean(document.querySelector('[data-testid="simulation-floor-kpis"]')));
      }

      await chromium.page.evaluate(() => {
        const button = document.querySelector('[data-testid="button-go-report"]');
        if (!(button instanceof HTMLButtonElement)) throw new Error("Кнопка отчёта не найдена");
        button.click();
      });
      await chromium.page.waitFor(() => window.location.pathname === "/report");
      await chromium.page.waitFor(() => Boolean(document.querySelector('[data-testid="button-export-csv"]')));
      await chromium.page.waitFor(
        floorCount => document.querySelectorAll('[data-testid^="report-floor-kpis-warehouse-"]').length === floorCount,
        reportCase.floors,
      );
      if (reportCase.customFloorLabel) {
        const storedLabel = await chromium.page.evaluate(customFloorLabel => {
          const raw = localStorage.getItem("robotshub_project");
          if (!raw) throw new Error("Сохранённый проект не найден после симуляции");
          const state = JSON.parse(raw);
          const floor = state.simulationKpis?.floorStats?.[1];
          if (!floor) throw new Error("В сохранённом снимке не найден второй этаж");
          floor.label = customFloorLabel;
          localStorage.setItem("robotshub_project", JSON.stringify(state));
          return floor.label;
        }, reportCase.customFloorLabel);
        assert.equal(
          storedLabel,
          reportCase.customFloorLabel,
          `${reportCase.name}: пользовательское название этажа должно сохраниться в снимке`,
        );
        await chromium.page.command("Page.reload", { ignoreCache: true });
        await chromium.page.waitFor(() => document.readyState === "complete");
        await chromium.page.waitFor(() => Boolean(document.querySelector('[data-testid="button-export-csv"]')));
        await chromium.page.waitFor(
          floorCount => document.querySelectorAll('[data-testid^="report-floor-kpis-warehouse-"]').length === floorCount,
          reportCase.floors,
        );
      }

      const reportKpis = await chromium.page.evaluate(() => {
        const snapshotLabel = document.querySelector('[data-testid="card-report-floor-kpis"]')?.textContent ?? "";
        const seed = snapshotLabel.match(/seed\s+(\d+)/i)?.[1] ?? "";
        const snapshotGeneratedAt = document.querySelector('[data-testid="report-snapshot-generated-at"]')?.textContent?.replace(/\s+/g, " ").trim() ?? "";
        const snapshotInputs = document.querySelector('[data-testid="report-snapshot-inputs"]')?.textContent?.replace(/\s+/g, " ").trim() ?? "";
        const verticalTrips = document.querySelector('[data-testid="report-vertical-trips"]')?.textContent?.trim() ?? "";
        const floors = [...document.querySelectorAll('[data-testid^="report-floor-kpis-warehouse-"]')].map(row => {
          const cells = [...row.querySelectorAll("td")].map(cell => cell.textContent ?? "");
          return {
            label: cells[0].trim(),
            tasks: cells[1].replace(/\s+/g, " ").trim(),
            completed: cells[2].replace(/\s+/g, " ").trim(),
          };
        });
        return { seed, snapshotGeneratedAt, snapshotInputs, verticalTrips, floors };
      });
      assert.equal(reportKpis.seed, "42", `${reportCase.name}: отчёт должен показать seed симуляции`);
      assert.match(
        reportKpis.snapshotGeneratedAt,
        new RegExp(`${reportCase.floors} этаж`),
        `${reportCase.name}: карточка должна показать этажность сохранённого снимка`,
      );
      assert.match(
        reportKpis.snapshotGeneratedAt,
        /сформирован/,
        `${reportCase.name}: карточка должна показать момент формирования снимка`,
      );
      assert.match(
        reportKpis.snapshotInputs,
        /склад/,
        `${reportCase.name}: карточка должна показать состав сохранённых входных параметров`,
      );
      assert.equal(
        reportKpis.floors.length,
        reportCase.floors,
        `${reportCase.name}: отчёт должен показать каждый этаж`,
      );
      if (reportCase.customFloorLabel) {
        assert.equal(
          reportKpis.floors[1]?.label,
          reportCase.customFloorLabel,
          `${reportCase.name}: отчёт должен показать пользовательское название этажа`,
        );
      }

      const csv = await downloadReportCsv(chromium, downloadDir);
      assert.match(csv, /^\uFEFF/, `${reportCase.name}: скачанный CSV должен начинаться с BOM`);
      const simulationCsv = parseSimulationKpiCsvRows(csv);
      assert.deepEqual(
        simulationCsv.header,
        [
          "Seed",
          "Поездки через вертикальный переход",
          "Этаж",
          "Задачи назначено",
          "Задачи выполнено",
          "Этажность снимка",
          "Момент формирования",
          "Состав входных параметров",
        ],
        `${reportCase.name}: CSV должен содержать заголовки межэтажных KPI`,
      );
      assert.equal(
        simulationCsv.rows.length,
        reportKpis.floors.length,
        `${reportCase.name}: CSV должен содержать все строки этажей`,
      );
      assert.equal(
        Number(simulationCsv.rows[0][0]),
        Number(reportKpis.seed),
        `${reportCase.name}: CSV должен сохранить seed отчёта`,
      );
      assert.equal(
        Number(simulationCsv.rows[0][1]),
        localizedNumber(reportKpis.verticalTrips),
        `${reportCase.name}: CSV должен сохранить число межэтажных поездок`,
      );
      assert.deepEqual(
        simulationCsv.rows.map(row => Number(row[0])),
        reportKpis.floors.map(() => Number(reportKpis.seed)),
        `${reportCase.name}: seed должен оставаться в первой колонке каждой строки`,
      );
      assert.deepEqual(
        simulationCsv.rows.map(row => Number(row[1])),
        reportKpis.floors.map(() => localizedNumber(reportKpis.verticalTrips)),
        `${reportCase.name}: число поездок должно оставаться во второй колонке каждой строки`,
      );
      assert.deepEqual(
        simulationCsv.rows.map(row => row[2]),
        reportKpis.floors.map(floor => floor.label),
        `${reportCase.name}: CSV должен сохранить подписи всех этажей`,
      );
      assert.deepEqual(
        simulationCsv.rows.map(row => Number(row[3])),
        reportKpis.floors.map(floor => localizedNumber(floor.tasks)),
        `${reportCase.name}: CSV должен сохранить задачи каждого этажа`,
      );
      assert.deepEqual(
        simulationCsv.rows.map(row => Number(row[4])),
        reportKpis.floors.map(floor => localizedNumber(floor.completed)),
        `${reportCase.name}: CSV должен сохранить выполненные задачи каждого этажа`,
      );
      if (reportCase.customFloorLabel) {
        assert.equal(
          simulationCsv.rows[1][2],
          reportCase.customFloorLabel,
          `${reportCase.name}: запятая и кавычки должны остаться одной ячейкой названия этажа`,
        );
        assert.equal(
          simulationCsv.rows[1].length,
          8,
          `${reportCase.name}: пользовательское название не должно сдвинуть KPI по колонкам`,
        );
      }
      assert.equal(
        simulationCsv.rows[0][5],
        reportKpis.snapshotGeneratedAt.split(" · ")[0],
        `${reportCase.name}: CSV должен использовать ту же этажность снимка, что и карточка`,
      );
      assert.equal(
        simulationCsv.rows[0][6],
        reportKpis.snapshotGeneratedAt.split(" · сформирован ")[1],
        `${reportCase.name}: CSV должен использовать тот же момент формирования, что и карточка`,
      );
      assert.equal(
        normalizeCsvText(simulationCsv.rows[0][7]),
        reportKpis.snapshotInputs,
        `${reportCase.name}: CSV должен использовать те же входные параметры, что и карточка`,
      );
      if (reportCase.floors === 1) {
        assert.equal(
          Number(simulationCsv.rows[0][1]),
          0,
          "одноэтажный CSV должен явно содержать нулевое число межэтажных поездок",
        );
      }
      assert.deepEqual(
        chromium.page.browserErrors(),
        [],
        `${reportCase.name}: скачивание CSV не должно оставлять ошибок браузера`,
      );

      if (reportCase !== reportCases.at(-1)) {
        chromium.page.close();
        await stopChild(chromium.browser, true);
        await rm(chromium.userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
        chromium = await startChromium([], Number(process.env.PAYBACK_RISK_DEBUG_PORT ?? 9226) + reportCaseIndex + 1);
      }
    }

    assert.deepEqual(chromium.page.browserErrors(), [], "скачивание отчёта не должно оставлять ошибок браузера");
  } finally {
    chromium.page.close();
    await stopChild(chromium.browser, true);
    await rm(chromium.userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    await stopChild(server);
    await Promise.all(downloadDirs.map(downloadDir => (
      rm(downloadDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    )));
  }
});

test("переключение этажей сохраняет состав сцены и KPI на разных ширинах", { concurrency: false }, async () => {
  const server = await startApp();
  const chromium = await startChromium();
  const viewportCases = [
    { name: "широкая ширина", width: 1280, height: 900, mobile: false },
    { name: "узкая ширина", width: 390, height: 844, mobile: true },
  ];
  const sceneCases = [
    {
      name: "двухэтажная",
      floors: 2,
      rackRows: 8,
      docks: 4,
      chargeStations: 3,
      expectedGeometry: {
        floors: ["2", "уровней"],
        rows: ["16", "8 на этаж"],
        posts: ["4", "погрузочных"],
        charges: ["6", "3 на этаж"],
      },
    },
    {
      name: "трёхэтажная",
      floors: 3,
      rackRows: 14,
      docks: 1,
      chargeStations: 6,
      expectedGeometry: {
        floors: ["3", "уровней"],
        rows: ["42", "14 на этаж"],
        posts: ["1", "погрузочных"],
        charges: ["18", "6 на этаж"],
      },
    },
  ];
  const project = (sceneCase) => ({
    objectType: "warehouse",
    objectParams: {
      ...objectParams,
      total_area_m2: 20_000,
      floors_count: sceneCase.floors,
      rack_rows: sceneCase.rackRows,
      docks_count: sceneCase.docks,
      charge_stations: sceneCase.chargeStations,
    },
    selectedSolutions: [selectedSolution.id],
    activeSolutionId: selectedSolution.id,
    whatIfOverrides: {},
    assumptionsOverrides: {},
  });
  const readState = async () => chromium.page.evaluate(() => {
    const metric = (testId) => {
      const element = document.querySelector(`[data-testid="${testId}"]`);
      const children = element ? [...element.children] : [];
      return {
        value: children[1]?.textContent?.trim() ?? "",
        detail: children[2]?.textContent?.trim() ?? "",
      };
    };
    const hashCanvas = () => {
      const canvas = document.querySelector('[data-testid="simulation-canvas"]');
      if (!(canvas instanceof HTMLCanvasElement)) return null;
      const context = canvas.getContext("2d");
      if (!context) return null;
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let hash = 2166136261;
      for (let index = 0; index < pixels.length; index += 4) {
        hash ^= pixels[index];
        hash = Math.imul(hash, 16777619);
        hash ^= pixels[index + 1];
        hash = Math.imul(hash, 16777619);
        hash ^= pixels[index + 2];
        hash = Math.imul(hash, 16777619);
      }
      return hash >>> 0;
    };
    return {
      geometry: {
        floors: metric("simulation-geometry-floors"),
        rows: metric("simulation-geometry-rows"),
        posts: metric("simulation-geometry-posts"),
        charges: metric("simulation-geometry-charges"),
      },
      kpis: Object.fromEntries(
        [
          "tasks",
          "money",
          "distance",
          "utilization",
          "battery",
          "vertical-trips",
        ].map((key) => [
          key,
          document.querySelector(`[data-testid="simulation-kpi-${key}"]`)?.textContent?.replace(/\s+/g, " ").trim() ?? "",
        ]),
      ),
      floorKpis: document.querySelector('[data-testid="simulation-floor-kpis"]')?.textContent?.replace(/\s+/g, " ").trim() ?? "",
      floors: [...document.querySelectorAll('[data-testid^="simulation-floor-warehouse-"]')]
        .map((element) => ({
          id: element.getAttribute("data-testid") ?? "",
          label: element.textContent?.replace(/\s+/g, " ").trim() ?? "",
          pressed: element.getAttribute("aria-pressed"),
        })),
      canvasHash: hashCanvas(),
    };
  });

  try {
    for (const viewport of viewportCases) {
      await setViewport(chromium, viewport);
      for (const sceneCase of sceneCases) {
        await chromium.page.command("Page.navigate", { url: `${baseUrl}/` });
        await chromium.page.waitFor(() => document.readyState === "complete");
        await chromium.page.evaluate(state => {
          localStorage.setItem("robotshub_project", JSON.stringify(state));
        }, project(sceneCase));
        await chromium.page.command("Page.navigate", { url: `${baseUrl}/simulation` });
        await chromium.page.waitFor(() => Boolean(document.querySelector('[data-testid="page-simulation"]')));
        await chromium.page.waitFor(
          expectedCount => document.querySelectorAll('[data-testid^="simulation-floor-warehouse-"]').length === expectedCount,
          sceneCase.floors,
        );
        await chromium.page.evaluate(() => {
          const button = document.querySelector('[data-testid="sim-toggle-running"]');
          if (!(button instanceof HTMLButtonElement)) throw new Error("Кнопка паузы симуляции не найдена");
          button.click();
        });
        await chromium.page.waitFor(
          () => document.querySelector('[data-testid="sim-toggle-running"]')?.textContent?.includes("Пуск") ?? false,
        );
        await new Promise(resolve => setTimeout(resolve, 100));

        const initial = await readState();
        assert.deepEqual(
          initial.geometry,
          Object.fromEntries(
            Object.entries(sceneCase.expectedGeometry).map(([key, [value, detail]]) => [key, { value, detail }]),
          ),
          `${viewport.name}, ${sceneCase.name}: состав сцены должен соответствовать построенной сцене`,
        );
        assert.equal(
          initial.floors.filter((floor) => floor.pressed === "true").length,
          1,
          `${viewport.name}, ${sceneCase.name}: ровно один этаж должен быть выбран в начале`,
        );
        assert.equal(
          initial.floors.filter((floor) => floor.pressed === "true")[0]?.id,
          "simulation-floor-warehouse-1",
          `${viewport.name}, ${sceneCase.name}: первым должен быть выбран первый этаж`,
        );
        assert.ok(initial.canvasHash !== null, `${viewport.name}, ${sceneCase.name}: карта должна быть отрисована`);
        assert.ok(
          Object.values(initial.kpis).every(Boolean),
          `${viewport.name}, ${sceneCase.name}: KPI не должны быть пустыми после остановки симуляции`,
        );

        let previousHash = initial.canvasHash;
        for (let floorIndex = 1; floorIndex < sceneCase.floors; floorIndex++) {
          const expectedId = `simulation-floor-warehouse-${floorIndex + 1}`;
          await chromium.page.evaluate(testId => {
            const button = document.querySelector(`[data-testid="${testId}"]`);
            if (!(button instanceof HTMLButtonElement)) throw new Error(`Кнопка этажа не найдена: ${testId}`);
            button.click();
          }, expectedId);
          await chromium.page.waitFor(
            testId => document.querySelector(`[data-testid="${testId}"]`)?.getAttribute("aria-pressed") === "true",
            expectedId,
          );
          await chromium.page.waitFor(
            previous => {
              const canvas = document.querySelector('[data-testid="simulation-canvas"]');
              if (!(canvas instanceof HTMLCanvasElement)) return false;
              const context = canvas.getContext("2d");
              if (!context) return false;
              const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
              let hash = 2166136261;
              for (let index = 0; index < pixels.length; index += 4) {
                hash ^= pixels[index];
                hash = Math.imul(hash, 16777619);
                hash ^= pixels[index + 1];
                hash = Math.imul(hash, 16777619);
                hash ^= pixels[index + 2];
                hash = Math.imul(hash, 16777619);
              }
              return (hash >>> 0) !== previous;
            },
            previousHash,
          );

          const afterSwitch = await readState();
          assert.equal(
            afterSwitch.floors.filter((floor) => floor.pressed === "true").length,
            1,
            `${viewport.name}, ${sceneCase.name}, этаж ${floorIndex + 1}: должен быть выбран ровно один этаж`,
          );
          assert.equal(
            afterSwitch.floors.find((floor) => floor.pressed === "true")?.id,
            expectedId,
            `${viewport.name}, ${sceneCase.name}, этаж ${floorIndex + 1}: активная кнопка должна соответствовать карте`,
          );
          assert.deepEqual(
            afterSwitch.geometry,
            initial.geometry,
            `${viewport.name}, ${sceneCase.name}, этаж ${floorIndex + 1}: общая сводка не должна сбрасываться`,
          );
          assert.deepEqual(
            afterSwitch.kpis,
            initial.kpis,
            `${viewport.name}, ${sceneCase.name}, этаж ${floorIndex + 1}: KPI не должны сбрасываться`,
          );
          assert.equal(
            afterSwitch.floorKpis,
            initial.floorKpis,
            `${viewport.name}, ${sceneCase.name}, этаж ${floorIndex + 1}: распределение задач по этажам не должно сбрасываться`,
          );
          previousHash = afterSwitch.canvasHash;
        }
      }
    }
    assert.deepEqual(chromium.page.browserErrors(), [], "переключение этажей не должно оставлять ошибок браузера");
  } finally {
    chromium.page.close();
    await stopChild(chromium.browser, true);
    await rm(chromium.userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    await stopChild(server);
  }
});