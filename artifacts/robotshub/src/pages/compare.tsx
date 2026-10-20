import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'wouter';
import { ArrowLeft, EyeOff, Highlighter, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useComparisonSelection } from '@/hooks/use-comparison-selection';
import { areComparisonValuesEqual } from '@/lib/comparisonValues';
import { getCompanyProfile, getSolutionRole, getSolutionSpecLabel } from '@/lib/solutionPresentation';
import solutionsData from '@/data/solutions.json';

type SolutionRecord = (typeof solutionsData.items)[number];

const baseRows = [
  { key: 'category-subtype', label: 'Категория и подтип', get: (s: SolutionRecord) => [s.category, s.subtype].filter(Boolean).join(' · ') || '—' },
  { key: 'manufacturer-vendor', label: 'Производитель / поставщик', get: (s: SolutionRecord) => getCompanyProfile(s).company || '—' },
  { key: 'scenario', label: 'Сценарий', get: (s: SolutionRecord) => getSolutionRole(s) === 'Сценарий применения не указан' ? '—' : getSolutionRole(s) },
  { key: 'trl', label: 'УГТ', get: (s: SolutionRecord) => s.trl ? `${s.trl}/9` : '—' },
  { key: 'region', label: 'Регион', get: (s: SolutionRecord) => s.region || '—' },
  { key: 'industry', label: 'Отрасль', get: (s: SolutionRecord) => s.industry || '—' },
];

export default function Compare() {
  const [, setLocation] = useLocation();
  const { ids, remove, replace } = useComparisonSelection();
  const [hideIdenticalRows, setHideIdenticalRows] = useState(false);
  const [highlightDifferences, setHighlightDifferences] = useState(false);
  const queryIds = new URLSearchParams(window.location.search).get('ids')?.split(',').filter(Boolean);
  useEffect(() => {
    if (!queryIds?.length) return;
    const validIds = Array.from(new Set(queryIds)).filter(id =>
      solutionsData.items.some(solution => solution.id === id),
    ).slice(0, 3);
    if (validIds.length && validIds.join('|') !== ids.join('|')) replace(validIds);
  }, [queryIds?.join('|'), ids, replace]);
  const activeIds = ids;
  const solutions = useMemo(
    () => activeIds.map(id => solutionsData.items.find(item => item.id === id)).filter((item): item is SolutionRecord => Boolean(item)),
    [activeIds.join('|')],
  );

  const specKeys = Array.from(new Set(solutions.flatMap(solution => Object.keys(solution.specs ?? {}))));
  const rows = [
    ...baseRows.map(row => ({ key: row.key, label: row.label, values: solutions.map(row.get) })),
    ...specKeys.map(key => ({
      key: `spec-${key}`,
      label: getSolutionSpecLabel(key),
      values: solutions.map(solution => {
        const value = (solution.specs as Record<string, unknown> | undefined)?.[key];
        return value === undefined || value === null || value === '' ? '—' : String(value);
      }),
    })),
  ];
  const visibleRows = hideIdenticalRows
    ? rows.filter(row => !areComparisonValuesEqual(row.values))
    : rows;

  return (
    <main className="min-h-[70dvh] px-4 py-8 sm:px-6 lg:px-10" data-testid="page-compare">
      <div className="mx-auto max-w-[1440px]">
        <div className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <button type="button" onClick={() => setLocation('/solutions')} className="mb-4 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground" data-testid="button-back-catalog">
              <ArrowLeft className="h-4 w-4" /> Каталог
            </button>
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-primary">Рабочая матрица</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Сравнение решений</h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">Характеристики приведены по данным карточек; пустые поля не означают отсутствия функции.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant={hideIdenticalRows ? 'default' : 'outline'} onClick={() => setHideIdenticalRows(value => !value)} aria-pressed={hideIdenticalRows} data-testid="button-hide-identical">
              <EyeOff className="mr-2 h-4 w-4" />
              {hideIdenticalRows ? 'Одинаковые скрыты' : 'Скрыть одинаковые'}
            </Button>
            <Button type="button" variant={highlightDifferences ? 'default' : 'outline'} onClick={() => setHighlightDifferences(value => !value)} aria-pressed={highlightDifferences} data-testid="button-highlight-differences">
              <Highlighter className="mr-2 h-4 w-4" />
              {highlightDifferences ? 'Различия подсвечены' : 'Подсветить отличия'}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setLocation('/solutions')} data-testid="button-add-comparison">Добавить решение</Button>
          </div>
        </div>

        {solutions.length === 0 ? (
          <section className="rounded-2xl border border-dashed border-border bg-card/60 px-6 py-16 text-center" data-testid="empty-comparison">
            <p className="text-lg font-semibold">Пока нечего сравнивать</p>
            <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">Выберите до трёх решений в каталоге — список сохранится и останется после перезагрузки.</p>
            <Button type="button" className="mt-5" onClick={() => setLocation('/solutions')}>Открыть каталог</Button>
          </section>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-sm">
            <table className="w-full min-w-[760px] border-separate border-spacing-0 text-left" data-testid="comparison-table">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 w-52 border-b border-border bg-secondary/90 p-4 text-xs font-medium uppercase tracking-wider text-muted-foreground backdrop-blur">Параметр</th>
                  {solutions.map(solution => (
                    <th key={solution.id} className="min-w-[230px] border-b border-l border-border bg-card p-4 align-top">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          {solution.img ? (
                            <img src={solution.img} alt="" width={84} height={84} className="mb-3 h-[84px] w-[84px] rounded-lg border border-border object-cover" loading="lazy" />
                          ) : (
                            <div className="mb-3 grid h-[84px] w-[84px] place-items-center rounded-lg border border-dashed border-border bg-secondary/50 text-xs text-muted-foreground">Нет фото</div>
                          )}
                          <h2 className="text-base font-semibold leading-snug">{solution.name}</h2>
                          <p className="mt-2 font-mono text-sm font-semibold text-foreground">
                            {solution.price_rub
                              ? `${new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(solution.price_rub)} · с НДС`
                              : '—'}
                          </p>
                        </div>
                        <button type="button" onClick={() => {
                          const nextIds = ids.filter(id => id !== solution.id);
                          remove(solution.id);
                          setLocation(`/compare?ids=${encodeURIComponent(nextIds.join(','))}`);
                        }} aria-label={`Убрать ${solution.name}`} className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" data-testid={`button-remove-compare-${solution.id}`}>
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleRows.map(row => {
                  const equal = areComparisonValuesEqual(row.values);
                  const highlighted = highlightDifferences && !equal;
                  return (
                    <tr key={row.key} className={highlighted ? 'bg-primary/[0.08]' : ''}>
                      <th scope="row" className={`sticky left-0 z-[1] border-b border-border/70 p-4 text-xs font-medium text-muted-foreground ${highlighted ? 'border-l-2 border-l-primary bg-primary/[0.11]' : 'bg-background'}`}>{row.label}</th>
                      {row.values.map((value, index) => (
                        <td key={`${row.key}-${solutions[index].id}`} className={`border-b border-l border-border/70 p-4 text-sm leading-6 ${equal ? 'text-muted-foreground' : 'text-foreground'}`}>
                          {String(value)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-4 text-xs text-muted-foreground">«—» означает, что поле отсутствует в опубликованных данных.</p>
      </div>
    </main>
  );
}
