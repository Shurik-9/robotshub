import { ArrowLeft } from 'lucide-react';
import { useLocation } from 'wouter';
import { Button } from '@/components/ui/button';

export function StepNav({
  step,
  label,
  backTo,
  backLabel,
  testId = 'button-back-step',
}: {
  step: string;
  label: string;
  backTo: string;
  backLabel: string;
  testId?: string;
}) {
  const [, setLocation] = useLocation();

  return (
    <div
      className="flex flex-wrap items-center justify-between gap-2 print:hidden"
      data-testid="step-nav"
      role="group"
      aria-label={`Маршрут подбора, шаг ${step}: ${label}`}
    >
      <p className="font-mono text-xs uppercase tracking-[0.18em] text-primary">
        Маршрут подбора / {step} — {label}
      </p>
      <Button
        variant="ghost"
        size="sm"
        className="-ml-2 text-muted-foreground hover:bg-transparent hover:text-foreground"
        onClick={() => setLocation(backTo)}
        data-testid={testId}
      >
        <ArrowLeft className="mr-2 h-4 w-4" />
        {backLabel}
      </Button>
    </div>
  );
}
