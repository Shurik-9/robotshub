import { useLocation } from 'wouter';
import { ArrowRight, GitCompareArrows, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useComparisonSelection } from '@/hooks/use-comparison-selection';

export function FloatingCompareBar() {
  const [, setLocation] = useLocation();
  const { ids, clear } = useComparisonSelection();
  if (ids.length === 0) return null;

  return (
    <aside
      className="fixed inset-x-3 bottom-3 z-40 mx-auto flex max-w-3xl flex-col gap-3 rounded-2xl border border-primary/35 bg-card/95 p-3 shadow-[0_18px_55px_-22px_hsl(var(--primary)/0.45)] backdrop-blur-xl sm:inset-x-6 sm:bottom-5 sm:flex-row sm:items-center sm:justify-between sm:px-5"
      data-testid="floating-compare-bar"
    >
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/12 text-primary">
          <GitCompareArrows className="h-5 w-5" />
        </span>
        <div>
          <p className="text-sm font-semibold">Сравнение решений</p>
          <p className="text-xs text-muted-foreground" data-testid="text-compare-bar-count">
            Выбрано {ids.length} из 3
          </p>
        </div>
      </div>
      <div className="flex gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={clear} data-testid="button-clear-comparison">
          <X className="mr-1.5 h-4 w-4" /> Очистить
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={ids.length < 2}
          onClick={() => setLocation(`/compare?ids=${encodeURIComponent(ids.join(','))}`)}
          data-testid="button-open-comparison"
        >
          {ids.length < 2 ? 'Выберите минимум 2' : `Сравнить (${ids.length})`}
          {ids.length >= 2 && <ArrowRight className="ml-2 h-4 w-4" />}
        </Button>
      </div>
    </aside>
  );
}
