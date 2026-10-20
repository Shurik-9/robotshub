import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { evaluationLimit } from '../src/lib/evaluationScope.ts';
import { sectorCatalogPath } from '../src/lib/useSectorMap.ts';
import catalog from '../src/data/solutions.json' with { type: 'json' };
import { getMergedSolutionTaxonomy, getSolutionTaxonomy } from '../src/lib/solutionTaxonomy.ts';
import { resolveChromiumPath } from './chromium-path.mjs';

const clinicCleaner = '5a5b3599-bd64-4330-9bbb-4f8ce7d780b9';
const medicalDrone = '0861538d-75c8-473e-a2ab-499a6b8c1d49';
const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const mapData = JSON.parse(readFileSync(new URL('../public/map/map-data.json', import.meta.url), 'utf8'));
const extraSectorContext = { window: {} };
vm.runInNewContext(
  readFileSync(new URL('../public/map/extra-sectors.js', import.meta.url), 'utf8'),
  extraSectorContext,
);
const thematicSectors = extraSectorContext.window.MAP_EXTRA_SECTORS(mapData);

class DevToolsPage {
  #nextId = 1;
  #pending = new Map();
  #ready;

  constructor(webSocketUrl) {
    this.socket = new WebSocket(webSocketUrl);
    this.#ready = new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    this.socket.addEventListener('message', ({ data }) => {
      const message = JSON.parse(data);
      if (!message.id) return;
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

  async evaluate(fn, argument) {
    const result = await this.command('Runtime.evaluate', {
      expression: `(${fn.toString()})(${JSON.stringify(argument)})`,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? 'Ошибка браузера');
    }
    return result.result?.value;
  }

  async waitFor(fn, argument, timeoutMs = 15_000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (await this.evaluate(fn, argument)) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error(`Браузер не дождался состояния за ${timeoutMs} мс`);
  }

  close() {
    this.socket.close();
  }
}

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function waitForUrl(url, timeoutMs = 20_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // Сервис ещё запускается.
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`RobotsHub не ответил: ${url}`);
}

async function stopChild(child, killProcessGroup = false) {
  if (!child || child.exitCode !== null) return;
  const signal = name => {
    try {
      if (killProcessGroup && child.pid) process.kill(-child.pid, name);
      else child.kill(name);
    } catch {
      // Процесс мог завершиться между проверкой и отправкой сигнала.
    }
  };
  signal('SIGTERM');
  await Promise.race([once(child, 'exit'), new Promise(resolve => setTimeout(resolve, 1_000))]);
  if (child.exitCode === null) {
    signal('SIGKILL');
    await Promise.race([once(child, 'exit'), new Promise(resolve => setTimeout(resolve, 1_000))]);
  }
}

function groupedIndustryIds(industry, areaId) {
  const groups = new Map();
  for (const solution of catalog.items) {
    const key = `${solution.name}|${solution.vendor}`;
    const variants = groups.get(key) ?? [];
    variants.push(solution);
    groups.set(key, variants);
  }

  return [...groups.values()]
    .filter(variants => variants.some(variant => variant.industry === industry))
    .filter(variants => !areaId || getMergedSolutionTaxonomy(variants)?.areaIds.includes(areaId))
    .map(variants => variants[0].id)
    .sort();
}

