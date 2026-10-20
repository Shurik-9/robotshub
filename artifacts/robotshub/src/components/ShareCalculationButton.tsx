import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { IconSourceDoc } from '@/components/brand-icons';
import { useToast } from '@/hooks/use-toast';
import {
  createSharedCalculationUrl,
  type ShareableProjectState,
} from '@/lib/project-sharing';

interface ShareCalculationButtonProps {
  state: ShareableProjectState;
  className?: string;
  children?: ReactNode;
}

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const input = document.createElement('textarea');
  input.value = value;
  input.setAttribute('readonly', '');
  input.style.position = 'fixed';
  input.style.opacity = '0';
  document.body.appendChild(input);
  input.select();
  const copied = document.execCommand('copy');
  input.remove();
  if (!copied) throw new Error('Буфер обмена недоступен в этом браузере.');
}

export function ShareCalculationButton({
  state,
  className,
  children = 'Поделиться расчётом',
}: ShareCalculationButtonProps) {
  const { toast } = useToast();

  const handleShare = async () => {
    try {
      await copyText(createSharedCalculationUrl(state));
      toast({ title: 'Ссылка скопирована' });
    } catch (error) {
      toast({
        title: 'Не удалось скопировать ссылку',
        description: error instanceof Error ? error.message : 'Попробуйте ещё раз.',
      });
    }
  };

  return (
    <Button
      type="button"
      variant="outline"
      className={className}
      onClick={handleShare}
      data-testid="button-share-calculation"
    >
      <IconSourceDoc size={17} className="mr-2" />
      {children}
    </Button>
  );
}
