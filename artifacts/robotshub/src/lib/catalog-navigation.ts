import { useEffect } from 'react';

export type CatalogView = {
  url: string;
  filters: {
    search: string; area: string; operation: string; brand: string; company: string; role: string;
    industry: string; warehouse: boolean; personalized: boolean; evidence: boolean;
    sector: { id: string; label: string; ids: string[] } | null;
    open: { area: boolean; operation: boolean; brand: boolean; company: boolean };
  };
  cardId: string;
  cardTop: number;
  scrollY: number;
  pending: boolean;
};

const KEY = 'robotshub:catalog-view:v1';
let memory: CatalogView | null = null;

export function readCatalogView(): CatalogView | null {
  try {
    const view = JSON.parse(sessionStorage.getItem(KEY) ?? 'null');
    if (view?.url && /^\/solutions(?:\?|$)/.test(view.url) && view.filters
      && typeof view.filters.search === 'string' && typeof view.cardId === 'string'
      && Number.isFinite(view.scrollY) && Number.isFinite(view.cardTop)) memory = view;
  } catch { /* Session-only browser preference; in-memory navigation still works. */ }
  return memory;
}

export function saveCatalogView(view: CatalogView) {
  memory = view;
  try { sessionStorage.setItem(KEY, JSON.stringify(view)); } catch { /* Keep SPA navigation working. */ }
}

export function catalogReturnUrl() {
  return readCatalogView()?.url ?? '/solutions';
}

export function useRestoreCatalogView(view: CatalogView | null) {
  useEffect(() => {
    if (!view?.pending || view.url !== window.location.pathname + window.location.search) return;
    let frame = 0;
    let finished = false;
    const restore = () => {
      if (finished) return;
      const card = document.querySelector<HTMLElement>(`[data-testid="card-solution-${CSS.escape(view.cardId)}"]`);
      if (!card) return;
      finished = true;
      observer.disconnect();
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => {
          window.scrollTo({ top: Math.max(0, window.scrollY + card.getBoundingClientRect().top - view.cardTop), behavior: 'instant' });
          saveCatalogView({ ...view, pending: false });
        });
      });
    };
    const observer = new MutationObserver(restore);
    observer.observe(document.body, { childList: true, subtree: true });
    restore();
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [view]);
}
