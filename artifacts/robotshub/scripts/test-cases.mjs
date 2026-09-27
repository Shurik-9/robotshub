import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { tmpdir } from "node:os";
import path from "node:path";
import { resolveChromiumPath } from "./chromium-path.mjs";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const casesPagePath = path.join(projectRoot, "src/pages/cases.tsx");
const articlePagePath = path.join(projectRoot, "src/pages/case-article.tsx");
const appPath = path.join(projectRoot, "src/App.tsx");
const assetsRoot = path.join(projectRoot, "public/assets/cases");

const [casesPage, articlePage, app] = await Promise.all([
  readFile(casesPagePath, "utf8"),
  readFile(articlePagePath, "utf8"),
  readFile(appPath, "utf8"),
]);

const caseSection = casesPage.match(
  /export const CASES: CaseStudy\[\] = \[(?<cases>[\s\S]*?)\n\];/,
)?.groups?.cases;
assert.ok(caseSection, "каталог CASES не найден");

const caseBlocks = [...caseSection.matchAll(/\{\n(?<block>[\s\S]*?)\n  \},?/g)].map(
  ({ groups }) => groups.block,
);
const cases = caseBlocks.map((block) => {
  const readField = (field) =>
    block.match(new RegExp(`(?:^|\\n)\\s+${field}: '([^']*)'`))?.[1];

  return {
    id: readField("id"),
    number: readField("number"),
    image: readField("image"),
    title: readField("title"),
    lead: readField("lead"),
    metrics: readField("metrics"),
    task: readField("task"),
    solution: readField("solution"),
    result: readField("result"),
    importance: readField("importance"),
    vendor: readField("vendor"),
    trl: readField("trl"),
    price: readField("price"),
    client: readField("client"),
    industry: readField("industry"),
    region: readField("region"),
  };
});

const expectedIds = [
  "ronavi-h1500-vostok",
  "ronavi-sr-delimobil",
  "klinbotix-600-skli",
  "stock-counter-vkusvill",
  "doperator-p",
  "ronavi-h1500-avtoprom",
  "aripix-a1-gidroel",
  "kurier-30-biomaterialy",
  "evocargo-n1-alabuga",
  "ak2000-x5-newariga",
  "yandex-roker",
  "promobot-lenta",
  "rubi-s-hermitage",
  "vt440-yanao",
  "morskoy-skorpion-balaklava",
  "dmr600-sapfir",
  "robot-rastsepshik-rzd",
  "mark2-se-multi",
  "pickbyvoice-diksi",
  "yandex-inv-azbuka",
  "unit-auchan",
  "klinbotix400-grandkanon",
  "omdjet-bti",
  "geoskan201-ank",
  "gumich-spasatel-yamal",
  "lvonok-moskva-tramvai",
  "amt6x6-gazpromneft",
  "cognitive-pulkovo",
  "rededucation-baumanka",
  "azarrus-demontazh",
  "niias-rover-vagony",
  "aksc80-x5",
  "yandex-robotaksi",
  "tagarka-semargl",
  "solocoffee-fudtrak",
  "rc5-16-robopro",
  "berill-mcst",
  "geoskan701-les",
  "mai-patrol-zhukovsky",
  "tral-patrol-zelenopark",
  "bitrobotics-vkusiliya",
  "gorgona15-yakutia",
  "tagarka-35000-aviastroenie",
  "innospector-nornickel",
  "kati-agrobit-vakcina",
];

test("каталог содержит все кейсы в ожидаемом порядке с существующими SVG", async () => {
  assert.equal(cases.length, expectedIds.length);
  assert.deepEqual(
    cases.map(({ id }) => id),
    expectedIds,
    "порядок и идентификаторы кейсов должны совпадать с каталогом",
  );
  assert.equal(new Set(cases.map(({ id }) => id)).size, cases.length);

  await Promise.all(
    cases.map(async ({ number, id, image }) => {
       assert.match(number ?? "", /^\d{2}$/, `${id}: отсутствует номер карточки`);
      assert.match(image ?? "", /\.svg$/, `${id}: инфографика должна быть SVG`);
      await access(path.join(assetsRoot, image));
      const svg = await readFile(path.join(assetsRoot, image), "utf8");
      assert.match(svg, /^\s*<svg\b/, `${id}: файл инфографики не является SVG`);
    }),
  );
});

