import { useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Building2, Check, ChevronRight, Factory, Hospital, MapPin, Plane, Plus, RotateCcw, Warehouse, X } from 'lucide-react';
import { fieldsForProcess, objectProcesses, type DetailField, type ProcessKind, type SiteProcess } from './_object-scope-data';
import './_group.css';
import './ObjectFirst.css';

type Scope = 'whole' | 'multiple' | 'single' | 'unsure';
type ObjectId = 'warehouse' | 'production' | 'airport' | 'medical' | 'public' | 'other';
type SiteInfo = { id: ObjectId; title: string; short: string; icon: typeof Warehouse };
const sites: SiteInfo[] = [
  { id: 'warehouse', title: 'Склад', short: 'приёмка, хранение, отгрузка', icon: Warehouse },
  { id: 'production', title: 'Производство', short: 'материалы, линии, выпуск', icon: Factory },
  { id: 'airport', title: 'Аэропорт', short: 'терминал и служебные потоки', icon: Plane },
  { id: 'medical', title: 'Медучреждение', short: 'отделения и общие зоны', icon: Hospital },
  { id: 'public', title: 'Офис или общественное здание', short: 'этажи и сервисные зоны', icon: Building2 },
  { id: 'other', title: 'Другой объект', short: 'назовите свою площадку', icon: MapPin },
];
const scopeOptions: { id: Scope; title: string; description: string }[] = [
  { id: 'whole', title: 'Весь объект', description: 'Разобрать площадку целиком; перечень зон можно дополнить.' },
  { id: 'multiple', title: 'Несколько участков', description: 'Выбрать нужные рабочие зоны.' },
  { id: 'single', title: 'Один участок', description: 'Сосредоточиться на одном процессе.' },
  { id: 'unsure', title: 'Пока не знаю', description: 'Посмотреть карту без выбора приоритета.' },
];

type FieldValues = Record<string, string>;
type ProcessDetails = Record<string, { values: FieldValues; unknown: Record<string, boolean> }>;
const kindHelp: Record<ProcessKind, string> = {
  flow: 'При изучении этого потока важно уточнить маршрут, точки передачи, ограничения проходов и роль сотрудников.',
  storage: 'Для этого участка стоит проверить устройство зон хранения, правила доступа и способ учёта запасов.',
  replenishment: 'Для уточнения пригодятся сигнал пополнения, место передачи и действующий порядок учёта.',
  picking: 'Здесь важно понять, как поступает задание, как устроен маршрут отбора и кому передаётся заказ.',
  shipping: 'Для этого потока нужно уточнить конечную точку, временные окна и правила передачи результата.',
  cleaning: 'Для уборки важны тип поверхности, доступность зон и временные окна работ.',
  inspection: 'Для обхода нужно определить точки проверки, безопасный доступ и способ фиксации результата.',
  service: 'Для сервиса важно выяснить, кто формирует запрос, где он учитывается и когда подключается сотрудник.',
  custom: 'Опишите текущую работу и передачу результата; неизвестные детали можно оставить на потом.',
};
const scopeText: Record<Scope, string> = {
  whole: 'Весь объект',
  multiple: 'Несколько участков',
  single: 'Один участок',
  unsure: 'Объём пока не определён',
};

function hasValidAnswer(field: DetailField, value: string | undefined) {
  const answer = value?.trim();
  if (!answer) return false;
  if (!field.numeric) return true;
  const number = Number(answer.replace(',', '.'));
  return Number.isFinite(number) && number > 0
    && (!['shift', 'hours'].includes(field.key) || number <= 24);
}

