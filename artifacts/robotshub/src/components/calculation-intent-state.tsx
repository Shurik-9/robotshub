import { Link, useLocation } from 'wouter';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { withCalculationIntent } from '@/lib/calculation-intent';
import { calculationObjectsFor } from '@/lib/calculation-objects';
import { useProject } from '@/store/project';
import { catalogReturnUrl } from '@/lib/catalog-navigation';
import { operationFor } from '@/lib/operationEconomics';
import { QuoteCta } from '@/components/quote-cta';

type Props = {
  solution: { id: string; name: string };
  hasObject: boolean;
  limitation: string | null;
  onCalculate: () => void;
};

export function CalculationIntentState({ solution, hasObject, limitation, onCalculate }: Props) {
  const { state, setObjectType, setSectorId } = useProject();
  const [, setLocation] = useLocation();
  const options = calculationObjectsFor(solution.id);
  const dedicatedSector = ['sector-water', 'sector-mining', 'sector-medicine']
    .find(sector => operationFor(sector, solution.id));
  const supported = options.some(option => option.type === state.objectType)
    || Boolean(operationFor(state.sectorId, solution.id));
  const ready = hasObject && !limitation && supported;
  const chooseObject = (type: 'warehouse' | 'airport' | 'medical') => {
    const replacing = (state.objectType !== type || (type === 'medical' && state.sectorId !== 'sector-medicine'))
      && Object.keys(state.objectParams).length > 0;
    if (replacing && !window.confirm('Вы меняете тип объекта. Параметры, выбранные модели и результаты текущего проекта будут сброшены. Продолжить?')) return;
    if (type === 'medical') setSectorId('sector-medicine');
    else if (state.objectType !== type) setSectorId(null);
    setObjectType(type);
    setLocation(withCalculationIntent('/object', solution.id));
  };
  return (
    <div className="container mx-auto max-w-3xl px-4 py-10 sm:py-16" data-testid="calculation-intent-state">
      <Card>
        <CardHeader><h1 className="text-2xl font-semibold leading-tight tracking-tight">От модели к расчёту и симуляции</h1></CardHeader>
        <CardContent className="space-y-5">
          <p className="text-sm leading-7">Выбранная модель: <strong data-testid="calculation-intent-solution">{solution.name}</strong>.</p>
          <ol className="grid gap-2 rounded-lg border border-primary/30 bg-primary/5 p-4 text-sm sm:grid-cols-3" aria-label="Этапы расчёта">
            <li><strong>1. Объект</strong><br />Тип площадки и параметры</li>
            <li><strong>2. Экономика</strong><br />Парк, затраты и допущения</li>
            <li><strong>3. Симуляция</strong><br />Для поддерживаемых операций</li>
          </ol>
          {!ready ? (
            <>
              {options.length > 0 ? <>
                <h2 className="text-lg font-semibold">Для какого объекта считаем?</h2>
                <p className="text-sm leading-6 text-muted-foreground">Выберите площадку. Далее откроются сразу её параметры — модель «{solution.name}» уже выбрана, возвращаться в каталог не нужно.</p>
                <div className="grid gap-3 sm:grid-cols-3">
                  {options.map(option => <Button key={option.type} type="button" variant="outline"
                    className="h-auto min-h-24 flex-col items-start whitespace-normal p-4 text-left"
                    onClick={() => chooseObject(option.type)} data-testid={`button-intent-object-${option.type}`}>
                    <span className="text-base font-semibold">{option.title}</span>
                    <span className="mt-1 text-sm font-normal leading-5 text-muted-foreground">{option.description}</span>
                    <span className="mt-2 text-sm text-primary">К параметрам →</span>
                  </Button>)}
                </div>
                {hasObject && <p className="text-sm text-muted-foreground" data-testid="calculation-intent-limitation">Текущий объект ещё не подходит для расчёта этой модели. При выборе другого типа потребуется подтверждение замены; открытие этой страницы ничего не меняет.</p>}
              </> : dedicatedSector ? <>
                <h2 className="text-lg font-semibold">Для этой модели нужен бриф операции</h2>
                <p className="text-sm leading-6 text-muted-foreground">Здесь используется отдельная модель операции, а не складская формула. Укажите площадку и задачу; затем откроются профильные исходные данные и экономика.</p>
                <Button type="button" onClick={() => {
                  if ((state.sectorId !== dedicatedSector || state.objectType !== 'custom')
                    && Object.keys(state.objectParams).length > 0
                    && !window.confirm('Переход к другой операции сбросит параметры и результаты текущего проекта. Продолжить?')) return;
                  setSectorId(dedicatedSector);
                  setObjectType('custom');
                  setLocation(withCalculationIntent('/object', solution.id));
                }} data-testid="button-intent-operation">Заполнить бриф операции<ArrowRight className="ml-2 h-4 w-4" /></Button>
              </> : <>
                <h2 className="text-lg font-semibold">Для этой операции нет типовой модели расчёта</h2>
                <p className="text-sm leading-6 text-muted-foreground" data-testid="calculation-intent-limitation">{limitation ?? 'Нельзя достоверно применить складскую формулу к этой технике.'} Модель можно сравнить по характеристикам или запросить расчёт у поставщика. Симуляцию другой техники за результат этой модели не выдаём.</p>
                <QuoteCta solutionId={solution.id} />
              </>}
            </>
          ) : (
            <>
              <p className="text-sm leading-7 text-muted-foreground">Параметры текущего объекта будут сохранены. По кнопке ниже эта модель заменит ранее выбранные решения для расчёта.</p>
              <Button type="button" onClick={onCalculate} className="h-auto min-h-10 whitespace-normal py-3" data-testid="button-intent-calculate">Открыть расчёт<ArrowRight className="ml-2 h-4 w-4 shrink-0" /></Button>
              {(dedicatedSector || state.objectType === 'medical') && <p className="text-sm leading-6 text-amber-300">Для этой операции доступна оценка экономики, но проверенной маршрутной симуляции пока нет.</p>}
              <Button type="button" variant="outline" onClick={() => setLocation(withCalculationIntent('/object', solution.id))}>Уточнить параметры объекта</Button>
            </>
          )}
          <div className="flex flex-wrap gap-5 text-sm">
            <Link href={`/solutions/${solution.id}`} className="font-medium text-primary underline underline-offset-4">Карточка решения</Link>
            <Link href={catalogReturnUrl()} className="font-medium text-primary underline underline-offset-4">Вернуться к списку моделей</Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