test("каждая карточка ведет на статью по своему идентификатору", () => {
  assert.match(
    casesPage,
    /<Link href=\{`\/cases\/\$\{item\.id\}`\}/,
    "карточка должна формировать ссылку /cases/:id",
  );
  for (const { id, number } of cases) {
    assert.match(
      casesPage,
      new RegExp(`data-testid=\\{\\\`case-card-\\$\\{item\\.number\\}\\\`\\}`),
      `${id}: у карточки отсутствует стабильный идентификатор`,
    );
    assert.ok(number, `${id}: у карточки отсутствует номер`);
  }
});

test("каждая статья содержит инфографику, результат, паспорт и источник", () => {
  assert.match(articlePage, /data-testid=\{`case-article-image-\$\{item\.number\}`\}/);
  assert.match(articlePage, /data-testid=\{`case-result-\$\{item\.number\}`\}/);
  assert.match(articlePage, /data-testid=\{`case-passport-\$\{item\.number\}`\}/);
  assert.match(articlePage, /data-testid=\{`case-source-\$\{item\.number\}`\}/);
  assert.match(articlePage, /Паспорт внедрения/);
  assert.match(articlePage, /Источник: Каталог внедрений ФЦ БАС, 2026/);

  for (const item of cases) {
    for (const field of ["title", "lead", "metrics", "task", "solution", "result", "importance", "vendor", "trl", "price", "client", "industry", "region"]) {
      assert.ok(item[field], `${item.id}: поле ${field} пустое`);
    }
  }
});

test("маршрут статьи и неизвестный идентификатор обрабатываются явно", () => {
  assert.match(app, /<Route path="\/cases\/:id" component=\{CaseArticle\} \/>/);
  assert.match(articlePage, /useRoute\('\/cases\/:id'\)/);
  assert.match(articlePage, /CASES\.find\(\(caseStudy\) => caseStudy\.id === params\?\.id\)/);
  assert.match(articlePage, /if \(!item\)/);
  assert.match(articlePage, /Такой кейс не найден\./);
  assert.match(articlePage, /Вернуться к кейсам/);
});

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