async function startBrowserApp() {
  const port = await freePort();
  const debugPort = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = spawn('pnpm', ['run', 'dev'], {
    cwd: projectRoot,
    env: { ...process.env, BASE_PATH: '/', PORT: String(port) },
    detached: true,
    stdio: 'ignore',
  });
  let browser;
  let userDataDir;
  let page;

  try {
    await waitForUrl(`${baseUrl}/`);
    userDataDir = await mkdtemp(path.join(tmpdir(), 'robotshub-sector-journey-'));
    browser = spawn(resolveChromiumPath(), [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${userDataDir}`,
      'about:blank',
    ], { stdio: 'ignore', detached: true });
    const devtoolsUrl = `http://127.0.0.1:${debugPort}/json/list`;
    await waitForUrl(devtoolsUrl);
    const pages = await (await fetch(devtoolsUrl)).json();
    const target = pages.find(({ type }) => type === 'page');
    assert.ok(target?.webSocketDebuggerUrl, 'Chromium не открыл страницу DevTools');
    page = new DevToolsPage(target.webSocketDebuggerUrl);
    return {
      baseUrl,
      page,
      async close() {
        page.close();
        await stopChild(browser, true);
        await rm(userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
        await stopChild(server, true);
      },
    };
  } catch (error) {
    page?.close();
    await stopChild(browser, true);
    if (userDataDir) {
      await rm(userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
    await stopChild(server, true);
    throw error;
  }
}

test('переходы к каталогу сохраняют все отраслевые записи без автоматического фильтра среды', () => {
  const transport = new URL(sectorCatalogPath({ id: 'Транспорт и логистика', thematic: false }), 'https://robotshub.ru');
  assert.equal(transport.pathname, '/solutions');
  assert.equal(transport.searchParams.get('industry'), 'Транспорт и логистика');
  assert.equal(transport.searchParams.has('area'), false);

  const security = new URL(sectorCatalogPath({ id: 'Безопасность', thematic: false }), 'https://robotshub.ru');
  assert.equal(security.searchParams.get('industry'), 'Безопасность');
  assert.equal(security.searchParams.has('area'), false);

  const utilities = new URL(sectorCatalogPath({ id: 'ЖКХ', thematic: false }), 'https://robotshub.ru');
  assert.equal(utilities.searchParams.get('industry'), 'ЖКХ');
  assert.equal(utilities.searchParams.has('area'), false);

  assert.deepEqual(
    Array.from(thematicSectors, sector => sector.id),
    ['sector-water', 'sector-mining', 'sector-medicine'],
  );
  for (const sector of thematicSectors) {
    const recordIds = sector.records.map(record => record.split('|')[0]);
    const expectedIds = [...new Set(recordIds)];
    const journey = new URL(sectorCatalogPath(sector), 'https://robotshub.ru');
    const ids = journey.searchParams.get('ids')?.split(',') ?? [];

    assert.equal(journey.pathname, '/solutions', `${sector.id}: маршрут должен вести в каталог`);
    assert.equal(journey.searchParams.get('sector'), sector.id);
    assert.deepEqual(ids, expectedIds, `${sector.id}: URL должен включать каждый уникальный ID записей`);
    assert.equal(new Set(ids).size, ids.length, `${sector.id}: повторяющиеся связи не должны дублировать ID`);
    assert.ok(recordIds.length > expectedIds.length, `${sector.id}: тестовые данные должны покрывать повторяющиеся связи`);
    assert.ok(
      expectedIds.every(id => catalog.items.some(item => item.id === id)),
      `${sector.id}: в URL должны попасть реальные ID каталога`,
    );
    assert.equal(journey.searchParams.has('area'), false, `${sector.id}: среда не должна задаваться автоматически`);
  }
});

test('отказ от единственной среды подтверждён фактической смесью записей каталога', () => {
  const catalogAreas = (rows) => new Set(rows.flatMap(row => getSolutionTaxonomy(row).areaIds));
  const securityAreas = catalogAreas(catalog.items.filter(row => row.industry === 'Безопасность'));
  const utilitiesAreas = catalogAreas(catalog.items.filter(row => row.industry === 'ЖКХ'));
  const medicineIds = new Set([
    clinicCleaner,
    medicalDrone,
    'ac5b3159-9df0-4911-8cc3-31227a5b3b59',
    '0aaaa4d1-9ca6-4737-a3d6-92081635402c',
    '00ddbb71-8fca-4cb1-9998-78250c62ea03',
  ]);
  const medicineAreas = catalogAreas(catalog.items.filter(row => medicineIds.has(row.id)));

  assert.ok(securityAreas.has('air') && securityAreas.has('outdoor') && securityAreas.has('water'));
  assert.ok(utilitiesAreas.has('indoor') && utilitiesAreas.has('roads') && utilitiesAreas.has('water'));
  assert.ok(medicineAreas.has('air') && medicineAreas.has('healthcare') && medicineAreas.has('indoor'));
});

test('выбор и сброс среды сохраняют выбранную смешанную отрасль в браузере', { timeout: 60_000 }, async () => {
  const industry = 'ЖКХ';
  const areaId = 'water';
  const expectedAll = groupedIndustryIds(industry);
  const expectedArea = groupedIndustryIds(industry, areaId);
  assert.ok(expectedArea.length > 0, 'в отрасли должны быть решения для выбранной среды');
  assert.ok(expectedAll.length > expectedArea.length, 'отрасль должна включать и другие среды');

  const app = await startBrowserApp();
  try {
    const { page, baseUrl } = app;
    await page.command('Page.enable');
    await page.command('Runtime.enable');
    await page.command('Page.navigate', {
      url: `${baseUrl}/solutions?industry=${encodeURIComponent(industry)}`,
    });
    await page.waitFor(() => Boolean(
      document.querySelector('[data-testid="text-results-count"]')
      && document.querySelector('[data-testid="filter-area-water"]')
      && document.querySelector('[data-testid="button-clear-industry-filter"]'),
    ));
    await page.waitFor(expectedIndustry => {
      const subtitle = document.querySelector('[data-testid="text-page-subtitle"]')?.textContent ?? '';
      return subtitle.includes(`«${expectedIndustry}»`);
    }, industry);

    const readCatalog = () => page.evaluate(() => ({
      count: Number(document.querySelector('[data-testid="text-results-count"]')?.textContent?.trim() ?? -1),
      ids: [...document.querySelectorAll('[data-testid^="card-solution-"]')]
        .map(card => card.getAttribute('data-testid').replace('card-solution-', ''))
        .sort(),
      industryLabel: document.querySelector('[data-testid="button-clear-industry-filter"]')?.textContent?.trim() ?? '',
      subtitle: document.querySelector('[data-testid="text-page-subtitle"]')?.textContent?.trim() ?? '',
      note: document.querySelector('[data-testid="text-industry-environment-note"]')?.textContent?.trim() ?? '',
    }));

    const assertIndustryRemainsActive = catalogState => {
      assert.match(catalogState.industryLabel, /Отрасль:\s*ЖКХ/);
      assert.match(catalogState.subtitle, /Решения отрасли «ЖКХ»/);
      assert.match(catalogState.note, /среду можно выбрать отдельно/);
    };

    const initial = await readCatalog();
    assert.deepEqual(initial.ids, expectedAll, 'до выбора среды должны быть показаны все решения отрасли');
    assert.equal(initial.count, expectedAll.length, 'счётчик должен совпадать со всеми решениями отрасли');
    assertIndustryRemainsActive(initial);

    await page.evaluate(() => document.querySelector('[data-testid="filter-area-water"]')?.click());
    await page.waitFor(
      ids => JSON.stringify([...document.querySelectorAll('[data-testid^="card-solution-"]')]
        .map(card => card.getAttribute('data-testid').replace('card-solution-', '')).sort()) === JSON.stringify(ids),
      expectedArea,
    );
    const narrowed = await readCatalog();
    assert.deepEqual(narrowed.ids, expectedArea, 'среда должна пересечься с отраслью, а не заменить её');
    assert.equal(narrowed.count, expectedArea.length, 'счётчик должен соответствовать результатам выбранной среды');
    assertIndustryRemainsActive(narrowed);

    await page.evaluate(() => document.querySelector('[data-testid="filter-area-all"]')?.click());
    await page.waitFor(
      ids => JSON.stringify([...document.querySelectorAll('[data-testid^="card-solution-"]')]
        .map(card => card.getAttribute('data-testid').replace('card-solution-', '')).sort()) === JSON.stringify(ids),
      expectedAll,
    );
    const restored = await readCatalog();
    assert.deepEqual(restored.ids, expectedAll, 'сброс среды должен восстановить все решения отрасли');
    assert.equal(restored.count, expectedAll.length, 'счётчик должен вернуться к числу решений отрасли');
    assertIndustryRemainsActive(restored);
  } finally {
    await app.close();
  }
});

test('бриф произвольного объекта не превращается в фиктивное ТЭО', () => {
  assert.match(evaluationLimit('sector-water', 'custom', { site_name: 'Причал' }), /нет отдельной/);
  assert.match(evaluationLimit(null, null, {}), /шаблонов объекта/);
  assert.match(evaluationLimit(null, 'warehouse', {}), /шаблонов объекта/);
});

test('для воды и карьеров универсальный расчёт по типовым объектам не открывается', () => {
  assert.match(evaluationLimit('sector-water', 'airport', { terminal_area_m2: 1000 }, '018cc2dd-3dfe-4bd2-aac6-f54cbebd783e'), /Свой объект/);
  assert.match(evaluationLimit('sector-mining', 'warehouse', { pickers_count: 10 }, '33fca97e-ef4f-459d-a773-ab58b7f84fd5'), /Свой объект/);
  assert.equal(evaluationLimit('sector-water', 'custom', { site_name: 'Балаклавская бухта', task: 'сбор мусора' }, '018cc2dd-3dfe-4bd2-aac6-f54cbebd783e'), null);
  assert.equal(evaluationLimit('sector-mining', 'custom', { site_name: 'Карьер №1', task: 'съёмка' }, '33fca97e-ef4f-459d-a773-ab58b7f84fd5'), null);
  assert.match(evaluationLimit('sector-water', 'custom', { task: 'сбор мусора' }, '018cc2dd-3dfe-4bd2-aac6-f54cbebd783e'), /точным названием площадки/);
});

test('медицинская экономика не наследуется доставкой дронами и реабилитацией', () => {
  const hospital = { sanitar_count: 20 };
  assert.equal(evaluationLimit('sector-medicine', 'medical', hospital, clinicCleaner), null);
  assert.match(evaluationLimit('sector-medicine', 'medical', hospital, medicalDrone), /Свой объект/);
  assert.match(evaluationLimit('sector-medicine', 'medical', hospital, '0aaaa4d1-9ca6-4737-a3d6-92081635402c'), /Свой объект/);
  assert.match(evaluationLimit('sector-medicine', 'warehouse', { pickers_count: 10 }, clinicCleaner), /только.*уборки/);
});

test('старый расчётный шаблон остаётся доступен для своей исходной отрасли', () => {
  assert.equal(evaluationLimit('Транспорт и логистика', 'warehouse', { pickers_count: 10 }, 'some-solution'), null);
});