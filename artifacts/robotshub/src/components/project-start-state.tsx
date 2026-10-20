import { ArrowRight, Calculator, FileBarChart } from 'lucide-react';
import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';

export function ProjectStartState({ mode }: { mode: 'calc' | 'report' }) {
  const report = mode === 'report';
  const Icon = report ? FileBarChart : Calculator;
  return (
    <div className="container mx-auto max-w-3xl px-4 py-10 sm:py-16" data-testid={`empty-${mode}-state`}>
      <Card>
        <CardHeader>
          <Icon className="mb-3 h-8 w-8 text-primary" aria-hidden="true" />
          <h1 className="text-2xl font-semibold leading-tight tracking-tight">{report ? 'Подготовьте данные для отчёта' : 'Начните оценку экономики роботизации'}</h1>
        </CardHeader>
        <CardContent className="space-y-6">
          <p className="text-sm leading-7 text-muted-foreground">
            {report
              ? 'Отчёт собирается из вашего объекта, выбранного решения и расчёта экономики. Сейчас этих данных недостаточно — раздел доступен, но готового отчёта пока нет.'
              : 'Для расчёта нужны тип и параметры вашего объекта, а также выбранное решение. Сначала опишите площадку, затем подберите модель в каталоге.'}
          </p>
          <ol className="space-y-2 text-sm leading-6">
            <li>1. Выберите направление и тип площадки.</li>
            <li>2. Проверьте параметры объекта.</li>
            <li>3. Выберите решение и откройте предварительное ТЭО.</li>
          </ol>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button asChild className="h-auto min-h-10 whitespace-normal py-3">
              <Link href="/quick-select" data-testid={`button-start-${mode}`}>Выбрать направление и объект<ArrowRight className="ml-2 h-4 w-4 shrink-0" /></Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/solutions">Сначала изучить каталог</Link>
            </Button>
          </div>
          <p className="text-xs leading-5 text-muted-foreground">Переход сюда не сбрасывает сохранённые параметры. Демо работы роботов можно посмотреть отдельно в симуляции.</p>
          <Link href="/simulation" className="inline-flex items-center gap-2 text-sm font-medium text-primary underline underline-offset-4">Посмотреть демо симуляции<ArrowRight className="h-4 w-4" /></Link>
        </CardContent>
      </Card>
    </div>
  );
}