async function waitForUrl(url, timeoutMs = 20_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Сервер ещё запускается.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Сервер каталога не ответил: ${url}`);
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

async function startCasesApp() {
  const configuredUrl = process.env.CASES_BROWSER_URL?.replace(/\/$/, "");
  const port = Number(process.env.CASES_BROWSER_PORT ?? 4175);
  const baseUrl = configuredUrl ?? `http://127.0.0.1:${port}`;

  try {
    await waitForUrl(`${baseUrl}/cases`, 750);
    return { baseUrl, server: null };
  } catch {
    if (configuredUrl) {
      throw new Error(`CASES_BROWSER_URL недоступен: ${configuredUrl}`);
    }
  }

  const server = spawn("pnpm", ["run", "dev"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      BASE_PATH: "/",
      PORT: String(port),
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
  return { baseUrl, server };
}

async function startChromium() {
  const port = Number(process.env.CASES_BROWSER_DEBUG_PORT ?? 9225);
  const userDataDir = await mkdtemp(path.join(tmpdir(), "robotshub-cases-"));
  const chromium = resolveChromiumPath();
  const browser = spawn(
    chromium,
    [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDataDir}`,
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  try {
    await waitForUrl(`http://127.0.0.1:${port}/json/list`);
    const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
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

async function clickTestId(page, testId) {
  const clicked = await page.evaluate((id) => {
    const element = [...document.querySelectorAll("[data-testid]")].find(
      (candidate) => candidate.getAttribute("data-testid") === id,
    );
    if (!element) return false;
    element.click();
    return true;
  }, testId);
  assert.equal(clicked, true, `элемент ${testId} не найден в браузере`);
}

async function setInputValue(page, testId, value) {
  const changed = await page.evaluate(
    ({ id, nextValue }) => {
      const input = [...document.querySelectorAll("[data-testid]")].find(
        (candidate) => candidate.getAttribute("data-testid") === id,
      );
      if (!(input instanceof HTMLInputElement)) return false;
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(input, nextValue);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    },
    { id: testId, nextValue: value },
  );
  assert.equal(changed, true, `поле ${testId} не найдено в браузере`);
}

async function setSelectValue(page, testId, value) {
  const changed = await page.evaluate(
    ({ id, nextValue }) => {
      const select = [...document.querySelectorAll("[data-testid]")].find(
        (candidate) => candidate.getAttribute("data-testid") === id,
      );
      if (!(select instanceof HTMLSelectElement)) return false;
      select.value = nextValue;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    },
    { id: testId, nextValue: value },
  );
  assert.equal(changed, true, `список ${testId} не найден в браузере`);
}

async function focusTestId(page, testId) {
  const focused = await page.evaluate((id) => {
    const element = [...document.querySelectorAll("[data-testid]")].find(
      (candidate) => candidate.getAttribute("data-testid") === id,
    );
    if (!(element instanceof HTMLElement)) return false;
    element.focus();
    return document.activeElement === element;
  }, testId);
  assert.equal(focused, true, `элемент ${testId} не получил фокус`);
}

async function readActiveTestId(page) {
  return page.evaluate(() => document.activeElement?.getAttribute("data-testid") ?? "");
}

async function pressKey(page, key, { code = key, keyCode } = {}) {
  const resolvedKeyCode =
    keyCode ??
    ({
      Enter: 13,
      Space: 32,
      Tab: 9,
      ArrowDown: 40,
      ArrowUp: 38,
    }[key] ?? 0);
  await page.command("Input.dispatchKeyEvent", {
    type: "keyDown",
    key,
    code,
    text: key === " " ? " " : key === "Enter" ? "\r" : undefined,
    unmodifiedText: key === " " ? " " : key === "Enter" ? "\r" : undefined,
    windowsVirtualKeyCode: resolvedKeyCode,
    nativeVirtualKeyCode: resolvedKeyCode,
  });
  await page.command("Input.dispatchKeyEvent", {
    type: "keyUp",
    key,
    code,
    windowsVirtualKeyCode: resolvedKeyCode,
    nativeVirtualKeyCode: resolvedKeyCode,
  });
}

async function readBrowserCatalog(page) {
  return page.evaluate(() => ({
    count: Number(
      document.querySelector('[data-testid="cases-result-count"]')?.textContent
        ?.match(/\d+/)?.[0] ?? -1,
    ),
    query: document.querySelector('[data-testid="input-cases-search"]')?.value ?? "",
    sortBy: document.querySelector('[data-testid="select-sort-cases"]')?.value ?? "",
    mode: document.querySelector('[data-testid="button-browse-tasks"]')?.getAttribute("aria-pressed") === "true"
      ? "task"
      : "area",
    heading: document.querySelector('[data-testid="cases-results-heading"]')?.textContent?.trim() ?? "",
    cards: [...document.querySelectorAll('[data-testid^="case-card-"]')].map((card) => ({
      id: card.querySelector('a[data-testid^="link-case-"]')?.getAttribute("href")?.split("/").pop(),
      number: card.getAttribute("data-testid")?.replace("case-card-", ""),
      title: card.querySelector('[data-testid^="case-title-"]')?.textContent?.trim(),
      industry: card.getAttribute("data-industry"),
      areas: card.getAttribute("data-areas")?.split(" ").filter(Boolean) ?? [],
      tasks: card.getAttribute("data-tasks")?.split(" ").filter(Boolean) ?? [],
    })),
    empty: Boolean(document.querySelector('[data-testid="cases-empty-state"]')),
  }));
}

async function waitForCount(page, count) {
  await page.waitFor((expected) => {
    const text = document.querySelector('[data-testid="cases-result-count"]')?.textContent ?? "";
    return text.startsWith(`${expected} `);
  }, count);
}

test(
  "браузерная карта кейсов переключает категории, сортирует и сбрасывает каталог",
  { timeout: 120_000 },
  async () => {
    const { baseUrl, server } = await startCasesApp();
    const { page, browser, userDataDir } = await startChromium();

    try {
      await page.command("Page.enable");
      await page.command("Runtime.enable");
      await page.command("Page.navigate", { url: `${baseUrl}/cases` });
      await page.waitFor(() => Boolean(document.querySelector('[data-testid="cases-result-count"]')));
      await page.waitFor(() => document.querySelectorAll('[data-testid^="case-card-"]').length > 0);

      const fullCatalog = await readBrowserCatalog(page);
      const fullIds = fullCatalog.cards.map(({ id }) => id);
      const numberSortedIds = [...cases]
        .sort((a, b) => Number(a.number) - Number(b.number))
        .map(({ id }) => id);
      assert.equal(fullCatalog.count, cases.length, "на старте должен быть доступен весь каталог");
      assert.deepEqual(
        fullIds,
        numberSortedIds,
        "на старте карточки должны идти по номеру без скрытой группировки",
      );
      assert.equal(fullCatalog.empty, false);
      assert.equal(fullCatalog.mode, "task");
      assert.equal(fullCatalog.heading, "Все 45 кейсов");

      const targetTask = "inspection";
      const taskCards = fullCatalog.cards.filter(({ tasks }) => tasks.includes(targetTask));
      await clickTestId(page, `filter-task-${targetTask}`);
      await waitForCount(page, taskCards.length);
      const taskCatalog = await readBrowserCatalog(page);
      assert.equal(taskCatalog.heading, "Контроль, съёмка и обследование");
      assert.deepEqual(
        taskCatalog.cards.map(({ id }) => id),
        taskCards.map(({ id }) => id),
        "задача должна включать каждый кейс с соответствующей ручной меткой",
      );
      assert.ok(taskCatalog.cards.every(({ tasks }) => tasks.includes(targetTask)));

      const replacementTask = "movement";
      const movementCards = fullCatalog.cards.filter(({ tasks }) => tasks.includes(replacementTask));
      await clickTestId(page, `filter-task-${replacementTask}`);
      await waitForCount(page, movementCards.length);
      const replacedTaskCatalog = await readBrowserCatalog(page);
      assert.equal(replacedTaskCatalog.heading, "Перемещение и доставка");
      assert.deepEqual(replacedTaskCatalog.cards.map(({ id }) => id), movementCards.map(({ id }) => id));

      await clickTestId(page, "button-browse-areas");
      await waitForCount(page, fullCatalog.count);
      assert.equal((await readBrowserCatalog(page)).mode, "area", "смена режима должна снять категорию другого режима");

      const targetArea = "city";
      const cityCards = fullCatalog.cards.filter(({ areas }) => areas.includes(targetArea));
      await clickTestId(page, `filter-area-${targetArea}`);
      await waitForCount(page, cityCards.length);
      const cityCatalog = await readBrowserCatalog(page);
      assert.equal(cityCatalog.heading, "Город и ЖКХ");
      assert.ok(cityCatalog.cards.length > 1, "городская сфера не должна состоять только из «Морского скорпиона»");
      assert.ok(cityCatalog.cards.every(({ areas }) => areas.includes(targetArea)));

      await clickTestId(page, "button-clear-filters");
      await waitForCount(page, fullCatalog.count);
      await setInputValue(page, "input-cases-search", "Восток-Сервис");
      await waitForCount(page, 1);
      const searchCatalog = await readBrowserCatalog(page);
      assert.equal(searchCatalog.query, "Восток-Сервис");
      assert.deepEqual(searchCatalog.cards.map(({ id }) => id), ["ronavi-h1500-vostok"]);

      await clickTestId(page, "button-clear-filters");
      await waitForCount(page, fullCatalog.count);
      await setSelectValue(page, "select-sort-cases", "title");
      const titleSortedCatalog = await readBrowserCatalog(page);
      const titleSortedIds = [...cases]
        .sort((a, b) => a.title.localeCompare(b.title, "ru"))
        .map(({ id }) => id);
      assert.equal(titleSortedCatalog.sortBy, "title");
      assert.deepEqual(
        titleSortedCatalog.cards.map(({ id }) => id),
        titleSortedIds,
        "сортировка по названию должна менять порядок карточек",
      );

      await clickTestId(page, "button-clear-filters");
      await waitForCount(page, fullCatalog.count);
      const resetCatalog = await readBrowserCatalog(page);
      assert.equal(resetCatalog.query, "");
      assert.equal(resetCatalog.sortBy, "number");
      assert.deepEqual(
        resetCatalog.cards.map(({ id }) => id),
        numberSortedIds,
        "сброс должен вернуть полный каталог и сортировку по номеру",
      );

      await setInputValue(page, "input-cases-search", "запрос-которого-точно-нет");
      await waitForCount(page, 0);
      const emptyCatalog = await readBrowserCatalog(page);
      assert.equal(emptyCatalog.empty, true, "для пустого результата должно быть отдельное состояние");
      assert.equal(emptyCatalog.cards.length, 0);
      await clickTestId(page, "button-empty-clear-filters");
      await waitForCount(page, fullCatalog.count);
      const restoredCatalog = await readBrowserCatalog(page);
      assert.equal(restoredCatalog.empty, false);
      assert.deepEqual(
        restoredCatalog.cards.map(({ id }) => id),
        numberSortedIds,
        "кнопка пустого состояния должна вернуть полный каталог",
      );
    } finally {
      page.close();
      await stopChild(browser);
      await rm(userDataDir, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      });
      await stopChild(server, { processGroup: true });
    }
  },
);

test(
  "браузерная карта кейсов доступна с клавиатуры и не ломается на мобильной ширине",
  { timeout: 120_000 },
  async () => {
    const { baseUrl, server } = await startCasesApp();
    const { page, browser, userDataDir } = await startChromium();

    try {
      await page.command("Page.enable");
      await page.command("Runtime.enable");
      await page.command("Page.navigate", { url: `${baseUrl}/cases` });
      await page.waitFor(() => Boolean(document.querySelector('[data-testid="cases-map"]')));
      await page.waitFor(() => document.querySelectorAll('[data-testid^="case-card-"]').length > 0);

      const fullCatalog = await readBrowserCatalog(page);
      const firstTask = "filter-task-movement";
      const nextTask = await page.evaluate((id) => {
        const ids = [...document.querySelectorAll('[data-testid^="filter-task-"]')].map(
          (element) => element.getAttribute("data-testid"),
        );
        return ids[ids.indexOf(id) + 1] ?? "";
      }, firstTask);

      await focusTestId(page, firstTask);
      await pressKey(page, " ", { code: "Space", keyCode: 32 });
      await waitForCount(page, fullCatalog.cards.filter(({ tasks }) => tasks.includes("movement")).length);
      assert.equal(
        await page.evaluate(
          (id) => document.querySelector(`[data-testid="${id}"]`)?.getAttribute("aria-pressed"),
          firstTask,
        ),
        "true",
        "категория задачи должна включаться пробелом",
      );
      await pressKey(page, " ", { code: "Space", keyCode: 32 });
      await waitForCount(page, cases.length);
      assert.equal(
        await page.evaluate(
          (id) => document.querySelector(`[data-testid="${id}"]`)?.getAttribute("aria-pressed"),
          firstTask,
        ),
        "false",
        "категория задачи должна выключаться пробелом",
      );

      await focusTestId(page, firstTask);
      await pressKey(page, "Tab");
      assert.equal(
        await readActiveTestId(page),
        nextTask,
        "кнопки задач должны последовательно проходиться клавишей Tab",
      );

      await focusTestId(page, "button-browse-areas");
      await pressKey(page, "Enter");
      await page.waitFor(() => document.querySelector('[data-testid="button-browse-areas"]')?.getAttribute("aria-pressed") === "true");
      assert.equal(
        (await readBrowserCatalog(page)).mode,
        "area",
        "режим сфер должен включаться клавишей Enter",
      );

      await focusTestId(page, "input-cases-search");
      await pressKey(page, "Tab");
      assert.equal(
        await readActiveTestId(page),
        "select-sort-cases",
        "из поиска клавиша Tab должна переводить фокус на сортировку",
      );
      await pressKey(page, "ArrowDown");
      await page.waitFor(() => document.querySelector('[data-testid="select-sort-cases"]')?.value === "title");
      assert.equal(
        (await readBrowserCatalog(page)).sortBy,
        "title",
        "список сортировки должен переключаться с клавиатуры",
      );

      await focusTestId(page, "input-cases-search");
      await page.command("Input.insertText", { text: "Восток-Сервис" });
      await waitForCount(page, 1);
      const keyboardSearch = await readBrowserCatalog(page);
      assert.equal(keyboardSearch.query, "Восток-Сервис");
      assert.deepEqual(
        keyboardSearch.cards.map(({ id }) => id),
        ["ronavi-h1500-vostok"],
        "поиск должен принимать текст с клавиатуры и обновлять карту",
      );

      await page.command("Emulation.setDeviceMetricsOverride", {
        width: 390,
        height: 844,
        deviceScaleFactor: 1,
        mobile: true,
      });
      await page.command("Page.navigate", { url: `${baseUrl}/cases` });
      await page.waitFor(() => Boolean(document.querySelector('[data-testid="cases-map"]')));
      await page.waitFor(() => document.querySelectorAll('[data-testid^="case-card-"]').length > 0);

      const mobileLayout = await page.evaluate(() => {
        const selectors = [
          '[data-testid="cases-map"]',
          '[data-testid="button-browse-tasks"]',
          '[data-testid="button-browse-areas"]',
          '[data-testid^="filter-task-"]',
          '[data-testid="input-cases-search"]',
          '[data-testid="select-sort-cases"]',
          '[data-testid^="case-card-"]',
        ];
        const elements = selectors.flatMap((selector) =>
          [...document.querySelectorAll(selector)].map((element) => {
            const rect = element.getBoundingClientRect();
            return {
              testId: element.getAttribute("data-testid"),
              left: rect.left,
              right: rect.right,
              width: rect.width,
              height: rect.height,
            };
          }),
        );
        const cards = [...document.querySelectorAll('[data-testid^="case-card-"]')].map((card) => {
          const title = card.querySelector('[data-testid^="case-title-"]');
          const metrics = card.querySelector(".border-l-2");
          const rect = card.getBoundingClientRect();
          return {
            testId: card.getAttribute("data-testid"),
            title: title?.textContent?.trim() ?? "",
            titleFits: title ? title.scrollWidth <= title.clientWidth + 1 : false,
            metricsFits: metrics ? metrics.scrollWidth <= metrics.clientWidth + 1 : false,
            visible: rect.width > 0 && rect.height > 0,
          };
        });
        return {
          viewportWidth: window.innerWidth,
          documentWidth: document.documentElement.scrollWidth,
          elements,
          cards,
        };
      });

      assert.ok(
        mobileLayout.documentWidth <= mobileLayout.viewportWidth + 1,
        `на мобильной ширине появился горизонтальный overflow: ${mobileLayout.documentWidth}px > ${mobileLayout.viewportWidth}px`,
      );
      assert.ok(mobileLayout.elements.length > 0, "мобильная раскладка должна содержать карту и элементы управления");
      for (const element of mobileLayout.elements) {
        assert.ok(element.left >= -1, `${element.testId} выходит за левую границу мобильного viewport`);
        assert.ok(
          element.right <= mobileLayout.viewportWidth + 1,
          `${element.testId} выходит за правую границу мобильного viewport`,
        );
        assert.ok(element.width > 0 && element.height > 0, `${element.testId} должен оставаться видимым`);
      }
      assert.equal(mobileLayout.cards.length, cases.length, "на мобильной ширине должны сохраниться все карточки");
      assert.ok(mobileLayout.cards.every(({ title, titleFits, metricsFits, visible }) => title && titleFits && metricsFits && visible), "заголовки и метрики карточек не должны ломать читаемость на мобильной ширине");
    } finally {
      page.close();
      await stopChild(browser);
      await rm(userDataDir, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      });
      await stopChild(server, { processGroup: true });
    }
  },
);
