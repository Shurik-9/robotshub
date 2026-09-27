import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { calculateOperation, customBriefChanged, isOperationExample, mergeCustomBrief, operationFieldKey, operationFinancialEvidenceStatus, operationRecordEvidenceStatus, operationFor, operationProfiles, readOperationInputs, readOperationJournal, serializeOperationCsv, summarizeOperationJournal, validateOperationInputs, withoutOperationFields } from '../src/lib/operationEconomics.ts';
import { resolveChromiumPath } from './chromium-path.mjs';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));

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
      try {
        if (await this.evaluate(fn, argument)) return;
      } catch (error) {
        if (!String(error?.message ?? error).includes('Inspected target navigated or closed')) throw error;
      }
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
      // Сервер ещё запускается.
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

async function startBrowserApp() {
  const requestedUrl = process.env.OPERATION_ECONOMICS_BROWSER_URL?.replace(/\/$/, '');
  if (requestedUrl) {
    await waitForUrl(`${requestedUrl}/`);
    return { server: null, baseUrl: requestedUrl };
  }
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = spawn('pnpm', ['run', 'dev'], {
    cwd: projectRoot,
    env: { ...process.env, BASE_PATH: '/', PORT: String(port) },
    stdio: 'ignore',
  });
  try {
    await waitForUrl(`${baseUrl}/`);
    return { server, baseUrl };
  } catch (error) {
    await stopChild(server);
    throw error;
  }
}

