import { useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleHelp,
  Clock3,
  Package,
  RotateCcw,
  Route,
  Users,
  X,
} from 'lucide-react';
import './_group.css';
import './ExampleFirst.css';

type Mode = 'people' | 'robot';
type OwnTask = {
  operation: string;
  start: string;
  finish: string;
  frequency: string;
  people: string;
};

const emptyTask: OwnTask = {
  operation: '',
  start: '',
  finish: '',
  frequency: '',
  people: '',
};

const stepNames = ['Одна перевозка', 'Что меняется', 'Что нужно для оценки'];

function PalletRoute({ mode, onModeChange, runId, onReplay }: { mode: Mode; onModeChange: (mode: Mode) => void; runId: number; onReplay: () => void }) {
  return (
    <div className="ef-route-card">
      <div className="ef-route-top">
        <div>
          <span className="ef-mini-label">УЧЕБНЫЙ ПРИМЕР</span>
          <h2>Паллета: приёмка → хранение</h2>
        </div>
        <span className="ef-route-badge"><Route size={15} /> Внутренний транспорт</span>
      </div>
      <div className="ef-route-visual" aria-label="Одинаковый маршрут в обоих вариантах: паллета перемещается из точки A в точку B">
        <div className="ef-location">
          <span className="ef-location-dot">A</span>
          <span>Приёмка</span>
          <small>точка передачи</small>
        </div>
        <div className="ef-track" aria-hidden="true">
          <span className="ef-track-line" />
          <span className="ef-route-pallet" key={runId}><Package size={21} /></span>
          <span className="ef-track-arrow"><ArrowRight size={16} /></span>
        </div>
        <div className="ef-location ef-location-end">
          <span className="ef-location-dot">B</span>
          <span>Зона хранения</span>
          <small>точка приёма</small>
        </div>
      </div>
      <div className="ef-route-controls">
        <span>Кто везёт паллету?</span>
        <div className="ef-toggle" role="group" aria-label="Способ перемещения">
          <button type="button" className={mode === 'people' ? 'is-selected' : ''} onClick={() => onModeChange('people')} aria-pressed={mode === 'people'} data-testid="choice-manual">
            <Users size={15} /> Люди
          </button>
          <button type="button" className={mode === 'robot' ? 'is-selected' : ''} onClick={() => onModeChange('robot')} aria-pressed={mode === 'robot'} data-testid="choice-robot">
            <Route size={15} /> <span className="ef-toggle-full">Мобильный робот</span><span className="ef-toggle-short">Робот</span>
          </button>
        </div>
        <button type="button" className="ef-route-replay" onClick={onReplay} data-testid="cta-replay-route"><RotateCcw size={16} /> Повторить путь</button>
      </div>
      <p className="ef-route-caption" aria-live="polite">
        {mode === 'people'
          ? 'В этом варианте перевозку A → B выполняют люди.'
          : 'В этом варианте паллету A → B перевозит робот.'}
        {' '}Маршрут одинаковый; меняется только исполнитель.
      </p>
    </div>
  );
}

function TaskForm({
  value,
  onChange,
  onSubmit,
  onClose,
  errors,
}: {
  value: OwnTask;
  onChange: (value: OwnTask) => void;
  onSubmit: () => void;
  onClose: () => void;
  errors: string[];
}) {
  const set = (key: keyof OwnTask, next: string) => onChange({ ...value, [key]: next });
  return (
    <section className="ef-task-panel" aria-labelledby="ef-task-title">
      <div className="ef-task-heading">
        <div>
          <span className="ef-mini-label">ВАША ОПЕРАЦИЯ</span>
          <h3 id="ef-task-title">Опишем один участок</h3>
          <p>Заполните известное. Неизвестное можно отметить отдельно — данных не нужно угадывать.</p>
        </div>
        <button className="ef-icon-button" type="button" onClick={onClose} aria-label="Закрыть форму"><X size={18} /></button>
      </div>
      <div className="ef-fields">
        <label className="ef-field ef-field-wide">
          <span>Что перемещается? <b>Обязательно</b></span>
          <input value={value.operation} onChange={event => set('operation', event.target.value)} placeholder="Например: паллета с приёмки в хранение" data-testid="field-operation" />
        </label>
        <label className="ef-field">
          <span>Откуда начинается?</span>
          <input value={value.start} onChange={event => set('start', event.target.value)} placeholder="Зона или точка" data-testid="field-start" />
        </label>
        <label className="ef-field">
          <span>Где заканчивается?</span>
          <input value={value.finish} onChange={event => set('finish', event.target.value)} placeholder="Зона или точка" data-testid="field-finish" />
        </label>
        <label className="ef-field">
          <span>Как часто происходит?</span>
          <input value={value.frequency} onChange={event => set('frequency', event.target.value)} placeholder="Частота или «пока неизвестно»" data-testid="field-frequency" />
        </label>
        <label className="ef-field">
          <span>Кто выполняет сейчас?</span>
          <input value={value.people} onChange={event => set('people', event.target.value)} placeholder="Роль, команда или «неизвестно»" data-testid="field-people" />
        </label>
      </div>
      {errors.length > 0 && <p className="ef-validation" role="alert">Укажите, что именно перемещается. Остальные поля можно оставить пустыми или отметить как неизвестные.</p>}
      <div className="ef-task-actions">
        <span><CircleHelp size={15} /> Никаких расчётов или сохранения на сервере</span>
        <button type="button" className="ef-primary-button" onClick={onSubmit} data-testid="cta-save-task">Собрать описание <ArrowRight size={17} /></button>
      </div>
    </section>
  );
}

