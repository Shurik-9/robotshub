import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'wouter';
import { useProject } from '@/store/project';

const STORAGE_KEY = 'robotshub_demo_tour';
const RONAVI_ID = '5760e938-9a43-45a7-b8e8-f4f2e6383930';
const texts = [
  '223 реальных внедрения по 12 направлениям. Клик — досье отрасли.',
  'Типовые объекты — быстрый старт за один клик.',
  'Параметры вашей площадки: можно заполнить вручную или загрузить анкетой Excel.',
  '188 решений: реальные фото, цены с НДС, кейсы внедрений.',
  '4 сценария финансирования: покупка, лизинг, RaaS, как есть.',
  'Роботы едут по проездам вашего объекта, этаж — через лифт. Отчёт для руководства — в один клик.',
];
const paths = ['/map', '/quick-select', '/object', '/solutions', '/calc', '/simulation'];
type TourSession = { active: true; step: number };
type Box = { left: number; top: number; width: number; height: number };

function savedTour(): TourSession | null {
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? 'null');
    return saved?.active === true && Number.isInteger(saved.step) && saved.step >= 0 && saved.step < 6
      ? saved as TourSession : null;
  } catch {
    return null;
  }
}

function waitFor<T>(find: () => T | null | undefined, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const immediate = find();
    if (immediate) return resolve(immediate);
    if (signal.aborted) return reject(new Error('Тур остановлен'));
    const observer = new MutationObserver(() => {
      const value = find();
      if (value) finish(value);
    });
    const finish = (value?: T) => {
      observer.disconnect();
      clearTimeout(timeout);
      signal.removeEventListener('abort', aborted);
      if (value) resolve(value);
      else reject(new Error(signal.aborted ? 'Тур остановлен' : 'Элемент не появился за 15 секунд'));
    };
    const aborted = () => finish();
    const timeout = window.setTimeout(() => finish(), 15_000);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-current'] });
    signal.addEventListener('abort', aborted, { once: true });
  });
}

function query(selector: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(selector);
}

function calcButton(): HTMLButtonElement | null {
  const cards = [...document.querySelectorAll<HTMLElement>('[data-testid^="card-solution-"]')];
  const preferred = cards.find(card => card.dataset.testid === `card-solution-${RONAVI_ID}`);
  return [preferred, ...cards]
    .filter((card): card is HTMLElement => Boolean(card))
    .map(card => card.querySelector<HTMLButtonElement>('[data-testid^="button-calculate-"]'))
    .find(button => button && !button.disabled && button.textContent?.includes('Предварительное ТЭО'))
    ?? null;
}

function targets(step: number, objectType: string | null): { element: Element; frame?: HTMLIFrameElement }[] {
  if (step === 0) {
    const frame = document.querySelector<HTMLIFrameElement>('[data-testid="iframe-robotization-map"]');
    const doc = frame?.contentDocument;
    if (!frame || !doc) return [];
    const tile = [...doc.querySelectorAll<SVGElement>('#bubbles .bub')]
      .find(item => item.getAttribute('aria-label')?.startsWith('Торговля и услуги,'));
    const count = doc.querySelector('#v-ind .vh');
    return [tile, count].filter((element): element is Element => Boolean(element)).map(element => ({ element, frame }));
  }
  if (step === 1) {
    return ['[data-testid="card-object-warehouse"]', '[data-testid="button-choose-object-warehouse"]']
      .map(selector => query(selector)).filter((element): element is HTMLElement => Boolean(element))
      .map(element => ({ element }));
  }
  if (step === 2) {
    const selectors = objectType === 'airport'
      ? ['[data-testid="object-field-terminal_area_m2"]', '[data-testid="object-field-floors_count"]']
      : objectType === 'warehouse'
        ? ['[data-testid="object-field-total_area_m2"]', '[data-testid="object-field-floors_count"]']
        : ['[data-testid^="object-field-"]', '[data-testid="object-setup-card"]'];
    return selectors
      .map(selector => query(selector)).filter((element): element is HTMLElement => Boolean(element))
      .map(element => ({ element }));
  }
  if (step === 3) {
    const button = calcButton();
    return [button?.closest('[data-testid^="card-solution-"]'), button]
      .filter((element): element is Element => Boolean(element)).map(element => ({ element }));
  }
  if (step === 4) {
    const verdict = [...document.querySelectorAll('span')].find(item => item.textContent?.startsWith('Вердикт окупаемости:'));
    return [verdict?.closest('.rounded-xl') ?? verdict, query('[data-testid="tab-tco-cards"]')?.parentElement]
      .filter((element): element is Element => Boolean(element)).map(element => ({ element }));
  }
  const canvas = query('[data-testid="simulation-canvas"]');
  const focus = [...document.querySelectorAll<HTMLElement>('div')]
    .find(element => element.textContent?.trim() === 'Сейчас в работе');
  return [canvas, focus?.parentElement]
    .filter((element): element is HTMLElement => Boolean(element))
    .map(element => ({ element }));
}

