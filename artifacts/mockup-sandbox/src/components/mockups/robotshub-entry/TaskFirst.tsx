import { useState } from 'react';
import { ArrowLeft, ArrowRight, Check, CircleHelp, RotateCcw, Truck, Sparkles, ScanEye, Wrench } from 'lucide-react';
import './_group.css';
import './TaskFirst.css';

type Operation = 'transport' | 'cleaning' | 'inspection' | 'other';
type DataValues = Record<string, string>;
type Context = { id: string; label: string; note: string };

const operations: { id: Operation; label: string; detail: string; icon: typeof Truck }[] = [
  { id: 'transport', label: 'Перевозить грузы', detail: 'Внутренние перемещения и доставка', icon: Truck },
  { id: 'cleaning', label: 'Убирать помещения', detail: 'Полы, коридоры и общие зоны', icon: Sparkles },
  { id: 'inspection', label: 'Осматривать и контролировать', detail: 'Обходы, контроль состояния, мониторинг', icon: ScanEye },
  { id: 'other', label: 'Другая задача', detail: 'Опишите операцию своими словами', icon: Wrench },
];

const contexts: Context[] = [
  { id: 'warehouse', label: 'Склад', note: 'стеллажи, зоны хранения, доки' },
  { id: 'production', label: 'Производство', note: 'цеха и производственные зоны' },
  { id: 'airport', label: 'Аэропорт', note: 'терминал и служебные зоны' },
  { id: 'medical', label: 'Медучреждение', note: 'корпуса и общие пространства' },
  { id: 'office', label: 'Офис или общественное здание', note: 'этажи, коридоры, холлы' },
  { id: 'other', label: 'Другая площадка', note: 'укажите свой тип объекта' },
];

type Field = { key: string; label: string; unit: string; placeholder: string; help: string };
function fieldsFor(operation: Operation): Field[] {
  if (operation === 'transport') return [
    { key: 'volume', label: 'Сколько перемещений нужно выполнять?', unit: 'перемещений за смену', placeholder: 'Например, 120', help: 'Подойдёт оценка за обычную смену. Уточните, что считаете одним перемещением.' },
    { key: 'hours', label: 'Сколько часов длится рабочая смена?', unit: 'часов', placeholder: 'Например, 8', help: 'Укажите фактическую длительность смены, если она известна.' },
  ];
  if (operation === 'cleaning') return [
    { key: 'area', label: 'Какую площадь нужно убирать за смену?', unit: 'м² за смену', placeholder: 'Площадь или «не знаю»', help: 'Нужна площадь именно регулярной уборки, а не всего здания.' },
    { key: 'hours', label: 'Сколько часов отведено на уборку?', unit: 'часов за смену', placeholder: 'Например, 6', help: 'Если график ещё не определён — отметьте, что пока не знаете.' },
  ];
  if (operation === 'inspection') return [
    { key: 'volume', label: 'Сколько точек или маршрутов нужно проверить?', unit: 'за смену', placeholder: 'Количество или «не знаю»', help: 'Например, число контрольных точек. Единицу измерения можно уточнить позже.' },
    { key: 'hours', label: 'Как часто нужен обход?', unit: 'раз за смену', placeholder: 'Например, 2', help: 'Укажите желаемую частоту, а не технический интервал робота.' },
  ];
  return [
    { key: 'task', label: 'Что именно должен делать робот?', unit: '', placeholder: 'Опишите операцию коротко', help: 'Свободного описания достаточно для первичного разговора.' },
    { key: 'volume', label: 'Как часто возникает эта задача?', unit: 'частота или объём', placeholder: 'Например, несколько раз за смену', help: 'Можно указать словами или отметить «пока не знаю».' },
  ];
}

const opNames: Record<Operation, string> = {
  transport: 'Перевозка грузов',
  cleaning: 'Уборка помещений',
  inspection: 'Осмотр и контроль',
  other: 'Другая задача',
};
const contextName = (id: string) => contexts.find(item => item.id === id)?.label ?? id;