export function ExampleFirst() {
  const [step, setStep] = useState(0);
  const [mode, setMode] = useState<Mode>('people');
  const [routeRun, setRouteRun] = useState(0);
  const [formOpen, setFormOpen] = useState(false);
  const [task, setTask] = useState(emptyTask);
  const [summary, setSummary] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const restart = () => {
    setStep(0);
    setMode('people');
    setRouteRun(0);
    setFormOpen(false);
    setTask(emptyTask);
    setSummary(false);
    setErrors([]);
  };

  const submitTask = () => {
    if (!task.operation.trim()) {
      setErrors(['operation']);
      return;
    }
    setErrors([]);
    setFormOpen(false);
    setSummary(true);
  };

  return (
    <main className="ef-shell">
      <header className="ef-header">
        <div className="ef-brand"><span className="ef-brand-mark"><img src="/__mockup/images/robotshub-logo.jpg" alt="" width={27} height={27} className="rounded-md" /></span><span>ROBOTS<span>HUB</span></span></div>
        <div className="ef-header-right"><span className="ef-prototype">ИНТЕРАКТИВНЫЙ ПРИМЕР</span><button type="button" className="ef-restart" onClick={restart} data-testid="cta-restart"><RotateCcw size={15} /> Сначала</button></div>
      </header>
      <div className="ef-main">
        <div className="ef-progress" aria-label={`Шаг ${step + 1} из 3`}>
          <div className="ef-progress-label"><span>РАЗБИРАЕМ ОДНУ ОПЕРАЦИЮ</span><span>{String(step + 1).padStart(2, '0')} <i>/ 03</i></span></div>
          <div className="ef-progress-track">{stepNames.map((name, index) => <span key={name} className={index <= step ? 'is-active' : ''} data-testid={`step-${index + 1}`} />)}</div>
        </div>

        {step === 0 && (
          <section className="ef-step ef-step-one">
            <div className="ef-intro">
              <span className="ef-kicker"><span /> ОТ ПОНЯТНОГО ПРИМЕРА К ВАШЕЙ ЗАДАЧЕ</span>
              <h1>Робот не «делает склад».<br /><em>Он перевозит груз.</em></h1>
              <p className="ef-lead">Паллета едет от приёмки к хранению. Переключите, кто выполняет эту перевозку.</p>
            </div>
            <PalletRoute mode={mode} onModeChange={setMode} runId={routeRun} onReplay={() => setRouteRun(value => value + 1)} />
            <div className="ef-step-footer">
              <span className="ef-illustrative"><Clock3 size={15} /> Схема условная — не в масштабе и не по времени</span>
              <button type="button" className="ef-primary-button" onClick={() => setStep(1)} data-testid="cta-next-step-1">Что остаётся людям <ArrowRight size={17} /></button>
            </div>
          </section>
        )}

        {step === 1 && (
          <section className="ef-step">
            <div className="ef-step-title">
              <span className="ef-kicker"><span /> ШАГ 2 · ГРАНИЦЫ ОПЕРАЦИИ</span>
              <h1>Перевозка — только<br /><em>часть процесса.</em></h1>
              <p className="ef-lead">Робот может перемещать груз между согласованными точками. Остальные действия остаются отдельными.</p>
            </div>
            <div className="ef-work-split">
              <article className="ef-work-card ef-robot-work">
                <div className="ef-work-icon"><Route size={20} /></div><span className="ef-mini-label">МОБИЛЬНЫЙ РОБОТ</span>
                <h2>Перемещает</h2><p>Забирает груз в точке передачи и везёт по маршруту к следующей точке.</p>
                <div className="ef-work-chip">A <ArrowRight size={14} /> B</div>
              </article>
              <article className="ef-work-card ef-human-work">
                <div className="ef-work-icon"><Users size={20} /></div><span className="ef-mini-label">РОЛЬ ЧЕЛОВЕКА</span>
                <h2>Готовит и контролирует</h2><p>Передаёт груз, подтверждает выполнение; подъём, отбор и размещение зависят от процесса и оборудования.</p>
                <div className="ef-work-chip"><Check size={14} /> Отдельные действия</div>
              </article>
            </div>
            <div className="ef-boundary-note"><CircleHelp size={17} /><p><strong>Не предполагаем автоматизацию всего цикла.</strong> Здесь рассматривается только внутренняя перевозка паллеты — не комплектация заказа и не работа со стеллажной ячейкой.</p></div>
            <div className="ef-step-footer">
              <button type="button" className="ef-secondary-button" onClick={() => setStep(0)} data-testid="cta-back-step-2"><ArrowLeft size={16} /> Назад</button>
              <button type="button" className="ef-primary-button" onClick={() => setStep(2)} data-testid="cta-next-step-2">Что влияет на экономику <ArrowRight size={17} /></button>
            </div>
          </section>
        )}

        {step === 2 && (
          <section className="ef-step">
            <div className="ef-step-title">
              <span className="ef-kicker"><span /> ШАГ 3 · ДАННЫЕ ДЛЯ ПРОВЕРКИ</span>
              <h1>Экономика зависит<br /><em>от вашего потока.</em></h1>
              <p className="ef-lead">Одной площади недостаточно. Чтобы обсуждать сценарий, нужно понять цикл и фактическую работу на участке.</p>
            </div>
            <div className="ef-input-map">
              <div className="ef-input-map-head"><span>ЧТО СТОИТ УТОЧНИТЬ</span><span>ПОЧЕМУ ЭТО ВАЖНО</span></div>
              <div className="ef-input-row"><span><b>Поток</b><small>что и как часто перемещают</small></span><span>Показывает объём работы участка</span></div>
              <div className="ef-input-row"><span><b>Цикл</b><small>начало, конец и условия маршрута</small></span><span>Определяет, что считать одной перевозкой</span></div>
              <div className="ef-input-row"><span><b>Работа людей</b><small>кто выполняет задачу сейчас</small></span><span>Нужна для сравнения сценариев</span></div>
            </div>
            {!formOpen && !summary && (
              <div className="ef-own-cta">
                <div><span className="ef-mini-label">СЛЕДУЮЩИЙ ШАГ</span><h2>Опишите один свой участок</h2><p>Можно начать с известного и пометить остальное как неизвестное.</p></div>
                <button type="button" className="ef-primary-button" onClick={() => setFormOpen(true)} data-testid="cta-own-task">Описать свою задачу <ArrowRight size={17} /></button>
              </div>
            )}
            {formOpen && <TaskForm value={task} onChange={setTask} onSubmit={submitTask} onClose={() => { setFormOpen(false); setErrors([]); }} errors={errors} />}
            {summary && (
              <section className="ef-summary" aria-live="polite" data-testid="task-summary">
                <div className="ef-summary-heading"><span className="ef-summary-check"><Check size={17} /></span><div><span className="ef-mini-label">ЧЕРНОВИК ОПИСАНИЯ</span><h2>Операция записана для этого примера</h2></div></div>
                <dl>
                  {([['Операция', task.operation], ['Начало', task.start], ['Завершение', task.finish], ['Частота', task.frequency], ['Кто выполняет', task.people]] as const).map(([label, value]) => (
                    <div key={label}><dt>{label}</dt><dd>{value.trim() || <span className="ef-unknown">Неизвестно</span>}</dd></div>
                  ))}
                </dl>
                <div className="ef-summary-actions"><span>Данные остаются только в текущем открытом прототипе.</span><button type="button" className="ef-secondary-button" onClick={() => { setSummary(false); setFormOpen(true); }} data-testid="cta-edit-task">Изменить описание</button></div>
              </section>
            )}
            <div className="ef-step-footer">
              <button type="button" className="ef-secondary-button" onClick={() => { setStep(1); setFormOpen(false); }} data-testid="cta-back-step-3"><ArrowLeft size={16} /> Назад</button>
              <button type="button" className="ef-text-button" onClick={restart} data-testid="cta-replay">Пройти пример заново <RotateCcw size={15} /></button>
            </div>
          </section>
        )}
      </div>
      <footer className="ef-footer"><span>ROBOTS<span>HUB</span> <i>·</i> Учебный пример перемещения паллеты</span><span>Без прогноза производительности и окупаемости</span></footer>
    </main>
  );
}
