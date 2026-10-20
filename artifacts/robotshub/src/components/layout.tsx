import { useEffect, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { useProject } from '@/store/project';
import { BRAND_FULL_NAME, BRAND_NAME, BRAND_TAGLINE } from '@/lib/brand';
import {
  Map,
  Sparkles,
  Settings2, 
  ListTree, 
  Calculator, 
  PlaySquare, 
  FileBarChart,
  Info,
  House,
  Menu,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { applyPageMetadata } from '@/lib/page-seo';

const STEPS = [
  { path: '/', label: 'Главная', icon: House },
  { path: '/map', label: 'Карта', icon: Map },
  { path: '/start', label: 'Разбор объекта', icon: Sparkles },
  { path: '/object', label: 'Объект', icon: Settings2 },
  { path: '/solutions', label: 'Каталог', icon: ListTree },
  { path: '/calc', label: 'Экономика', icon: Calculator },
  { path: '/simulation', label: 'Симуляция', icon: PlaySquare },
  { path: '/report', label: 'Отчет', icon: FileBarChart },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { state, projectStorageUnavailable, retryProjectStorage } = useProject();
  const isHome = location === '/map';
  const isMainPage = location === '/';
  const brandLogo = `${import.meta.env.BASE_URL}brand/logo.jpg`;
  const [navOpen, setNavOpen] = useState(false);
  useEffect(() => {
    setNavOpen(false);
    applyPageMetadata(location);
  }, [location]);

  const isStepAccessible = (stepPath: string) => {
    if (stepPath === '/') return true;
    if (stepPath === '/map') return true;
    if (stepPath === '/start') return true;
    if (stepPath === '/object') return !!state.objectType;
    if (stepPath === '/solutions') return true;
    if (stepPath === '/calc') return true;
    if (stepPath === '/simulation') return state.selectedSolutions.length > 0;
    if (stepPath === '/report') return true;
    return false;
  };

  return (
    <div className={cn("flex flex-col bg-background", isHome ? "h-[100dvh] overflow-hidden" : "min-h-[100dvh]")}>
      <header className={cn("sticky top-0 z-50 w-full border-b border-border bg-background", isHome && "bg-[#0A101D] border-[#22304A] min-[1081px]:absolute min-[1081px]:left-0 min-[1081px]:right-[380px] min-[1081px]:w-auto")}>
        <div className="container mx-auto w-full max-w-none flex items-start justify-between gap-2 px-4 py-2 sm:h-16 sm:items-center sm:justify-between sm:gap-4 sm:py-0">
          <Link href="/" className="flex min-w-fit items-center gap-3" aria-label={BRAND_FULL_NAME}>
            <img
              src={brandLogo}
              alt=""
              className="h-10 w-10 rounded-lg border border-primary/60 object-cover"
            />
            <span className="flex flex-col gap-0.5">
              <span className="text-base font-semibold leading-5 text-foreground">{BRAND_NAME}</span>
              <span className="text-xs leading-4 text-muted-foreground">{BRAND_TAGLINE}</span>
            </span>
          </Link>
          
          <button
            type="button"
            className="rounded-md border border-border p-2 text-muted-foreground hover:text-foreground sm:hidden"
            aria-expanded={navOpen}
            aria-label={navOpen ? "Закрыть меню" : "Открыть меню"}
            aria-controls="mobile-nav"
            data-testid="button-nav-toggle"
            onClick={() => setNavOpen(value => !value)}
          >
            {navOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
          <nav className="no-scrollbar hidden min-w-0 items-center gap-1 overflow-x-auto sm:flex sm:w-auto">
            {isMainPage ? (
              <>
                <Link href="/map" className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-secondary hover:text-foreground" data-testid="nav-light-map">
                  <Map className="h-4 w-4" />Карта
                </Link>
                <Link href="/solutions" className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-secondary hover:text-foreground" data-testid="nav-light-catalog">
                  <ListTree className="h-4 w-4" />Каталог
                </Link>
                <Link href="/start" className="ml-2 flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90" data-testid="nav-light-cta">
                  Описать объект
                </Link>
              </>
            ) : STEPS.map((step, index) => {
              const accessible = isStepAccessible(step.path);
              const active = location === step.path;
              
              return (
                <div key={step.path} className="flex items-center">
                  {index > 0 && <div className={cn("w-4 h-[1px] bg-border mx-1", isHome && "min-[1081px]:w-2 min-[1081px]:mx-0.5")} />}
                  {accessible ? (
                    <Link
                      href={step.path}
                      className={cn(
                        "flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors whitespace-nowrap", isHome && "min-[1081px]:px-2.5 min-[1081px]:gap-1.5",
                        active 
                          ? "bg-primary text-primary-foreground" 
                          : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                      )}
                    >
                      <step.icon className={cn("w-4 h-4", isHome && "min-[1081px]:max-[1439px]:hidden")} />
                      {step.label}
                    </Link>
                  ) : (
                    <div className={cn("flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium text-muted-foreground/50 cursor-not-allowed whitespace-nowrap", isHome && "min-[1081px]:px-2.5")}>
                      <step.icon className={cn("w-4 h-4", isHome && "min-[1081px]:max-[1439px]:hidden")} />
                      {step.label}
                    </div>
                  )}
                </div>
              );
            })}
          </nav>
        </div>
        {navOpen && (
          <nav id="mobile-nav" className="border-t border-border bg-background sm:hidden" data-testid="mobile-nav" aria-label="Основная навигация">
            <div className="container mx-auto w-full max-w-none flex flex-col px-2 py-2">
              {STEPS.map(step => {
                const accessible = isStepAccessible(step.path);
                const active = location === step.path;
                const content = (
                  <>
                    <step.icon className="h-4 w-4 shrink-0" />
                    <span className="flex-1">{step.label}</span>
                    {!accessible && <span className="text-xs text-muted-foreground/60">шаг позже</span>}
                  </>
                );
                const itemClass = cn(
                  "flex items-center gap-3 rounded-md px-3 py-3 text-sm font-medium",
                  active
                    ? "bg-primary text-primary-foreground"
                    : accessible
                      ? "text-foreground hover:bg-secondary"
                      : "text-muted-foreground/50 cursor-not-allowed",
                );
                const mobileTestId = `nav-mobile-${step.path === '/' ? 'home' : step.path.replace('/', '')}`;
                return accessible ? (
                  <Link key={step.path} href={step.path} className={itemClass} onClick={() => setNavOpen(false)} data-testid={mobileTestId}>
                    {content}
                  </Link>
                ) : (
                  <div key={step.path} className={itemClass} aria-disabled="true" data-testid={mobileTestId}>
                    {content}
                  </div>
                );
              })}
            </div>
          </nav>
        )}
      </header>

        {projectStorageUnavailable && (
          <div className="container mx-auto w-full max-w-none px-4 pt-4">
            <Alert
              className="border-amber-500/40 bg-amber-500/10 text-amber-100"
              data-testid="alert-project-storage"
            >
              <Info className="h-4 w-4" />
              <AlertTitle>Сохранение недоступно</AlertTitle>
              <AlertDescription className="text-amber-100/80">
                <p>
                  Браузер запретил доступ к локальному хранилищу. Объект, каталог, экономика, симуляция и отчёт доступны,
                  но изменения не сохранятся после обновления страницы.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-3 border-amber-200/50 bg-transparent text-amber-100 hover:bg-amber-100/10 hover:text-amber-50"
                  data-testid="button-retry-project-storage"
                  onClick={retryProjectStorage}
                >
                  Повторить проверку сохранения
                </Button>
              </AlertDescription>
            </Alert>
          </div>
        )}
      {isMainPage ? children : (
      <main className={cn("flex-1 flex flex-col relative", isHome && "min-h-0")}>
        {children}
      </main>
      )}
      <footer className={cn("border-t border-border bg-secondary/30", isHome && "hidden")}>
        <div className="container mx-auto w-full max-w-none flex flex-col gap-3 px-4 py-6 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <Link href="/" className="flex items-center gap-3" aria-label={BRAND_FULL_NAME}>
            <img src={brandLogo} alt="" className="h-10 w-10 rounded-md object-cover" />
            <span className="flex flex-col gap-0.5">
              <span className="text-sm font-semibold text-foreground">{BRAND_NAME}</span>
              <span className="text-xs">{BRAND_TAGLINE}</span>
            </span>
          </Link>
          <nav className="flex flex-wrap items-center gap-x-5 gap-y-2" aria-label="Дополнительная навигация">
            <Link href="/cases" data-testid="footer-cases-link" className="font-medium text-foreground transition-colors hover:text-primary">Кейсы внедрения</Link>
            <Link href="/map" data-testid="footer-map-link" className="font-medium text-foreground transition-colors hover:text-primary">Карта роботизации</Link>
            <a href={`${import.meta.env.BASE_URL}glossary/`} data-testid="footer-glossary-link" className="font-medium text-foreground transition-colors hover:text-primary">Глоссарий</a>
            <a href={`${import.meta.env.BASE_URL}news`} data-testid="footer-news-link" className="font-medium text-foreground transition-colors hover:text-primary">Новости</a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
