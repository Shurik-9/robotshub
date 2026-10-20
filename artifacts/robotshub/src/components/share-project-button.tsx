import { Share2 } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { useProject } from '@/store/project';
import { createProjectShareUrl } from '@/lib/project-sharing';

export function ShareProjectButton({ className }: { className?: string }) {
  const { state } = useProject();

  const share = async () => {
    try {
      const url = createProjectShareUrl(state);
      let copied = false;
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(url);
          copied = true;
        }
      } catch {
        // Embedded previews can deny clipboard access; try the browser's copy command.
      }
      if (!copied) {
        const input = document.createElement('textarea');
        input.value = url;
        input.style.position = 'fixed';
        input.style.opacity = '0';
        document.body.append(input);
        input.select();
        try {
          if (!document.execCommand('copy')) throw new Error('Буфер обмена недоступен');
        } finally {
          input.remove();
        }
      }
      toast({ title: 'Ссылка скопирована', description: 'Она откроет этот расчёт с теми же вводными.' });
    } catch (error) {
      toast({
        title: 'Не удалось создать ссылку',
        description: error instanceof Error ? error.message : 'Попробуйте ещё раз.',
      });
    }
  };

  return (
    <Button type="button" variant="outline" className={className} onClick={share} data-testid="button-share-project">
      <Share2 className="mr-2 h-4 w-4" />
      Поделиться расчётом
    </Button>
  );
}