export function ObjectFirst() {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [objectId, setObjectId] = useState<ObjectId | null>(null);
  const [customObject, setCustomObject] = useState('');
  const [scope, setScope] = useState<Scope | null>(null);
  const [processes, setProcesses] = useState<SiteProcess[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [details, setDetails] = useState<ProcessDetails>({});
  const [activeProcess, setActiveProcess] = useState<string | null>(null);
  const [values, setValues] = useState<FieldValues>({});
  const [unknown, setUnknown] = useState<Record<string, boolean>>({});
  const [customProcessName, setCustomProcessName] = useState('');
  const [customCounter, setCustomCounter] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);
  const [objectChangeOpen, setObjectChangeOpen] = useState(false);
  const [pendingObjectId, setPendingObjectId] = useState<ObjectId | null>(null);
  const [scopeError, setScopeError] = useState('');
  const [detailSaved, setDetailSaved] = useState(false);

  const site = sites.find(item => item.id === objectId);
  const objectLabel = objectId === 'other' ? customObject.trim() || 'Другой объект' : site?.title ?? '';
  const processList = useMemo(() => processes, [processes]);
  const selectedProcesses = processList.filter(item => selectedIds.includes(item.id));
  const currentProcess = processList.find(item => item.id === activeProcess) ?? null;
  const detailFields = currentProcess ? fieldsForProcess(currentProcess.kind) : [];

  const resetProject = () => {
    setStep(1);
    setObjectId(null);
    setCustomObject('');
    setScope(null);
    setProcesses([]);
    setSelectedIds([]);
    setDetails({});
    setActiveProcess(null);
    setValues({});
    setUnknown({});
    setCustomProcessName('');
    setCustomCounter(0);
    setErrors([]);
    setObjectChangeOpen(false);
    setPendingObjectId(null);
    setScopeError('');
    setDetailSaved(false);
  };

  const continueObject = () => {
    if (!objectId) {
      setErrors(['Выберите физический объект.']);
      return;
    }
    if (objectId === 'other' && !customObject.trim()) {
      setErrors(['Укажите название или тип площадки.']);
      return;
    }
    if (processes.length === 0) {
      setProcesses(objectProcesses[objectId]);
      setSelectedIds([]);
      setScope(null);
    }
    setErrors([]);
    setStep(2);
  };

  const chooseScope = (nextScope: Scope) => {
    if (nextScope === scope) {
      setScopeError('');
      return;
    }
    setScope(nextScope);
    setScopeError('');
    setSelectedIds(nextScope === 'whole' ? processList.map(item => item.id) : []);
  };

  const continueScope = () => {
    if (!scope) {
      setScopeError('Выберите масштаб задачи или «Пока не знаю».');
      return;
    }
    setScopeError('');
    setStep(3);
  };

  const saveDetail = () => {
    const nextErrors: string[] = [];
    detailFields.forEach(field => {
      const answer = values[field.key]?.trim() ?? '';
      if (unknown[field.key] || !answer || !field.numeric) return;
      const number = Number(answer.replace(',', '.'));
      if (!Number.isFinite(number)) nextErrors.push(`«${field.label}»: введите конечное число.`);
      else if (number <= 0) nextErrors.push(`«${field.label}»: значение должно быть больше нуля.`);
      else if ((field.key === 'shift' || field.key === 'hours') && number > 24) nextErrors.push(`«${field.label}»: укажите не более 24 часов.`);
    });
    if (nextErrors.length) {
      setErrors(nextErrors);
      return;
    }
    if (!currentProcess) return;
    setDetails(current => ({ ...current, [currentProcess.id]: { values: { ...values }, unknown: { ...unknown } } }));
    setErrors([]);
    setDetailSaved(true);
  };

  const openProcess = (item: SiteProcess) => {
    const stored = details[item.id];
    setActiveProcess(item.id);
    setValues(stored?.values ?? {});
    setUnknown(stored?.unknown ?? {});
    setErrors([]);
    setDetailSaved(false);
  };

  const closeProcess = () => {
    setActiveProcess(null);
    setValues({});
    setUnknown({});
    setErrors([]);
    setDetailSaved(false);
  };

  const toggleProcess = (id: string) => {
    if (scope === 'whole') return;
    setScopeError('');
    setSelectedIds(current => {
      if (scope === 'single') return current.includes(id) ? [] : [id];
      return current.includes(id) ? current.filter(value => value !== id) : [...current, id];
    });
  };

  const addCustomProcess = () => {
    const name = customProcessName.trim();
    if (!name) {
      setErrors(['Введите название рабочей зоны.']);
      return;
    }
    const id = `custom-${customCounter + 1}`;
    const item: SiteProcess = {
      id, name, summary: 'Пользовательская рабочая зона для уточнения на площадке',
      kind: 'custom', focus: 'Опишите содержание работы и её место в общем процессе.',
    };
    setProcesses(current => [...current, item]);
    if (scope === 'whole') setSelectedIds(current => [...current, id]);
    setCustomCounter(current => current + 1);
    setCustomProcessName('');
    setErrors([]);
  };

  const editField = (key: string, value: string) => {
    const nextValues = { ...values, [key]: value };
    const nextUnknown = { ...unknown, [key]: false };
    setValues(nextValues);
    setUnknown(nextUnknown);
    if (activeProcess) setDetails(current => ({ ...current, [activeProcess]: { values: nextValues, unknown: nextUnknown } }));
    setDetailSaved(false);
  };
  const toggleUnknown = (key: string) => {
    const nextUnknown = { ...unknown, [key]: !unknown[key] };
    const nextValues = { ...values, [key]: '' };
    setUnknown(nextUnknown);
    setValues(nextValues);
    if (activeProcess) setDetails(current => ({ ...current, [activeProcess]: { values: nextValues, unknown: nextUnknown } }));
    setDetailSaved(false);
  };

  const scopeAllows = (item: SiteProcess) => scope === 'whole' || selectedIds.includes(item.id);
  const projectProcesses = scope === 'whole' || (scope === 'unsure' && selectedProcesses.length === 0)
    ? processList
    : selectedProcesses;
  const backToMapFromSummary = () => setStep(3);
  const requestObjectChange = () => {
    setPendingObjectId(null);
    setObjectChangeOpen(true);
  };
  const confirmObjectChange = () => {
    const nextObject = pendingObjectId;
    setObjectChangeOpen(false);
    setPendingObjectId(null);
    setStep(1);
    setObjectId(nextObject);
    setCustomObject('');
    setScope(null);
    setProcesses([]);
    setSelectedIds([]);
    setDetails({});
    setActiveProcess(null);
    setValues({});
    setUnknown({});
    setCustomProcessName('');
    setCustomCounter(0);
    setErrors([]);
    setScopeError('');
    setDetailSaved(false);
  };

  return (
    <main className="of-page">
      <header className="of-header">
        <div className="of-brand"><img className="of-logo" src="/__mockup/images/robotshub-logo.jpg" alt="" /><span>Robots<span>Hub</span></span></div>
        <span className="of-prototype">Прототип · карта объекта</span>
      </header>

      <div className="of-shell">
        <aside className="of-side">
          <div className="of-overline">ПЕРВИЧНАЯ ОЦЕНКА</div>
          <h1>Сначала<br />ваша площадка.</h1>
          <p>Разберём рабочие процессы, прежде чем обсуждать отдельные решения.</p>
          <nav className="of-steps" aria-label="Этапы">
            {([
              ['01', 'Объект', 1],
              ['02', 'Масштаб', 2],
              ['03', 'Карта работ', 3],
              ['04', 'Сводка', 4],
            ] as const).map(([number, label, index]) => (
              <div className={`of-step ${step === index ? 'current' : step > index ? 'done' : ''}`} key={number} data-testid={`object-step-${index}`}>
                <span>{step > index ? <Check size={15} /> : number}</span>{label}
              </div>
            ))}
          </nav>
          <div className="of-side-note"><i /> Локальный прототип: ответы не отправляются</div>
        </aside>

        <section className="of-workspace" aria-live="polite">
          <div className="of-topline">
            <div className="of-progress"><span style={{ width: `${step * 25}%` }} /></div>
            <span>ШАГ {String(step).padStart(2, '0')} / 04</span>
          </div>

          {step === 1 && <div className="of-screen" data-testid="object-screen">
            <div className="of-eyebrow">ФИЗИЧЕСКИЙ ОБЪЕКТ</div>
            <h2>Какую площадку разбираем?</h2>
            <p className="of-lede">Выберите место, где идут процессы. Отрасль компании можно уточнить позже.</p>
            <div className="of-object-grid">
              {sites.map(item => {
                const Icon = item.icon;
                return <button type="button" key={item.id} className={`of-object-card ${objectId === item.id ? 'selected' : ''}`} onClick={() => {
                  if (objectId && item.id !== objectId && processes.length > 0) {
                    setPendingObjectId(item.id);
                    setObjectChangeOpen(true);
                    return;
                  }
                  setObjectId(item.id);
                  if (item.id !== 'other') setCustomObject('');
                  setErrors([]);
                }} data-testid={`object-${item.id}`}>
                  <span className="of-object-icon"><Icon size={21} /></span>
                  <span className="of-object-text"><strong>{item.title}</strong><small>{item.short}</small></span>
                  <span className="of-select-dot">{objectId === item.id && <i />}</span>
                </button>;
              })}
            </div>
            {objectId === 'other' && <label className="of-custom-object">Как называется или устроена площадка?
              <input value={customObject} onChange={event => { setCustomObject(event.target.value); setErrors([]); }} disabled={processes.length > 0} placeholder="Например, кампус или распределительный центр" data-testid="object-custom-name" />
            </label>}
            <p className="of-after-list">Другой тип объекта? Выберите «Другой объект» и назовите его.</p>
            {errors.length > 0 && <div className="of-errors" role="alert">{errors.map(error => <p key={error}>{error}</p>)}</div>}
            <div className="of-actions"><span>Дальше определим масштаб — весь объект или его часть.</span><button className="of-primary" type="button" onClick={continueObject} data-testid="object-continue">Продолжить <ArrowRight size={18} /></button></div>
          </div>}

          {step === 2 && <div className="of-screen" data-testid="scope-screen">
            <button type="button" className="of-back" onClick={() => { setStep(1); setErrors([]); }} data-testid="scope-back-object"><ArrowLeft size={17} /> К объекту</button>
            <div className="of-eyebrow">{objectLabel.toLocaleUpperCase('ru-RU')}</div>
            <h2>Какой масштаб задачи?</h2>
            <p className="of-lede">Можно начать с площадки целиком — знать отдельные операции заранее не нужно.</p>
            <div className="of-scope-list">
              {scopeOptions.map(item => <button type="button" key={item.id} className={`of-scope-card ${scope === item.id ? 'selected' : ''}`} onClick={() => chooseScope(item.id)} data-testid={`scope-${item.id}`}>
                <span className="of-scope-radio">{scope === item.id && <i />}</span>
                <span><strong>{item.title}</strong><small>{item.description}</small></span>
                {item.id === 'whole' && <span className="of-scope-badge">{processList.length} зон</span>}
              </button>)}
            </div>
            {scopeError && <div className="of-errors" role="alert"><p>{scopeError}</p></div>}
            <div className="of-actions">
              <button type="button" className="of-text-button" onClick={requestObjectChange} data-testid="object-change">Изменить объект</button>
              <button className="of-primary" type="button" onClick={continueScope} data-testid="scope-continue">К карте процессов <ArrowRight size={18} /></button>
            </div>
          </div>}

          {step === 3 && <div className="of-screen" data-testid="process-map-screen">
            {activeProcess && currentProcess ? <div className="of-detail" data-testid={`process-detail-${currentProcess.id}`}>
              <button type="button" className="of-back" onClick={closeProcess} data-testid="process-detail-back"><ArrowLeft size={17} /> Назад к карте работ</button>
              <div className="of-detail-top">
                <span className="of-detail-label">УЧАСТОК / {objectLabel.toLocaleUpperCase('ru-RU')}</span>
                {details[currentProcess.id] && <span className="of-saved-state"><Check size={14} /> Черновик в этой вкладке</span>}
              </div>
              <h2>{currentProcess.name}</h2>
              <p className="of-lede">{currentProcess.summary}. {currentProcess.focus}</p>
              <div className="of-detail-note"><strong>Что важно понять здесь</strong><p>{kindHelp[currentProcess.kind]}</p></div>
              <div className="of-detail-fields">
                {detailFields.map((field: DetailField) => <div className="of-field" key={field.key}>
                  <label htmlFor={`of-${currentProcess.id}-${field.key}`}>{field.label}{field.unit && <span> · {field.unit}</span>}</label>
                  <input id={`of-${currentProcess.id}-${field.key}`} value={values[field.key] ?? ''} onChange={event => editField(field.key, event.target.value)} inputMode={field.numeric ? 'decimal' : 'text'} placeholder={unknown[field.key] ? 'Пока неизвестно' : field.placeholder} disabled={unknown[field.key]} data-testid={`process-input-${currentProcess.id}-${field.key}`} />
                  <button type="button" className={`of-unknown ${unknown[field.key] ? 'active' : ''}`} onClick={() => toggleUnknown(field.key)} data-testid={`process-unknown-${currentProcess.id}-${field.key}`}><span>{unknown[field.key] ? '✓' : '+'}</span> Пока неизвестно</button>
                </div>)}
              </div>
              {errors.length > 0 && <div className="of-errors" role="alert">{errors.map(error => <p key={error}>{error}</p>)}</div>}
              {detailSaved && <div className="of-saved-message" data-testid="process-detail-saved">Вводные сохранены в карте. Неизвестные поля не считаются нулём.</div>}
              <div className="of-actions">
                <span>Можно сохранить только то, что уже известно.</span>
                <button type="button" className="of-primary" onClick={saveDetail} data-testid="process-detail-save">Сохранить вводные <Check size={18} /></button>
              </div>
            </div> : <>
              <div className="of-map-head">
                <div>
                  <div className="of-eyebrow">КАРТА РАБОТ · {objectLabel.toLocaleUpperCase('ru-RU')}</div>
                  <h2>{scope === 'whole' ? 'Карта процессов всего объекта' : 'Отметьте рабочие участки'}</h2>
                  <p className="of-lede">{scope === 'whole'
                    ? 'Охват — весь объект. Это стартовый перечень направлений: добавьте свои зоны, если их нет на карте. Открытие участка не сужает охват.'
                    : scope === 'single'
                      ? 'В проект войдёт один выбранный участок. Откройте карточку, чтобы уточнить его вводные.'
                      : scope === 'multiple'
                        ? 'Выберите несколько участков. В проект попадут все отмеченные процессы.'
                        : 'Можно просматривать карту и собирать вводные без заданного масштаба.'}</p>
                </div>
                <button type="button" className="of-change-object" onClick={requestObjectChange} data-testid="object-change-map">Изменить объект</button>
              </div>
              <div className="of-map-legend">
                <span className="of-map-status"><i /> {scopeText[scope ?? 'unsure']}</span>
                <span>{scope === 'whole' ? `${processList.length} процессов включено` : `${selectedIds.length} выбрано`}</span>
              </div>
              <div className="of-process-grid">
                {processList.map(item => {
                  const selected = scopeAllows(item);
                  return <article className={`of-process-card ${selected ? 'in-project' : ''}`} key={item.id} data-testid={`process-${item.id}`}>
                    <button type="button" className="of-process-open" onClick={() => openProcess(item)} data-testid={`process-open-${item.id}`}>
                      <span className="of-process-title">{item.name}<ChevronRight size={18} /></span>
                      <span className="of-process-summary">{item.summary}</span>
                      <span className="of-process-meta">{details[item.id] ? 'Есть черновик вводных' : 'Вводные пока не уточнены'}</span>
                    </button>
                    <button type="button" disabled={scope === 'whole'} className={`of-select-process ${selected ? 'selected' : ''} ${scope === 'whole' ? 'locked' : ''}`} onClick={() => toggleProcess(item.id)} aria-pressed={selected} aria-label={scope === 'whole' ? `Включено в охват всего объекта: ${item.name}` : `${selected ? 'Убрать из' : 'Добавить в'} карту: ${item.name}`} data-testid={`process-select-${item.id}`}>
                      {selected ? <Check size={17} /> : <Plus size={17} />}
                      <span>{scope === 'whole' ? 'Весь объект' : selected ? 'В проекте' : scope === 'single' ? 'Выбрать участок' : 'Добавить участок'}</span>
                    </button>
                  </article>;
                })}
              </div>
              <div className="of-add-process">
                <div><strong>Нужен свой рабочий участок?</strong><p>Добавьте его в карту — пресет не ограничивает состав объекта.</p></div>
                <div className="of-add-row"><input value={customProcessName} onChange={event => setCustomProcessName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addCustomProcess(); } }} placeholder="Название участка или процесса" data-testid="custom-process-name" /><button type="button" onClick={addCustomProcess} aria-label="Добавить рабочую зону" data-testid="process-add-custom"><Plus size={18} /> Добавить</button></div>
              </div>
              {errors.length > 0 && <div className="of-errors" role="alert">{errors.map(error => <p key={error}>{error}</p>)}</div>}
              {scopeError && <div className="of-errors" role="alert"><p>{scopeError}</p></div>}
              <div className="of-actions of-map-actions">
                <button type="button" className="of-text-button" onClick={() => setStep(2)} data-testid="map-back-scope"><ArrowLeft size={16} /> Изменить масштаб</button>
                <button type="button" className="of-primary" onClick={() => {
                  if (scope === 'single' && selectedIds.length !== 1) { setScopeError('Для одного участка выберите ровно один процесс.'); return; }
                  if (scope === 'multiple' && selectedIds.length < 1) { setScopeError('Отметьте хотя бы один рабочий участок.'); return; }
                  setScopeError('');
                  setStep(4);
                }} data-testid="map-build-project">Собрать сводку <ArrowRight size={18} /></button>
              </div>
              <p className="of-map-caveat">Это карта направлений для изучения, а не подтверждение возможностей конкретного решения.</p>
            </>}
          </div>}

          {step === 4 && <div className="of-screen" data-testid="project-map">
            <button type="button" className="of-back" onClick={backToMapFromSummary} data-testid="project-map-back"><ArrowLeft size={17} /> Назад к карте работ</button>
            <div className="of-eyebrow">ПРОЕКТНАЯ КАРТА · ЛОКАЛЬНАЯ СВОДКА</div>
            <h2>{objectLabel}: {scopeText[scope ?? 'unsure'].toLocaleLowerCase('ru-RU')}</h2>
            <p className="of-lede">{scope === 'whole'
              ? 'Весь объект остаётся в охвате. Карта фиксирует перечисленные рабочие зоны; при необходимости список можно расширить.'
              : scope === 'unsure'
                ? 'Масштаб пока не определён. Это направления для изучения, а не рекомендация автоматизировать их все.'
                : scope === 'single'
                  ? 'Карта ограничена одним выбранным участком.'
                  : 'В карту включены отмеченные участки.'}</p>
            <div className="of-project-summary" data-testid="project-map-summary">
              <div className="of-project-summary-head"><strong>{scope === 'unsure' ? 'Направления для изучения' : 'Участки в карте'}</strong><span>{projectProcesses.length}</span></div>
              {projectProcesses.length === 0 ? <div className="of-empty-map">Пока ничего не выбрано. Вернитесь к карте, чтобы добавить рабочий участок или создать свой.</div> :
                projectProcesses.map(item => {
                  const saved = details[item.id];
                  const fieldList = fieldsForProcess(item.kind);
                  const knownCount = saved ? fieldList.filter(field => {
                    return !saved.unknown[field.key] && hasValidAnswer(field, saved.values[field.key]);
                  }).length : 0;
                  const unknownCount = saved ? fieldList.filter(field => saved.unknown[field.key]).length : 0;
                  const invalidCount = saved ? fieldList.filter(field => !saved.unknown[field.key] && saved.values[field.key]?.trim() && !hasValidAnswer(field, saved.values[field.key])).length : 0;
                  const missingCount = fieldList.length - knownCount - unknownCount - invalidCount;
                  return <div className="of-project-row" key={item.id}>
                    <div className="of-project-row-copy"><strong>{item.name}</strong><span>{item.summary}</span><small>Известно: {knownCount} · неизвестно: {unknownCount} · не заполнено: {missingCount}{invalidCount > 0 && ` · нужно исправить: ${invalidCount}`}</small></div>
                    <button type="button" className="of-edit-process" onClick={() => { setStep(3); openProcess(item); }} data-testid={`project-edit-${item.id}`}>Уточнить <ChevronRight size={16} /></button>
                  </div>;
                })}
            </div>
            <div className="of-project-unknown"><strong>Что это даёт</strong><p>Зафиксированы охват и известные вводные. Конкретные условия уточняются внутри каждого участка; эта сводка не делает вывод о возможности автоматизации. Каталог, стоимость и экономика здесь не рассчитываются.</p></div>
            <div className="of-summary-actions">
              <button type="button" className="of-secondary" onClick={backToMapFromSummary} data-testid="project-edit-map">Вернуться к карте</button>
              <button type="button" className="of-primary" onClick={resetProject} data-testid="object-restart"><RotateCcw size={17} /> Начать новую карту</button>
            </div>
          </div>}

          {objectChangeOpen && <div className="of-confirm-backdrop" role="presentation">
            <div className="of-confirm" role="alertdialog" aria-labelledby="of-confirm-title" aria-describedby="of-confirm-text">
              <div className="of-confirm-icon"><X size={20} /></div>
              <h3 id="of-confirm-title">Сменить объект?</h3>
              <p id="of-confirm-text">Вводные, выбранные участки и пользовательские зоны относятся к текущей площадке и будут сброшены.</p>
              <div><button type="button" className="of-secondary" onClick={() => setObjectChangeOpen(false)} data-testid="object-change-cancel">Остаться</button><button type="button" className="of-primary" onClick={confirmObjectChange} data-testid="object-change-confirm">Сменить объект</button></div>
            </div>
          </div>}
        </section>
      </div>
    </main>
  );
}
