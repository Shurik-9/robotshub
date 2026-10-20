import { type ReactNode, useEffect, useRef } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';

import { ProjectProvider } from '@/store/project';
import { Layout } from '@/components/layout';
import { DemoTourProvider } from '@/components/demo-tour';

import Home from '@/pages/home';
import RobotMap from '@/pages/robot-map';
import Start from '@/pages/start';
import HowItWorks from '@/pages/kak-eto-rabotaet';
import QuickSelect from '@/pages/quick-select';
import ObjectSetup from '@/pages/object-setup';
import Solutions from '@/pages/solutions';
import Calc from '@/pages/calc';
import Simulation from '@/pages/simulation';
import Report from '@/pages/report';
import Cases from '@/pages/cases';
import CaseArticle from '@/pages/case-article';
import Compare from '@/pages/compare';
import SolutionDetail from '@/pages/solution-detail';
import Vendors from '@/pages/vendors';
import NotFound from '@/pages/not-found';

declare global {
  interface Window {
    YM_ID?: number;
    ym?: (
      counterId: number,
      method: 'hit',
      url: string,
      options?: { referer?: string; title?: string },
    ) => void;
  }
}

const queryClient = new QueryClient();

function YandexMetrikaPageTracker() {
  const [location] = useLocation();
  const lastSentUrl = useRef<string | null>(null);

  useEffect(() => {
    const counterId = window.YM_ID;
    if (!counterId || typeof window.ym !== 'function') return;

    const currentUrl = window.location.href;
    if (lastSentUrl.current === currentUrl) return;

    window.ym(counterId, 'hit', currentUrl, {
      referer: lastSentUrl.current ?? document.referrer,
      title: document.title,
    });
    lastSentUrl.current = currentUrl;
  }, [location]);

  return null;
}

function Router() {
  return (
    <>
      <ScrollToTop />
      <Layout>
        <RoutedErrorBoundary>
          <Switch>
            <Route path="/" component={Home} />
            <Route path="/map" component={RobotMap} />
            <Route path="/start" component={Start} />
            <Route path="/kak-eto-rabotaet" component={HowItWorks} />
            <Route path="/quick-select" component={QuickSelect} />
            <Route path="/object" component={ObjectSetup} />
            <Route path="/solutions" component={Solutions} />
            <Route path="/solutions/:id" component={SolutionDetail} />
            <Route path="/compare" component={Compare} />
            <Route path="/vendors" component={Vendors} />
            <Route path="/calc" component={Calc} />
            <Route path="/simulation" component={Simulation} />
            <Route path="/report" component={Report} />
            <Route path="/cases" component={Cases} />
            <Route path="/cases/:id" component={CaseArticle} />
            <Route component={NotFound} />
          </Switch>
        </RoutedErrorBoundary>
      </Layout>
    </>
  );
}

function ScrollToTop() {
  const [location] = useLocation();

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [location]);

  return null;
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ProjectProvider>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
            <YandexMetrikaPageTracker />
            <DemoTourProvider><Router /></DemoTourProvider>
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </ProjectProvider>
    </QueryClientProvider>
  );
}

export default App;
