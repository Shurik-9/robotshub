import { Link } from 'wouter';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { withCalculationIntent } from '@/lib/calculation-intent';

type Props = {
  solution: { id: string; name: string };
  hasObject: boolean;
  limitation: string | null;
  onCalculate: () => void;
};

export function CalculationIntentState({ solution, hasObject, limitation, onCalculate }: Props) {
  return (
    <div className="container mx-auto max-w-3xl px-4 py-10 sm:py-16" data-testid="calculation-intent-state">
      <Card>
        <CardHeader><h1 className="text-2xl font-semibold leading-tight tracking-tight">Оценка для вашего объекта</h1></CardHeader>
        <CardContent className="space-y-5">
          <p className="text-sm leading-7">Выбранная модель: <strong data-testid="calculation-intent-solution">{solution.name}</strong>.</p>
          <p className="text-sm leading-7 text-muted-foreground">Результаты внедрения из кейса не являются прогнозом для вашей площадки. Расчёт будет использовать ваши исходные данные и допущения.</p>
          {!hasObject ? (
            <>
              <p className="text-sm leading-7 text-muted-foreground">Сначала выберите направление, тип объекта и заполните его параметры. Выбранная модель сохранится в этом маршруте.</p>
              <Button asChild className="h-auto min-h-10 whitespace-normal py-3">
                <Link href={withCalculationIntent('/quick-select', solution.id)} data-testid="button-intent-choose-object">Описать свой объект<ArrowRight className="ml-2 h-4 w-4 shrink-0" /></Link>
              </Button>
            </>
          ) : limitation ? (
            <>
              <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-4 text-sm leading-7" role="status" data-testid="calculation-intent-limitation">{limitation} Текущий проект не изменён.</p>
              <Button asChild variant="outline"><Link href={withCalculationIntent('/quick-select', solution.id)}>Изменить направление или объект</Link></Button>
            </>
          ) : (
            <>
              <p className="text-sm leading-7 text-muted-foreground">Параметры текущего объекта будут сохранены. По кнопке ниже эта модель заменит ранее выбранные решения для расчёта.</p>
              <Button type="button" onClick={onCalculate} className="h-auto min-h-10 whitespace-normal py-3" data-testid="button-intent-calculate">Рассчитать для текущего объекта<ArrowRight className="ml-2 h-4 w-4 shrink-0" /></Button>
            </>
          )}
          <div className="flex flex-wrap gap-5 text-sm">
            <Link href={`/solutions/${solution.id}`} className="font-medium text-primary underline underline-offset-4">Карточка решения</Link>
            <Link href="/solutions" className="font-medium text-primary underline underline-offset-4">Другие решения</Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
