import './_group.css';
import './Operations.css';
import { useState } from 'react';
import {
  IconCalculator,
  IconChartRoi,
  IconClockPayback,
  IconWarehouse,
  IconRobotAmr,
  IconOperations,
  IconSourceDoc,
  IconInfoAssumption,
} from './brand-icons';

const PARTNERS = [
  'Алабуга', 'Билайн', 'ВК тех', 'ГКМ', 'ГОЧС', 'ГПБ', 'Геоскан',
  'ДЖКХ', 'ДИТ', 'ДПИиР', 'ДФ', 'КМ Стройнадзор', 'КМ Экология',
  'ММ', 'МТ', 'ПТ', 'РСХБ', 'Ростелеком', 'ФЦ БАС', 'Фалькон', 'ЦДиТМ', 'ЯК',
];
const INDUSTRIES = [
  'Торговля и услуги', 'Промышленность', 'Транспорт и логистика', 'ТЭК',
  'Сельское хозяйство', 'Безопасность', 'Строительство', 'ЖКХ', 'Лесное хозяйство',
];
const TRACKS = [
  {
    n: '01', title: 'Сформулировать задачу', who: 'Для владельца и руководителя операций',
    text: 'Опишите объект и поток работ. Получите маршрут к решениям без преждевременного обещания окупаемости.',
    href: '/start', icon: IconClockPayback, tag: 'ОБЪЕКТ → ОЦЕНКА',
  },
  {
    n: '02', title: 'Проверить экономику', who: 'Для экономики, снабжения и ПТО',
    text: 'Сопоставьте варианты финансирования и проследите, какие допущения двигают результат.',
    href: '/calc', icon: IconCalculator, tag: 'МОДЕЛЬ → ДОПУЩЕНИЯ',
  },
  {
    n: '03', title: 'Сверить технику', who: 'Для инженера и технолога',
    text: 'Изучите реальные решения, технические данные, статусы и подтверждённые сценарии применения.',
    href: '/solutions', icon: IconChartRoi, tag: 'ТТХ → ПРИМЕНЕНИЕ',
  },
];

function Mark({ n }: { n: string }) {
  return <span className="ops-mark" aria-hidden="true">{n}</span>;
}

function WarehouseDrawing() {
  return (
    <div className="ops-diagram" aria-label="Схема потока на модельном складе" role="img">
      <div className="ops-diagram-top">
        <span className="ops-mono">СХЕМА ПОТОКА / ОБЪЕКТ 05.2</span>
        <span className="ops-state"><i /> МОДЕЛЬ</span>
      </div>
      <svg className="ops-blueprint" viewBox="0 0 650 360" fill="none" aria-hidden="true">
        <defs>
          <pattern id="opsGrid" width="26" height="26" patternUnits="userSpaceOnUse">
            <path d="M26 0H0V26" stroke="#31403d" strokeWidth="1" />
          </pattern>
          <marker id="opsArrow" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
            <path d="M0 0L8 4L0 8" fill="none" stroke="#e4ad43" strokeWidth="1.4" />
          </marker>
        </defs>
        <rect width="650" height="360" fill="url(#opsGrid)" opacity=".6" />
        <path d="M56 62H592V292H56z" stroke="#758078" strokeWidth="1.5" />
        <path d="M180 63V290M302 63V290M424 63V290" stroke="#65716a" strokeDasharray="4 5" />
        <path d="M57 121H591M57 178H591M57 235H591" stroke="#495650" strokeDasharray="3 6" />
        <path d="M74 78h82v30H74zM196 78h82v30h-82zM318 78h82v30h-82zM440 78h82v30h-82z" fill="#293732" stroke="#7d8981" />
        <path d="M74 249h82v30H74zM196 249h82v30h-82zM318 249h82v30h-82zM440 249h82v30h-82z" fill="#293732" stroke="#7d8981" />
        <path d="M88 193H554V147H132V221H510V132" stroke="#e4ad43" strokeWidth="2" strokeDasharray="6 6" markerEnd="url(#opsArrow)" />
        <circle cx="132" cy="193" r="6" fill="#e4ad43" />
        <circle cx="554" cy="193" r="6" fill="#e4ad43" />
        <g transform="translate(280 179)">
          <rect x="0" y="0" width="37" height="28" rx="5" fill="#d9e4dc" />
          <rect x="5" y="5" width="27" height="18" rx="3" fill="#31443e" />
          <circle cx="8" cy="30" r="3" fill="#d9e4dc" /><circle cx="29" cy="30" r="3" fill="#d9e4dc" />
          <path d="M18 7v14M11 14h14" stroke="#e4ad43" strokeWidth="1.5" />
        </g>
        <text x="64" y="48" fill="#9aa69d" fontSize="10" fontFamily="monospace">ПРИЁМКА</text>
        <text x="512" y="48" fill="#9aa69d" fontSize="10" fontFamily="monospace">ОТГРУЗКА</text>
        <text x="78" y="324" fill="#758078" fontSize="9" fontFamily="monospace">А — ЗОНА ХРАНЕНИЯ</text>
        <text x="422" y="324" fill="#758078" fontSize="9" fontFamily="monospace">МАРШРУТ AMR / СХЕМА УСЛОВНАЯ</text>
        <path d="M78 336h138" stroke="#607067" />
      </svg>
      <div className="ops-diagram-foot">
        <span><b>01</b> входные условия</span>
        <span><b>02</b> парк и поток</span>
        <span><b>03</b> экономика</span>
      </div>
    </div>
  );
}

