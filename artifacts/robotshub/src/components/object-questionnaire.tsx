import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useProject } from '@/store/project';
import { fieldsFor, questionnaireFieldLabel, questionnaireTemplates, type Answers, type QuestionnaireType } from '@/lib/questionnaire-schema';
import { projectFingerprint } from '@/lib/questionnaire-state';
import type { QuestionnaireImport } from '@/lib/questionnaire-xlsx';

type Preview = { imported: QuestionnaireImport; expected: string; current: Answers; draftSignature: string; requestedType: QuestionnaireType };
const show = (value: unknown) => value == null || value === '' ? 'Не указано' : typeof value === 'boolean' ? value ? 'Да' : 'Нет' : String(value);

export function ObjectQuestionnaire({ readCurrent, onApplied }: { readCurrent?: () => Answers; onApplied?: () => void }) {
  const { state, applyQuestionnaire, projectStorageUnavailable } = useProject();
  const [type, setType] = useState<QuestionnaireType>(state.objectType ?? 'warehouse');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [typeConfirmed, setTypeConfirmed] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const current = () => readCurrent?.() ?? state.objectParams;
  const download = async () => {
    setBusy(true); setMessage('');
    try {
      const { createQuestionnaire } = await import('@/lib/questionnaire-xlsx');
      const buffer = await createQuestionnaire(type, state.sectorId);
      const url = URL.createObjectURL(new Blob([new Uint8Array(buffer)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = `Анкета-${questionnaireTemplates[type].name}.xlsx`; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage('Пустая анкета скачана. Проект и выбранный тип объекта не изменены.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Не удалось скачать анкету.'); }
    finally { setBusy(false); }
  };
  const upload = async (file: File) => {
    setBusy(true); setMessage(''); setPreview(null); setConfirmed(false); setTypeConfirmed(false);
    const expected = projectFingerprint(state);
    const draft = { ...current() };
    try {
      if (!/\.xlsx$/i.test(file.name) || file.size > 2 * 1024 * 1024 || !file.size) throw new Error('Выберите непустой XLSX размером до 2 МБ.');
      const { parseQuestionnaire } = await import('@/lib/questionnaire-xlsx');
      const imported = await parseQuestionnaire(await file.arrayBuffer());
      setPreview({ imported, expected, current: draft, draftSignature: JSON.stringify(draft), requestedType: type });
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Не удалось прочитать файл.'); }
    finally { setBusy(false); if (fileInput.current) fileInput.current.value = ''; }
  };
  const imported = preview?.imported;
  const mismatch = !!preview && (preview.requestedType !== imported!.type || !!state.objectType && state.objectType !== imported!.type);
  const stale = !!preview && projectFingerprint(state) !== preview.expected;
  const sectorMismatch = !!imported && imported.sectorId !== state.sectorId;
  const blocked = !imported || imported.errors.length > 0 || imported.missing.length > 0 || sectorMismatch || stale;
  const apply = () => {
    if (!preview || blocked || !confirmed || mismatch && !typeConfirmed) return;
    if (JSON.stringify(current()) !== preview.draftSignature) {
      setPreview(null); setMessage('Форма изменилась после загрузки. Ничего не применено. Загрузите файл повторно для актуального сравнения.'); return;
    }
    try {
      if (!applyQuestionnaire(preview.imported, preview.expected)) throw new Error('Проект изменился. Загрузите файл повторно.');
      setType(preview.imported.type); setPreview(null); setMessage('Анкета применена. Параметры заменены, прежние модели и расчёт сброшены.'); onApplied?.();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Не удалось применить анкету.'); }
  };
  return <Card className="my-6" data-testid="object-questionnaire"><CardContent className="space-y-4 pt-6">
    <h2 className="text-lg font-semibold">Анкета объекта XLSX</h2>
    <p className="text-sm text-muted-foreground">Скачайте пустую анкету для специалиста. Примеры вынесены на отдельный лист. Импорт сначала открывает проверку без изменения проекта. Анкета содержит параметры объекта; данные экономики отдельных операций могут потребоваться позже. Она не подтверждает применимость моделей.</p>
    <div className="flex flex-wrap items-end gap-3">
      <label className="space-y-1 text-sm">Тип анкеты (не меняет проект)
        <select className="block h-10 rounded border bg-background px-3" value={type} onChange={event => setType(event.target.value as QuestionnaireType)} data-testid="questionnaire-type">
          {Object.entries(questionnaireTemplates).map(([key, template]) => <option key={key} value={key}>{template.name}</option>)}
        </select>
      </label>
      <Button variant="outline" disabled={busy} onClick={download} data-testid="questionnaire-download">Скачать пустую XLSX</Button>
      <label className="text-sm">Загрузить заполненную XLSX
        <input ref={fileInput} type="file" accept=".xlsx" disabled={busy} className="block max-w-full text-sm" onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file); }} data-testid="questionnaire-upload" />
      </label>
    </div>
    <p className="text-xs text-muted-foreground">До 2 МБ. Комментарий, источник и дата сохраняются, но не используются в расчёте. Количество этажей поддерживается скалярными параметрами; планы отдельных этажей/зон не импортируются.</p>
    {projectStorageUnavailable && <p role="alert">Хранилище недоступно: изменения могут не сохраниться после перезагрузки.</p>}
    {(busy || message) && <p role="status" data-testid="questionnaire-status">{busy ? 'Обработка XLSX…' : message}</p>}
    <Dialog open={!!preview} onOpenChange={open => { if (!open) { setPreview(null); setMessage('Импорт отменён. Проект и несохранённая форма не изменены.'); } }}>
      <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto" data-testid="questionnaire-preview">
        <DialogHeader><DialogTitle>Проверка анкеты — {imported && questionnaireTemplates[imported.type].name}</DialogTitle><DialogDescription>Ничего ещё не сохранено. Сравните текущую форму (включая несохранённые правки) с файлом. Пустые ответы не заменяются типовыми значениями.</DialogDescription></DialogHeader>
        {imported && preview && <>
          {sectorMismatch && <p role="alert">Направление файла «{imported.sectorId ?? 'не выбрано'}» не совпадает с текущим «{state.sectorId ?? 'не выбрано'}». Применение заблокировано. Скачайте анкету в текущем направлении и перенесите ответы.</p>}
          {stale && <p role="alert">Проект изменился. Применение заблокировано; загрузите файл повторно.</p>}
          {!!imported.errors.length && <div role="alert"><h3 className="font-semibold">Ошибки</h3><ul className="list-inside list-disc">{imported.errors.map((error, i) => <li key={i}>{error}</li>)}</ul></div>}
          {!!imported.missing.length && <div role="alert" data-testid="questionnaire-missing"><h3 className="font-semibold">Не заполнены обязательные поля ({imported.missing.length})</h3><p>Применение невозможно. Исправьте XLSX и загрузите его повторно.</p><ul className="list-inside list-disc">{fieldsFor(imported.type).filter(field => imported.missing.includes(field.key)).map(field => <li key={field.key}>{questionnaireFieldLabel(field)}</li>)}</ul></div>}
          {!!imported.warnings.length && <div><h3 className="font-semibold">Предупреждения</h3><ul className="list-inside list-disc">{imported.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul></div>}
          <div className="overflow-x-auto"><table className="w-full text-left text-sm" data-testid="questionnaire-comparison"><caption className="text-left">Значения и сохранённые сведения специалиста</caption><thead><tr><th className="p-2">Параметр</th><th className="p-2">Текущая форма</th><th className="p-2">Из файла</th><th className="p-2">Комментарий / источник / дата</th></tr></thead><tbody>
             {fieldsFor(imported.type).map(field => <tr key={field.key} className="border-t"><th className="p-2 font-normal">{questionnaireFieldLabel(field)}</th><td className="p-2">{show(preview.current[field.key])}</td><td className="p-2">{show(imported.rawAnswers[field.key])} {field.unit}</td><td className="max-w-xs break-words p-2">{Object.values(imported.evidence[field.key] ?? {}).filter(Boolean).join(' / ') || '—'}</td></tr>)}
          </tbody></table></div>
          {mismatch && <label className="flex items-start gap-2"><input type="checkbox" checked={typeConfirmed} onChange={event => setTypeConfirmed(event.target.checked)} data-testid="questionnaire-confirm-type" /><span>Подтверждаю смену типа объекта на «{questionnaireTemplates[imported.type].name}». Направление останется прежним; все прежние параметры объекта будут заменены.</span></label>}
          <label className="flex items-start gap-2"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} data-testid="questionnaire-confirm-overwrite" /><span>Проверил(а) значения и предупреждения. Разрешаю заменить ВСЕ параметры и несохранённые правки формы, сбросить выбранные модели, расчётные поправки и KPI. Необязательные пустые поля останутся неуказанными.</span></label>
          <div className="flex flex-wrap gap-3"><Button disabled={blocked || !confirmed || mismatch && !typeConfirmed} onClick={apply} data-testid="questionnaire-apply">Применить</Button><Button variant="outline" onClick={() => { setPreview(null); setMessage('Импорт отменён. Проект и несохранённая форма не изменены.'); }} data-testid="questionnaire-cancel">Отмена</Button></div>
        </>}
      </DialogContent>
    </Dialog>
  </CardContent></Card>;
}