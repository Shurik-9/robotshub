import './start-experience.css';
import { useState } from 'react';
import { Link } from 'wouter';
import { ArrowRight, Check, CircleHelp, FileSearch, Route, Warehouse } from 'lucide-react';

const WAREHOUSE_INDUSTRY = 'Транспорт и логистика';

const stages = [
  {
    id: 'acceptance',
    label: 'Приёмка',
    marker: 'A',
    title: 'От ворот до зоны приёмки',
    description: 'Входящая паллета проходит разгрузку, идентификацию и контроль. На этом участке важно определить точку, где начинается именно внутренняя транспортная операция.',
    questions: ['Где груз передаётся внутреннему процессу?', 'Кто подтверждает идентификатор и состояние паллеты?', 'Какие грузы идут по отдельным правилам?'],
  },
  {
    id: 'storage',
    label: 'В путь к хранению',
    marker: 'B',
    title: 'Приёмка → зона хранения',
    description: 'Паллета перемещается из зоны приёмки к месту хранения. Направление движения зависит от адреса, текущей загрузки площадки и правил распределения запаса.',
    questions: ['Как формируется адрес хранения?', 'Где пересекаются потоки людей и техники?', 'Что происходит, если целевая зона занята?'],
  },
  {
    id: 'putaway',
    label: 'Размещение',
    marker: 'C',
    title: 'Постановка в место хранения',
    description: 'После прибытия груза требуется корректно разместить его в стеллаже или выделенной зоне. Подъём и работа с ячейкой — отдельная операция, её нельзя автоматически приписывать любому транспортировщику.',
    questions: ['Кто поднимает груз и размещает его в ячейке?', 'Какая техника и тара уже используются?', 'Как система подтверждает адрес и завершение задания?'],
  },
  {
    id: 'picking',
    label: 'Отбор',
    marker: 'D',
    title: 'Хранение → отбор заказа',
    description: 'По заданию запас подбирают или перемещают к месту комплектации. Сценарий зависит от того, что именно отбирают: паллету, коробку, единицу товара или целую стеллажную секцию.',
    questions: ['Что является единицей отбора?', 'Где начинается и заканчивается задание?', 'Нужна ли проверка количества или качества человеком?'],
  },
  {
    id: 'packing',
    label: 'Упаковка',
    marker: 'E',
    title: 'Комплектация → упаковка',
    description: 'Подобранный заказ проверяют, упаковывают и готовят к дальнейшей передаче. Перемещение между рабочими местами и сама упаковка — разные процессы с разными требованиями.',
    questions: ['Какие действия входят в комплектацию?', 'Как формируются этикетки и документы?', 'Какие операции выполняет человек на посту?'],
  },
  {
    id: 'dispatch',
    label: 'Отгрузка',
    marker: 'F',
    title: 'Подготовленная паллета → зона отгрузки',
    description: 'Готовый груз перемещают к зоне отгрузки и передают следующему процессу. Маршрут, очередь и правила передачи должны быть описаны для конкретного склада.',
    questions: ['Где заканчивается внутренняя транспортная операция?', 'Как назначаются ворота или очередь отгрузки?', 'Какая система подтверждает передачу груза?'],
  },
];