function PartnerStrip() {
  const [paused, setPaused] = useState(false);
  const group = (copy: boolean) => (
    <div className="ops-partner-group" aria-hidden={copy || undefined}>
      {PARTNERS.map((name, index) => (
        <div className="ops-partner-logo" key={`${copy ? 'copy-' : ''}${name}`} title={copy ? undefined : name}>
          <img src={`/__mockup/images/robotshub-partners/${String(index + 1).padStart(2, '0')}.webp`} alt={copy ? '' : name} />
        </div>
      ))}
    </div>
  );
  return (
    <section className="ops-partners" aria-label="Логотипы организаций из исходной подборки">
      <div className="ops-partners-head">
        <div><span className="ops-kicker">КОНТЕКСТ ИСТОЧНИКОВ</span><p>Организации, упомянутые в открытых материалах</p></div>
        <button className="ops-pause" type="button" aria-pressed={paused}
          aria-label={paused ? 'Продолжить движение логотипов' : 'Приостановить движение логотипов'}
          onClick={() => setPaused(value => !value)} data-testid="button-pause-partners">
          <span aria-hidden="true">{paused ? '▶' : 'Ⅱ'}</span>{paused ? 'Продолжить' : 'Пауза'}
        </button>
      </div>
      <div className={`ops-partners-window${paused ? ' is-paused' : ''}`}>
        <div className="ops-partners-track">{group(false)}{group(true)}</div>
      </div>
    </section>
  );
}

