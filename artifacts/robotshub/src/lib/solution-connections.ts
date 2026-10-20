import solutionsData from '@/data/solutions.json';
import { findCaseCatalogSolution } from '@/lib/calculation-intent';

type SourceSolution = {
  specs?: Record<string, unknown>;
  specs_real?: Record<string, unknown>;
};

export type SolutionSourceLink = { url: string; label: string; host: string };
const caseModelIds = new Map<string, string | null>();
const modelsById = new Map<string, (typeof solutionsData.items)[number]>();
for (const item of solutionsData.items) {
  if (!modelsById.has(item.id)) modelsById.set(item.id, item);
}

/** Only explicitly recorded links: never infer a manufacturer's product URL. */
export function getSolutionSourceLinks(solution: SourceSolution): SolutionSourceLink[] {
  const links = new Map<string, SolutionSourceLink>();
  for (const raw of [solution.specs?.source_url, solution.specs_real?.source_url]) {
    if (typeof raw !== 'string' || !raw.trim()) continue;
    try {
      const url = new URL(raw.trim());
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) continue;
      links.set(url.href, {
        url: url.href,
        label: 'Источник характеристик',
        host: url.hostname.replace(/^www\./, ''),
      });
    } catch {
      // An invalid/missing source stays absent; do not substitute a search link.
    }
  }
  return [...links.values()];
}

/** Reuse the same unambiguous model identity as the case → catalog transition. */
export function getSolutionCases<T extends { solutionName: string }>(
  solutionId: string,
  cases: readonly T[],
): T[] {
  return cases.filter(item => {
    if (!caseModelIds.has(item.solutionName)) {
      caseModelIds.set(item.solutionName, findCaseCatalogSolution(item.solutionName)?.id ?? null);
    }
    return caseModelIds.get(item.solutionName) === solutionId;
  });
}

/** Same stated scenario, subtype and system kind — not a compatibility claim. */
export function getRelatedSolutions(solutionId: string, limit = 3) {
  const solution = modelsById.get(solutionId);
  if (!solution?.scenario?.trim() || !solution.subtype?.trim() || !solution.kind) return [];
  const normalize = (value: string) => value.trim().toLowerCase().replaceAll('ё', 'е');
  return [...modelsById.values()].filter(item => {
    return item.id !== solutionId && item.kind === solution.kind
      && normalize(item.subtype || '') === normalize(solution.subtype)
      && normalize(item.scenario || '') === normalize(solution.scenario);
  }).slice(0, Math.max(0, Math.floor(limit)));
}