function rectFor(element: Element, frame?: HTMLIFrameElement): Box {
  const rect = element.getBoundingClientRect();
  const iframeRect = frame?.getBoundingClientRect();
  return {
    left: rect.left + (iframeRect?.left ?? 0),
    top: rect.top + (iframeRect?.top ?? 0),
    width: rect.width,
    height: rect.height,
  };
}

const DemoContext = createContext<{ start: () => void } | null>(null);
export function useDemoTour() {
  const context = useContext(DemoContext);
  if (!context) throw new Error('useDemoTour requires DemoTourProvider');
  return context;
}

export function DemoTourProvider({ children }: { children: ReactNode }) {
  const [location, setLocation] = useLocation();
  const { state } = useProject();
  const [session, setSession] = useState<TourSession | null>(savedTour);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const controller = useRef<AbortController | null>(null);
  const activeRef = useRef(Boolean(session));
  activeRef.current = Boolean(session);

  const stop = useCallback(() => {
    activeRef.current = false;
    controller.current?.abort();
    controller.current = null;
    setBusy(false);
    setBoxes([]);
    setMessage('');
    setSession(null);
    try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* private browsing */ }
  }, []);

  const start = useCallback(() => {
    controller.current?.abort();
    setBusy(false);
    setMessage('');
    // Resume the user's actual project; never reset their object or solution.
    const step = state.selectedSolutions.length ? (location === '/simulation' ? 5 : 4)
      : state.objectType ? (location === '/solutions' ? 3 : 2)
      : state.sectorId ? 1 : 0;
    setSession({ active: true, step });
    if (location !== paths[step]) setLocation(paths[step]);
  }, [state.selectedSolutions.length, state.objectType, state.sectorId, location, setLocation]);

  useEffect(() => {
    if (!session) return;
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session)); } catch { /* continue without persistence */ }
  }, [session]);

  useEffect(() => {
    if (!session) return;
    const routeStep = paths.indexOf(location);
    if (routeStep === -1) {
      stop();
      return;
    }
    if (routeStep >= 0 && routeStep !== session.step) {
      // Manual navigation through the live site also moves the tour.
      setSession({ active: true, step: routeStep });
      setMessage('');
    }
  }, [location, session, stop]);

  useEffect(() => {
    if (!session) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') stop();
    };
    const frame = document.querySelector<HTMLIFrameElement>('[data-testid="iframe-robotization-map"]');
    const listenInFrame = () => frame?.contentDocument?.addEventListener('keydown', onKey, true);
    listenInFrame();
    frame?.addEventListener('load', listenInFrame);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      frame?.removeEventListener('load', listenInFrame);
      frame?.contentDocument?.removeEventListener('keydown', onKey, true);
    };
  }, [session, stop]);

  useEffect(() => {
    if (!session || session.step !== 1 || location !== '/quick-select' || state.sectorId) return;
    const signal = new AbortController();
    void waitFor(() => [...document.querySelectorAll<HTMLButtonElement>('[data-testid^="button-sector-"]')]
      .find(button => button.textContent?.includes('Торговля и услуги')), signal.signal)
      .then(button => { if (!signal.signal.aborted && activeRef.current) button.click(); })
      .catch(() => { if (!signal.signal.aborted) setMessage('Направление не загрузилось. Выберите его вручную или пропустите тур.'); });
    return () => signal.abort();
  }, [session?.step, location, state.sectorId]);

  useEffect(() => {
    if (!session || session.step !== 5 || location !== '/simulation') return;
    const signal = new AbortController();
    void waitFor(() => document.querySelector<HTMLButtonElement>('[aria-label="Скорость модели ×10"]'), signal.signal)
      .then(button => { if (!signal.signal.aborted && activeRef.current && button.getAttribute('aria-pressed') !== 'true') button.click(); })
      .catch(() => { if (!signal.signal.aborted) setMessage('Скорость ×10 недоступна для этой сцены.'); });
    return () => signal.abort();
  }, [session?.step, location]);

  useEffect(() => {
    if (!session) return;
    let raf = 0;
    let lastTarget: Element | null = null;
    const update = () => {
      raf = 0;
      const found = targets(session.step, state.objectType);
      const first = found[0]?.element;
      if (first && first !== lastTarget) {
        lastTarget = first;
        first.scrollIntoView({ block: 'center', inline: 'nearest' });
      }
      const next = found.map(({ element, frame }) => rectFor(element, frame))
        .filter(box => box.width > 0 && box.height > 0 && box.top < innerHeight && box.top + box.height > 0);
      setBoxes(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(update); };
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    const frame = document.querySelector<HTMLIFrameElement>('[data-testid="iframe-robotization-map"]');
    const frameObserver = new MutationObserver(schedule);
    if (session.step === 0 && frame?.contentDocument?.body) {
      frameObserver.observe(frame.contentDocument.body, { childList: true, subtree: true });
    }
    frame?.addEventListener('load', schedule);
    window.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
    schedule();
    const timeout = window.setTimeout(() => {
      if (!targets(session.step, state.objectType).length) setMessage('Элемент не появился за 15 секунд. Можно продолжить или пропустить демо.');
    }, 15_000);
    return () => {
      observer.disconnect();
      frameObserver.disconnect();
      frame?.removeEventListener('load', schedule);
      window.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
      cancelAnimationFrame(raf);
      clearTimeout(timeout);
    };
  }, [session?.step, location, state.objectType]);

  const next = async () => {
    if (!session || busy) return;
    if (session.step === 5) return stop();
    const signal = new AbortController();
    controller.current = signal;
    setBusy(true);
    setMessage('');
    try {
      if (session.step === 0) {
        setLocation('/quick-select');
        setSession({ active: true, step: 1 });
      } else if (session.step === 1) {
        const button = await waitFor(() => query('[data-testid="button-choose-object-warehouse"]') as HTMLButtonElement | null, signal.signal);
        button.click();
        await waitFor(() => query('[data-testid="object-setup-form"]'), signal.signal);
        if (activeRef.current) setSession({ active: true, step: 2 });
      } else if (session.step === 2) {
        await waitFor(() => query('[data-testid="object-setup-form"]'), signal.signal);
        const groups = [...document.querySelectorAll<HTMLElement>('[data-testid^="object-group-"]')];
        if (groups.length) {
          for (let index = groups.findIndex(group => group.getAttribute('aria-current') === 'step'); index < groups.length - 1; index++) {
            if (signal.signal.aborted) return;
            const button = query('[data-testid="object-next-step"]') as HTMLButtonElement | null;
            if (!button) throw new Error('Кнопка «Далее» на форме не найдена');
            button.click();
            await waitFor(() => groups[index + 1]?.getAttribute('aria-current') === 'step' ? groups[index + 1] : null, signal.signal);
          }
        }
        const submit = query('[data-testid="object-submit"]') as HTMLButtonElement | null;
        if (!submit) throw new Error('Кнопка сохранения объекта не найдена');
        submit.click();
        await waitFor(() => query('[data-testid="page-solutions"]'), signal.signal);
        if (activeRef.current) setSession({ active: true, step: 3 });
      } else if (session.step === 3) {
        const button = await waitFor(calcButton, signal.signal);
        button.click();
        await waitFor(() => query('[data-testid="tab-tco-cards"]') || query('[data-testid="alert-calculation-unavailable"]'), signal.signal);
        if (query('[data-testid="alert-calculation-unavailable"]')) throw new Error('Для выбранной модели расчёт недоступен');
        if (activeRef.current) setSession({ active: true, step: 4 });
      } else if (session.step === 4) {
        const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.includes('Перейти к симуляции'));
        if (!button) throw new Error('Кнопка перехода к симуляции не найдена');
        button.click();
        await waitFor(() => query('[data-testid="page-simulation"]') || query('[data-testid="alert-simulation-unavailable"]'), signal.signal);
        if (query('[data-testid="alert-simulation-unavailable"]')) throw new Error('Для выбранного решения симуляция недоступна');
        if (activeRef.current) setSession({ active: true, step: 5 });
      }
    } catch (error) {
      if (!signal.signal.aborted) setMessage(error instanceof Error ? error.message : 'Переход не удался');
    } finally {
      if (controller.current === signal) controller.current = null;
      if (activeRef.current) setBusy(false);
    }
  };

  return (
    <DemoContext.Provider value={{ start }}>
      {children}
      {session && (
        <>
          {boxes.map((box, index) => (
            <div key={index} aria-hidden="true" className="pointer-events-none fixed z-[90] rounded-lg"
              style={{
                left: box.left - 5, top: box.top - 5, width: box.width + 10, height: box.height + 10,
                boxShadow: '0 0 0 2px #3BE68F, 0 0 0 7px rgba(59,230,143,.18), 0 0 28px rgba(59,230,143,.48)',
              }}
            />
          ))}
          <div role="region" aria-label="Демо-тур" data-testid="demo-tour-nav"
            className="fixed inset-x-0 bottom-0 z-[100] mx-auto w-full border-t border-[#3BE68F]/40 bg-[#111C31]/95 p-4 text-slate-100 shadow-2xl backdrop-blur-md sm:bottom-5 sm:max-w-2xl sm:rounded-xl sm:border">
            <div className="flex items-start gap-4">
              <span className="shrink-0 font-mono text-sm font-bold text-[#3BE68F]">{String(session.step + 1).padStart(2, '0')} / 06</span>
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 text-sm font-medium leading-5 sm:line-clamp-none" data-testid="demo-tour-text">{texts[session.step]}</p>
                {message && <p role="status" className="mt-1 text-xs text-amber-300">{message}</p>}
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between gap-2">
              <div className="flex gap-1.5" aria-label={`Шаг ${session.step + 1} из 6`}>
                {texts.map((_, index) => <span key={index} aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${index <= session.step ? 'bg-[#3BE68F]' : 'bg-slate-600'}`} />)}
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={stop} data-testid="demo-tour-skip" className="rounded-md px-2 py-2 text-xs text-slate-300 hover:text-white">Пропустить демо</button>
                <button type="button" onClick={() => void next()} disabled={busy} data-testid="demo-tour-next"
                  className="min-w-20 rounded-md bg-[#3BE68F] px-3 py-2 text-xs font-bold text-[#0A101D] hover:bg-[#70f4af] disabled:opacity-60">
                  {busy ? 'Переход…' : session.step === 5 ? 'Завершить демо' : 'Далее'}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </DemoContext.Provider>
  );
}