export function Operations() {
  return (
    <div className="ops-home" data-testid="page-home-operations">
      <header className="ops-header">
        <a href="/" className="ops-logo" aria-label="RobotsHub — на главную">
          <img src="/__mockup/images/robotshub-logo.jpg" alt="RobotsHub" />
        </a>
        <nav className="ops-nav" aria-label="Основная навигация">
          <a href="/solutions">Решения</a><a href="/map">Карта отраслей</a><a href="/calc">Экономика</a>
        </nav>
        <a className="ops-header-cta" href="/start">Начать оценку <span aria-hidden="true">↗</span></a>
      </header>
      <main>
        <section className="ops-hero">
          <div className="ops-hero-copy">
            <div className="ops-eyebrow"><span className="ops-led" /> ИНЖЕНЕРНОЕ РЕШЕНИЕ ДЛЯ ПРИНЯТИЯ РЕШЕНИЙ <span className="ops-divider">/</span> РФ</div>
            <h1>Сначала<br /><em>расчёт.</em><br />Потом робот.</h1>
            <p className="ops-hero-lede">RobotsHub помогает оценить применимость роботизации на вашем объекте — от сценария и парка до экономики и источников данных.</p>
            <div className="ops-hero-actions">
              <a href="/start" className="ops-button-primary">Оценить задачу <span aria-hidden="true">↗</span></a>
              <a href="/solutions" className="ops-button-quiet">Открыть каталог <span aria-hidden="true">→</span></a>
            </div>
            <div className="ops-hero-note"><IconInfoAssumption size={16} /><span>Предварительная оценка — не техническое задание и не коммерческое предложение.</span></div>
          </div>
          <div className="ops-hero-art">
            <div className="ops-art-index"><span>PLATFORM / FIELD NOTE 01</span><span>PROCESS / RU</span></div>
            <WarehouseDrawing />
            <div className="ops-art-caption"><span>СИСТЕМНАЯ ЛОГИКА</span><span>Сначала условия — затем выводы.</span></div>
          </div>
          <div className="ops-edge-label" aria-hidden="true">ROBOTS / ECONOMICS / OPERATIONS</div>
        </section>

        <section className="ops-data-rail" aria-label="Состав базы RobotsHub">
          <div className="ops-data-intro"><span className="ops-kicker">РАБОЧАЯ БАЗА</span><p>Не витрина оборудования.<br />Рабочая карта выбора.</p></div>
          <div className="ops-data-item"><strong>223</strong><span>записи каталога</span></div>
          <div className="ops-data-item"><strong>9</strong><span>базовых отраслей</span></div>
          <div className="ops-data-item"><strong>24</strong><span>региона на карте</span></div>
          <div className="ops-data-foot">Записи включают эксплуатацию, пилоты и разработки по открытым источникам. Отраслевые тематические срезы пересекаются.</div>
        </section>

        <section className="ops-method">
          <div className="ops-section-heading">
            <div><span className="ops-kicker">ПРОВЕРЯЙТЕ ЦЕПОЧКУ</span><h2>От задачи<br />к обоснованному выбору.</h2></div>
            <p>Никакой универсальной цифры для незнакомой площадки. Путь начинается с условий вашего процесса и сохраняет видимыми границы модели.</p>
          </div>
          <div className="ops-track-list" aria-label="Выберите рабочий маршрут">
            {TRACKS.map(({ n, title, who, text, href, icon: Icon, tag }) => (
              <a className="ops-track" href={href} key={n}>
                <Mark n={n} /><div className="ops-track-icon"><Icon size={23} /></div>
                <div className="ops-track-main"><span className="ops-track-who">{who}</span><h3>{title}</h3><p>{text}</p></div>
                <div className="ops-track-end"><span>{tag}</span><b aria-hidden="true">↗</b></div>
              </a>
            ))}
          </div>
        </section>

        <section className="ops-scenario">
          <div className="ops-scenario-aside"><span className="ops-kicker">СЦЕНАРИЙ ДЛЯ ПРОВЕРКИ МОДЕЛИ</span><div className="ops-scenario-stamp"><IconWarehouse size={25} /><span>СКЛАД<br />5 200 м²</span></div><p>Иллюстративная предварительная оценка. Параметры не получены с действующего объекта.</p></div>
          <div className="ops-scenario-main">
            <div className="ops-scenario-title"><h2>Модельный склад</h2><a href="/start?industry=%D0%A2%D1%80%D0%B0%D0%BD%D1%81%D0%BF%D0%BE%D1%80%D1%82%20%D0%B8%20%D0%BB%D0%BE%D0%B3%D0%B8%D1%81%D1%82%D0%B8%D0%BA%D0%B0">Проверить свои параметры <span aria-hidden="true">↗</span></a></div>
            <div className="ops-metrics">
              <div><span>Расчётный парк</span><strong>~1 <small>робот</small></strong></div>
              <div><span>CAPEX модели</span><strong>3 475 000 <small>₽</small></strong></div>
              <div><span>Окупаемость</span><strong>1,5147 <small>года</small></strong></div>
              <div><span>Требуемый поток</span><strong>11,818 <small>палл./ч</small></strong></div>
            </div>
            <div className="ops-assumptions">
              <span className="ops-assumption-icon"><IconSourceDoc size={17} /></span>
              <div><b>Что заложено в модель</b><p>260 паллет в сутки на приёмку и столько же на отгрузку · 2 смены по 11 часов · 3 сотрудника перемещения.</p></div>
              <a href="/calc" aria-label="Открыть расчёт экономики">Изучить расчёт <span aria-hidden="true">→</span></a>
            </div>
            <p className="ops-caveat">Сценарий не является измеренной производительностью, обещанием окупаемости или предложением поставщика. Итог зависит от ТТХ, планировки, стоимости труда и параметров эксплуатации.</p>
          </div>
        </section>

        <section className="ops-industries">
          <div className="ops-industries-title"><span className="ops-kicker">РАЗНЫЕ ПРОЦЕССЫ — РАЗНЫЕ ОГРАНИЧЕНИЯ</span><h2>Роботизация<br />не заканчивается складом.</h2><p>Изучайте карту применений по базовым отраслям. Число записей не означает число внедрений.</p><a href="/map">Перейти к карте отраслей <span aria-hidden="true">↗</span></a></div>
          <div className="ops-industry-grid">
            {INDUSTRIES.map((industry, index) => (
              <a href={`/start?industry=${encodeURIComponent(industry)}`} key={industry} className="ops-industry">
                <span className="ops-industry-index">0{index + 1}</span><span>{industry}</span><b aria-hidden="true">↗</b>
              </a>
            ))}
          </div>
          <div className="ops-industry-foot"><IconOperations size={18} />9 базовых отраслей · тематические срезы пересекаются и не означают новые внедрения</div>
        </section>

        <PartnerStrip />

        <section className="ops-closing">
          <div className="ops-closing-mark"><IconRobotAmr size={28} /></div>
          <div><span className="ops-kicker">ПРИНЯТИЕ РЕШЕНИЯ НАЧИНАЕТСЯ С ВХОДНЫХ ДАННЫХ</span><h2>Поставьте задачу.<br /><em>Проверьте допущения.</em></h2></div>
          <a href="/start" className="ops-button-primary">Начать с объекта <span aria-hidden="true">↗</span></a>
        </section>
      </main>
      <footer className="ops-footer">
        <a href="/" className="ops-footer-logo" aria-label="RobotsHub — на главную"><img src="/__mockup/images/robotshub-logo.jpg" alt="RobotsHub" /></a>
        <span>Решения · экономика · карта применений</span>
        <nav aria-label="Навигация в подвале"><a href="/solutions">Каталог</a><a href="/calc">Экономика</a><a href="/map">Карта</a></nav>
      </footer>
    </div>
  );
}
