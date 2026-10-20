import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Building2, Check, ChevronRight, Factory, Hospital, MapPin, Plane, Plus, RotateCcw, Warehouse } from 'lucide-react';
import { fieldsForProcess, objectProcesses, type DetailField, type ProcessKind, type SiteProcess } from '@/lib/start-processes';
import { readStartScopeDraft, saveStartScopeDraft, startScopeObjectLabel, startScopeProcesses, START_SCOPE_LABELS, type StartScopeDraft } from '@/lib/start-scope';
import { decodeStartBriefHash } from '@/lib/start-brief';
import StartBrief from './start-brief';
import type { StartValueInputs } from '@/lib/start-value';
import type { WorkbenchPlan } from '@/lib/start-workbench';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import './start-scope.css';

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
  { id: 'whole', title: 'Весь объект', description: 'Сразу увидеть типовой разбор. Заполнять вводные по всем зонам не нужно.' },
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

export default function StartScopePage() {
  const [restored] = useState(readStartScopeDraft);
  const draft = restored.draft;
  const workspace = useRef<HTMLElement>(null);
  const mounted = useRef(false);
  const saveMounted = useRef(false);
  const [step, setStep] = useState<1 | 2 | 3 | 4>(() => (draft?.step === 3 && !draft.activeProcess && (draft.scope === 'whole' || draft.scope === 'unsure')) ? 4 : draft?.step ?? 1);
  const [objectId, setObjectId] = useState<ObjectId | null>(draft?.objectId ?? null);
  const [customObject, setCustomObject] = useState(draft?.customObject ?? '');
  const [scope, setScope] = useState<Scope | null>(draft?.scope ?? null);
  const [processes, setProcesses] = useState<SiteProcess[]>(draft?.processes ?? []);
  const [selectedIds, setSelectedIds] = useState<string[]>(draft?.selectedIds ?? []);
  const [details, setDetails] = useState<ProcessDetails>(draft?.details ?? {});
  const [activeProcess, setActiveProcess] = useState<string | null>(draft?.activeProcess ?? null);
  const restoredDetail = draft?.activeProcess ? draft.details[draft.activeProcess] : null;
  const [values, setValues] = useState<FieldValues>(restoredDetail?.values ?? {});
  const [unknown, setUnknown] = useState<Record<string, boolean>>(restoredDetail?.unknown ?? {});
  const [customProcessName, setCustomProcessName] = useState('');
  const [customCounter, setCustomCounter] = useState(
    Math.max(0, ...(draft?.processes ?? []).filter(item => item.kind === 'custom').map(item => Number(item.id.slice(7)))),
  );
  const [errors, setErrors] = useState<string[]>([]);
  const [objectChangeOpen, setObjectChangeOpen] = useState(false);
  const [pendingObjectId, setPendingObjectId] = useState<ObjectId | null>(null);
  const [scopeError, setScopeError] = useState('');
  const [detailSaved, setDetailSaved] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [storageAvailable, setStorageAvailable] = useState(true);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [valueScenarios, setValueScenarios] = useState<Record<string, StartValueInputs>>(draft?.valueScenarios ?? {});
  const [valueFocusId, setValueFocusId] = useState<string | undefined>(draft?.valueFocusId);
  const [workbenchPlans, setWorkbenchPlans] = useState<Record<string, WorkbenchPlan>>(draft?.workbenchPlans ?? {});
  const readShared = (): { draft: StartScopeDraft | null; error: string | null } => {
    const hash = typeof window === 'undefined' ? '' : window.location.hash;
    if (!hash || hash.length < 2) return { draft: null, error: null };
    try {
      const value = decodeStartBriefHash(hash);
      return value ? { draft: value, error: null } : { draft: null, error: null };
    } catch (error) {
      return { draft: null, error: `Не удалось открыть разбор${error instanceof Error && error.message ? `: ${error.message}` : ''}. Ваш черновик не изменён.` };
    }
  };
  const [shared, setShared] = useState(readShared);
  const [viewShared, setViewShared] = useState(!!shared.draft);
  useEffect(() => {
    const refreshShared = () => {
      const next = readShared();
      setShared(next);
      setViewShared(!!next.draft);
    };
    const events = ['hashchange', 'popstate', 'pushState', 'replaceState'] as const;
    events.forEach(event => window.addEventListener(event, refreshShared));
    return () => events.forEach(event => window.removeEventListener(event, refreshShared));
  }, []);
  const [acceptOpen, setAcceptOpen] = useState(false);
  const clearHash = () => { try { window.history.replaceState(null, '', window.location.pathname + window.location.search); } catch { /* ignore */ } };
  const acceptShared = () => {
    const d = shared.draft; if (!d) return;
    setAcceptOpen(false);
    setStep(4); setObjectId(d.objectId); setCustomObject(d.customObject); setScope(d.scope);
    setProcesses(d.processes); setSelectedIds(d.selectedIds); setDetails(d.details);
    setValueScenarios(d.valueScenarios ?? {}); setValueFocusId(d.valueFocusId); setWorkbenchPlans(d.workbenchPlans ?? {});
    setActiveProcess(null); setValues({}); setUnknown({}); setErrors([]); setDetailSaved(false); setSavedNotice(null);
    setCustomCounter(Math.max(0, ...d.processes.filter(item => item.kind === 'custom').map(item => Number(item.id.slice(7)))));
    setViewShared(false); clearHash();
  };

  useEffect(() => {
    // Opening a link is read-only. Persist only an intentional local action.
    if (!saveMounted.current) { saveMounted.current = true; return; }
    if (viewShared) return;
    setStorageAvailable(saveStartScopeDraft({
      version: 1, step, objectId, customObject, scope, processes, selectedIds, details, activeProcess, valueScenarios, valueFocusId, workbenchPlans,
    }));
  }, [step, objectId, customObject, scope, processes, selectedIds, details, activeProcess, valueScenarios, valueFocusId, workbenchPlans, viewShared]);

  useEffect(() => {
    if (!mounted.current) { mounted.current = true; return; }
    workspace.current?.focus({ preventScroll: true });
    workspace.current?.scrollIntoView({ block: 'start', behavior: 'instant' });
  }, [step, activeProcess]);

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
    setValueScenarios({});
    setValueFocusId(undefined);
    setWorkbenchPlans({});
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
    setSavedNotice(null);
    setStep(scope === 'whole' || scope === 'unsure' ? 4 : 3);
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
    setActiveProcess(null);
    setValues({});
    setUnknown({});
    setSavedNotice(`Вводные по участку «${currentProcess.name}» сохранены${storageAvailable ? ' в браузере' : ' только в этой вкладке'}. Неизвестные поля не считаются нулём.`);
    setStep(scope === 'single' && selectedIds.length !== 1 || scope === 'multiple' && selectedIds.length < 2 ? 3 : 4);
  };

  const openProcess = (item: SiteProcess) => {
    const stored = details[item.id];
    setActiveProcess(item.id);
    setValues(stored?.values ?? {});
    setUnknown(stored?.unknown ?? {});
    setErrors([]);
    setDetailSaved(false);
    setSavedNotice(null);
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
    if (processes.length >= 80) {
      setErrors(['В одной карте можно сохранить до 80 участков.']);
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
  const currentDraft: StartScopeDraft = { version: 1, step, objectId, customObject, scope, processes, selectedIds, details, activeProcess, valueScenarios, valueFocusId, workbenchPlans };
  const requestObjectChange = () => {
    setPendingObjectId(null);
    setObjectChangeOpen(true);
  };
  const confirmObjectChange = () => {
    const nextObject = pendingObjectId;
    setObjectChangeOpen(false);
    setPendingObjectId(null);
    setStep(nextObject && nextObject !== 'other' ? 2 : 1);
    setObjectId(nextObject);
    setCustomObject('');
    setScope(null);
    setProcesses(nextObject && nextObject !== 'other' ? objectProcesses[nextObject] : []);
    setSelectedIds([]);
    setDetails({});
    setValueScenarios({});
    setValueFocusId(undefined);
    setWorkbenchPlans({});
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
    <div className="of-page" data-testid="page-start">
      <div className={`of-shell ${step === 4 && !activeProcess || viewShared ? 'of-result' : ''}`}>
        <aside className="of-side">
          <div className="of-overline">ПЕРВИЧНАЯ ОЦЕНКА</div>
          <h1>Сначала<br />ваша площадка.</h1>
          <p>Разберём рабочие процессы, прежде чем обсуждать отдельные решения.</p>
          <nav className="of-steps" aria-label="Этапы">
            {([
              ['01', 'Объект', 1],
              ['02', 'Масштаб', 2],
              ['03', 'Результат', 3],
            ] as const).map(([number, label, index]) => {
              const at = viewShared || step >= 3 ? 3 : step;
              return <div className={`of-step ${at === index ? 'current' : at > index ? 'done' : ''}`} key={number} data-testid={`object-step-${index}`}>
                <span>{at > index ? <Check size={15} /> : number}</span>{label}
              </div>;
            })}
          </nav>
          <div className="of-side-note"><i /> {storageAvailable ? 'Карта сохраняется в этом браузере. Ваш расчёт не меняется.' : 'Хранилище недоступно: карта останется только до закрытия страницы.'}</div>
        </aside>

        <section className="of-workspace" ref={workspace} tabIndex={-1} aria-label="Составление карты задачи">
          <div className="of-topline">
            <div className="of-progress"><span style={{ width: `${(viewShared ? 3 : Math.min(step, 3)) * 33.4}%` }} /></div>
            <span>{viewShared ? 'ШАГ 03 / 03 · ПРОСМОТР РЕЗУЛЬТАТА' : step === 3 && !activeProcess ? 'ШАГ 03 / 03 · ВЫБОР УЧАСТКОВ' : `ШАГ ${String(Math.min(step, 3)).padStart(2, '0')} / 03`}</span>
          </div>

          {shared.error && <div className="of-errors" role="alert" data-testid="shared-brief-error">{shared.error}</div>}
          {viewShared && shared.draft ? <div className="of-screen" data-testid="shared-brief">
            <div className="of-eyebrow">РАЗБОР ПО ССЫЛКЕ · ПРОСМОТР</div>
            <h2>{startScopeObjectLabel(shared.draft)}: {(shared.draft.scope ? START_SCOPE_LABELS[shared.draft.scope] : 'масштаб не определён').toLocaleLowerCase('ru-RU')}</h2>
            <div className="sb-shared-banner">
              <p style={{ margin: 0 }}>Вы открыли разбор по ссылке. Ваш собственный черновик и финансовые расчёты в этом браузере не изменены.</p>
              <div className="of-summary-actions">
                <button type="button" className="of-primary" onClick={() => (step > 1 || objectId ? setAcceptOpen(true) : acceptShared())} data-testid="shared-brief-accept">Продолжить с этим разбором</button>
                <button type="button" className="of-secondary" onClick={() => { setViewShared(false); clearHash(); }} data-testid="shared-brief-close">Вернуться к своему черновику</button>
              </div>
            </div>
            <StartBrief draft={shared.draft} objectId={shared.draft.objectId} objectLabel={startScopeObjectLabel(shared.draft)} scopeLabel={shared.draft.scope ? START_SCOPE_LABELS[shared.draft.scope] : 'Масштаб не определён'} processes={startScopeProcesses(shared.draft)} readOnly />
          </div> : <>
          {restored.warning && <div className="of-errors" role="alert">{restored.warning}</div>}
          {!storageAvailable && <div className="of-errors" role="alert" data-testid="start-scope-storage-error">Не удалось сохранить карту. Не закрывайте страницу, если хотите оставить введённые данные. Финансовый расчёт не изменён.</div>}
          {step === 1 && <div className="of-screen" data-testid="object-screen">
            <div className="of-eyebrow">ФИЗИЧЕСКИЙ ОБЪЕКТ</div>
            <h2>Какую площадку разбираем?</h2>
            <p className="of-lede">Выберите место, где идут процессы. Отрасль компании можно уточнить позже.</p>
            <div className="of-object-grid">
              {sites.map(item => {
                const Icon = item.icon;
                return <button type="button" key={item.id} aria-pressed={objectId === item.id} className={`of-object-card ${objectId === item.id ? 'selected' : ''}`} onClick={() => {
                  if (objectId && item.id !== objectId && processes.length > 0) {
                    setPendingObjectId(item.id);
                    setObjectChangeOpen(true);
                    return;
                  }
                  setObjectId(item.id);
                  if (item.id !== 'other') setCustomObject('');
                  setErrors([]);
                  if (item.id !== 'other') {
                    if (!processes.length) {
                      setProcesses(objectProcesses[item.id]);
                      setSelectedIds([]);
                      setScope(null);
                    }
                    setStep(2);
                  }
                }} data-testid={`object-${item.id}`}>
                  <span className="of-object-icon"><Icon size={21} /></span>
                  <span className="of-object-text"><strong>{item.title}</strong><small>{item.short}</small></span>
                  <span className="of-select-dot">{objectId === item.id && <i />}</span>
                </button>;
              })}
            </div>
            {objectId === 'other' && <label className="of-custom-object">Как называется или устроена площадка?
              <input value={customObject} maxLength={160} onChange={event => { setCustomObject(event.target.value); setErrors([]); }} disabled={processes.length > 0} placeholder="Например, кампус или распределительный центр" data-testid="object-custom-name" />
            </label>}
            <p className="of-after-list">Другой тип объекта? Выберите «Другой объект» и назовите его.</p>
            {errors.length > 0 && <div className="of-errors" role="alert">{errors.map(error => <p key={error}>{error}</p>)}</div>}
            <div className="of-actions of-object-actions"><span>Нажмите на объект — далее выберете его целиком или отдельные процессы.</span>{objectId === 'other' && <button className="of-primary" type="button" onClick={continueObject} data-testid="object-continue">Продолжить <ArrowRight size={18} /></button>}</div>
          </div>}

          {step === 2 && <div className="of-screen" data-testid="scope-screen">
            <button type="button" className="of-back" onClick={() => { setStep(1); setErrors([]); }} data-testid="scope-back-object"><ArrowLeft size={17} /> К объекту</button>
            <div className="of-eyebrow">{objectLabel.toLocaleUpperCase('ru-RU')}</div>
            <h2>Какой масштаб задачи?</h2>
            <p className="of-lede">Можно начать с площадки целиком — знать отдельные операции заранее не нужно.</p>
            <div className="of-scope-list">
              {scopeOptions.map(item => <button type="button" key={item.id} aria-pressed={scope === item.id} className={`of-scope-card ${scope === item.id ? 'selected' : ''}`} onClick={() => chooseScope(item.id)} data-testid={`scope-${item.id}`}>
                <span className="of-scope-radio">{scope === item.id && <i />}</span>
                <span><strong>{item.title}</strong><small>{item.description}</small></span>
                {item.id === 'whole' && <span className="of-scope-badge">{processList.length} процессов</span>}
              </button>)}
            </div>
            {scopeError && <div className="of-errors" role="alert"><p>{scopeError}</p></div>}
            <div className="of-actions">
              <button type="button" className="of-text-button" onClick={requestObjectChange} data-testid="object-change">Изменить объект</button>
              <button className="of-primary" type="button" onClick={continueScope} data-testid="scope-continue">{scope === 'whole' || scope === 'unsure' ? 'Показать результат' : 'Выбрать участки'} <ArrowRight size={18} /></button>
            </div>
          </div>}

          {(step === 3 || (step === 4 && activeProcess && currentProcess)) && <div className="of-screen" data-testid={step === 4 ? 'process-detail-screen' : 'process-map-screen'}>
            {activeProcess && currentProcess ? <div className="of-detail" data-testid={`process-detail-${currentProcess.id}`}>
              <button type="button" className="of-back" onClick={closeProcess} data-testid="process-detail-back"><ArrowLeft size={17} /> {step === 4 ? 'Назад к результату' : 'Назад к карте работ'}</button>
              <div className="of-detail-top">
                <span className="of-detail-label">УЧАСТОК / {objectLabel.toLocaleUpperCase('ru-RU')}</span>
                {details[currentProcess.id] && <span className="of-saved-state"><Check size={14} /> {storageAvailable ? 'Черновик в браузере' : 'Черновик в этой вкладке'}</span>}
              </div>
              <h2>{currentProcess.name}</h2>
              <p className="of-lede">{currentProcess.summary}. {currentProcess.focus}</p>
              <div className="of-detail-note"><strong>Что важно понять здесь</strong><p>{kindHelp[currentProcess.kind]}</p></div>
              <div className="of-detail-fields">
                {detailFields.map((field: DetailField) => <div className="of-field" key={field.key}>
                  <label htmlFor={`of-${currentProcess.id}-${field.key}`}>{field.label}{field.unit && <span> · {field.unit}</span>}</label>
                  <input id={`of-${currentProcess.id}-${field.key}`} value={values[field.key] ?? ''} maxLength={4000} onChange={event => editField(field.key, event.target.value)} inputMode={field.numeric ? 'decimal' : 'text'} placeholder={unknown[field.key] ? 'Пока неизвестно' : field.placeholder} disabled={unknown[field.key]} data-testid={`process-input-${currentProcess.id}-${field.key}`} />
                  <button type="button" className={`of-unknown ${unknown[field.key] ? 'active' : ''}`} onClick={() => toggleUnknown(field.key)} data-testid={`process-unknown-${currentProcess.id}-${field.key}`}><span>{unknown[field.key] ? '✓' : '+'}</span> Пока неизвестно</button>
                </div>)}
              </div>
              {errors.length > 0 && <div className="of-errors" role="alert">{errors.map(error => <p key={error}>{error}</p>)}</div>}
              {detailSaved && <div className="of-saved-message" data-testid="process-detail-saved">Вводные проверены. {storageAvailable ? 'Черновик сохранён в браузере.' : 'Сохранение недоступно — данные пока только в этой вкладке.'} Неизвестные поля не считаются нулём.</div>}
              <div className="of-actions">
                <span>Можно сохранить только то, что уже известно.</span>
                <button type="button" className="of-primary" onClick={saveDetail} data-testid="process-detail-save">Сохранить и вернуться <Check size={18} /></button>
              </div>
            </div> : <>
              <div className="of-map-head">
                <div>
                  <div className="of-eyebrow">КАРТА РАБОТ · {objectLabel.toLocaleUpperCase('ru-RU')}</div>
                  <h2>{scope === 'whole' ? 'Карта процессов всего объекта' : scope === 'single' ? 'Выберите участок' : 'Отметьте рабочие участки'}</h2>
                  <p className="of-lede">{scope === 'whole'
                    ? 'Охват — весь объект. Это стартовый перечень направлений: добавьте свои зоны, если их нет на карте. Открытие участка не сужает охват.'
                    : scope === 'single'
                      ? 'В карту войдёт один выбранный участок. Откройте карточку, чтобы уточнить его вводные.'
                      : scope === 'multiple'
                        ? 'Выберите несколько участков. В карту попадут все отмеченные процессы.'
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
                    <button type="button" className="of-process-open" onClick={() => toggleProcess(item.id)} data-testid={`process-open-${item.id}`}>
                      <span className="of-process-title">{item.name}<ChevronRight size={18} /></span>
                      <span className="of-process-summary">{item.summary}</span>
                      <span className="of-process-meta">{details[item.id] ? 'Есть сохранённые вводные' : selected ? 'Включено в разбор' : 'Нажмите, чтобы включить в разбор'}</span>
                    </button>
                    <button type="button" disabled={scope === 'whole'} className={`of-select-process ${selected ? 'selected' : ''} ${scope === 'whole' ? 'locked' : ''}`} onClick={() => toggleProcess(item.id)} aria-pressed={selected} aria-label={scope === 'whole' ? `Включено в охват всего объекта: ${item.name}` : `${selected ? 'Убрать из' : 'Добавить в'} карту: ${item.name}`} data-testid={`process-select-${item.id}`}>
                      {selected ? <Check size={17} /> : <Plus size={17} />}
                      <span>{scope === 'whole' ? 'Весь объект' : selected ? 'В карте' : scope === 'single' ? 'Выбрать участок' : 'Добавить участок'}</span>
                    </button>
                  </article>;
                })}
              </div>
              <div className="of-add-process">
                <div><strong>Нужен свой рабочий участок?</strong><p>Добавьте его в карту — пресет не ограничивает состав объекта.</p></div>
                <div className="of-add-row"><input value={customProcessName} maxLength={160} aria-label="Название своего участка" onChange={event => setCustomProcessName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addCustomProcess(); } }} placeholder="Название участка или процесса" data-testid="custom-process-name" /><button type="button" onClick={addCustomProcess} aria-label="Добавить рабочую зону" data-testid="process-add-custom"><Plus size={18} /> Добавить</button></div>
              </div>
              {errors.length > 0 && <div className="of-errors" role="alert">{errors.map(error => <p key={error}>{error}</p>)}</div>}
              {scopeError && <div className="of-errors" role="alert"><p>{scopeError}</p></div>}
              <div className="of-actions of-map-actions">
                <button type="button" className="of-text-button" onClick={() => setStep(2)} data-testid="map-back-scope"><ArrowLeft size={16} /> Изменить масштаб</button>
                <button type="button" className="of-primary" onClick={() => {
                  if (scope === 'single' && selectedIds.length !== 1) { setScopeError('Для одного участка выберите ровно один процесс.'); return; }
                  if (scope === 'multiple' && selectedIds.length < 2) { setScopeError('Отметьте хотя бы два участка или выберите масштаб «Один участок».'); return; }
                  setScopeError('');
                  setStep(4);
                  setSavedNotice(null);
                }} data-testid="map-build-project">Показать результат <ArrowRight size={18} /></button>
              </div>
              <p className="of-map-caveat">Это карта направлений для изучения, а не подтверждение возможностей конкретного решения.</p>
            </>}
          </div>}

          {step === 4 && !activeProcess && <div className="of-screen" data-testid="project-map">
            <button type="button" className="of-back" onClick={() => setStep(scope === 'whole' || scope === 'unsure' ? 2 : 3)} data-testid="project-map-back"><ArrowLeft size={17} /> {scope === 'whole' || scope === 'unsure' ? 'К масштабу' : 'К выбору участков'}</button>
            <div className="of-eyebrow">РЕЗУЛЬТАТ · {objectLabel.toLocaleUpperCase('ru-RU')}</div>
            <h2>Где на объекте искать эффект</h2>
            <p className="of-lede">Выберите процесс на схеме: увидите, какую возможность проверить, на каком экономическом механизме она держится и какие кейсы это подтверждают.</p>
            <StartBrief draft={currentDraft} objectId={objectId} objectLabel={objectLabel} scopeLabel={scopeText[scope ?? 'unsure']} processes={projectProcesses} onRefine={item => openProcess(item)} onWorkbenchChange={(id, plan) => setWorkbenchPlans(current => ({ ...current, [id]: plan }))} onValueFocus={id => setValueFocusId(id)} savedNotice={savedNotice} />
            <div className="of-summary-actions">
              <button type="button" className="of-secondary" onClick={() => setStep(3)} data-testid="project-edit-map">Изменить состав участков</button>
              <button type="button" className="of-text-button" onClick={requestObjectChange} data-testid="object-change-result">Изменить объект</button>
              <button type="button" className="of-text-button" onClick={() => setResetOpen(true)} data-testid="object-restart"><RotateCcw size={17} /> Новая карта</button>
            </div>
          </div>}
          </>}

          <AlertDialog open={acceptOpen} onOpenChange={setAcceptOpen}>
            <AlertDialogContent>
              <AlertDialogHeader><AlertDialogTitle>Заменить текущий черновик?</AlertDialogTitle><AlertDialogDescription>В этом браузере уже есть черновик карты. Он будет заменён разбором из ссылки. Финансовые расчёты не изменятся.</AlertDialogDescription></AlertDialogHeader>
              <AlertDialogFooter><AlertDialogCancel data-testid="shared-brief-accept-cancel">Оставить свой</AlertDialogCancel><AlertDialogAction onClick={acceptShared} data-testid="shared-brief-accept-confirm">Заменить</AlertDialogAction></AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <AlertDialog open={objectChangeOpen} onOpenChange={setObjectChangeOpen}>
            <AlertDialogContent>
              <AlertDialogHeader><AlertDialogTitle>Сменить объект?</AlertDialogTitle><AlertDialogDescription>Вводные, выбранные участки и пользовательские зоны этой карты будут сброшены. Финансовый расчёт не изменится.</AlertDialogDescription></AlertDialogHeader>
              <AlertDialogFooter><AlertDialogCancel data-testid="object-change-cancel">Остаться</AlertDialogCancel><AlertDialogAction onClick={confirmObjectChange} data-testid="object-change-confirm">Сменить объект</AlertDialogAction></AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
            <AlertDialogContent>
              <AlertDialogHeader><AlertDialogTitle>Начать новую карту?</AlertDialogTitle><AlertDialogDescription>Текущий черновик карты и все вводные участков будут удалены из этого браузера. Финансовый расчёт не изменится.</AlertDialogDescription></AlertDialogHeader>
              <AlertDialogFooter><AlertDialogCancel data-testid="start-scope-reset-cancel">Оставить карту</AlertDialogCancel><AlertDialogAction onClick={() => { setResetOpen(false); resetProject(); }} data-testid="start-scope-reset-confirm">Начать заново</AlertDialogAction></AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </section>
      </div>
    </div>
  );
}
