import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveChromiumPath } from "./chromium-path.mjs";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const port = Number(process.env.CASES_PRODUCTION_PORT ?? 4176);
const debugPort = Number(process.env.CASES_BROWSER_DEBUG_PORT ?? 9226);
const configuredUrl = process.env.CASES_PRODUCTION_URL?.replace(/\/$/, "");
const baseUrl = configuredUrl ?? `http://127.0.0.1:${port}`;

async function waitForUrl(url, timeoutMs = 20_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch {
      // Сервер ещё запускается.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Production-сервер не ответил: ${url}`);
}

async function runBuild() {
  return new Promise((resolve, reject) => {
    const build = spawn("pnpm", ["run", "build"], {
      cwd: projectRoot,
      env: {
        ...process.env,
        BASE_PATH: "/",
        PORT: String(port),
        NODE_ENV: "production",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    build.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    build.stderr.on("data", (chunk) => {
      output += chunk.toString();
    });
    build.on("error", reject);
    build.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Production-сборка завершилась с кодом ${code}\n${output}`));
      }
    });
  });
}

async function stopChild(child, { processGroup = false } = {}) {
  if (!child || child.exitCode !== null) return;
  try {
    if (processGroup && child.pid) {
      process.kill(-child.pid, "SIGTERM");
    } else {
      child.kill("SIGTERM");
    }
  } catch {
    // Процесс мог завершиться между проверкой и отправкой сигнала.
  }
  await Promise.race([
    once(child, "exit"),
    new Promise((resolve) => setTimeout(resolve, 1_000)),
  ]);
  if (child.exitCode === null) {
    try {
      if (processGroup && child.pid) {
        process.kill(-child.pid, "SIGKILL");
      } else {
        child.kill("SIGKILL");
      }
    } catch {
      // Процесс уже завершился.
    }
    await Promise.race([
      once(child, "exit"),
      new Promise((resolve) => setTimeout(resolve, 500)),
    ]);
  }
}

async function startProductionServer() {
  if (configuredUrl) {
    await waitForUrl(`${baseUrl}/cases`);
    return null;
  }

  await runBuild();
  const server = spawn("pnpm", ["run", "serve"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      BASE_PATH: "/",
      PORT: String(port),
      NODE_ENV: "production",
    },
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  server.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  server.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });

  try {
    await waitForUrl(`${baseUrl}/cases`);
  } catch (error) {
    await stopChild(server, { processGroup: true });
    throw new Error(`${error.message}\n${output}`);
  }
  return server;
}

class DevToolsPage {
  #nextId = 1;
  #pending = new Map();
  #ready;

  constructor(webSocketUrl) {
    this.socket = new WebSocket(webSocketUrl);
    this.#ready = new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", ({ data }) => {
      const message = JSON.parse(data);
      if (!message.id) return;
      const pending = this.#pending.get(message.id);
      if (!pending) return;
      this.#pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(`${message.error.code}: ${message.error.message}`));
      } else {
        pending.resolve(message.result);
      }
    });
  }

  async command(method, params = {}) {
    await this.#ready;
    const id = this.#nextId++;
    const result = new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
    });
    this.socket.send(JSON.stringify({ id, method, params }));
    return result;
  }

  async evaluate(fn, argument) {
    const result = await this.command("Runtime.evaluate", {
      expression: `(${fn.toString()})(${JSON.stringify(argument)})`,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text ?? "Ошибка выполнения в браузере");
    }
    return result.result?.value;
  }

  async waitFor(fn, argument, timeoutMs = 10_000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (await this.evaluate(fn, argument)) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`Браузер не дождался состояния за ${timeoutMs} мс`);
  }

  close() {
    this.socket.close();
  }
}

async function startChromium() {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "robotshub-production-cases-"));
  const chromium = resolveChromiumPath();
  const browser = spawn(
    chromium,
    [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${userDataDir}`,
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  try {
    await waitForUrl(`http://127.0.0.1:${debugPort}/json/list`);
    const pages = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
    const page = pages.find(({ type }) => type === "page");
    assert.ok(page?.webSocketDebuggerUrl, "Chromium не открыл страницу DevTools");
    return {
      page: new DevToolsPage(page.webSocketDebuggerUrl),
      browser,
      userDataDir,
    };
  } catch (error) {
    await stopChild(browser);
    await rm(userDataDir, { recursive: true, force: true });
    throw error;
  }
}

async function readProductionCatalog(page) {
  return page.evaluate(() => ({
    count: Number(
      document
        .querySelector('[data-testid="cases-result-count"]')
        ?.textContent?.match(/\d+/)?.[0] ?? -1,
    ),
    cards: [...document.querySelectorAll('[data-testid^="case-card-"]')].map((card) => {
      const link = card.querySelector('a[data-testid^="link-case-"]');
      const image = card.querySelector('img[data-testid^="case-image-"]');
      return {
        testId: card.getAttribute("data-testid"),
        href: link?.getAttribute("href") ?? "",
        image: image
          ? {
              src: image.getAttribute("src") ?? "",
              complete: image.complete,
              naturalWidth: image.naturalWidth,
              naturalHeight: image.naturalHeight,
            }
          : null,
        missingImage: Boolean(card.querySelector('[data-testid^="case-image-missing-"]')),
      };
    }),
  }));
}

async function main() {
  const server = await startProductionServer();
  let browserSession;

  try {
    const catalogResponse = await fetch(`${baseUrl}/cases`);
    assert.equal(catalogResponse.status, 200, "production-сервер должен отдавать /cases с HTTP 200");

    browserSession = await startChromium();
    const { page } = browserSession;
    await page.command("Page.enable");
    await page.command("Runtime.enable");
    await page.command("Page.navigate", { url: `${baseUrl}/cases` });
    await page.waitFor(() => Boolean(document.querySelector('[data-testid="cases-result-count"]')));
    await page.waitFor(
      () =>
        document.querySelectorAll('[data-testid^="case-card-"]').length > 0 &&
        [...document.querySelectorAll('[data-testid^="case-card-"] img')].every(
          (image) => image.complete,
        ),
    );

    const catalog = await readProductionCatalog(page);
    assert.equal(catalog.count, catalog.cards.length, "счётчик каталога должен совпадать с числом карточек");
    assert.ok(catalog.cards.length > 0, "production-каталог должен содержать карточки");

    for (const card of catalog.cards) {
      assert.match(
        card.href,
        /^\/cases\/[^/]+$/,
        `${card.testId}: ссылка должна вести на /cases/:id`,
      );
      assert.ok(
        card.image || card.missingImage,
        `${card.testId}: должна быть инфографика или явное состояние отсутствующего изображения`,
      );
      if (card.image) {
        assert.match(card.image.src, /\/assets\/cases\/[^/]+\.svg$/, `${card.testId}: неверный src инфографики`);
        assert.equal(card.image.complete, true, `${card.testId}: инфографика не завершила загрузку`);
        assert.ok(card.image.naturalWidth > 0, `${card.testId}: инфографика загрузилась с нулевой шириной`);
        assert.ok(card.image.naturalHeight > 0, `${card.testId}: инфографика загрузилась с нулевой высотой`);
      }
    }

    const firstCard = catalog.cards[0];
    const articleUrl = new URL(firstCard.href, baseUrl).toString();
    const articleResponse = await fetch(articleUrl);
    assert.equal(articleResponse.status, 200, "production-сервер должен отдавать страницу конкретного кейса");

    await page.command("Page.navigate", { url: articleUrl });
    await page.waitFor(() => Boolean(document.querySelector('[data-testid^="case-article-title-"]')));
    await page.waitFor(() => {
      const image = document.querySelector('[data-testid^="case-article-image-"]');
      const missing = document.querySelector('[data-testid^="case-article-image-missing-"]');
      return Boolean(missing || (image instanceof HTMLImageElement && image.complete));
    });

    const article = await page.evaluate(() => {
      const image = document.querySelector('[data-testid^="case-article-image-"]');
      return {
        path: window.location.pathname,
        title: document.querySelector('[data-testid^="case-article-title-"]')?.textContent?.trim() ?? "",
        result: document.querySelector('[data-testid^="case-result-"]')?.textContent?.trim() ?? "",
        passport: Boolean(document.querySelector('[data-testid^="case-passport-"]')),
        source: Boolean(document.querySelector('[data-testid^="case-source-"]')),
        image: image instanceof HTMLImageElement
          ? { complete: image.complete, naturalWidth: image.naturalWidth }
          : null,
        missingImage: Boolean(document.querySelector('[data-testid^="case-article-image-missing-"]')),
      };
    });

    assert.equal(article.path, new URL(articleUrl).pathname, "клик по карточке должен открыть её detail-маршрут");
    assert.ok(article.title, "деталь кейса должна содержать заголовок");
    assert.ok(article.result, "деталь кейса должна содержать результат");
    assert.equal(article.passport, true, "деталь кейса должна содержать паспорт внедрения");
    assert.equal(article.source, true, "деталь кейса должна содержать источник");
    assert.ok(article.image || article.missingImage, "деталь кейса должна содержать изображение или fallback");
    if (article.image) {
      assert.equal(article.image.complete, true, "инфографика детали не завершила загрузку");
      assert.ok(article.image.naturalWidth > 0, "инфографика детали загрузилась с нулевой шириной");
    }

    console.log(
      `Production smoke пройден: /cases → ${article.path}; карточек ${catalog.cards.length}, инфографик ${catalog.cards.filter(({ image }) => image).length}.`,
    );
  } finally {
    browserSession?.page.close();
    await stopChild(browserSession?.browser);
    if (browserSession?.userDataDir) {
      await rm(browserSession.userDataDir, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      });
    }
    await stopChild(server, { processGroup: true });
  }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
}