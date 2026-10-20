import { useMemo, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, Scale, TrendingDown, TrendingUp } from 'lucide-react';
import {
  computeFormulaVsSim,
  fmtMln,
  type FormulaVsSimInput,
  type FormulaVsSimTone,
} from '@/lib/formula-vs-sim';

interface Props extends FormulaVsSimInput {
  className?: string;
}

const TONE_STYLES: Record<FormulaVsSimTone, { card: string; badge: string; icon: ReactNode }> = {
  waiting: {
    card: 'border-border bg-muted/10',
    badge: 'text-muted-foreground',
    icon: <Loader2 className="h-4 w-4 animate-spin" />,
  },
  ok: {
    card: 'border-emerald-500/40 bg-emerald-500/5',
    badge: 'text-emerald-300',
    icon: <CheckCircle2 className="h-4 w-4" />,
  },
  tight: {
    card: 'border-amber-500/40 bg-amber-500/5',
    badge: 'text-amber-300',
    icon: <AlertTriangle className="h-4 w-4" />,
  },
  layout: {
    card: 'border-amber-500/40 bg-amber-500/5',
    badge: 'text-amber-300',
    icon: <AlertTriangle className="h-4 w-4" />,
  },
  shortage: {
    card: 'border-sky-500/40 bg-sky-500/5',
    badge: 'text-sky-300',
    icon: <AlertTriangle className="h-4 w-4" />,
  },
};

export function FormulaVsSim(props: Props) {
  const result = useMemo(
    () => computeFormulaVsSim(props),
    [
      props.formulaRobots,
      props.runRobots,
      props.formulaUnitPriceRub,
      props.runUnitPriceRub,
      props.targetPerHour,
      props.observedPerHour,
      props.utilizationPct,
      props.queueLen,
    ],
  );
  const style = TONE_STYLES[result.tone];
  const deltaLabel = !result.ready
    ? 'ожидаем чистого окна измерения'
    : result.deltaRobots === 0 && result.deltaRub === 0
      ? 'цифры совпали'
      : `${result.deltaRobots > 0 ? '+' : ''}${result.deltaRobots} ед. · ${result.deltaRub > 0 ? '+' : ''}${fmtMln(result.deltaRub)}`;

  return (
    <section className={`rounded-lg border ${style.card} ${props.className ?? ''}`} data-testid="formula-vs-sim">
      <div className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
        <div className="flex items-center gap-2">
          <Scale className="h-4 w-4 text-accent" />
          <h3 className="text-base font-semibold text-foreground">Формула против прогона</h3>
        </div>
        <span
          className={`flex items-center gap-1.5 text-xs font-medium ${style.badge}`}
          data-testid="formula-vs-sim-tone"
          aria-live="polite"
        >
          {style.icon}
          {result.tone === 'waiting'
            ? 'считаем'
            : result.tone === 'ok'
              ? 'проверено'
              : result.tone === 'shortage'
                ? 'нужна проверка'
                : 'внимание'}
        </span>
      </div>

      <div className="grid gap-0 sm:grid-cols-2">
        <div className="border-b border-border/60 px-4 py-4 sm:border-b-0 sm:border-r">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">По формуле</p>
          <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-foreground" data-testid="formula-vs-sim-formula">
            {result.formulaRobots} <span className="text-sm font-medium text-muted-foreground">роб.</span>
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {fmtMln(result.formulaCapexRub)} · цена активного решения
          </p>
        </div>
        <div className="px-4 py-4">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            {result.tone === 'layout' ? 'Парк прогона' : result.tone === 'ok' ? 'Проверенный парк' : 'Ориентир для проверки'}
          </p>
          <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-foreground" data-testid="formula-vs-sim-run">
            {result.ready ? result.neededRobots : '—'}{' '}
            <span className="text-sm font-medium text-muted-foreground">роб.</span>
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {result.ready
              ? `${Math.round(result.ratio * 100)}% потока · парк в прогоне ${result.runRobots}`
              : 'Нужно дождаться чистого окна измерения'}
          </p>
        </div>
      </div>

      <div className="border-t border-border/60 px-4 py-3">
        <p className="text-sm font-semibold text-foreground" data-testid="formula-vs-sim-headline">
          {result.headline}
        </p>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground" data-testid="formula-vs-sim-detail">
          {result.detail}
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Текущий сценарий: {props.targetPerHour.toLocaleString('ru-RU', { maximumFractionDigits: 1 })} оп/ч, {result.runRobots} ед.
        </p>
        {result.tone !== 'layout' && <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <span
            className={`inline-flex items-center gap-1.5 font-medium ${!result.ready || result.deltaRub === 0 ? 'text-muted-foreground' : result.deltaRub > 0 ? 'text-sky-300' : 'text-emerald-300'}`}
            data-testid="formula-vs-sim-delta"
          >
            {result.ready && result.deltaRub > 0
              ? <TrendingUp className="h-3.5 w-3.5" />
              : result.ready && result.deltaRub < 0
                ? <TrendingDown className="h-3.5 w-3.5" />
                : null}
            {deltaLabel}
          </span>
          {result.ready && result.deltaRub !== 0 && (
            <span className="text-muted-foreground">
              вложения: {fmtMln(result.neededCapexRub)} против {fmtMln(result.formulaCapexRub)}
            </span>
          )}
        </div>}
        {result.ready && (
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Сценарный ориентир, не гарантия SLA и не полный CAPEX: учтена только техника. Формула относится к активному решению, цена парка — к текущему составу. Изменённые ручками условия могут отличаться от экономики.
          </p>
        )}
      </div>
    </section>
  );
}
