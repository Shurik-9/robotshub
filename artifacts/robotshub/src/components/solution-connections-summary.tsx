import { ExternalLink, FileText, Layers, ArrowRight } from 'lucide-react';
import { getSolutionSourceLinks, getSolutionCases, getRelatedSolutions } from '@/lib/solution-connections';
import { CASES } from '@/pages/cases';
import type solutionsData from '@/data/solutions.json';

type CatalogSolution = (typeof solutionsData.items)[number];

export function SolutionConnectionsSummary({ solution, onOpen }: { solution: CatalogSolution; onOpen: () => void }) {
  const sources = getSolutionSourceLinks(solution);
  const cases = getSolutionCases(solution.id, CASES);
  const related = getRelatedSolutions(solution.id, 3);

  return (
    <section className="rounded-xl border border-border bg-secondary/30 p-3" data-testid={`panel-connections-${solution.id}`}>
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Связи модели</p>
      <ul className="mt-2 space-y-2 text-sm leading-5">
        <li className="flex items-start gap-2" data-testid={`text-connection-sources-${solution.id}`}>
          <ExternalLink className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          {sources.length > 0 ? (
            <span className="min-w-0">
              Источник характеристик:{' '}
              {sources.map((link, index) => (
                <span key={link.url}>
                  {index > 0 && ', '}
                  <a href={link.url} target="_blank" rel="noopener noreferrer" className="break-words text-primary underline underline-offset-2" data-testid={`link-source-${solution.id}-${index}`}>{link.host}</a>
                </span>
              ))}
            </span>
          ) : <span className="text-muted-foreground">Источник характеристик не указан</span>}
        </li>
        <li className="flex items-start gap-2" data-testid={`text-connection-cases-${solution.id}`}>
          <FileText className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <span className={cases.length ? '' : 'text-muted-foreground'}>
            {cases.length ? `Кейсы с этой моделью: ${cases.length}` : 'Связанных кейсов в базе нет'}
          </span>
        </li>
        <li className="flex items-start gap-2" data-testid={`text-connection-related-${solution.id}`}>
          <Layers className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <span className={related.length ? '' : 'text-muted-foreground'}>
            {related.length ? 'Есть другие модели того же сценария' : 'Другие модели пока не связаны'}
          </span>
        </li>
      </ul>
      {(cases.length > 0 || related.length > 0) && (
        <button type="button" onClick={onOpen} className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline" data-testid={`button-connections-open-${solution.id}`}>
          Смотреть связи на странице модели <ArrowRight className="h-4 w-4" />
        </button>
      )}
    </section>
  );
}
