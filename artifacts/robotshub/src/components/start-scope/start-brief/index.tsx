import { useEffect, useMemo, useState } from 'react';
import { Link } from 'wouter';
import { ArrowRight, BookOpen, Check, ChevronDown, Copy, Download, Pencil } from 'lucide-react';
import { briefForProcess, createStartBriefUrl } from '@/lib/start-brief';
import { fieldsForProcess, type SiteProcess } from '@/lib/start-processes';
import { ROBOTSHUB_PUBLIC_ORIGIN } from '@/lib/project-sharing';
import type { StartObjectId, StartScopeDraft } from '@/lib/start-scope';
import { processDivision } from '@/lib/start-value';
import type { WorkbenchPlan } from '@/lib/start-workbench';
import { generateStartWorkbenchDocx } from '@/lib/start-value-docx';
import { CASES } from '@/pages/cases';
import Workbench from './workbench';
import { useWorkbench } from './use-workbench';
import './start-brief.css';
import './workbench.css';

type Props = {
  draft: StartScopeDraft;
  objectId: StartObjectId | null;
  objectLabel: string;
  scopeLabel: string;
  processes: SiteProcess[];
  readOnly?: boolean;
  onRefine?: (item: SiteProcess) => void;
  onWorkbenchChange?: (processId: string, plan: WorkbenchPlan) => void;
  onValueFocus?: (processId: string) => void;
  savedNotice?: string | null;
};

