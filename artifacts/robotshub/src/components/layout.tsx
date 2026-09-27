import { Link, useLocation } from 'wouter';
import { useProject } from '@/store/project';
import {
  Map,
  Sparkles,
  Settings2, 
  ListTree, 
  Calculator, 
  PlaySquare, 
  FileBarChart,
  Info,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

const STEPS = [
  { path: '/', label: 'Карта', icon: Map },
  { path: '/quick-select', label: 'Быстрый выбор', icon: Sparkles },
  { path: '/object', label: 'Объект', icon: Settings2 },
  { path: '/solutions', label: 'Каталог', icon: ListTree },
  { path: '/calc', label: 'Экономика', icon: Calculator },
  { path: '/simulation', label: 'Симуляция', icon: PlaySquare },
  { path: '/report', label: 'Отчет', icon: FileBarChart },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { state, projectStorageUnavailable, retryProjectStorage } = useProject();
  const isHome = location === '/';
  const brandLogo = `${import.meta.env.BASE_URL}brand/logo.jpg`;

  const isStepAccessible = (stepPath: string) => {
    if (stepPath === '/') return true;
    if (stepPath === '/quick-select') return true;
    if (stepPath === '/object') return !!state.objectType;
    if (stepPath === '/solutions') return true;
    if (stepPath === '/calc') return state.selectedSolutions.length > 0;
    if (stepPath === '/simulation') return state.selectedSolutions.length > 0;
    if (stepPath === '/report') return state.selectedSolutions.length > 0;
    return false;
  };

  return (
    <div className={cn("flex flex-col bg-background", isHome ? "h-[100dvh] overflow-hidden" : "min-h-[100dvh]")}>
      <header className={cn("sticky top-0 z-50 w-full border-b border-border bg-background", isHome && "bg-[#0A101D] border-[#22304A] min-[1081px]:absolute min-[1081px]:left-0 min-[1081px]:right-[380px] min-[1081px]:w-auto")}>
        <div className="container mx-auto w-full max-w-none flex flex-col gap-2 px-4 py-2 sm:h-16 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:py-0">
          <Link href="/" className="flex min-w-fit items-center gap-3" aria-label='Центр подбора роботизации «Железный аргумент»'>
            <img
              src={brandLogo}
              alt=""
              className="h-10 w-10 rounded-lg border border-primary/60 object-cover"
            />
            <span className="flex flex-col leading-none">
              <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                Центр подбора роботизации
              </span>
              <span className="mt-1 text-sm font-semibold tracking-tight text-foreground">
                «Железный аргумент»
              </span>
            </span>
          </Link>
          
          <nav className="no-scrollbar flex w-full items-center gap-1 overflow-x-auto sm:w-auto">
            {STEPS.map((step, index) => {
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
      </header>
      
      <main className={cn("flex-1 flex flex-col relative", isHome && "min-h-0")}>
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
        {children}
      </main>
      <footer className={cn("border-t border-border bg-secondary/30", location === '/' && "hidden")}>
        <div className="container mx-auto w-full max-w-none flex flex-col gap-3 px-4 py-6 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>Центр подбора роботизации «Железный аргумент»</span>
          <Link
            href="/cases"
            data-testid="footer-cases-link"
            className="font-medium text-foreground transition-colors hover:text-primary"
          >
            Кейсы внедрения
          </Link>
        </div>
      </footer>
    </div>
  );
}
