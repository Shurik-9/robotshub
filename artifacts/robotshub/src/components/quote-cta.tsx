import { useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import { ArrowRight } from 'lucide-react';

type QuoteCtaProps = {
  solutionId: string;
  variant?: 'quote' | 'leasing';
  size?: 'default' | 'sm' | 'lg';
  className?: string;
};

export function QuoteCta({ solutionId, variant = 'quote', size = 'default', className }: QuoteCtaProps) {
  const [, setLocation] = useLocation();
  const leasing = variant === 'leasing';
  const href = leasing
    ? `/lead?solution=${encodeURIComponent(solutionId)}&via=leasing`
    : `/lead?solution=${encodeURIComponent(solutionId)}&via=quote`;

  return (
    <Button
      type="button"
      size={size}
      className={className}
      onClick={() => setLocation(href)}
      data-testid={`${leasing ? 'button-leasing' : 'button-request-quote'}-${solutionId}`}
    >
      {leasing ? 'Оформить в лизинг' : 'Запросить КП'}
      <ArrowRight className="ml-2 h-4 w-4" />
    </Button>
  );
}