export default function StartBrief({ draft, objectId, objectLabel, scopeLabel, processes, readOnly, onRefine, onWorkbenchChange, onValueFocus, savedNotice }: Props) {
  const initialFocus = () => (draft.valueFocusId && processes.some(p => p.id === draft.valueFocusId) ? draft.valueFocusId : null)
    ?? processes.find(item => briefForProcess(objectId, item).evidence.length > 0)?.id ?? processes[0]?.id ?? null;
  const [focusId, setFocusId] = useState<string | null>(initialFocus);
  const focus = processes.find(item => item.id === focusId) ?? processes[0] ?? null;
  const [previewPlans, setPreviewPlans] = useState(draft.workbenchPlans ?? {});
  const sharedInputSignature = readOnly ? JSON.stringify(draft) : '';
  useEffect(() => {
    if (readOnly) setPreviewPlans(draft.workbenchPlans ?? {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sharedInputSignature]);
  const effectiveDraft = readOnly ? { ...draft, workbenchPlans: previewPlans } : draft;
  const wb = useWorkbench(effectiveDraft, focus, readOnly
    ? (id, plan) => setPreviewPlans(current => ({ ...current, [id]: plan }))
    : onWorkbenchChange);
  const [shareUrl, setShareUrl] = useState('');
  const [shareMsg, setShareMsg] = useState('');
  const [shareErr, setShareErr] = useState('');
  const [busy, setBusy] = useState(false);

  const planSig = JSON.stringify(wb.plan);
  useEffect(() => { setShareUrl(''); setShareMsg(''); setShareErr(''); }, [focus?.id, planSig]);
  const sharedSignature = readOnly ? JSON.stringify([draft.objectId, draft.valueFocusId]) : '';
  useEffect(() => {
    if (!readOnly) return;
    setFocusId(draft.valueFocusId && processes.some(item => item.id === draft.valueFocusId) ? draft.valueFocusId : processes[0]?.id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sharedSignature]);

  const division = useMemo(() => focus ? processDivision(focus) : null, [focus]);
  const brief = useMemo(() => focus ? briefForProcess(objectId, focus) : null, [objectId, focus]);
  const saved = focus ? draft.details[focus.id] : undefined;
  const answered = focus && saved ? fieldsForProcess(focus.kind).filter(f => saved.unknown[f.key] || saved.values[f.key]?.trim()) : [];
  const pick = (id: string) => { setFocusId(id); if (!readOnly) onValueFocus?.(id); };
  const selectedInputs = wb.selected ? wb.parsed[wb.selected.id]?.inputs : null;

  const buildUrl = () => {
    if (!focus || !wb.allValid || !selectedInputs) throw new Error('исправьте параметры модели');
    return createStartBriefUrl({
      ...effectiveDraft, workbenchPlans: { ...effectiveDraft.workbenchPlans, [focus.id]: wb.plan }, valueFocusId: focus.id,
      valueScenarios: { ...draft.valueScenarios, [focus.id]: selectedInputs },
    }, ROBOTSHUB_PUBLIC_ORIGIN);
  };
  const download = async () => {
    setShareErr(''); setShareMsg('');
    if (!focus || !wb.approved) return;
    setBusy(true);
    try {
      const url = buildUrl();
      const blob = await generateStartWorkbenchDocx({ draft: effectiveDraft, process: focus, plan: wb.plan, url, logoUrl: `${import.meta.env.BASE_URL}brand/logo.jpg` });
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href; a.download = `robotshub-${focus.id}-zadacha.docx`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(href), 1000);
      setShareMsg('DOCX с выбранным вариантом и сравнением скачан.');
    } catch (error) {
      setShareErr(`Не удалось сформировать DOCX: ${error instanceof Error ? error.message : 'неизвестная ошибка'}.`);
    } finally { setBusy(false); }
  };
  const copy = async () => {
    setShareErr(''); setShareMsg('');
    let url = '';
    try { url = buildUrl(); }
    catch (error) { setShareUrl(''); setShareErr(`Ссылку создать нельзя: ${error instanceof Error ? error.message : 'слишком много данных'}.`); return; }
    setShareUrl(url);
    try {
      if (!navigator.clipboard) throw new Error('no clipboard');
      await navigator.clipboard.writeText(url);
      setShareMsg(`Ссылка скопирована: участок и все варианты${wb.approved ? '' : ' (пока не утверждены)'}.`);
    } catch {
      setShareMsg('Буфер обмена недоступен — скопируйте ссылку из поля ниже.');
    }
  };

  if (!processes.length) return <div className="sb-empty" data-testid="brief-empty">В охвате пока нет участков. Вернитесь к карте и выберите хотя бы один.</div>;

  return <div className="sb" data-testid="start-brief">
    <div className="sb-map" role="group" aria-label="Процессы объекта" data-testid="brief-process-map">
      <div className="sb-map-head"><span>{objectLabel} · охват: {scopeLabel}</span><small>{processes.length} участков · расчёт по одному</small></div>
      <div className="sb-flow">
        {processes.map((item, index) => {
          const has = !!(draft.details[item.id] || draft.valueScenarios?.[item.id] || draft.workbenchPlans?.[item.id]);
          return <button key={item.id} type="button" id={`brief-process-${item.id}`} aria-pressed={focus?.id === item.id}
            className={`sb-node ${focus?.id === item.id ? 'active' : ''} ${has ? 'has-data' : ''}`}
            onClick={() => pick(item.id)} data-testid={`brief-process-${item.id}`}>
            <span className="sb-node-num">{String(index + 1).padStart(2, '0')}</span>
            <span className="sb-node-name">{item.name}</span>
            {has && <Check size={14} aria-label="есть данные" />}
          </button>;
        })}
      </div>
    </div>

    {focus && <Workbench key={focus.id} wb={wb} process={focus} readOnly={readOnly} objectId={objectId} />}

    {focus && brief && division && <article className="sb-panel" data-testid={`brief-panel-${focus.id}`} aria-labelledby={`brief-process-${focus.id}`}>
      <div className="sb-kicker">ГЛУБЖЕ · {focus.name.toLocaleUpperCase('ru-RU')}</div>
      <details className="sv-more"><summary><ChevronDown size={15} /> Что передаётся роботу, а что остаётся человеку</summary><div className="sv-split">
        <div><span>Робот</span><p>{division.robot}</p></div>
        <div><span>Человек</span><p>{division.human}</p></div>
        <div><span>Ограничение</span><p>{division.limitation}</p></div>
      </div></details>
      {answered.length > 0 && saved && <details className="sb-answers" data-testid="brief-answers">
        <summary><ChevronDown size={15} /> Факты об участке ({answered.length})</summary>
        <dl>{answered.map(f => <div key={f.key}><dt>{f.label}</dt><dd>{saved.unknown[f.key] ? 'Пока неизвестно' : `${saved.values[f.key]}${f.unit ? ` ${f.unit}` : ''}`}</dd></div>)}</dl>
      </details>}
      {savedNotice && <p className="sb-saved" role="status" data-testid="brief-saved-notice">{savedNotice}</p>}
      {!readOnly && onRefine && <div className="sb-refine-wrap">
        <button type="button" className="of-secondary sb-refine" onClick={() => onRefine(focus)} data-testid={`brief-refine-${focus.id}`}><Pencil size={16} /> Добавить факты об участке</button>
        <small>Маршрут, смены, ограничения попадут в задание. Параметры верстака не сбрасываются.</small>
      </div>}
      <details className="sb-answers" data-testid="brief-evidence">
        <summary><BookOpen size={15} /> Примеры других площадок ({brief.evidence.length})</summary>
        {brief.evidence.length === 0
          ? <p className="sb-muted" data-testid="brief-no-evidence">Прямой кейс для такого участка пока не подобран. Это не означает, что решений нет.</p>
          : <ul className="sb-evidence">{brief.evidence.map(ev => { const c = CASES.find(item => item.id === ev.caseId); return <li key={ev.caseId}>
            <Link href={`/cases/${ev.caseId}`} className="sb-case" data-testid={`brief-case-${ev.caseId}`}>
              <span>Пример другой площадки, не результат вашего объекта</span>
              {c?.image && <img className="sb-case-image" loading="lazy" decoding="async" src={`${import.meta.env.BASE_URL}assets/cases/${c.image}`} alt={`Инфографика кейса: ${ev.title}`} />}
              <strong>{ev.title}</strong><small>{ev.sourceLabel}</small>
              <span>Посмотреть кейс <ArrowRight size={14} /></span>
            </Link></li>; })}</ul>}
      </details>
      <p className="sb-caveat">Условный расчёт по введённым допущениям. Не инвестиционная рекомендация. Высвобожденное время не становится деньгами само по себе.</p>
    </article>}

    <div className="sb-share" data-testid="brief-share">
      {typeof window !== 'undefined' && !['robotshub.ru', 'www.robotshub.ru'].includes(window.location.hostname) &&
        <p className="sv-warn">Вы в рабочем Preview. Ссылка использует robotshub.ru: чтобы сценарий открывался на публичном сайте, эту версию необходимо опубликовать.</p>}
      <div><strong>Задание и совместный просмотр</strong><p>Ссылка открывает варианты без замены расчётов получателя. DOCX включает утверждённые участки: выбранный вариант и сравнение альтернатив для каждого. Пересекающиеся эффекты не суммируются.</p></div>
      <div className="sb-share-actions">
        <button type="button" className="of-secondary" onClick={download} disabled={!wb.approved || busy} title={wb.approved ? undefined : 'Сначала утвердите вариант'} data-testid="brief-download"><Download size={16} /> {busy ? 'Готовим DOCX…' : 'Скачать DOCX'}</button>
        <button type="button" className="of-secondary" onClick={copy} disabled={!wb.allValid} data-testid="brief-copy-link"><Copy size={16} /> Копировать ссылку</button>
      </div>
      {!wb.approved && <p className="sb-muted">DOCX станет доступен после «Утвердить для задания».</p>}
      {shareMsg && <p className="sb-saved" role="status" data-testid="brief-share-status">{shareMsg}</p>}
      {shareErr && <div className="of-errors" role="alert" data-testid="brief-share-error">{shareErr}</div>}
      {shareUrl && <input className="sb-url" readOnly value={shareUrl} onFocus={e => e.currentTarget.select()} aria-label="Ссылка на разбор" data-testid="brief-share-url" />}
    </div>
  </div>;
}