function WarehouseFlow({ activeId }: { activeId: string }) {
  const activeIndex = stages.findIndex(stage => stage.id === activeId);
  const points = stages.map((stage, index) => ({ x: 74 + index * 122, tag: stage.marker, index }));
  return (
    <div className="workflow-diagram">
      <div className="workflow-diagram-head">
        <span>УСЛОВНАЯ СХЕМА ПОТОКА / СКЛАД</span>
        <span className="workflow-state"><i /> НЕ ПЛАН ОБЪЕКТА</span>
      </div>
      <svg viewBox="0 0 760 290" role="img" aria-label="Условная схема складского потока от приёмки через хранение к отгрузке">
        <defs>
          <pattern id="workflow-grid" width="24" height="24" patternUnits="userSpaceOnUse">
            <path d="M24 0H0V24" fill="none" stroke="#24334a" strokeWidth="1" />
          </pattern>
          <marker id="workflow-arrow" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
            <path d="M0 0L8 4L0 8" fill="none" stroke="#22d3ee" strokeWidth="1.3" />
          </marker>
        </defs>
        <rect width="760" height="290" fill="url(#workflow-grid)" opacity=".78" />
        <path d="M52 46H708V236H52z" fill="rgba(8,15,25,.32)" stroke="#556b83" strokeWidth="1.5" />
        <path d="M52 105H708M52 177H708" stroke="#2f4057" strokeDasharray="4 7" />
        <path d="M135 46V236M257 46V236M379 46V236M501 46V236M623 46V236" stroke="#34465d" strokeDasharray="4 6" />
        <path d="M68 143H690" stroke="#22d3ee" strokeWidth="2" strokeDasharray="7 6" markerEnd="url(#workflow-arrow)" opacity=".78" />
        {points.map(point => (
          <g key={point.tag} opacity={activeIndex === point.index ? 1 : .68}>
            <circle cx={point.x} cy="143" r={activeIndex === point.index ? 20 : 15} fill={activeIndex === point.index ? '#123341' : '#142033'} stroke={activeIndex === point.index ? '#22d3ee' : '#7890a7'} strokeWidth="1.5" />
            <text x={point.x} y="148" fill={activeIndex === point.index ? '#9df3fa' : '#bfd0df'} textAnchor="middle" fontSize="13" fontFamily="var(--app-font-mono), monospace">{point.tag}</text>
          </g>
        ))}
        <g transform="translate(361 130)" opacity=".95">
          <rect x="1" y="2" width="38" height="20" rx="2" fill="#c6d4df" />
          <path d="M5 8H35M5 14H35M8 22v7m12-7v7m12-7v7" stroke="#122236" strokeWidth="2" />
          <path d="M3 30H39" stroke="#22d3ee" strokeWidth="2" />
        </g>
        <text className="workflow-svg-label" x="65" y="78" fill="#b9c8d6" fontSize="10" fontFamily="var(--app-font-mono), monospace">ПРИЁМКА</text>
        <text className="workflow-svg-label" x="187" y="78" fill="#b9c8d6" fontSize="10" fontFamily="var(--app-font-mono), monospace">ПЕРЕВОЗКА</text>
        <text className="workflow-svg-label" x="309" y="78" fill="#b9c8d6" fontSize="10" fontFamily="var(--app-font-mono), monospace">РАЗМЕЩЕНИЕ</text>
        <text className="workflow-svg-label" x="433" y="78" fill="#b9c8d6" fontSize="10" fontFamily="var(--app-font-mono), monospace">ОТБОР</text>
        <text className="workflow-svg-label" x="554" y="78" fill="#b9c8d6" fontSize="10" fontFamily="var(--app-font-mono), monospace">УПАКОВКА</text>
        <text className="workflow-svg-label" x="664" y="78" fill="#b9c8d6" fontSize="10" fontFamily="var(--app-font-mono), monospace">ОТГРУЗКА</text>
        <text x="72" y="264" fill="#8298ad" fontSize="12" fontFamily="var(--app-font-mono), monospace">СХЕМА ПОМОГАЕТ ОБСУДИТЬ ГРАНИЦЫ ОПЕРАЦИИ, НЕ ТЕХНИЧЕСКОЕ РЕШЕНИЕ</text>
      </svg>
      <p className="workflow-diagram-caption">Линия показывает последовательность процессов, а не подтверждённый маршрут конкретного робота или склада.</p>
    </div>
  );
}

