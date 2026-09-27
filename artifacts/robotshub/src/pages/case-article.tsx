import { ArrowLeft, Check, ExternalLink, ShieldCheck } from 'lucide-react';
import { Link, useRoute } from 'wouter';
import { CASES, type CaseStudy } from '@/pages/cases';

function Passport({ item }: { item: CaseStudy }) {
  return (
    <section data-testid={`case-passport-${item.number}`} className="border-t border-border pt-7">
      <div className="mb-5 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        <ShieldCheck className="h-4 w-4 text-accent" />
        Паспорт внедрения
      </div>
      <dl className="grid gap-x-8 gap-y-5 text-sm sm:grid-cols-2">
        <div className="min-w-0">
          <dt className="text-muted-foreground">Решение</dt>
          <dd className="mt-1 break-words font-medium text-foreground">{item.solutionName}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-muted-foreground">Вендор</dt>
          <dd className="mt-1 break-words font-medium text-foreground">{item.vendor}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-muted-foreground">Отрасль</dt>
          <dd className="mt-1 break-words font-medium text-foreground">{item.industry}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-muted-foreground">Регион (вендор)</dt>
          <dd className="mt-1 break-words font-medium text-foreground">{item.region}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-muted-foreground">Статус, УГТ (TRL)</dt>
          <dd className="mt-1 break-words font-medium text-foreground">{item.status ?? 'Эксплуатация'}, {item.trl}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-muted-foreground">Цена по каталогу</dt>
          <dd className="mt-1 break-words font-medium text-foreground">{item.price}</dd>
        </div>
        <div className="min-w-0 sm:col-span-2">
          <dt className="text-muted-foreground">Клиент / площадка</dt>
          <dd className="mt-1 break-words font-medium text-foreground">{item.client}</dd>
        </div>
      </dl>
    </section>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{title}</h2>
      <div className="mt-3 text-[1.02rem] leading-7 text-foreground/85">{children}</div>
    </section>
  );
}

export default function CaseArticle() {
  const [, params] = useRoute('/cases/:id');
  const item = CASES.find((caseStudy) => caseStudy.id === params?.id);

  if (!item) {
    return (
      <div className="container mx-auto w-full max-w-none px-4 py-16 sm:px-6 lg:px-8">
        <p className="text-sm text-muted-foreground">Такой кейс не найден.</p>
        <Link href="/cases" className="mt-5 inline-flex items-center gap-2 font-medium text-foreground hover:text-accent">
          <ArrowLeft className="h-4 w-4" />
          Вернуться к кейсам
        </Link>
      </div>
    );
  }

  return (
    <article className="bg-background">
      <header className="border-b border-border bg-secondary/35">
        <div className="container mx-auto w-full max-w-none px-4 pb-10 pt-8 sm:px-6 sm:pb-14 sm:pt-10 lg:px-8">
          <Link
            href="/cases"
            data-testid="case-article-back"
            className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Все кейсы
          </Link>
          <div className="mt-10 flex min-w-0 items-start gap-4">
            <span className="pt-1 font-mono text-sm font-semibold tracking-[0.16em] text-accent">{item.number}</span>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{item.industry}</p>
              <h1 data-testid={`case-article-title-${item.number}`} className="mt-4 max-w-5xl break-words text-3xl font-semibold leading-tight tracking-[-0.03em] text-foreground sm:text-5xl">
                {item.title}
              </h1>
            </div>
          </div>
          <div className="mt-8 max-w-4xl break-words border-l-2 border-accent pl-4 text-base font-semibold leading-7 text-foreground sm:text-lg">
            {item.metrics}
          </div>
          <p data-testid={`case-article-lead-${item.number}`} className="mt-6 max-w-4xl text-base leading-7 text-muted-foreground sm:text-lg">
            {item.lead}
          </p>
        </div>
      </header>

      <div className="container mx-auto w-full max-w-none px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
        <figure className="overflow-hidden border border-border bg-secondary/45 p-3 sm:p-6">
          {item.image ? (
            <img
              src={`${import.meta.env.BASE_URL}assets/cases/${item.image}`}
              alt={`Инфографика внедрения: ${item.title}`}
              data-testid={`case-article-image-${item.number}`}
              className="block h-auto w-full max-w-full object-contain"
            />
          ) : (
            <div data-testid={`case-article-image-missing-${item.number}`} className="flex min-h-64 items-center justify-center text-center text-sm text-muted-foreground">
              Для этого кейса инфографика не приложена
            </div>
          )}
          <figcaption className="border-t border-border px-1 pt-4 text-xs leading-5 text-muted-foreground">
            {item.image ? 'Инфографика кейса · ' : 'Текстовый кейс · '}Каталог внедрений ФЦ БАС, 2026
          </figcaption>
        </figure>

        <div className="mx-auto mt-10 grid max-w-5xl gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.62fr)]">
          <div className="min-w-0 space-y-8">
            <Section title="Задача">
              <p data-testid={`case-task-${item.number}`}>{item.task}</p>
            </Section>
            <Section title="Решение">
              <p data-testid={`case-solution-${item.number}`}>{item.solution}</p>
            </Section>
            <section className="border border-accent/45 bg-accent/10 p-5 sm:p-6">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-foreground">
                <Check className="h-4 w-4 text-accent" />
                Результат
              </div>
              <p data-testid={`case-result-${item.number}`} className="mt-3 text-lg font-bold leading-8 text-foreground">
                {item.result}
              </p>
            </section>
            <Section title="Почему это важно">
              <p data-testid={`case-importance-${item.number}`}>{item.importance}</p>
            </Section>
          </div>

          <aside className="min-w-0 lg:border-l lg:border-border lg:pl-8">
            <Passport item={item} />
          </aside>
        </div>

        <div className="mx-auto mt-10 flex max-w-5xl flex-col gap-5 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
          <p data-testid={`case-source-${item.number}`} className="flex min-w-0 items-start gap-2 text-xs leading-5 text-muted-foreground">
            <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Источник: Каталог внедрений ФЦ БАС, 2026. Статья опирается только на данные каталога.
          </p>
          <Link href="/cases" className="inline-flex shrink-0 items-center gap-2 text-sm font-medium text-foreground hover:text-accent">
            <ArrowLeft className="h-4 w-4" />
            К списку кейсов
          </Link>
        </div>
      </div>
    </article>
  );
}