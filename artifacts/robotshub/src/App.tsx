import { type ReactNode, useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';

import { ProjectProvider } from '@/store/project';
import { Layout } from '@/components/layout';

import Home from '@/pages/home';
import QuickSelect from '@/pages/quick-select';
import ObjectSetup from '@/pages/object-setup';
import Solutions from '@/pages/solutions';
import Calc from '@/pages/calc';
import Simulation from '@/pages/simulation';
import SimulationSandbox from '@/pages/simulation-sandbox';
import Report from '@/pages/report';
import Cases from '@/pages/cases';
import CaseArticle from '@/pages/case-article';
import NotFound from '@/pages/not-found';

const queryClient = new QueryClient();

function Router() {
  return (
    <>
      <ScrollToTop />
      <Layout>
        <RoutedErrorBoundary>
          <Switch>
            <Route path="/" component={Home} />
            <Route path="/quick-select" component={QuickSelect} />
            <Route path="/object" component={ObjectSetup} />
            <Route path="/solutions" component={Solutions} />
            <Route path="/calc" component={Calc} />
            <Route path="/simulation/sandbox" component={SimulationSandbox} />
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
            <Router />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </ProjectProvider>
    </QueryClientProvider>
  );
}

export default App;
