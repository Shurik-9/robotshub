import { useMemo, useState } from 'react';
import { Link, useLocation, useSearch } from 'wouter';
import { ArrowRight } from 'lucide-react';
import { useProject } from '@/store/project';
import { DEMO_SOLUTION_ID, isEmptyProject } from '@/lib/demo-project';
import { readStartScopeDraft, type StartObjectId } from '@/lib/start-scope';
import { fieldsForProcess } from '@/lib/start-processes';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';

export function StartBriefModelAction({ objectId, processId }: { objectId: StartObjectId | null; processId: string }) {
  const { state, replaceProject } = useProject();
  const [, navigate] = useLocation();
  const [confirm, setConfirm] = useState(false);
  if (objectId !== 'warehouse' || !['receiving', 'shipping'].includes(processId)) return null;
  const openModel = () => {
    replaceProject({
      objectType: 'warehouse', sectorId: null, objectParams: {},
      selectedSolutions: [DEMO_SOLUTION_ID], activeSolutionId: DEMO_SOLUTION_ID,
      whatIfOverrides: {}, assumptionsOverrides: {}, financingScenario: 'purchase',
      simulationKpis: null, demoProject: false,
    });
    navigate(`/object?from=start-brief&process=${encodeURIComponent(processId)}`);
  };
  return <div className="mt-5 border-t border-border pt-4" data-testid="brief-model-action">
    <p className="mb-3 text-base leading-6">Для внутренней перевозки паллет доступна отдельная модель Ronavi H1500. Это не расчёт автоматизации всего склада.</p>
    <button type="button" className="of-primary" data-testid="brief-open-model" onClick={() => isEmptyProject(state) ? openModel() : setConfirm(true)}>
      Проверить модель перевозки <ArrowRight size={17} />
    </button>
    <AlertDialog open={confirm} onOpenChange={setConfirm}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Начать отдельный расчёт перевозки?</AlertDialogTitle>
          <AlertDialogDescription>Текущий финансовый расчёт будет заменён новой моделью с пустыми параметрами. Краткий разбор объекта и введённые по его участкам данные сохранятся отдельно. Если текущий расчёт нужен, сначала сохраните его.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="brief-model-cancel">Оставить текущий расчёт</AlertDialogCancel>
          <AlertDialogAction data-testid="brief-model-confirm" onClick={openModel}>Начать отдельный расчёт</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>;
}

export function StartBriefModelContext() {
  const params = new URLSearchParams(useSearch());
  const { draft } = useMemo(readStartScopeDraft, []);
  if (params.get('from') !== 'start-brief' || !draft) return null;
  const process = draft.processes.find(item => item.id === params.get('process'));
  if (!process) return null;
  const answers = draft.details[process.id];
  return <section className="mb-6 rounded-lg border border-primary/40 bg-primary/5 p-5" data-testid="object-brief-context">
    <h2 className="text-lg font-semibold">Отдельная модель перевозки · {process.name}</h2>
    <p className="mt-2 text-base leading-7">Разбор всей площадки сохранён. Ниже — параметры отдельного расчёта: стартовые значения формы являются допущениями шаблона, а не измерениями из вашей справки.</p>
    {answers && <details className="mt-3 text-base"><summary className="cursor-pointer text-primary">Показать уже собранные вводные</summary>
      <dl className="mt-3 space-y-2">{fieldsForProcess(process.kind).filter(field => answers.unknown[field.key] || answers.values[field.key]?.trim()).map(field => <div key={field.key}>
        <dt className="font-semibold">{field.label}</dt><dd>{answers.unknown[field.key] ? 'Пока неизвестно' : `${answers.values[field.key]}${field.unit ? ` ${field.unit}` : ''}`}</dd>
      </div>)}</dl>
      <p className="mt-3 text-muted-foreground">Автоматического переноса нет: единицы и охват нужно сверить с полями расчёта.</p>
    </details>}
    <Link href="/start" className="mt-3 inline-block font-medium text-primary underline">Вернуться к разбору площадки</Link>
  </section>;
}