async function startChromium() {
  const debugPort = await freePort();
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'robotshub-operation-economics-'));
  const chromiumPath = resolveChromiumPath();
  const browser = spawn(chromiumPath, [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${userDataDir}`,
    'about:blank',
  ], { stdio: 'ignore', detached: true });

  try {
    const devtoolsUrl = `http://127.0.0.1:${debugPort}/json/list`;
    await waitForUrl(devtoolsUrl);
    const pages = await (await fetch(devtoolsUrl)).json();
    const page = pages.find(({ type }) => type === 'page');
    assert.ok(page?.webSocketDebuggerUrl, 'Chromium не открыл страницу DevTools');
    return { browser, userDataDir, page: new DevToolsPage(page.webSocketDebuggerUrl) };
  } catch (error) {
    await stopChild(browser, true);
    await rm(userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    throw error;
  }
}

function parseCsvRows(csv) {
  const rows = [];
  let row = [];
  let cell = '';
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
    } else if (character === ',' && !quoted) {
      row.push(cell);
      cell = '';
    } else if (character === '\n' && !quoted) {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (character === '\r' && !quoted && csv[index + 1] === '\n') {
      continue;
    } else {
      cell += character;
    }
  }

  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

const ids = {
  waterCleanup: ['sector-water', '018cc2dd-3dfe-4bd2-aac6-f54cbebd783e'],
  quarrySurvey: ['sector-mining', '33fca97e-ef4f-459d-a773-ab58b7f84fd5'],
  medicalFlight: ['sector-medicine', '0861538d-75c8-473e-a2ab-499a6b8c1d49'],
  rehabilitation: ['sector-medicine', '0aaaa4d1-9ca6-4737-a3d6-92081635402c'],
};

for (const [key, [sector, id]] of Object.entries(ids)) {
  test(`${key}: применимость строго связана с картой и карточкой`, () => {
    const profile = operationFor(sector, id);
    assert.equal(profile?.key, key);
    assert.equal(operationFor('sector-mining', id), key === 'quarrySurvey' ? profile : null);
    assert.ok(profile.evidence.length);
    assert.ok(profile.operationalRecord.publicStatus.length > 30);
    assert.ok(profile.operationalRecord.requiredEntries.length >= 4);
    assert.match(operationRecordEvidenceStatus(false), /не подтверждён/i);
    assert.match(operationRecordEvidenceStatus(true), /независимо не проверены/i);
  });
  test(`${key}: четыре финансовые строки требуют отдельного документального подтверждения`, () => {
    const profile = operationProfiles[key];
    assert.deepEqual(
      profile.financialCostLines.map(line => line.fieldKey).sort(),
      ['annualFixedCost', 'baselineUnitCost', 'newUnitCost', 'unitCapex'].sort(),
    );
    for (const line of profile.financialCostLines) {
      assert.ok(line.composition.length > 20);
      assert.ok(line.documents.length > 20);
    }
    assert.ok(profile.financialReferences.length > 0);
    for (const reference of profile.financialReferences) {
      assert.match(reference.url, /^https?:\/\//);
      assert.ok(reference.value.length > 20);
      assert.ok(reference.limitation.length > 20);
    }
    assert.match(operationFinancialEvidenceStatus(true), /сценарий.*не подтверждён/i);
    assert.match(operationFinancialEvidenceStatus(false), /независимо не проверены/i);
  });
  test(`${key}: без проверяемых вводных расчёта нет`, () => {
    const profile = operationProfiles[key];
    const blank = readOperationInputs(profile, {}, {});
    assert.ok(validateOperationInputs(profile, blank).length >= 11);
    assert.throws(() => calculateOperation(profile, blank));
    const data = { site_name: 'Площадка А',
      [operationFieldKey(profile, 'observedFrom')]: '2026-01-01',
      [operationFieldKey(profile, 'observedTo')]: '2026-01-31',
      [operationFieldKey(profile, 'operationalCoverageConfirmed')]: true,
      [operationFieldKey(profile, 'operationalSource')]: 'Журнал замеров 2026-01',
      [operationFieldKey(profile, 'financialSource')]: 'Смета внедрения 2026-01',
      [operationFieldKey(profile, 'scheduledOperatingHours')]: 160,
      [operationFieldKey(profile, 'journal')]: JSON.stringify(Array.from({ length: 10 }, (_, index) => ({
        date: new Date(Date.UTC(2026, 0, 1 + index * 3)).toISOString().slice(0, 10),
        kind: 'accepted', volume: 0.7, downtimeHours: null, reason: '',
      }))),
      [operationFieldKey(profile, 'scopeConfirmed')]: true };
    const values = {
      annualVolume: 120, annualCapacity: 100, baselineUnitCost: 10000,
      newUnitCost: 2000, unitCapex: 300000, annualFixedCost: 100000,
      horizon: 5, discount: 10,
    };
    const overrides = Object.fromEntries(Object.entries(values).map(([field, value]) => [operationFieldKey(profile, field), value]));
    const input = readOperationInputs(profile, data, overrides);
    assert.deepEqual(validateOperationInputs(profile, input), []);
    assert.match(validateOperationInputs(profile, { ...input, observedTo: '' }).join(' '), /точные даты начала и окончания/);
    assert.match(validateOperationInputs(profile, { ...input, observedFrom: '2026-02-30' }).join(' '), /точные даты начала и окончания/);
    assert.match(validateOperationInputs(profile, { ...input, observedFrom: '2026-02-01', observedTo: '2026-01-31' }).join(' '), /не может быть позже/);
    assert.match(validateOperationInputs(profile, { ...input, siteName: '' }).join(' '), /точное название площадки/);
    assert.match(validateOperationInputs(profile, { ...input, operationalCoverageConfirmed: false }).join(' '), /Сверьте журнал/);
    const base = calculateOperation(profile, input);
    assert.equal(base.fleet, 2);
    assert.equal(base.baselineAnnual, 1200000);
    assert.equal(base.newAnnual, 440000);
    assert.equal(base.capex, 600000);
    assert.equal(base.savings, 760000);
    assert.equal(base.tcoNew, 2800000);
    assert.ok(base.npv > 0);
    assert.equal(calculateOperation(profile, input, { volumeMultiplier: 2, priceMultiplier: 1.1 }).fleet, 3);
    input.values.annualFixedCost = 700000;
    assert.equal(calculateOperation(profile, input).payback, null);
    const fallbackOnlyInput = {
      ...input,
      journal: [{ date: '2026-01-05', kind: 'cancelled', volume: 1, downtimeHours: null, reason: 'Отмена заказчиком' }],
      values: { ...input.values, annualCapacity: 0 },
    };
    assert.throws(() => calculateOperation(profile, fallbackOnlyInput));
  });
  test(`${key}: пример остаётся отмечен как модельные допущения`, () => {
    const profile = operationProfiles[key];
    assert.ok(profile.example.financialBasis.includes('сценарные оценки'));
    assert.ok(profile.example.operationalBasis.includes('предположения'));
    const params = {
      [operationFieldKey(profile, 'operationalSource')]: profile.example.operationalBasis,
      [operationFieldKey(profile, 'financialSource')]: profile.example.financialBasis,
      [operationFieldKey(profile, 'scopeConfirmed')]: true,
      [operationFieldKey(profile, 'example')]: true,
    };
    const overrides = Object.fromEntries(Object.entries(profile.example.values).map(([field, value]) => [operationFieldKey(profile, field), value]));
    const input = readOperationInputs(profile, params, overrides);
    assert.equal(isOperationExample(profile, params), true);
    assert.match(operationFinancialEvidenceStatus(isOperationExample(profile, params)), /не подтверждён/i);
    assert.deepEqual(validateOperationInputs(profile, input), []);
    const result = calculateOperation(profile, input);
    assert.ok(result.fleet >= 1 && Number.isFinite(result.npv));
    assert.ok(result.tcoNew > 0 && result.tcoBaseline > 0);
  });
}

test('рейсовое сообщение Минздрава подтверждает только тестовую доставку, а не годовую мощность', () => {
  const profile = operationProfiles.medicalFlight;
  const source = profile.evidence.find(item => item.url.startsWith('https://minzdrav.gov.ru/regional_news/'));
  assert.ok(source);
  assert.match(profile.operationalRecord.publicStatus, /одном рейсе 18\.02\.2025/);
  assert.match(source.note, /не подтверждает годовую мощность/);
  assert.match(profile.example.operationalBasis, /не сопровождается опубликованными итогами или журналом/);
});

test('публичные ориентиры не подменяют иллюстративные финансовые значения', () => {
  const costFields = ['baselineUnitCost', 'newUnitCost', 'unitCapex', 'annualFixedCost'];
  const expected = {
    waterCleanup: { baselineUnitCost: 12000, newUnitCost: 4000, unitCapex: 5000000, annualFixedCost: 700000 },
    quarrySurvey: { baselineUnitCost: 90000, newUnitCost: 30000, unitCapex: 5000000, annualFixedCost: 1200000 },
    medicalFlight: { baselineUnitCost: 13000, newUnitCost: 4500, unitCapex: 3300000, annualFixedCost: 1300000 },
    rehabilitation: { baselineUnitCost: 2500, newUnitCost: 1500, unitCapex: 4500000, annualFixedCost: 300000 },
  };
  for (const [key, profile] of Object.entries(operationProfiles)) {
    assert.deepEqual(
      Object.fromEntries(costFields.map(field => [field, profile.example.values[field]])),
      expected[key],
    );
  }
});

test('изменение площадки, задачи или ограничений отзывает допущения и источники прежней площадки', () => {
  const profile = operationProfiles.quarrySurvey;
  const previousBrief = { site_name: 'Карьер 1', task: 'Съёмка', constraints: 'Без полётов зимой' };
  for (const update of [
    { site_name: 'Карьер 2', task: 'Съёмка' },
    { site_name: 'Карьер 1', task: 'Демонтаж' },
    { site_name: 'Карьер 1', constraints: 'Можно зимой' },
  ]) assert.equal(customBriefChanged(previousBrief, update), true);
  assert.equal(customBriefChanged(previousBrief, { ...previousBrief }), false);
  const oldParams = {
    ...previousBrief,
    [operationFieldKey(profile, 'observedFrom')]: '2026-01-01',
    [operationFieldKey(profile, 'observedTo')]: '2026-01-31',
    [operationFieldKey(profile, 'operationalSource')]: 'Журнал карьера 1',
    [operationFieldKey(profile, 'financialSource')]: 'Смета карьера 1',
    [operationFieldKey(profile, 'scopeConfirmed')]: true,
    [operationFieldKey(profile, 'operationalCoverageConfirmed')]: true,
  };
  const cleaned = withoutOperationFields(oldParams);
  const newParams = { ...cleaned, site_name: 'Карьер 2' };
  assert.equal(newParams.site_name, 'Карьер 2');
  assert.equal(newParams[operationFieldKey(profile, 'scopeConfirmed')], undefined);
  assert.equal(newParams[operationFieldKey(profile, 'observedFrom')], undefined);
  assert.equal(newParams[operationFieldKey(profile, 'operationalCoverageConfirmed')], undefined);
  const oldOverrides = Object.fromEntries(Object.entries(profile.example.values).map(([field, value]) => [operationFieldKey(profile, field), value]));
  assert.deepEqual(withoutOperationFields(oldOverrides), {});
  const fresh = readOperationInputs(profile, newParams, withoutOperationFields(oldOverrides));
  assert.ok(validateOperationInputs(profile, fresh).length > 0);
  assert.throws(() => calculateOperation(profile, fresh));
});

test('очистка значения удаляет ключ и не пишет null в сохранённый проект', () => {
  const key = operationFieldKey(operationProfiles.waterCleanup, 'annualVolume');
  const next = Object.fromEntries(Object.entries({ [key]: 150, servicePct: 10 }).filter(([field]) => field !== key));
  assert.deepEqual(next, { servicePct: 10 });
  assert.equal(JSON.stringify(next).includes('null'), false);
});

test('удаление необязательной площади или смен сбрасывает прежнее ТЭО и не сохраняет старое значение', () => {
  const profile = operationProfiles.quarrySurvey;
  const params = {
    site_name: 'Карьер', task: 'Съёмка', constraints: 'Разрешены полёты',
    site_area_m2: 20000, shifts_per_day: 2,
    [operationFieldKey(profile, 'financialSource')]: 'Смета прошлого режима',
    [operationFieldKey(profile, 'scopeConfirmed')]: true,
  };
  const withoutArea = { site_name: 'Карьер', task: 'Съёмка', constraints: 'Разрешены полёты', shifts_per_day: 2 };
  assert.equal(customBriefChanged(params, withoutArea, true), true);
  const areaCleared = mergeCustomBrief(params, withoutArea, true);
  assert.equal(areaCleared.site_area_m2, undefined);
  assert.equal(areaCleared[operationFieldKey(profile, 'scopeConfirmed')], undefined);
  assert.equal(areaCleared[operationFieldKey(profile, 'financialSource')], undefined);
  const withoutShifts = { site_name: 'Карьер', task: 'Съёмка', constraints: 'Разрешены полёты' };
  assert.equal(customBriefChanged(params, withoutShifts, true), true);
  assert.equal(mergeCustomBrief(params, withoutShifts, true).shifts_per_day, undefined);
});

test('годовая экстраполяция учитывает период, принятый объём и отдельно показывает влияние простоев', () => {
  const profile = operationProfiles.waterCleanup;
  const journal = [
    ...Array.from({ length: 10 }, (_, index) => ({
      date: new Date(Date.UTC(2026, 0, 1 + index * 2)).toISOString().slice(0, 10),
      kind: 'accepted', volume: 10, downtimeHours: null, reason: '',
    })),
    { date: '2026-01-20', kind: 'cancelled', volume: 4, downtimeHours: null, reason: 'Шторм' },
    { date: '2026-01-21', kind: 'rework', volume: 3, downtimeHours: null, reason: 'Повтор из-за брака' },
    { date: '2026-01-22', kind: 'downtime', volume: null, downtimeHours: 12, reason: 'Отказ двигателя' },
  ];
  const params = {
    site_name: 'Балаклавская бухта, участок А',
    task: 'Сбор мусора',
    [operationFieldKey(profile, 'observedFrom')]: '2026-01-01',
    [operationFieldKey(profile, 'observedTo')]: '2026-01-30',
    [operationFieldKey(profile, 'operationalSource')]: 'Сменный журнал',
    [operationFieldKey(profile, 'financialSource')]: 'Смета',
    [operationFieldKey(profile, 'scheduledOperatingHours')]: 240,
    [operationFieldKey(profile, 'journal')]: JSON.stringify(journal),
    [operationFieldKey(profile, 'scopeConfirmed')]: true,
    [operationFieldKey(profile, 'operationalCoverageConfirmed')]: true,
  };
  const overrides = Object.fromEntries(Object.entries(profile.example.values).map(([field, value]) => [operationFieldKey(profile, field), value]));
  const input = readOperationInputs(profile, params, overrides);
  assert.deepEqual(validateOperationInputs(profile, input), []);
  const summary = summarizeOperationJournal(input);
  assert.equal(summary.observedCalendarDays, 30);
  assert.equal(summary.journalDays, 13);
  assert.equal(summary.acceptedVolume, 100);
  assert.equal(summary.cancelledVolume, 4);
  assert.ok(summary.cancelledSharePercent > 0);
  assert.equal(summary.reworkVolume, 3);
  assert.ok(summary.reworkSharePercent > 0);
  assert.equal(summary.downtimeHours, 12);
  assert.equal(summary.annualizedCapacity, 100 / 30 * 365);
  assert.equal(summary.seasonallyAdjustedCapacity, 100 / 30 * 365);
  assert.equal(summary.operatingMonths.length, 12);
  assert.deepEqual(summary.offSeasonAvailabilityByMonth, Object.fromEntries(
    Array.from({ length: 12 }, (_, index) => [index + 1, 0]),
  ));
  assert.ok(summary.noDowntimeAnnualCapacity > summary.annualizedCapacity);
  assert.ok(summary.downtimeCapacityLoss > 0);
  assert.equal(summary.sufficient, false);
  assert.equal(summary.seasonalCoverageComplete, false);
  assert.match(summary.scenarioReasons.join(' '), /не покрывают полный годовой сезонный цикл/);
  const result = calculateOperation(profile, input);
  assert.equal(result.annualCapacity, summary.annualizedCapacity);
  assert.equal(result.fleet, Math.ceil(input.values.annualVolume / summary.annualizedCapacity));
  const journalOnlyOverrides = { ...overrides };
  delete journalOnlyOverrides[operationFieldKey(profile, 'annualCapacity')];
  const journalOnlyInput = readOperationInputs(profile, params, journalOnlyOverrides);
  assert.deepEqual(validateOperationInputs(profile, journalOnlyInput), []);
  assert.equal(calculateOperation(profile, journalOnlyInput).annualCapacity, summary.annualizedCapacity);
});

test('короткий и разреженный период оставляет годовую экстраполяцию сценарной', () => {
  const profile = operationProfiles.waterCleanup;
  const params = {
    site_name: 'Причал',
    task: 'Сбор мусора',
    [operationFieldKey(profile, 'observedFrom')]: '2026-01-01',
    [operationFieldKey(profile, 'observedTo')]: '2026-01-07',
    [operationFieldKey(profile, 'operationalSource')]: 'Короткий журнал',
    [operationFieldKey(profile, 'financialSource')]: 'Смета',
    [operationFieldKey(profile, 'scheduledOperatingHours')]: 56,
    [operationFieldKey(profile, 'journal')]: JSON.stringify([
      { date: '2026-01-01', kind: 'accepted', volume: 8, downtimeHours: null, reason: '' },
      { date: '2026-01-06', kind: 'accepted', volume: 5, downtimeHours: null, reason: '' },
    ]),
    [operationFieldKey(profile, 'scopeConfirmed')]: true,
    [operationFieldKey(profile, 'operationalCoverageConfirmed')]: true,
  };
  const overrides = Object.fromEntries(Object.entries(profile.example.values).map(([field, value]) => [operationFieldKey(profile, field), value]));
  const summary = summarizeOperationJournal(readOperationInputs(profile, params, overrides));
  assert.equal(summary.annualizedCapacity, 13 / 7 * 365);
  assert.equal(summary.seasonallyAdjustedCapacity, summary.annualizedCapacity);
  assert.equal(summary.sufficient, false);
  assert.match(summary.scenarioReasons.join(' '), /короче 30/);
  assert.match(summary.scenarioReasons.join(' '), /менее 10 разных дат/);
  assert.match(summary.scenarioReasons.join(' '), /полный годовой сезонный цикл/);
});

test('сезонный сценарий использует отдельную доступность каждого месяца', () => {
  const profile = operationProfiles.waterCleanup;
  const params = {
    site_name: 'Причал',
    task: 'Сбор мусора',
    [operationFieldKey(profile, 'observedFrom')]: '2026-01-15',
    [operationFieldKey(profile, 'observedTo')]: '2026-02-13',
    [operationFieldKey(profile, 'operationalSource')]: 'Зимний журнал',
    [operationFieldKey(profile, 'financialSource')]: 'Смета',
    [operationFieldKey(profile, 'scheduledOperatingHours')]: 240,
    [operationFieldKey(profile, 'journal')]: JSON.stringify(Array.from({ length: 10 }, (_, index) => ({
      date: new Date(Date.UTC(2026, 0, 15 + index * 3)).toISOString().slice(0, 10),
      kind: 'accepted', volume: 10, downtimeHours: null, reason: '',
    }))),
    [operationFieldKey(profile, 'operatingMonths')]: JSON.stringify([1]),
    [operationFieldKey(profile, 'offSeasonAvailabilityByMonth')]: JSON.stringify({
      2: 20,
      3: 60,
      4: 0,
      5: 0,
      6: 0,
      7: 0,
      8: 0,
      9: 0,
      10: 0,
      11: 0,
      12: 0,
    }),
    [operationFieldKey(profile, 'offSeasonEvidenceByMonth')]: JSON.stringify({
      2: { source: 'Архив метеоданных, 2025 год', explanation: 'При ветре выше порога выходы сокращаются.' },
    }),
    [operationFieldKey(profile, 'scopeConfirmed')]: true,
    [operationFieldKey(profile, 'operationalCoverageConfirmed')]: true,
  };
  const values = {
    ...profile.example.values,
    annualVolume: 1000,
  };
  const overrides = Object.fromEntries(Object.entries(values).map(([field, value]) => [operationFieldKey(profile, field), value]));
  const input = readOperationInputs(profile, params, overrides);
  assert.deepEqual(validateOperationInputs(profile, input), []);
  const summary = summarizeOperationJournal(input);
  assert.equal(summary.annualizedCapacity, 100 / 30 * 365);
  assert.equal(summary.observedSeasonalDays, 19.6);
  assert.equal(summary.annualSeasonalDays, 55.2);
  assert.equal(summary.seasonallyAdjustedCapacity, 100 / 19.6 * 55.2);
  assert.equal(summary.operatingMonths.join(','), '1');
  assert.equal(summary.offSeasonAvailabilityByMonth[2], 20);
  assert.equal(summary.offSeasonAvailabilityByMonth[3], 60);
  assert.deepEqual(summary.offSeasonEvidenceByMonth[2], {
    source: 'Архив метеоданных, 2025 год',
    explanation: 'При ветре выше порога выходы сокращаются.',
  });
  assert.deepEqual(summary.offSeasonEvidenceByMonth[3], { source: '', explanation: '' });
  assert.equal(summary.seasonalCoverageComplete, false);
  assert.equal(summary.sufficient, false);

  const result = calculateOperation(profile, input);
  assert.equal(result.annualCapacity, summary.seasonallyAdjustedCapacity);
  assert.equal(result.fleet, Math.ceil(input.values.annualVolume / summary.seasonallyAdjustedCapacity));
});

test('старое общее значение доступности переносится на месяцы вне сезона', () => {
  const profile = operationProfiles.waterCleanup;
  const input = readOperationInputs(profile, {
    [operationFieldKey(profile, 'operatingMonths')]: JSON.stringify([1, 2]),
    [operationFieldKey(profile, 'offSeasonAvailabilityPercent')]: 35,
  }, {});
  assert.deepEqual(
    Object.values(input.offSeasonAvailabilityByMonth),
    Array(12).fill(35),
  );
  assert.deepEqual(validateOperationInputs(profile, input).filter(error => /Доступность работ/.test(error)), []);
});

test('полный календарный цикл снимает только предупреждение о неполном сезонном покрытии', () => {
  const profile = operationProfiles.quarrySurvey;
  const params = {
    site_name: 'Карьер',
    task: 'Съёмка',
    [operationFieldKey(profile, 'observedFrom')]: '2026-01-01',
    [operationFieldKey(profile, 'observedTo')]: '2026-12-31',
    [operationFieldKey(profile, 'operationalSource')]: 'Годовой журнал',
    [operationFieldKey(profile, 'financialSource')]: 'Смета',
    [operationFieldKey(profile, 'scheduledOperatingHours')]: 8760,
    [operationFieldKey(profile, 'journal')]: JSON.stringify(Array.from({ length: 12 }, (_, index) => ({
      date: `2026-${String(index + 1).padStart(2, '0')}-15`,
      kind: 'accepted', volume: 2, downtimeHours: null, reason: '',
    }))),
    [operationFieldKey(profile, 'operatingMonths')]: JSON.stringify([4, 5, 6, 7, 8, 9]),
    [operationFieldKey(profile, 'offSeasonAvailabilityPercent')]: 25,
    [operationFieldKey(profile, 'scopeConfirmed')]: true,
    [operationFieldKey(profile, 'operationalCoverageConfirmed')]: true,
  };
  const overrides = Object.fromEntries(Object.entries(profile.example.values).map(([field, value]) => [operationFieldKey(profile, field), value]));
  const input = readOperationInputs(profile, params, overrides);
  const summary = summarizeOperationJournal(input);
  assert.equal(summary.seasonalCoverageComplete, true);
  assert.equal(summary.sufficient, true);
  assert.ok(Math.abs(summary.annualizedCapacity - 24) < 1e-10);
  assert.ok(Math.abs(summary.seasonallyAdjustedCapacity - 24) < 1e-10);
});

test('неверные настройки сезонного календаря не принимаются молча', () => {
  const profile = operationProfiles.waterCleanup;
  const input = readOperationInputs(profile, {
    [operationFieldKey(profile, 'operatingMonths')]: '[1,1,13]',
    [operationFieldKey(profile, 'offSeasonAvailabilityPercent')]: 101,
  }, {});
  const errors = validateOperationInputs(profile, input).join(' ');
  assert.match(errors, /сезонный календарь имеет неизвестный формат/);
  assert.match(errors, /хотя бы один месяц/);
  assert.match(errors, /от 0 до 100%/);
});

test('помесячная доступность вне сезона ограничена диапазоном 0–100%', () => {
  const profile = operationProfiles.waterCleanup;
  const input = readOperationInputs(profile, {
    [operationFieldKey(profile, 'operatingMonths')]: '[1]',
    [operationFieldKey(profile, 'offSeasonAvailabilityByMonth')]: JSON.stringify({
      2: 100.1,
      3: -1,
      4: '',
    }),
  }, {});
  const errors = validateOperationInputs(profile, input);
  assert.ok(errors.some(error => /«Февраль».*0 до 100%/i.test(error)));
  assert.ok(errors.some(error => /«Март».*0 до 100%/i.test(error)));
  assert.ok(errors.some(error => /«Апрель».*0 до 100%/i.test(error)));
});

test('причины отмен, повторов и простоев обязательны, даты ограничены периодом', () => {
  const profile = operationProfiles.waterCleanup;
  const params = {
    site_name: 'Причал',
    task: 'Сбор мусора',
    [operationFieldKey(profile, 'observedFrom')]: '2026-01-01',
    [operationFieldKey(profile, 'observedTo')]: '2026-01-31',
    [operationFieldKey(profile, 'operationalSource')]: 'Журнал',
    [operationFieldKey(profile, 'financialSource')]: 'Смета',
    [operationFieldKey(profile, 'scheduledOperatingHours')]: 160,
    [operationFieldKey(profile, 'journal')]: JSON.stringify([
      { date: '2026-02-01', kind: 'cancelled', volume: 5, downtimeHours: null, reason: '' },
    ]),
    [operationFieldKey(profile, 'scopeConfirmed')]: true,
    [operationFieldKey(profile, 'operationalCoverageConfirmed')]: true,
  };
  const overrides = Object.fromEntries(Object.entries(profile.example.values).map(([field, value]) => [operationFieldKey(profile, field), value]));
  const errors = validateOperationInputs(profile, readOperationInputs(profile, params, overrides));
  assert.ok(errors.some(error => /должна попадать в период/.test(error)));
  assert.ok(errors.some(error => /укажите причину отмены/.test(error)));
  assert.deepEqual(readOperationJournal('{broken'), { entries: [], invalid: true });
});

test('CSV-сериализатор сохраняет запятые, кавычки и переносы строк внутри одной ячейки', () => {
  const original = [
    ['Показатель', 'Значение'],
    ['Причина', 'Шторм, "порыв ветра"\nзакрытие участка'],
  ];
  const csv = serializeOperationCsv(original);

  assert.ok(csv.startsWith('\uFEFF'), 'CSV должен начинаться с BOM для корректного распознавания UTF-8');
  assert.match(csv, /"Шторм, ""порыв ветра""\nзакрытие участка"/);
  assert.deepEqual(parseCsvRows(csv.slice(1)), original);
});

test('браузер сохраняет сезонные настройки в отчёте и экспортирует одинаковые оценки и статусы', { concurrency: false }, async () => {
  let server;
  let chromium;
  let downloadDir;
  let stage = 'запуск приложения и браузера';

  try {
    const app = await startBrowserApp();
    server = app.server;
    chromium = await startChromium();
    downloadDir = await mkdtemp(path.join(tmpdir(), 'robotshub-operation-csv-download-'));

    const waterProfile = operationProfiles.waterCleanup;
    const waterSolutionId = '018cc2dd-3dfe-4bd2-aac6-f54cbebd783e';
    const waterJournal = [
      ...Array.from({ length: 10 }, (_, index) => ({
        date: new Date(Date.UTC(2026, 0, 1 + index % 7)).toISOString().slice(0, 10),
        kind: 'accepted',
        volume: 10,
        downtimeHours: null,
        reason: '',
      })),
      { date: '2026-01-06', kind: 'cancelled', volume: 4, downtimeHours: null, reason: 'Шторм, "порыв ветра"\nзакрытие участка' },
      { date: '2026-01-06', kind: 'rework', volume: 3, downtimeHours: null, reason: 'Повтор из-за брака, "контроль"\nповторная проверка' },
      { date: '2026-01-07', kind: 'downtime', volume: null, downtimeHours: 12, reason: 'Отказ двигателя, "диагностика"\nожидание детали' },
    ];
    const makeState = ({ profile, solutionId, journal, observedFrom, observedTo, scheduledHours, operatingMonths, offSeasonAvailabilityPercent, siteName, task }) => ({
      objectType: 'custom',
      sectorId: profile.key === 'waterCleanup' ? 'sector-water' : 'sector-mining',
      objectParams: {
        site_name: siteName,
        task,
        [operationFieldKey(profile, 'observedFrom')]: observedFrom,
        [operationFieldKey(profile, 'observedTo')]: observedTo,
        [operationFieldKey(profile, 'operationalSource')]: 'Сменный журнал с периодом и источником',
        [operationFieldKey(profile, 'financialSource')]: 'Смета внедрения',
        [operationFieldKey(profile, 'scheduledOperatingHours')]: scheduledHours,
        [operationFieldKey(profile, 'journal')]: JSON.stringify(journal),
        [operationFieldKey(profile, 'operatingMonths')]: JSON.stringify(operatingMonths),
        [operationFieldKey(profile, 'offSeasonAvailabilityPercent')]: offSeasonAvailabilityPercent,
        [operationFieldKey(profile, 'scopeConfirmed')]: true,
        [operationFieldKey(profile, 'operationalCoverageConfirmed')]: true,
      },
      selectedSolutions: [solutionId],
      activeSolutionId: solutionId,
      whatIfOverrides: {},
      assumptionsOverrides: Object.fromEntries(
        Object.entries(profile.example.values).map(([field, value]) => [operationFieldKey(profile, field), value]),
      ),
      simulationKpis: null,
    });
    const waterSiteName = 'Бухта, "Южная"\nучасток А';
    const waterState = makeState({
      profile: waterProfile,
      solutionId: waterSolutionId,
      journal: waterJournal,
      observedFrom: '2026-01-01',
      observedTo: '2026-01-07',
      scheduledHours: 56,
      operatingMonths: [1, 2],
      offSeasonAvailabilityPercent: 25,
      siteName: waterSiteName,
      task: 'Сбор плавающего мусора',
    });
    const clickTestId = async testId => {
      const selector = `[data-testid="${testId}"]`;
      const point = await chromium.page.evaluate(value => {
        const element = document.querySelector(value);
        if (!(element instanceof HTMLElement)) throw new Error(`Не найден элемент ${value}`);
        element.scrollIntoView({ block: 'center' });
        const bounds = element.getBoundingClientRect();
        return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
      }, selector);
      await chromium.page.command('Input.dispatchMouseEvent', {
        type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1,
      });
      await chromium.page.command('Input.dispatchMouseEvent', {
        type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1,
      });
    };
    const clickCheckboxTestId = async testId => chromium.page.evaluate(testId => {
      const checkbox = document.querySelector(`[data-testid="${testId}"]`);
      if (!(checkbox instanceof HTMLInputElement) || checkbox.type !== 'checkbox') {
        throw new Error(`Не найден флажок ${testId}`);
      }
      checkbox.click();
    }, testId);
    const clickButtonTestId = async testId => chromium.page.evaluate(testId => {
      const button = document.querySelector(`[data-testid="${testId}"]`);
      if (!(button instanceof HTMLButtonElement) || button.disabled) {
        throw new Error(`Не найдена активная кнопка ${testId}`);
      }
      button.click();
    }, testId);
    const assertMobileMonthCards = async operatingMonths => {
      const monthLabels = [
        'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
        'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
      ];
      for (const [index, expectedLabel] of monthLabels.entries()) {
        const month = index + 1;
        const item = await chromium.page.evaluate(month => {
          const card = document.querySelector(`[data-testid="operation-season-month-card-${month}"]`);
          const input = document.querySelector(`[data-testid="operation-off-season-availability-${month}"]`);
          if (!(card instanceof HTMLElement) || !(input instanceof HTMLInputElement)) {
            throw new Error(`Не найдена карточка или ставка месяца ${month}`);
          }
          card.scrollIntoView({ block: 'center' });
          const heading = card.querySelector('label > span');
          const [label, status] = heading?.children ?? [];
          if (!(label instanceof HTMLElement) || !(status instanceof HTMLElement)) {
            throw new Error(`Не найдена подпись или отметка месяца ${month}`);
          }
          const rect = element => {
            const { left, right, top, bottom, width, height } = element.getBoundingClientRect();
            return { left, right, top, bottom, width, height };
          };
          return {
            label: label.textContent?.trim(),
            status: status.textContent?.trim(),
            disabled: input.disabled,
            inputVisible: input.getClientRects().length > 0 && getComputedStyle(input).visibility !== 'hidden',
            input: rect(input),
            card: rect(card),
            cardOverflowsHorizontally: card.scrollWidth > card.clientWidth + 1,
            viewportWidth: window.visualViewport?.width ?? window.innerWidth,
            viewportHeight: window.visualViewport?.height ?? window.innerHeight,
          };
        }, month);
        assert.equal(item.label, expectedLabel, `${expectedLabel}: подпись месяца должна отображаться полностью`);
        assert.equal(item.disabled, operatingMonths.includes(month), `${expectedLabel}: поле должно быть недоступно только при обычной работе`);
        assert.equal(item.status, operatingMonths.includes(month) ? 'обычная работа · 100%' : 'вне сезона');
        assert.equal(item.inputVisible, true, `${expectedLabel}: поле ставки должно присутствовать и отображаться`);
        assert.ok(item.input.width > 0 && item.input.height > 0, `${expectedLabel}: поле ставки должно иметь видимый размер`);
        assert.ok(item.input.left >= 0 && item.input.right <= item.viewportWidth, `${expectedLabel}: поле ставки не должно обрезаться по ширине экрана`);
        assert.ok(item.input.top >= 0 && item.input.bottom <= item.viewportHeight, `${expectedLabel}: поле ставки должно быть доступно в области просмотра после прокрутки`);
        assert.ok(item.card.left >= 0 && item.card.right <= item.viewportWidth, `${expectedLabel}: карточка месяца не должна выходить за ширину экрана`);
        assert.equal(item.cardOverflowsHorizontally, false, `${expectedLabel}: содержимое карточки не должно обрезаться по горизонтали`);
      }
    };
    const loadStateAtCalc = async state => {
      // Seed storage on a static document before React mounts. Waiting only for
      // document.readyState on / races the app's initial persistence effect in
      // production builds and can overwrite the seeded project.
      const seedUrl = `${app.baseUrl}/map/map-data.json`;
      await chromium.page.command('Page.navigate', { url: seedUrl });
      await chromium.page.waitFor(url => location.href === url && document.readyState === 'complete', seedUrl);
      await chromium.page.evaluate(project => {
        localStorage.clear();
        localStorage.setItem('robotshub_project', JSON.stringify(project));
      }, state);
      await chromium.page.command('Page.navigate', { url: `${app.baseUrl}/calc` });
      const expectedProfile = state.sectorId === 'sector-water' ? 'waterCleanup' : 'quarrySurvey';
      await chromium.page.waitFor(profile => Boolean(document.querySelector(`[data-testid="operation-calc-${profile}"]`)), expectedProfile);
    };

    const enterInputValue = async (testId, value) => {
      const selector = `[data-testid="${testId}"]`;
      await chromium.page.evaluate(value => {
        const input = document.querySelector(value);
        if (!(input instanceof HTMLInputElement)) throw new Error(`Не найдено поле ${value}`);
        input.focus();
        input.select();
      }, selector);
      await chromium.page.command('Input.insertText', { text: String(value) });
      await chromium.page.waitFor(([selector, expected]) => {
        const input = document.querySelector(selector);
        return input instanceof HTMLInputElement && input.value === expected;
      }, [selector, String(value)]);
    };
    const enterTextAreaValue = async (testId, value) => {
      const selector = `[data-testid="${testId}"]`;
      await chromium.page.evaluate(value => {
        const textarea = document.querySelector(value);
        if (!(textarea instanceof HTMLTextAreaElement)) throw new Error(`Не найдено текстовое поле ${value}`);
        textarea.focus();
        textarea.select();
      }, selector);
      await chromium.page.command('Input.insertText', { text: String(value) });
      await chromium.page.waitFor(([selector, expected]) => {
        const textarea = document.querySelector(selector);
        return textarea instanceof HTMLTextAreaElement && textarea.value === expected;
      }, [selector, String(value)]);
    };
    const normalizeWhitespace = value => value.replaceAll('\u00a0', ' ').replaceAll('\u202f', ' ').replace(/\s+/g, ' ').trim();
    const numberFromText = value => {
      const digits = value.replaceAll('\u00a0', '').replaceAll('\u202f', '').replaceAll(' ', '').match(/-?\d+(?:[,.]\d+)?/);
      assert.ok(digits, `В тексте должно быть числовое значение: ${value}`);
      return Number(digits[0].replace(',', '.'));
    };
    const reportPrecision = value => Math.round(value * 10) / 10;
    const reportStatusValue = async testId => chromium.page.evaluate(testId => {
      const text = document.querySelector(`[data-testid="${testId}"]`)?.textContent ?? '';
      return text.replace(/^[^:]+:\s*/, '').trim();
    }, testId);
    const exportRows = async () => {
      const button = await chromium.page.evaluate(() => {
        const element = document.querySelector('[data-testid="operation-export-csv"]');
        if (!(element instanceof HTMLButtonElement)) throw new Error('Кнопка экспорта CSV не найдена');
        return element.disabled;
      });
      assert.equal(button, false, 'Экспорт должен быть доступен для рассчитанного отчёта');
      const previousFiles = new Set((await readdir(downloadDir)).filter(file => file.endsWith('.csv')));
      await clickTestId('operation-export-csv');
      let csvFile;
      const downloadStartedAt = Date.now();
      while (Date.now() - downloadStartedAt < 10_000) {
        const files = await readdir(downloadDir);
        csvFile = files.find(file => file.endsWith('.csv') && !previousFiles.has(file));
        if (csvFile && !files.some(file => file.endsWith('.crdownload'))) break;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      assert.ok(csvFile, 'Chromium должен скачать CSV по нажатию кнопки отчёта');
      assert.equal((await readdir(downloadDir)).some(file => file.endsWith('.crdownload')), false, 'Скачивание CSV должно завершиться');
      const csv = await readFile(path.join(downloadDir, csvFile), 'utf8');
      assert.ok(csv.startsWith('\uFEFF'), 'Скачанный CSV должен содержать BOM UTF-8');
      return parseCsvRows(csv.slice(1));
    };
    const csvRowValue = (rows, label) => {
      const row = rows.find(([key]) => key === label);
      assert.ok(row, `CSV должен содержать показатель «${label}»`);
      return row[1];
    };

    await chromium.page.command('Page.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: downloadDir,
    });
    stage = 'загрузка короткого сезонного периода';
    await loadStateAtCalc(waterState);
    await chromium.page.command('Emulation.setDeviceMetricsOverride', {
      width: 360,
      height: 800,
      deviceScaleFactor: 1,
      mobile: true,
      screenWidth: 360,
      screenHeight: 800,
    });

    const monthCount = await chromium.page.evaluate(() => document.querySelectorAll('input[data-testid^="operation-season-month-"]').length);
    assert.equal(monthCount, 12, 'Форма должна показывать доступный выбор для каждого месяца');
    const mobileViewport = await chromium.page.evaluate(() => ({
      innerWidth: window.innerWidth,
      visualWidth: window.visualViewport?.width,
      visualScale: window.visualViewport?.scale,
      devicePixelRatio: window.devicePixelRatio,
      screenWidth: window.screen.width,
      outerWidth: window.outerWidth,
    }));
    assert.equal(mobileViewport.visualWidth, 360, `Видимая мобильная область должна иметь ширину 360 px: ${JSON.stringify(mobileViewport)}`);
    assert.ok(mobileViewport.innerWidth <= 640, `Ширина вёрстки должна оставаться мобильной: ${JSON.stringify(mobileViewport)}`);
    await assertMobileMonthCards([1, 2]);
    assert.equal(await chromium.page.evaluate(() => document.querySelector('[data-testid="operation-season-month-1"]').checked), true);
    assert.equal(await chromium.page.evaluate(() => document.querySelector('[data-testid="operation-season-month-2"]').checked), true);
    assert.equal(await chromium.page.evaluate(() => document.querySelector('[data-testid="operation-season-month-7"]').checked), false);
    await clickCheckboxTestId('operation-season-month-2');
    await chromium.page.waitFor(() => document.querySelector('[data-testid="operation-season-month-2"]')?.checked === false);
    await clickCheckboxTestId('operation-season-month-7');
    await chromium.page.waitFor(() => document.querySelector('[data-testid="operation-season-month-7"]')?.checked === true);
    await assertMobileMonthCards([1, 7]);
    await enterInputValue('operation-off-season-availability-2', 40);
    const februarySource = `Гидрометцентр: "Ветер", бюллетень 2025; ${'Архив наблюдений за доступностью и режимом ветра. '.repeat(5)} ${'storm-report-2025-'.repeat(6)}`;
    const februaryExplanation = `При сильном ветре выходы ограничены; ставка основана на журнале отмен. ${'Проверено по журналу ограничений полевых выходов. '.repeat(3)}`.trim();
    const marchSource = 'https://weather.example.gov/reports/seasonal-availability-2025';
    const aprilSource = 'Оценка спроса по архиву обращений за 2025 год';
    const maySource = 'javascript:alert(1)';
    assert.ok(februarySource.length <= 500, 'Длинный источник должен укладываться в ограничение формы');
    assert.ok(februaryExplanation.length <= 300, 'Длинное пояснение должно укладываться в ограничение формы');
    await enterInputValue('operation-off-season-source-2', februarySource);
    await enterTextAreaValue('operation-off-season-explanation-2', februaryExplanation);
    await enterInputValue('operation-off-season-source-3', marchSource);
    await enterInputValue('operation-off-season-source-4', aprilSource);
    await enterInputValue('operation-off-season-source-5', maySource);
    await chromium.page.waitFor(([profileKey, expectedSource, expectedExplanation, expectedMarchSource, expectedAprilSource, expectedMaySource]) => {
      const project = JSON.parse(localStorage.getItem('robotshub_project') ?? '{}');
      const months = JSON.parse(project.objectParams?.[`operation:${profileKey}:operatingMonths`] ?? '[]');
      const availability = JSON.parse(project.objectParams?.[`operation:${profileKey}:offSeasonAvailabilityByMonth`] ?? '{}');
      const evidence = JSON.parse(project.objectParams?.[`operation:${profileKey}:offSeasonEvidenceByMonth`] ?? '{}');
      return months.join(',') === '1,7'
        && availability[2] === 40
        && availability[3] === 25
        && evidence[2]?.source === expectedSource
        && evidence[2]?.explanation === expectedExplanation
        && evidence[3]?.source === expectedMarchSource
        && evidence[4]?.source === expectedAprilSource
        && evidence[5]?.source === expectedMaySource;
    }, [waterProfile.key, februarySource, februaryExplanation, marchSource, aprilSource, maySource]);

    stage = 'переход с расчёта в отчёт и перезагрузка';
    await clickButtonTestId('operation-open-report');
    await chromium.page.waitFor(() => Boolean(document.querySelector('[data-testid="operation-seasonality-report"]')));
    assert.equal(await chromium.page.evaluate(() => document.querySelector('[data-testid="operation-seasonality-report"]')?.dataset.operationProfile), 'waterCleanup');
    await chromium.page.command('Page.reload', { ignoreCache: true });
    await chromium.page.waitFor(() => performance.getEntriesByType('navigation')[0]?.type === 'reload');
    await chromium.page.waitFor(() => Boolean(
      document.readyState === 'complete'
      && document.querySelector('[data-testid="operation-seasonality-report"]')?.dataset.operationProfile === 'waterCleanup'
      && document.querySelector('[data-testid="operation-report-linear-estimate"]')?.textContent?.includes('Базовая линейная оценка')
      && document.querySelector('[data-testid="operation-report-seasonal-assumptions"]')?.textContent?.trim(),
    ));

    const linearEstimate = await chromium.page.evaluate(() => document.querySelector('[data-testid="operation-report-linear-estimate"]')?.textContent ?? '');
    const seasonalEstimate = await chromium.page.evaluate(() => document.querySelector('[data-testid="operation-report-seasonal-estimate"]')?.textContent ?? '');
    const seasonalAssumptions = normalizeWhitespace(await chromium.page.evaluate(() => document.querySelector('[data-testid="operation-report-seasonal-assumptions"]')?.textContent ?? ''));
    const linearStatus = await reportStatusValue('operation-report-linear-status');
    const seasonalStatus = await reportStatusValue('operation-report-seasonal-status');
    assert.match(linearEstimate, /Базовая линейная оценка/);
    assert.match(linearEstimate, /= .*\/год/);
    assert.match(seasonalEstimate, /отдельный сценарий/);
    assert.notEqual(
      numberFromText(await chromium.page.evaluate(() => document.querySelector('[data-testid="operation-report-linear-capacity-value"]')?.textContent ?? '')),
      numberFromText(await chromium.page.evaluate(() => document.querySelector('[data-testid="operation-report-seasonal-capacity-value"]')?.textContent ?? '')),
      'Для короткого январского журнала линейная оценка и сезонный сценарий должны оставаться разными значениями',
    );
    assert.match(linearStatus, /сценарная/);
    assert.match(seasonalStatus, /сценарный: наблюдения не покрывают полный годовой сезонный цикл/);
    assert.match(seasonalAssumptions, /Январь, Июль/);
    assert.match(seasonalAssumptions, /Февраль: 40% \(вне сезона\)/);
    assert.match(seasonalAssumptions, /Март: 25% \(вне сезона\)/);
    assert.match(seasonalAssumptions, /Источник: https:\/\/weather\.example\.gov\/reports\/seasonal-availability-2025/);
    assert.match(seasonalAssumptions, /Источник: Гидрометцентр: "Ветер", бюллетень 2025/);
    assert.match(seasonalAssumptions, /пояснение: При сильном ветре выходы ограничены; ставка основана на журнале отмен/);
    assert.match(seasonalAssumptions, /Оценка спроса по архиву обращений за 2025 год/);
    assert.match(seasonalAssumptions, /javascript:alert\(1\)/);
    const seasonalSourceLinks = await chromium.page.evaluate(() => {
      const readSource = month => {
        const basis = document.querySelector(`[data-testid="operation-report-seasonal-basis-${month}"]`);
        const sourceLink = basis?.querySelector('a');
        return {
          text: basis?.querySelector('p')?.textContent?.trim() ?? '',
          href: sourceLink?.getAttribute('href') ?? null,
          target: sourceLink?.getAttribute('target') ?? null,
          rel: sourceLink?.getAttribute('rel') ?? null,
        };
      };
      return { url: readSource(3), text: readSource(4), unsafe: readSource(5), ordinaryText: readSource(2) };
    });
    assert.deepEqual(seasonalSourceLinks.url, {
      text: `Источник: ${marchSource}`,
      href: marchSource,
      target: '_blank',
      rel: 'noopener noreferrer',
    }, 'HTTP(S)-источник должен открываться отдельно с безопасными атрибутами');
    assert.equal(seasonalSourceLinks.text.text, `Источник: ${aprilSource}`);
    assert.equal(seasonalSourceLinks.text.href, null, 'Обычный текстовый источник не должен превращаться в ссылку');
    assert.equal(seasonalSourceLinks.unsafe.text, `Источник: ${maySource}`);
    assert.equal(seasonalSourceLinks.unsafe.href, null, 'javascript:-источник должен оставаться обычным текстом');
    assert.equal(seasonalSourceLinks.ordinaryText.href, null, 'Длинный текстовый источник не должен превращаться в ссылку');

    stage = 'проверка печатной версии сезонного отчёта';
    await chromium.page.command('Emulation.clearDeviceMetricsOverride');
    await chromium.page.command('Emulation.setEmulatedMedia', { media: 'print' });
    const printSeasonalRows = await chromium.page.evaluate(() => {
      const table = document.querySelector('[data-testid="operation-report-seasonal-monthly-assumptions"]');
      const row = document.querySelector('[data-testid="operation-report-seasonal-month-2"]');
      const rate = row?.querySelector('[data-testid="operation-report-seasonal-rate-2"]');
      const basis = row?.querySelector('[data-testid="operation-report-seasonal-basis-2"]');
      const marchRow = document.querySelector('[data-testid="operation-report-seasonal-month-3"]');
      const marchRate = marchRow?.querySelector('[data-testid="operation-report-seasonal-rate-3"]');
      const marchBasis = marchRow?.querySelector('[data-testid="operation-report-seasonal-basis-3"]');
      if (!(table instanceof HTMLTableElement) || !(row instanceof HTMLTableRowElement)
        || !(rate instanceof HTMLElement) || !(basis instanceof HTMLElement)
        || !(marchRate instanceof HTMLElement) || !(marchBasis instanceof HTMLElement)) {
        throw new Error('Не найдена связанная строка помесячной сезонной ставки');
      }
      const rowStyle = getComputedStyle(row);
      const basisStyle = getComputedStyle(basis);
      return {
        printMedia: window.matchMedia('print').matches,
        rowCount: table.querySelectorAll('tbody tr').length,
        rateText: rate.textContent?.trim(),
        basisText: basis.textContent?.trim(),
        marchRateText: marchRate.textContent?.trim(),
        marchBasisText: marchBasis.textContent?.trim(),
        columns: row.cells.length,
        rowBreakInside: rowStyle.breakInside,
        rowPageBreakInside: rowStyle.pageBreakInside,
        basisOverflowWrap: basisStyle.overflowWrap,
        basisWhiteSpace: basisStyle.whiteSpace,
        basisOverflow: basisStyle.overflow,
        basisScrollWidth: basis.scrollWidth,
        basisClientWidth: basis.clientWidth,
        basisScrollHeight: basis.scrollHeight,
        basisClientHeight: basis.clientHeight,
      };
    });
    assert.equal(printSeasonalRows.printMedia, true, 'Проверка должна выполняться с активным print media');
    assert.equal(printSeasonalRows.rowCount, 12, 'В печатной таблице должны присутствовать все месяцы');
    assert.match(printSeasonalRows.rateText, /Февраль: 40% \(вне сезона\)/);
    assert.ok(printSeasonalRows.basisText.includes(februarySource), 'Источник должен оставаться в строке ставки февраля');
    assert.ok(printSeasonalRows.basisText.includes(februaryExplanation), 'Пояснение должно оставаться в строке ставки февраля');
    assert.match(printSeasonalRows.marchRateText, /Март: 25% \(вне сезона\)/);
    assert.ok(printSeasonalRows.marchBasisText.includes(`Источник: ${marchSource}`));
    assert.ok(printSeasonalRows.marchBasisText.includes('пояснение: не указано.'));
    assert.equal(printSeasonalRows.columns, 2, 'Ставка и основание должны находиться в одной строке таблицы');
    assert.equal(printSeasonalRows.rowBreakInside, 'avoid', 'Печатная строка ставки не должна разрываться между страницами');
    assert.equal(printSeasonalRows.rowPageBreakInside, 'avoid');
    assert.equal(printSeasonalRows.basisOverflowWrap, 'anywhere', 'Длинные источники должны переноситься внутри ячейки');
    assert.equal(printSeasonalRows.basisWhiteSpace, 'normal');
    assert.equal(printSeasonalRows.basisOverflow, 'visible');
    assert.ok(printSeasonalRows.basisScrollWidth <= printSeasonalRows.basisClientWidth + 1, 'Источник и пояснение не должны обрезаться по ширине');
    assert.ok(printSeasonalRows.basisScrollHeight <= printSeasonalRows.basisClientHeight + 1, 'Источник и пояснение не должны обрезаться по высоте');
    const seasonalPdf = await chromium.page.command('Page.printToPDF', {
      printBackground: true,
      preferCSSPageSize: true,
    });
    const seasonalPdfBytes = Buffer.from(seasonalPdf.data, 'base64');
    assert.ok(seasonalPdfBytes.toString('utf8').startsWith('%PDF-'), 'Сезонный отчёт должен формироваться в PDF');
    assert.ok(seasonalPdfBytes.toString('utf8').includes('%%EOF'), 'PDF должен завершаться корректным маркером');
    await chromium.page.command('Emulation.setEmulatedMedia', { media: 'screen' });

    stage = 'возврат из отчёта к мобильной форме расчёта';
    await chromium.page.command('Emulation.setDeviceMetricsOverride', {
      width: 360,
      height: 800,
      deviceScaleFactor: 1,
      mobile: true,
      screenWidth: 360,
      screenHeight: 800,
    });
    await clickButtonTestId('operation-back-to-calc');
    await chromium.page.waitFor(() => Boolean(document.querySelector('[data-testid="operation-calc-waterCleanup"]')));
    await chromium.page.waitFor(() => (
      document.querySelector('[data-testid="operation-off-season-availability-2"]')?.value === '40'
      && document.querySelector('[data-testid="operation-season-month-1"]')?.checked
      && document.querySelector('[data-testid="operation-season-month-7"]')?.checked
    ));
    await assertMobileMonthCards([1, 7]);
    assert.equal(
      await chromium.page.evaluate(() => JSON.parse(localStorage.getItem('robotshub_project') ?? '{}').objectParams?.['operation:waterCleanup:offSeasonAvailabilityByMonth']?.includes('"2":40')),
      true,
      'Изменённая ставка февраля должна сохраниться в настройках объекта',
    );
    await clickButtonTestId('operation-open-report');
    await chromium.page.waitFor(() => Boolean(document.querySelector('[data-testid="operation-seasonality-report"]')));

    stage = 'экспорт и сверка короткого сезонного периода';
    const shortPeriodRows = await exportRows();
    assert.equal(csvRowValue(shortPeriodRows, 'Объект'), waterSiteName, 'Кавычки и переносы строк в названии объекта должны сохраниться в одной ячейке');
    assert.equal(csvRowValue(shortPeriodRows, 'Период наблюдений с'), '2026-01-01');
    assert.equal(csvRowValue(shortPeriodRows, 'Период наблюдений по'), '2026-01-07');
    assert.equal(csvRowValue(shortPeriodRows, 'Метод годовой экстраполяции'), 'Принятый объём 100 / 7 календарных дней × 365.');
    assert.equal(csvRowValue(shortPeriodRows, 'Принятый объём за период'), '100');
    assert.equal(csvRowValue(shortPeriodRows, 'Отменённый объём за период'), '4');
    assert.equal(csvRowValue(shortPeriodRows, 'Объём повторной работы за период'), '3');
    assert.equal(csvRowValue(shortPeriodRows, 'Простой, часов'), '12');
    assert.equal(csvRowValue(shortPeriodRows, 'Месяцы обычной работы'), 'Январь, Июль');
    assert.equal(csvRowValue(shortPeriodRows, 'Доступность работ — Январь (обычная работа), % от обычной выработки'), '100');
    assert.equal(csvRowValue(shortPeriodRows, 'Доступность работ — Февраль (вне сезона), % от обычной выработки'), '40');
    assert.equal(csvRowValue(shortPeriodRows, 'Доступность работ — Март (вне сезона), % от обычной выработки'), '25');
    assert.equal(csvRowValue(shortPeriodRows, 'Основание доступности работ — Февраль: источник'), februarySource);
    assert.equal(csvRowValue(shortPeriodRows, 'Основание доступности работ — Февраль: пояснение'), februaryExplanation);
    assert.equal(
      csvRowValue(shortPeriodRows, 'Основание доступности работ — Март: источник'),
      marchSource,
    );
    assert.equal(csvRowValue(shortPeriodRows, 'Основание доступности работ — Март: пояснение'), 'не указано');
    assert.equal(csvRowValue(shortPeriodRows, 'Основание доступности работ — Апрель: источник'), aprilSource);
    assert.equal(csvRowValue(shortPeriodRows, 'Основание доступности работ — Май: источник'), maySource);
    assert.equal(
      shortPeriodRows.filter(([label]) => label.startsWith('Доступность работ — ')).length,
      12,
      'CSV должен перечислять доступность для каждого месяца',
    );
    assert.equal(
      shortPeriodRows.filter(([label]) => label.startsWith('Основание доступности работ — ') && label.endsWith(': источник')).length,
      10,
      'CSV должен отдельно указывать источник для каждого месяца вне сезона',
    );
    assert.equal(
      shortPeriodRows.filter(([label]) => label.startsWith('Основание доступности работ — ') && label.endsWith(': пояснение')).length,
      10,
      'CSV должен отдельно указывать пояснение для каждого месяца вне сезона',
    );
    assert.equal(csvRowValue(shortPeriodRows, 'Сезонно доступные дни периода наблюдений'), '7');
    assert.equal(csvRowValue(shortPeriodRows, 'Сезонно доступные дни в расчётном году'), '141.95');
    assert.equal(csvRowValue(shortPeriodRows, 'Покрыт полный сезонный цикл'), 'нет: результат сценарный');
    assert.equal(csvRowValue(shortPeriodRows, 'Статус базовой линейной оценки'), linearStatus);
    assert.equal(csvRowValue(shortPeriodRows, 'Статус сезонного сценария'), seasonalStatus);
    assert.equal(csvRowValue(shortPeriodRows, 'Статус годовой экстраполяции'), linearStatus);
    assert.equal(
      reportPrecision(numberFromText(await chromium.page.evaluate(() => document.querySelector('[data-testid="operation-report-linear-capacity-value"]')?.textContent ?? ''))),
      reportPrecision(Number(csvRowValue(shortPeriodRows, 'Базовая линейная годовая мощность по журналу'))),
      'Линейная мощность в CSV должна совпадать с округлением отчёта',
    );
    assert.equal(
      reportPrecision(numberFromText(await chromium.page.evaluate(() => document.querySelector('[data-testid="operation-report-seasonal-capacity-value"]')?.textContent ?? ''))),
      reportPrecision(Number(csvRowValue(shortPeriodRows, 'Сезонно скорректированная годовая мощность, сценарий'))),
      'Сезонная мощность в CSV должна совпадать с округлением отчёта',
    );

    const expectedWaterJournalRows = waterJournal.map((entry, index) => [
      `Журнал ${index + 1}: ${{ accepted: 'Принятая операция', cancelled: 'Отмена', rework: 'Повторная работа', downtime: 'Простой' }[entry.kind]}`,
      `Дата: ${entry.date}; объём: ${entry.volume ?? '—'} ${waterProfile.unit}; простой: ${entry.downtimeHours ?? '—'} ч; причина: ${entry.reason || '—'}`,
    ]);
    const actualWaterJournalRows = shortPeriodRows.filter(([label]) => label.startsWith('Журнал '));
    assert.equal(actualWaterJournalRows.length, waterJournal.length, 'CSV должен содержать отдельную строку для каждой записи журнала');
    assert.ok(actualWaterJournalRows.every(row => row.length === 2), 'переносы строк не должны разбивать записи на дополнительные CSV-строки');
    assert.deepEqual(actualWaterJournalRows, expectedWaterJournalRows, 'даты, типы, объёмы, часы и причины должны совпадать с исходным журналом');

    stage = 'загрузка полного годового цикла';
    const quarryProfile = operationProfiles.quarrySurvey;
    const quarryJournal = Array.from({ length: 12 }, (_, index) => ({
      date: `2026-${String(index + 1).padStart(2, '0')}-15`,
      kind: 'accepted',
      volume: 2,
      downtimeHours: null,
      reason: '',
    }));
    const quarryState = makeState({
      profile: quarryProfile,
      solutionId: '33fca97e-ef4f-459d-a773-ab58b7f84fd5',
      journal: quarryJournal,
      observedFrom: '2026-01-01',
      observedTo: '2026-12-31',
      scheduledHours: 8760,
      operatingMonths: [4, 5, 6, 7, 8, 9],
      offSeasonAvailabilityPercent: 25,
      siteName: 'Карьер',
      task: 'Фотограмметрическая съёмка',
    });
    await loadStateAtCalc(quarryState);
    await clickButtonTestId('operation-open-report');
    await chromium.page.waitFor(() => Boolean(
      document.querySelector('[data-testid="operation-report-seasonal-status"]')?.textContent?.trim(),
    ));
    assert.equal(await chromium.page.evaluate(() => document.querySelector('[data-testid="operation-seasonality-report"]')?.dataset.operationProfile), 'quarrySurvey');
    const fullCycleSeasonalStatus = await reportStatusValue('operation-report-seasonal-status');
    assert.match(fullCycleSeasonalStatus, /включают не менее 365 дней и все 12 месяцев/);
    assert.doesNotMatch(fullCycleSeasonalStatus, /сценарный: наблюдения не покрывают/);
    stage = 'экспорт полного годового цикла';
    const fullYearRows = await exportRows();
    assert.equal(csvRowValue(fullYearRows, 'Покрыт полный сезонный цикл'), 'да: не менее 365 дней и 12 месяцев');
    assert.equal(csvRowValue(fullYearRows, 'Статус сезонного сценария'), fullCycleSeasonalStatus);
  } catch (error) {
    throw new Error(`Ошибка на этапе «${stage}»: ${error?.message ?? error}`, { cause: error });
  } finally {
    chromium?.page.close();
    await stopChild(chromium?.browser, true);
    if (chromium?.userDataDir) {
      await rm(chromium.userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
    await stopChild(server);
    if (downloadDir) {
      await rm(downloadDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  }
});