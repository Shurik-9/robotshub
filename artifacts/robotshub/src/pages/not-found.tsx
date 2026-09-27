import { Link } from "wouter";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-background">
      <h1 className="text-4xl font-bold mb-4">404 - Страница не найдена</h1>
      <p className="text-muted-foreground mb-8">Возможно, вы перешли по устаревшей ссылке.</p>
      <Link href="/">
        <Button>Вернуться на главную</Button>
      </Link>
    </div>
  );
}