export function TaskFirst() {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [operation, setOperation] = useState<Operation | null>(null);
  const [context, setContext] = useState('');
  const [customContext, setCustomContext] = useState('');
  const [answersContextKey, setAnswersContextKey] = useState('');
  const [values, setValues] = useState<DataValues>({});
  const [unknown, setUnknown] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<string[]>([]);
  const [completed, setCompleted] = useState(false);
  const [taskDescription, setTaskDescription] = useState('');

  const fields = operation ? fieldsFor(operation) : [];
  const visibleContextChoices = contexts;
  const contextLabel = context === 'other' && customContext.trim() ? customContext.trim() : contextName(context);
  const clearAnswers = () => {
    setValues({});
    setUnknown({});
    setErrors([]);
    setCompleted(false);
    setTaskDescription('');
  };

  const chooseOperation = (next: Operation) => {
    setOperation(next);
    setContext('');
    setCustomContext('');
    setAnswersContextKey('');
    clearAnswers();
    setStep(2);
  };

  const continueToQuestions = () => {
    if (!context) {
      setErrors(['Выберите тип площадки или отметьте «Другая площадка».']);
      return;
    }
    if (context === 'other' && !customContext.trim()) {
      setErrors(['Напишите, что это за площадка.']);
      return;
    }
    setErrors([]);
    const nextContextKey = context === 'other' ? `other:${customContext.trim()}` : context;
    if (answersContextKey !== nextContextKey) {
      clearAnswers();
      setAnswersContextKey(nextContextKey);
    }
    setStep(3);
  };

  const validate = () => {
    const nextErrors: string[] = [];
    fields.forEach(field => {
      if (unknown[field.key]) return;
      const answer = values[field.key]?.trim() ?? '';
      if (!answer) {
        nextErrors.push(`Заполните поле «${field.label}» или отметьте, что пока не знаете.`);
      } else if (field.key !== 'task' && operation !== 'other' && !Number.isFinite(Number(answer.replace(',', '.')))) {
        nextErrors.push(`В поле «${field.label}» укажите конечное число или отметьте «Пока не знаю».`);
      } else if (field.key !== 'task' && operation !== 'other' && Number(answer.replace(',', '.')) <= 0) {
        nextErrors.push(`В поле «${field.label}» значение должно быть больше нуля.`);
      } else if (field.key === 'hours' && operation !== 'inspection' && Number(answer.replace(',', '.')) > 24) {
        nextErrors.push(`В поле «${field.label}» укажите длительность больше 0 и не больше 24 часов.`);
      }
    });
    if (operation === 'other' && !unknown.task && !(values.task?.trim())) {
      nextErrors.push('Опишите задачу или отметьте, что пока не знаете.');
    }
    setErrors(nextErrors);
    if (nextErrors.length) return;
    setCompleted(true);
    setTaskDescription(operation === 'other' && values.task?.trim() ? values.task.trim() : '');
  };

  const restart = () => {
    setStep(1);
    setOperation(null);
    setContext('');
    setCustomContext('');
    setAnswersContextKey('');
    clearAnswers();
  };

  const changeAnswer = (key: string, value: string) => {
    setValues(current => ({ ...current, [key]: value }));
    setUnknown(current => ({ ...current, [key]: false }));
    setCompleted(false);
  };
  const markUnknown = (key: string) => {
    setUnknown(current => ({ ...current, [key]: !current[key] }));
    setValues(current => ({ ...current, [key]: '' }));
    setCompleted(false);
  };

  return (
    <main className="tf-page">
      <header className="tf-header">
        <div className="tf-brand">
          <span className="tf-mark" aria-hidden="true"><img src="/__mockup/images/robotshub-logo.jpg" alt="" width={32} height={32} className="rounded-md" /></span>
          <span>Robots<span>Hub</span></span>
        </div>
        <span className="tf-prototype">ПРОТОТИП · сбор данных</span>
      </header>

      <div className="tf-layout">
        <aside className="tf-rail" aria-label="Этапы">
          <div className="tf-rail-kicker">ПЕРВИЧНАЯ ОЦЕНКА</div>
          <h1>От задачи<br />к понятным<br /><em>вводным.</em></h1>
          <p>Сначала определим операцию и площадку. Числовые данные можно пропустить, если их пока нет.</p>
          <div className="tf-step-list">
            {[
              ['01', 'Операция'],
              ['02', 'Площадка'],
              ['03', 'Вводные'],
            ].map(([num, label], index) => {
              const n = index + 1;
              return <div key={num} className={`tf-step ${step === n ? 'is-current' : step > n ? 'is-done' : ''}`} data-testid={`task-step-${n}`}>
                <span className="tf-step-number">{step > n ? <Check size={14} /> : num}</span><span>{label}</span>
              </div>;
            })}
          </div>
          <div className="tf-rail-foot"><span className="tf-status-dot" /> Данные остаются только в этом прототипе</div>
        </aside>

        <section className="tf-panel" aria-live="polite">
          <div className="tf-panel-top">
            <div className="tf-progress"><span style={{ width: `${(step / 3) * 100}%` }} /></div>
            <span>ШАГ {String(step).padStart(2, '0')} / 03</span>
          </div>

          {step === 1 && <div className="tf-screen" data-testid="task-screen-operation">
            <p className="tf-eyebrow">НАЧНЁМ С РАБОТЫ</p>
            <h2>Какую задачу хотите автоматизировать?</h2>
            <p className="tf-intro">Выберите действие, которое робот должен выполнять на вашей площадке.</p>
            <div className="tf-operation-list">
              {operations.map(item => {
                const Icon = item.icon;
                return <button type="button" key={item.id} onClick={() => chooseOperation(item.id)} className="tf-operation" data-testid={`task-operation-${item.id}`}>
                  <span className="tf-op-icon"><Icon size={20} /></span>
                  <span className="tf-op-copy"><strong>{item.label}</strong><small>{item.detail}</small></span>
                  <ArrowRight className="tf-op-arrow" size={18} />
                </button>;
              })}
            </div>
            <div className="tf-help"><CircleHelp size={16} /><span>Не нужно знать модель робота — опишите работу, которую хотите поручить.</span></div>
          </div>}

          {step === 2 && <div className="tf-screen" data-testid="task-screen-context">
            <button type="button" className="tf-back" onClick={() => { setStep(1); setErrors([]); }} data-testid="task-back-operation"><ArrowLeft size={16} /> К выбору задачи</button>
            <p className="tf-eyebrow">КОНТЕКСТ РАБОТЫ</p>
            <h2>Где выполняется эта задача?</h2>
            <p className="tf-intro">Это физическая площадка, а не отрасль компании.</p>
            <div className="tf-context-grid">
              {visibleContextChoices.map(item => <button type="button" key={item.id} className={`tf-context ${context === item.id ? 'selected' : ''}`} onClick={() => { setContext(item.id); setErrors([]); }} data-testid={`task-context-${item.id}`}>
                <span className="tf-radio">{context === item.id && <i />}</span>
                <span><strong>{item.label}</strong><small>{item.note}</small></span>
              </button>)}
            </div>
            {context === 'other' && <label className="tf-custom-context">Тип площадки
              <input value={customContext} onChange={event => setCustomContext(event.target.value)} placeholder="Например, распределительный центр" data-testid="task-context-other-input" />
            </label>}
            {errors.length > 0 && <div className="tf-errors" role="alert">{errors.map(error => <p key={error}>{error}</p>)}</div>}
            <div className="tf-actions"><span>Следующий шаг — только знакомые вам вводные</span><button type="button" className="tf-primary" onClick={continueToQuestions} data-testid="task-continue-context">Продолжить <ArrowRight size={17} /></button></div>
          </div>}

          {step === 3 && operation && <div className="tf-screen" data-testid="task-screen-inputs">
            <button type="button" className="tf-back" onClick={() => { setStep(2); setErrors([]); setCompleted(false); }} data-testid="task-back-context"><ArrowLeft size={16} /> К выбору площадки</button>
            <p className="tf-eyebrow">ПАРАМЕТРЫ ЗАДАЧИ</p>
            <h2>{completed ? 'Картина задачи собрана' : 'Что уже известно?'}</h2>
            <p className="tf-intro">{opNames[operation]} · {contextLabel}. Заполните известное — неизвестные поля можно оставить честно пустыми.</p>

            {!completed ? <form className="tf-fields" onSubmit={event => { event.preventDefault(); validate(); }}>
              {fields.map(field => <div className="tf-field" key={field.key}>
                <label htmlFor={`task-${field.key}`}>{field.label}</label>
                <div className="tf-input-row">
                  <input id={`task-${field.key}`} inputMode={field.key === 'task' ? 'text' : 'decimal'} value={values[field.key] ?? ''} onChange={event => changeAnswer(field.key, event.target.value)} disabled={unknown[field.key]} placeholder={unknown[field.key] ? 'Пока не указано' : field.placeholder} data-testid={`task-input-${field.key}`} />
                  {field.unit && <span>{field.unit}</span>}
                </div>
                <div className="tf-field-meta"><small>{field.help}</small><button type="button" className={`tf-unknown ${unknown[field.key] ? 'active' : ''}`} onClick={() => markUnknown(field.key)} data-testid={`task-unknown-${field.key}`}><span>{unknown[field.key] ? '✓' : '+'}</span> Пока не знаю</button></div>
              </div>)}
              {errors.length > 0 && <div className="tf-errors" role="alert">{errors.map(error => <p key={error}>{error}</p>)}</div>}
              <div className="tf-actions"><span>Без неизвестных цифр — без ложной точности</span><button type="submit" className="tf-primary" data-testid="task-build-summary">Собрать сводку <ArrowRight size={17} /></button></div>
            </form> : <div className="tf-summary" data-testid="task-summary">
              <div className="tf-summary-title"><span className="tf-summary-check"><Check size={18} /></span><div><strong>Задача описана</strong><small>Это сводка вводных, не расчёт экономики.</small></div></div>
              <div className="tf-summary-line"><span>Операция</span><strong>{opNames[operation]}</strong></div>
              <div className="tf-summary-line"><span>Площадка</span><strong>{contextLabel}</strong></div>
              {fields.map(field => <div className="tf-summary-line" key={field.key}><span>{field.label}</span><strong>{unknown[field.key] ? 'Пока неизвестно' : `${values[field.key]}${field.unit ? ` ${field.unit}` : ''}`}</strong></div>)}
              {taskDescription && <div className="tf-summary-line"><span>Описание</span><strong>{taskDescription}</strong></div>}
              <div className="tf-next-note"><strong>Что нужно уточнить дальше</strong><p>Для оценки реализуемости потребуются характеристики маршрутов или зон, ограничения площадки и режим работы. Для стоимости нужны проверенные данные по решениям и условиям внедрения. Здесь они не подменяются предположениями.</p></div>
              <div className="tf-summary-actions"><button type="button" className="tf-secondary" onClick={() => { setCompleted(false); setErrors([]); }} data-testid="task-edit-inputs">Изменить вводные</button><button type="button" className="tf-primary" onClick={restart} data-testid="task-restart"><RotateCcw size={16} /> Начать заново</button></div>
            </div>}
          </div>}
        </section>
      </div>
    </main>
  );
}
