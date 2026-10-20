import { useCallback, useEffect, useState } from 'react';
import { toast } from '@/hooks/use-toast';
import {
  readComparisonIds,
  toggleComparisonId,
  writeComparisonIds,
} from '@/lib/comparisonSelection';

const EVENT_NAME = 'robotshub:comparison-change';

export function useComparisonSelection() {
  const [ids, setIds] = useState<string[]>(readComparisonIds);

  useEffect(() => {
    const sync = () => setIds(readComparisonIds());
    window.addEventListener(EVENT_NAME, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(EVENT_NAME, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const commit = useCallback((next: string[]) => {
    writeComparisonIds(next);
    setIds(next);
    window.dispatchEvent(new Event(EVENT_NAME));
  }, []);

  const toggle = useCallback((id: string) => {
    const result = toggleComparisonId(readComparisonIds(), id);
    if (result.limitReached) {
      toast({
        title: 'Можно сравнить не более 3 решений',
        description: 'Уберите одну позицию, чтобы добавить другую.',
      });
      return false;
    }
    commit(result.ids);
    return true;
  }, [commit]);

  const remove = useCallback((id: string) => {
    commit(readComparisonIds().filter(item => item !== id));
  }, [commit]);

  const clear = useCallback(() => commit([]), [commit]);

  return { ids, toggle, remove, clear, replace: commit };
}