export default function HowItWorks() {
  const [activeStage, setActiveStage] = useState(stages[0].id);
  const selected = stages.find(stage => stage.id === activeStage) ?? stages[0];

  return (
    <div className="workflow-page mx-auto w-full max-w-6xl px-4 pb-16 pt-7 sm:px-6 sm:pt-10" data-testid="page-how-it-works">
      <section className="workflow-hero">
        <p className="start-eyebrow"><span className="start-led" /> СПРАВОЧНЫЙ МАТЕРИАЛ / СКЛАДСКОЙ ПРОЦЕСС</p>
        <h1>Складской поток —<br /><em>от приёмки до отгрузки.</em></h1>
        <p className="workflow-lede">Разберём, какие вопросы стоит задать о паллетной операции до расчёта парка и экономики. Эта схема помогает описать процесс, но не заменяет обследование площадки.</p>
        <div className="workflow-hero-bottom">
          <span><Warehouse size={17} aria-hidden="true" /> Шесть этапов одного условного потока</span>
          <Link href={`/start?industry=${encodeURIComponent(WAREHOUSE_INDUSTRY)}`} className="workflow-primary-link" data-testid="how-start-estimate">
            Перейти к оценке склада <ArrowRight size={17} aria-hidden="true" />
          </Link>
        </div>
      </section>

      <section className="workflow-section" aria-labelledby="workflow-map-title">
        <div className="workflow-section-heading">
          <div>
            <p className="start-kicker">СНАЧАЛА РАЗБЕРИТЕ ПРОЦЕСС</p>
            <h2 id="workflow-map-title">Где начинается и заканчивается операция?</h2>
            <p>Выберите участок схемы. Вместо предположений о площадке собраны вопросы, которые помогают задать границы задачи.</p>
          </div>
            <span className="workflow-section-stamp">ЭТАП<br />→ ПРОВЕРКА</span>
        </div>
        <WarehouseFlow activeId={activeStage} />
        <div className="workflow-stage-tabs" role="tablist" aria-label="Этапы складского потока">
          {stages.map((stage, index) => (
            <button key={stage.id} id={`workflow-tab-${stage.id}`} type="button" role="tab"
              aria-selected={activeStage === stage.id} aria-controls="workflow-stage-detail"
              tabIndex={activeStage === stage.id ? 0 : -1}
              onClick={() => setActiveStage(stage.id)} className={activeStage === stage.id ? 'is-active' : ''}
              onKeyDown={event => {
                let nextIndex: number | null = null;
                if (event.key === 'ArrowRight') nextIndex = (index + 1) % stages.length;
                if (event.key === 'ArrowLeft') nextIndex = (index - 1 + stages.length) % stages.length;
                if (event.key === 'Home') nextIndex = 0;
                if (event.key === 'End') nextIndex = stages.length - 1;
                if (nextIndex !== null) {
                  event.preventDefault();
                  const nextStage = stages[nextIndex];
                  setActiveStage(nextStage.id);
                  document.getElementById(`workflow-tab-${nextStage.id}`)?.focus();
                }
              }}
              data-testid={`workflow-stage-${stage.id}`}>
              <span>{String(index + 1).padStart(2, '0')}</span>{stage.label}<ArrowRight size={15} aria-hidden="true" />
            </button>
          ))}
        </div>
        <article id="workflow-stage-detail" role="tabpanel" aria-labelledby={`workflow-tab-${selected.id}`} className="workflow-detail">
          <div className="workflow-detail-heading">
            <span className="workflow-detail-marker">{selected.marker}</span>
            <div><p className="start-kicker">{selected.label}</p><h3>{selected.title}</h3></div>
          </div>
          <p className="workflow-detail-copy">{selected.description}</p>
          <div className="workflow-question-list">
            {selected.questions.map(question => <div key={question}><Check size={16} aria-hidden="true" />{question}</div>)}
          </div>
        </article>
      </section>

      <section className="workflow-context-grid" aria-label="Как читать оценку">
        <article className="workflow-context-card">
          <div className="workflow-card-icon"><FileSearch size={20} aria-hidden="true" /></div>
          <p className="start-kicker">ГДЕ ДАННЫЕ</p>
          <h2>Разделяйте факт и допущение</h2>
          <p>Площадь склада вводится пользователем. В первичной модели остальные параметры задаются по шаблону и показываются отдельно — их нужно сверить с объектом.</p>
        </article>
        <article className="workflow-context-card">
          <div className="workflow-card-icon"><Route size={20} aria-hidden="true" /></div>
          <p className="start-kicker">ГДЕ ГРАНИЦЫ</p>
          <h2>Операция не равна отрасли</h2>
          <p>Отрасль задаёт контекст, тип объекта — физическую площадку, а операция описывает конкретную работу. Один и тот же тип объекта может встречаться в разных отраслях.</p>
        </article>
        <article className="workflow-context-card workflow-context-card-note">
          <div className="workflow-card-icon"><CircleHelp size={20} aria-hidden="true" /></div>
          <p className="start-kicker">ЧЕГО СХЕМА НЕ ДОКАЗЫВАЕТ</p>
          <h2>Никаких выводов без проверки</h2>
          <p>Схема не сообщает длительность операций, эффект автоматизации, пригодность конкретного робота или срок окупаемости. Это требует данных о процессе, ограничениях и подтверждённых характеристиках решения.</p>
        </article>
      </section>

      <section className="workflow-next">
        <div>
          <p className="start-kicker">СЛЕДУЮЩИЙ ШАГ</p>
          <h2>Задайте площадь — и проверьте модель на своих вводных.</h2>
          <p>На странице оценки складской сценарий рассчитывается существующей моделью и каталожным решением. Все значения, которые не вводили вы, будут обозначены как допущения.</p>
        </div>
        <Link href={`/start?industry=${encodeURIComponent(WAREHOUSE_INDUSTRY)}`} className="workflow-primary-link" data-testid="how-start-estimate-bottom">
          Открыть оценку склада <ArrowRight size={17} aria-hidden="true" />
        </Link>
      </section>
    </div>
  );
}
