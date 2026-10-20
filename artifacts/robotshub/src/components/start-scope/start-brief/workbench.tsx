import { useState } from 'react';
import { CheckCircle2, ChevronDown, CopyPlus, Trash2 } from 'lucide-react';
import type { SiteProcess } from '@/lib/start-processes';
import { workbenchUnit } from '@/lib/start-workbench';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import WorkbenchField from './workbench-field';
import WorkbenchKpis from './workbench-kpis';
import WorkbenchCompare from './workbench-compare';
import { ADVANCED_FIELDS, FLOW_FIELDS, LABOR_FIELDS, num, toTexts, type WbField } from './workbench-fields';
import { MAX_VARIANTS, type useWorkbench } from './use-workbench';

type Wb = ReturnType<typeof useWorkbench>;

export default function Workbench({ wb, process, readOnly }: { wb: Wb; process: SiteProcess; readOnly?: boolean }) {
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const unit = workbenchUnit(process);
  const sel = wb.selected;
  if (!sel) return null;
  const t = wb.texts[sel.id] ?? toTexts(sel.inputs);
  const errs = wb.parsed[sel.id]?.errors ?? {};
  const result = wb.results[sel.id];
  const inputs = wb.parsed[sel.id]?.inputs;
  const field = (f: WbField) => <WorkbenchField key={f.key} field={f} unit={unit} value={t[f.key] ?? ''} error={errs[f.key]} onChange={v => wb.edit(f.key, v)} />;
  const unitNote = process.kind === 'cleaning' ? 'м² убранной площади в час' : process.kind === 'inspection' ? 'проверок в час' : process.kind === 'picking'
    ? 'перемещений тары/тележек в час — только транспорт, не захват отдельных товаров' : 'перемещений в час';
  const confirmVariant = wb.plan.variants.find(v => v.id === confirmId);

  return <section className="wb" data-testid="workbench">
    <div className="wb-head">
      <div>
        <div className="sb-kicker">ПУЛЬТ СЦЕНАРИЯ · {process.name.toLocaleUpperCase('ru-RU')}</div>
        <h3>Сколько роботов, во что обойдутся и когда вернут деньги</h3>
      </div>
      <span className={`wb-status ${wb.approved ? 'ok' : ''}`} data-testid="workbench-status">
        {wb.approved ? <><CheckCircle2 size={15} /> Утверждено для задания</> : wb.allValid ? 'Черновик · не утверждён' : 'Есть ошибки ввода'}
      </span>
    </div>
    <p className="wb-fine">Предварительный сценарий: цены, производительность и высвобождение труда — допущения до проверки, не подтверждённые данные вашей площадки.</p>

    <div className="wb-variants" role="tablist" aria-label="Варианты сценария">
      {wb.plan.variants.map(v => <div key={v.id} className={`wb-variant ${v.id === sel.id ? 'on' : ''} ${wb.parsed[v.id]?.inputs ? '' : 'bad'}`} data-testid={`workbench-variant-${v.id}`}>
        {v.id === sel.id
          ? <input value={v.name} maxLength={60} aria-label="Название варианта" onChange={e => wb.rename(v.id, e.target.value)} data-testid={`workbench-rename-${v.id}`} />
          : <button type="button" role="tab" aria-selected={false} onClick={() => wb.select(v.id)} data-testid={`workbench-select-${v.id}`}>{v.name || 'Без названия'}</button>}
        {wb.plan.variants.length > 1 && <button type="button" className="wb-del" aria-label={`Удалить ${v.name}`} onClick={() => setConfirmId(v.id)} data-testid={`workbench-delete-${v.id}`}><Trash2 size={14} /></button>}
      </div>)}
      <button type="button" className="wb-add" onClick={wb.copy} disabled={wb.plan.variants.length >= MAX_VARIANTS} data-testid="workbench-copy">
        <CopyPlus size={15} /> Копия варианта {wb.plan.variants.length}/{MAX_VARIANTS}
      </button>
    </div>

    <WorkbenchKpis result={result} unit={unit} />
    {wb.plan.variants.some(v => !v.name.trim()) && <p className="sv-warn" role="alert">У каждого варианта должно быть название. Пустое название не сохраняется и блокирует утверждение.</p>}
    {result && <p className="wb-verdict" data-testid="workbench-verdict">{result.verdict}</p>}
    {result && !result.meetsDemand && <p className="sv-warn" data-testid="workbench-undercapacity">Мощность {num(result.capacityPerHour)} {unit}, требуется с резервом {num(result.peakDemandPerHour)} {unit}. Окупаемость не подтверждена.</p>}
    {result && <p className="wb-fine">Объём за смену: {num(result.operationsPerShift)}. Годовое рабочее окно: {num(result.annualOperatingHours)} ч. Поток в час задаётся отдельно от длительности смены.</p>}

    <div className="wb-cols">
      <fieldset className="wb-group"><legend>Поток и парк <small>· {unitNote}</small></legend>{FLOW_FIELDS.map(field)}</fieldset>
      <fieldset className="wb-group"><legend>Люди и деньги <small>· человеко-часы</small></legend>{LABOR_FIELDS.map(field)}</fieldset>
    </div>
    <details className="wb-adv" open={Object.keys(errs).some(k => ADVANCED_FIELDS.some(f => f.key === k)) || undefined}>
      <summary><ChevronDown size={15} /> Режим работы, зарядка, сервис, энергия</summary>
      <div className="wb-adv-grid">{ADVANCED_FIELDS.map(field)}</div>
    </details>

    <details className="wb-adv">
      <summary><ChevronDown size={15} /> Методика и оговорки</summary>
      <div className="wb-method">
        <p><b>Потребность</b> = нагрузка × (1 + резерв) ÷ (производительность × загрузка × доля времени без зарядки), где доля = заряд ÷ (заряд + зарядка).</p>
        <p><b>CAPEX</b> = роботы × цена + фиксированная интеграция. <b>OPEX</b> = стоимость оборудования × сервис% + энергия и прочее.</p>
        <p><b>Чистая экономия</b> = чел·ч/смену × доля высвобождения × покрытие среднего потока × смены × ставка × доля в деньги − OPEX. <b>Окупаемость</b> = CAPEX ÷ положительная чистая экономия; нет — если экономия ≤ 0 или парк не покрывает пик с резервом. Зарядка учитывается усреднённым непрерывным циклом; планировка и фактическое расписание здесь не моделируются.</p>
        {inputs && result && <p>Высвобождение: {num(result.freedHoursPerShift)} чел·ч/смену, {num(result.annualFreedHours)} чел·ч/год — это время людей, не время работы роботов. Предел затрат за {num(inputs.targetYears)} г.: {Math.round(result.maxOwnershipBudgetRub).toLocaleString('ru-RU')} ₽.</p>}
        <p className="wb-fine">Значения по умолчанию — явные иллюстративные допущения, не данные производителей и не прогноз для вашей площадки. Площадь объекта не определяет ни поток, ни численность персонала.</p>
      </div>
    </details>

    <div className="wb-section-title">Сравнение вариантов</div>
    <WorkbenchCompare plan={wb.plan} validInputs={wb.results} unit={unit} />

    <div className="wb-approve">
      <p>{wb.approved ? 'Выбранный вариант и сравнение зафиксированы для задания. Любое изменение снимет утверждение.' : 'Утверждение фиксирует выбранный вариант и альтернативы для DOCX.'}{readOnly && ' В просмотре по ссылке утверждение действует только в этой вкладке.'}</p>
      <button type="button" className="of-primary" onClick={wb.approve} disabled={!wb.allValid || wb.approved} data-testid="workbench-approve">
        <CheckCircle2 size={17} /> Утвердить для задания
      </button>
    </div>

    <AlertDialog open={!!confirmId} onOpenChange={o => { if (!o) setConfirmId(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>Удалить вариант «{confirmVariant?.name}»?</AlertDialogTitle>
          <AlertDialogDescription>Параметры этого варианта будут потеряны, утверждение сравнения снимется.</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel data-testid="workbench-delete-cancel">Оставить</AlertDialogCancel>
          <AlertDialogAction onClick={() => { if (confirmId) wb.remove(confirmId); setConfirmId(null); }} data-testid="workbench-delete-confirm">Удалить</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </section>;
}
