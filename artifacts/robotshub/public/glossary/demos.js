import { findGridPath, castRay, financeExample, balanceAt, lidarDistanceColor } from './demo-models.mjs?v=distance-colors';

const $ = id => document.getElementById(id);
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const number = (value, digits = 1) => value.toLocaleString('ru-RU', { maximumFractionDigits: digits });
const point = ([x, y]) => [x * 40 + 20, y * 40 + 20];
const key = cell => cell.join(',');
const tasks = [];
function animate(element, tick) {
  const task = { element, tick, visible: true };
  tasks.push(task);
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(entries => { task.visible = entries[0].isIntersecting; }, { threshold: 0.05 }).observe(element);
  }
}
let previous = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - previous) / 1000);
  previous = now;
  if (!document.hidden) for (const task of tasks) if (task.visible) task.tick(dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// 1. Same task, same obstacle, two explicitly different routing policies.
function initComparison() {
  const host = $('demoCompare');
  if (!host) return;
  const shelves = [[3, 1], [4, 1], [7, 1], [8, 1], [3, 5], [4, 5], [7, 5], [8, 5]];
  const start = [1, 3], goal = [10, 3];
  const fixed = Array.from({ length: 10 }, (_, i) => [i + 1, 3]);
  let obstacle = true, sealed = false, playing = !reduced, ended = false;
  let agents = [], walls;
  function scene(path, mode) {
    const points = (path ?? []).map(cell => point(cell).join(',')).join(' ');
    return `<svg viewBox="0 0 480 280" role="img" aria-label="${mode}: приёмка А слева, буфер Б справа">
      <defs><pattern id="grid-${mode}" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="#172b3c"/></pattern></defs>
      <rect width="480" height="280" fill="url(#grid-${mode})"/>
      ${shelves.map(([x, y]) => `<rect x="${x * 40 + 3}" y="${y * 40 + 3}" width="34" height="34" rx="4" fill="#3d5368"/>`).join('')}
      <polyline points="${fixed.map(cell => point(cell).join(',')).join(' ')}" fill="none" stroke="#57738c" stroke-width="3" stroke-dasharray="6 5"/>
      ${mode === 'AMR' ? `<polyline points="${points}" fill="none" stroke="#22d3ee" stroke-width="3"/>` : ''}
      ${sealed ? '<rect x="246" y="2" width="28" height="276" rx="3" fill="#b45309" opacity=".8"/>' : obstacle ? '<rect x="246" y="126" width="28" height="28" rx="4" fill="#f59e0b"/><path d="M250 130L270 150M270 130L250 150" stroke="#422006" stroke-width="2"/>' : ''}
      <circle cx="60" cy="140" r="13" fill="#11684d"/><text x="60" y="145" text-anchor="middle" fill="white" font-size="14">А</text>
      <circle cx="420" cy="140" r="13" fill="#71601b"/><text x="420" y="145" text-anchor="middle" fill="white" font-size="14">Б</text>
      <text x="60" y="180" text-anchor="middle" fill="#acc5d6" font-size="13">Приёмка</text>
      <text x="420" y="180" text-anchor="middle" fill="#acc5d6" font-size="13">Буфер</text>
      <g class="demo-vehicle"><rect x="-12" y="-10" width="24" height="20" rx="5" fill="${mode === 'AMR' ? '#22d3ee' : '#a78bfa'}"/><rect x="-5" y="-6" width="10" height="12" rx="1" fill="#e2e8f0"/><circle cx="9" cy="0" r="2" fill="#0c1e30"/></g>
    </svg>`;
  }
  function reset(run = playing) {
    playing = run;
    ended = false;
    walls = new Set(shelves.map(key));
    if (sealed) for (let y = 0; y < 7; y++) walls.add(`6,${y}`);
    else if (obstacle) walls.add('6,3');
    agents = [
      { mode: 'AGV', path: fixed, index: 0, elapsed: 0, state: 'moving' },
      { mode: 'AMR', path: findGridPath(12, 7, walls, start, goal).path, index: 0, elapsed: 0, state: 'moving' },
    ];
    host.innerHTML = agents.map(agent => `<div class="demo-panel" data-agent="${agent.mode}">
      <h4>${agent.mode}<small>${agent.mode === 'AGV' ? 'Заданная трасса' : 'Поиск свободного маршрута'}</small></h4>
      ${scene(agent.path, agent.mode)}<p class="agent-status"></p></div>`).join('');
    for (const agent of agents) {
      agent.panel = host.querySelector(`[data-agent="${agent.mode}"]`);
      if (!agent.path) agent.state = 'no-path';
      render(agent);
    }
    controls();
  }
  function controls() {
    $('comparePlay').textContent = ended ? 'Повторить сравнение' : playing ? 'Пауза' : 'Пуск';
    $('compareObstacle').textContent = obstacle ? 'Убрать паллету с пути' : 'Поставить паллету на путь';
    $('compareObstacle').setAttribute('aria-pressed', String(obstacle));
    $('compareSeal').textContent = sealed ? 'Открыть обходы' : 'Перекрыть все проходы';
    $('compareSeal').setAttribute('aria-pressed', String(sealed));
    $('compareStatus').textContent = sealed
      ? 'Все проходы перекрыты: нового маршрута нет. AMR не может объехать через стеллаж или запретную зону.'
      : obstacle
        ? 'Паллета стоит на заданной трассе. AGV доедет до неё и остановится; AMR использует свободный соседний проезд.'
        : 'Препятствия убраны: обе машины могут выполнить одно и то же перемещение по прямому пути.';
  }
  function render(agent) {
    const path = agent.path ?? [start];
    const current = path[agent.index];
    const next = path[agent.index + 1];
    const ratio = agent.state === 'moving' && next && !walls.has(key(next)) ? agent.elapsed / 0.35 : 0;
    const a = point(current), b = next ? point(next) : a;
    const x = a[0] + (b[0] - a[0]) * ratio, y = a[1] + (b[1] - a[1]) * ratio;
    agent.panel.querySelector('.demo-vehicle').setAttribute('transform', `translate(${x} ${y})`);
    agent.panel.dataset.position = `${x.toFixed(1)},${y.toFixed(1)}`;
    agent.panel.dataset.state = agent.state;
    const status = agent.panel.querySelector('.agent-status');
    status.className = `agent-status ${agent.state === 'delivered' ? 'delivered' : agent.state !== 'moving' ? 'waiting' : ''}`;
    const text = agent.state === 'delivered' ? 'Паллета доставлена в буфер Б.'
      : agent.state === 'blocked' ? 'Остановка перед препятствием. Продолжение — после освобождения заданной трассы.'
        : agent.state === 'no-path' ? 'Свободного маршрута нет. Нужен доступный проезд.'
          : !playing ? 'Пауза. Нажмите «Пуск», чтобы увидеть перемещение.'
            : agent.mode === 'AMR' && obstacle ? 'Движется по рассчитанному объезду.' : 'Движется по заданному маршруту.';
    if (status.textContent !== text) status.textContent = text;
  }
  $('comparePlay').addEventListener('click', () => {
    if (ended) reset(true);
    else { playing = !playing; controls(); agents.forEach(render); }
  });
  $('compareReset').addEventListener('click', () => reset(true));
  $('compareObstacle').addEventListener('click', () => { obstacle = !obstacle; sealed = false; reset(true); });
  $('compareSeal').addEventListener('click', () => { sealed = !sealed; reset(true); });
  reset();
  animate(host, dt => {
    if (!playing) return;
    for (const agent of agents) {
      if (agent.state !== 'moving') continue;
      agent.elapsed += dt;
      while (agent.elapsed >= 0.35 && agent.state === 'moving') {
        agent.elapsed -= 0.35;
        const next = agent.path?.[agent.index + 1];
        if (!next) agent.state = 'delivered';
        else if (walls.has(key(next))) { agent.state = 'blocked'; agent.elapsed = 0; }
        else {
          agent.index++;
          if (agent.index === agent.path.length - 1) agent.state = 'delivered';
        }
      }
      render(agent);
    }
    if (agents.every(agent => agent.state !== 'moving')) { ended = true; playing = false; controls(); }
  });
}

// 2. Ray / nearest surface / point cloud, with no fabricated sensor performance.
function initLidar() {
  const host = $('demoLidar');
  if (!host) return;
  const rects = [[160, 50, 70, 70], [280, 150, 100, 60]];
  const segments = [[10, 10, 470, 10], [470, 10, 470, 270], [470, 270, 10, 270], [10, 270, 10, 10]];
  for (const [x, y, w, h] of rects) segments.push([x, y, x + w, y], [x + w, y, x + w, y + h], [x + w, y + h, x, y + h], [x, y + h, x, y]);
  let originIndex = 0, samples = [], playing = !reduced, elapsed = 0;
  const origins = [[80, 140], [420, 80]];
  function render() {
    const origin = origins[originIndex], last = samples.at(-1);
    const marker = `<circle cx="${origin[0]}" cy="${origin[1]}" r="8" fill="#34d399"/><text x="${origin[0] + 13}" y="${origin[1] - 12}" fill="#b9e7d8" font-size="14">Датчик ${originIndex ? 'Б' : 'А'}</text>`;
    const cloud = samples.map(hit => `<circle cx="${hit.x}" cy="${hit.y}" r="2.5" fill="${lidarDistanceColor(hit.distance)}" data-distance="${hit.distance}"/>`).join('');
    host.innerHTML = `<div class="demo-panel"><h4>Что находится в помещении<small>Луч останавливается на первой поверхности</small></h4>
      <svg viewBox="0 0 480 280" role="img" aria-label="Помещение с двумя стеллажами и сканирующим лучом">
        <rect x="10" y="10" width="460" height="260" rx="3" fill="none" stroke="#698399" stroke-width="3"/>
        ${rects.map(([x, y, w, h]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="#40566d"/><text x="${x + w / 2}" y="${y + h / 2 + 4}" text-anchor="middle" fill="#cfdfeb" font-size="12">Стеллаж</text>`).join('')}
        ${last ? `<line x1="${origin[0]}" y1="${origin[1]}" x2="${last.x}" y2="${last.y}" stroke="${lidarDistanceColor(last.distance)}" stroke-width="2.5"/>` : ''}
        ${cloud}${marker}</svg></div>
      <div class="demo-panel"><h4>Что измерил датчик<small>Точки отражений, а не готовое знание о комнате</small></h4>
      <svg viewBox="0 0 480 280" role="img" aria-label="Облако точек текущего сканирования">${cloud}${marker}</svg></div>
      <div class="demo-distance-legend" aria-label="Расстояние по цвету: близко — красный, далеко — синий">
        <span>Близко · 0</span><i aria-hidden="true"></i><span>Далеко · 100+</span>
        <small>Цвет показывает расстояние до датчика в единицах схемы, не в метрах.</small>
      </div>`;
    host.dataset.samples = String(samples.length);
    host.dataset.origin = originIndex ? 'Б' : 'А';
    $('lidarPlay').textContent = samples.length >= 180 ? 'Сканировать заново' : playing ? 'Пауза' : 'Сканировать';
    $('lidarMove').textContent = `Перенести датчик в точку ${originIndex ? 'А' : 'Б'}`;
    const status = samples.length === 180 ? 'Оборот завершён: 180 учебных измерений. Перенесите датчик, чтобы увидеть поверхности из другой точки.'
      : `Измерений: ${samples.length} из 180. ${last ? `Угол: ${last.angle}°. Последнее расстояние: ${number(last.distance)} ед. схемы.` : 'Измерения очищены.'} ${!playing ? 'Нажмите «Сканировать» или «Шаг на 30°».' : 'Идёт сканирование.'}`;
    $('lidarStatus').textContent = status;
  }
  function scan(count) {
    while (count-- > 0 && samples.length < 180) {
      const angle = (samples.length + 1) * 2;
      const hit = castRay(origins[originIndex], angle * Math.PI / 180, segments);
      if (!hit) throw new Error('Учебный луч не встретил замкнутую границу помещения.');
      samples.push({ ...hit, angle });
    }
    if (samples.length >= 180) playing = false;
    render();
  }
  $('lidarPlay').addEventListener('click', () => {
    if (samples.length >= 180) samples = [];
    playing = !playing;
    render();
  });
  $('lidarStep').addEventListener('click', () => { playing = false; if (samples.length >= 180) samples = []; scan(15); });
  $('lidarReset').addEventListener('click', () => { samples = []; playing = false; render(); });
  $('lidarMove').addEventListener('click', () => { originIndex = 1 - originIndex; samples = []; playing = !reduced; scan(15); });
  scan(15);
  animate(host, dt => {
    if (!playing) return;
    elapsed += dt * 45;
    if (elapsed >= 1) { const count = Math.floor(elapsed); elapsed -= count; scan(count); }
  });
}

// 3. Editable, keyboard-accessible grid. Search order is the actual A* trace.
function initRoutes() {
  const host = $('demoRoute');
  if (!host) return;
  const cols = 12, rows = 7, start = [1, 3], goal = [10, 3];
  const cells = Array.from({ length: cols * rows }, (_, index) => [index % cols, Math.floor(index / cols)]);
  let walls, result, revealed = 0, playing = false, elapsed = 0;
  host.innerHTML = cells.map(([x, y], index) => `<button type="button" class="demo-cell" data-index="${index}" data-cell="${x},${y}" aria-label="Строка ${y + 1}, колонка ${x + 1}"></button>`).join('');
  const buttons = [...host.children];
  function render() {
    const complete = revealed >= result.visited.length;
    const visited = new Set(result.visited.slice(0, revealed).map(key));
    const route = new Set(complete ? (result.path ?? []).map(key) : []);
    cells.forEach((cell, index) => {
      const id = key(cell), button = buttons[index];
      const endpoint = id === key(start) ? 'start' : id === key(goal) ? 'goal' : '';
      const wall = walls.has(id);
      button.dataset.wall = String(wall);
      button.dataset.visited = String(!wall && visited.has(id));
      button.dataset.path = String(route.has(id));
      button.dataset.endpoint = endpoint;
      button.dataset.current = String(!complete && key(result.visited[revealed - 1] ?? [-1, -1]) === id);
      button.textContent = endpoint === 'start' ? 'А' : endpoint === 'goal' ? 'Б' : '';
      button.setAttribute('aria-pressed', String(wall));
      button.setAttribute('aria-label', `${endpoint === 'start' ? 'А: приёмка' : endpoint === 'goal' ? 'Б: буфер' : `Строка ${cell[1] + 1}, колонка ${cell[0] + 1}`}. ${wall ? 'Препятствие, нажмите для удаления' : route.has(id) ? 'Маршрут' : visited.has(id) ? 'Клетка проверена' : 'Свободная клетка'}`);
    });
    host.dataset.steps = String(result.steps);
    host.dataset.visited = String(revealed);
    host.dataset.found = String(Boolean(result.path));
    $('routeAnimate').textContent = playing ? 'Пауза поиска' : complete ? 'Показать поиск' : 'Продолжить поиск';
    $('routeStatus').textContent = !complete
      ? `Поиск по шагам: проверено ${revealed} из ${result.visited.length} клеток. Подсвеченная точка — текущее рассмотрение.`
      : result.path
        ? `Путь найден: ${result.steps} шагов между А и Б. Алгоритм проверил ${result.visited.length} клеток. Добавьте препятствие на голубой путь — результат изменится.`
        : `Пути нет: алгоритм проверил ${result.visited.length} доступных клеток. Откройте проход; робот не должен пересекать стену.`;
  }
  function solve() { playing = false; result = findGridPath(cols, rows, walls, start, goal); revealed = result.visited.length; render(); }
  function example() { walls = new Set(['3,1', '4,1', '7,1', '8,1', '3,5', '4,5', '7,5', '8,5', '6,3']); solve(); }
  host.addEventListener('click', event => {
    const button = event.target.closest('[data-cell]');
    if (!button) return;
    const id = button.dataset.cell;
    if (id === key(start) || id === key(goal)) return;
    if (walls.has(id)) walls.delete(id); else walls.add(id);
    solve();
  });
  host.addEventListener('keydown', event => {
    const offset = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols }[event.key];
    if (!offset) return;
    const index = Number(event.target.dataset.index), next = index + offset;
    if (next >= 0 && next < buttons.length) { event.preventDefault(); buttons[next].focus(); }
  });
  $('routeExample').addEventListener('click', example);
  $('routeClear').addEventListener('click', () => { walls.clear(); solve(); });
  $('routeSeal').addEventListener('click', () => { for (let y = 0; y < rows; y++) walls.add(`6,${y}`); solve(); });
  $('routeAnimate').addEventListener('click', () => { if (revealed >= result.visited.length) revealed = 0; playing = !playing; render(); });
  $('routeStep').addEventListener('click', () => { playing = false; if (revealed >= result.visited.length) revealed = 0; revealed++; render(); });
  example();
  animate(host, dt => {
    if (!playing) return;
    elapsed += dt;
    if (elapsed >= 0.08) {
      elapsed = 0;
      revealed++;
      if (revealed >= result.visited.length) playing = false;
      render();
    }
  });
}

// 4. Transparent cash-flow arithmetic. No industry-average or vendor-rate claims.
function initFinance() {
  const host = $('demoFinance');
  if (!host) return;
  const inputs = { cost: 'financeCost', saving: 'financeSaving', advancePercent: 'financeAdvance', term: 'financeTerm', markupPercent: 'financeMarkup' };
  const money = value => `${number(Math.abs(value) < 1e-9 ? 0 : value, 2)} млн ₽`;
  const payback = value => value === null ? 'Не окупается'
    : value > 60 ? `Более 60 мес. (${number(value)} по модели)` : `${number(value)} мес.`;
  function update() {
    const values = Object.fromEntries(Object.entries(inputs).map(([key, id]) => {
      const value = Number($(id).value);
      $(`${id}Value`).textContent = number(value, 2);
      return [key, value];
    }));
    const model = financeExample(values), month = Number($('financeMonth').value), balance = balanceAt(model, month);
    host.dataset.purchasePayback = String(model.purchasePayback);
    host.dataset.leasePayback = String(model.leasePayback);
    host.dataset.payment = String(model.payment);
    host.innerHTML = `<div class="demo-finance-cards">
      <div class="demo-finance-card"><h4>Покупка · выход накопленного потока в плюс</h4><strong>${payback(model.purchasePayback)}</strong><p>В начале: ${money(model.cost)}. Дальше — эффект ${money(model.saving)} в месяц.</p></div>
      <div class="demo-finance-card"><h4>Лизинг · выход накопленного потока в плюс</h4><strong>${payback(model.leasePayback)}</strong><p>Аванс: ${money(model.advance)}. Платёж: ${money(model.payment)} / мес. в течение ${model.term} мес.<br>Всего по договору: ${money(model.totalLeaseCost)}.</p></div></div>
      <p class="demo-finance-note">Срок — момент устойчивого выхода накопленного денежного результата в ноль. Ранний выход лизингового потока в плюс не означает, что проект дешевле: будущие платежи остаются обязательством. Сравните полную сумму договора. Лизинг не создаёт дополнительной производительности.</p>`;
    $('financeMonthValue').textContent = String(month);
    $('financeBalance').innerHTML = [['Покупка', balance.purchase], ['Лизинг', balance.lease]].map(([name, value]) => `<div class="demo-finance-card" data-negative="${value < -1e-9}"><h4>${name} · итог к месяцу ${month}</h4><strong>${money(value)}</strong><p>Эффект за ${month} мес.: ${money(model.saving * month)}. ${value < -1e-9 ? 'Затраты ещё не покрыты.' : 'Накопленный результат неотрицательный.'}</p></div>`).join('');
  }
  for (const id of [...Object.values(inputs), 'financeMonth']) $(id).addEventListener('input', update);
  update();
}

for (const init of [initComparison, initLidar, initRoutes, initFinance]) init();

// A direct demo link must be positioned after the interactive layouts exist.
const initialTarget = document.getElementById(location.hash.slice(1));
if (initialTarget?.classList.contains('widget')) {
  document.fonts.ready.then(() => requestAnimationFrame(() => {
    if (location.hash.slice(1) === initialTarget.id) initialTarget.scrollIntoView({ behavior: 'instant', block: 'start' });
  }));
}
