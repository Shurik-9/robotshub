import { useLocation, useParams } from 'wouter';
import { useState } from 'react';
import './solutions-cards.css';
import { CatalogDescriptionSource } from '@/components/catalog-description-source';
import { ArrowLeft, ArrowRight, Check, ExternalLink, FileText, Layers, ShieldCheck, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { QuoteCta } from '@/components/quote-cta';
import { FloatingCompareBar } from '@/components/floating-compare-bar';
import { IconRobotAmr } from '@/components/brand-icons';
import { useComparisonSelection } from '@/hooks/use-comparison-selection';
import { useProject } from '@/store/project';
import {
  getCompanyProfile,
  getSolutionDataStatus,
  getSolutionRole,
  getSolutionSpecLabel,
  getSolutionSummary,
  getSolutionTypeLabel,
} from '@/lib/solutionPresentation';
import { getSolutionSourceLinks, getSolutionCases, getRelatedSolutions } from '@/lib/solution-connections';
import { CASES } from '@/pages/cases';
import solutionsData from '@/data/solutions.json';

const HIDDEN_SPEC_KEYS = new Set(['source_url', 'purpose', 'checked_at', 'unconfirmed', 'source', 'verified_at']);

function statusLabel(status?: string) {
  return status === 'operation' ? 'В эксплуатации' : status === 'pilot' ? 'Пилот' : 'НИОКР';
}

const SPEC_UNITS: Record<string, string> = {
  payload_kg: 'кг', own_weight_kg: 'кг', dims_mm: 'мм', speed_mps: 'м/с',
  charge_time_min: 'мин', runtime_h: 'ч', positioning_accuracy_mm: 'мм',
  operating_temp_c: '°C',
};

function formatSpec(key: string, value: unknown) {
  if (value == null) return null;
  if (Array.isArray(value)) return value.join(', ');
  if (value && typeof value === 'object') return null;
  if (typeof value === 'boolean') return value ? 'Да' : 'Нет';
  const text = typeof value === 'number'
    ? new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 6 }).format(value)
    : String(value);
  const unit = SPEC_UNITS[key];
  return unit && !/[a-zа-я°]/i.test(text) ? `${text} ${unit}` : text;
}

export default function SolutionDetail() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const comparison = useComparisonSelection();
  const { state, toggleSolution } = useProject();
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const variants = solutionsData.items.filter(item => item.id === id);
  const solution = variants[0];

  if (!solution) {
    return (
      <main className="min-h-[70dvh] px-4 py-16 text-center" data-testid="solution-detail-not-found">
        <h1 className="text-2xl font-semibold">Решение не найдено</h1>
        <p className="mt-2 text-muted-foreground">Модель могла быть удалена из каталога или ссылка неполная.</p>
        <Button type="button" className="mt-5" onClick={() => setLocation('/solutions')}>Вернуться в каталог</Button>
      </main>
    );
  }

  const specs = Object.entries(solution.specs ?? {})
    .filter(([key]) => !HIDDEN_SPEC_KEYS.has(key))
    .map(([key, value]) => [key, formatSpec(key, value)] as const)
    .filter((entry): entry is readonly [string, string] => Boolean(entry[1]));
  const sources = getSolutionSourceLinks(solution);
  const cases = getSolutionCases(solution.id, CASES);
  const related = getRelatedSolutions(solution.id, 3);
  const company = getCompanyProfile(solution);
  const industries = Array.from(new Set(variants.map(v => v.industry).filter(Boolean)));
  const regions = Array.from(new Set(variants.map(v => v.region).filter(Boolean)));
  const isSelected = state.selectedSolutions.includes(solution.id);
  const inComparison = comparison.ids.includes(solution.id);
  const price = solution.price_rub
    ? `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(solution.price_rub)} ₽`
    : 'По запросу';
  const showImage = solution.img && failedImage !== solution.img;
  const isModelImage = solution.img_kind === 'vendor-photo' || solution.img_kind === 'catalog-photo';

  return (
    <main className="min-h-[70dvh] px-4 py-8 sm:px-6" data-testid={`page-solution-detail-${solution.id}`}>
      <article className="mx-auto max-w-6xl">
        <button type="button" onClick={() => setLocation('/solutions')} className="mb-5 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground" data-testid="button-detail-back">
          <ArrowLeft className="h-4 w-4" /> Каталог решений
        </button>

        <div className="grid gap-8 lg:grid-cols-[minmax(0,420px)_1fr]">
          <div className="overflow-hidden rounded-2xl border border-border bg-[#0B1424]">
            <div className="relative aspect-square w-full" data-testid={`photo-detail-${solution.id}`}>
              {showImage ? (
                <img src={solution.img!} alt={isModelImage ? solution.name : `Типовое изображение: ${solution.name}`}
                  className="h-full w-full object-contain p-6" onError={() => setFailedImage(solution.img)} />
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
                  <IconRobotAmr size={64} className="text-primary/55" />
                  <span className="text-sm">Изображение не найдено</span>
                </div>
              )}
              <span className="absolute left-3 top-3 rounded-full border border-primary/40 bg-[#07101f]/85 px-2.5 py-1 font-mono text-xs text-primary" data-testid="badge-detail-status">{statusLabel(solution.status)}</span>
              <span className="absolute right-3 top-3 rounded-full border border-white/20 bg-[#07101f]/85 px-2.5 py-1 font-mono text-xs text-slate-100" data-testid="badge-detail-trl">УГТ {solution.trl}/9</span>
            </div>
            <p className="border-t border-border px-4 py-3 text-sm leading-5 text-muted-foreground">
              {showImage && isModelImage
                ? `${solution.img_kind === 'catalog-photo' ? 'Изображение' : 'Фото'}: ${solution.img_source || 'источник не указан'}. Изображение не подтверждает характеристики.`
                : showImage ? 'Типовое изображение класса техники, не фото вендора.' : 'Фото модели в каталоге отсутствует.'}
            </p>
          </div>

          <div className="flex min-w-0 flex-col">
            <p className="font-mono text-xs uppercase tracking-[.16em] text-primary">{solution.vendor}</p>
            <h1 className="mt-2 break-words text-3xl font-semibold leading-tight sm:text-4xl" data-testid="text-detail-name">{solution.name}</h1>
            {solution.tagline && <p className="mt-3 text-base leading-7 text-foreground">{solution.tagline}</p>}
            <p className="mt-3 text-sm leading-7 text-muted-foreground" data-testid="text-detail-summary">{solution.desc_real || getSolutionSummary(solution)}</p>
            {solution.desc_real && solution.specs_source
              ? <p className="mt-1 text-sm text-muted-foreground">Источник описания: {solution.specs_source}</p>
              : <CatalogDescriptionSource solution={solution} />}

            <dl className="mt-5 grid gap-3 sm:grid-cols-2">
              {[
                ['Тип', getSolutionTypeLabel(solution)],
                ['Сценарий', getSolutionRole(solution)],
                ['Отрасли в каталоге', industries.join(', ') || 'Не указаны'],
                ['Регион', regions.join(', ') || 'Не указан'],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl border border-border bg-card p-3">
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="mt-1 break-words text-sm font-medium">{value}</dd>
                </div>
              ))}
            </dl>

            <div className="mt-5 rounded-xl border border-border bg-card p-4">
              <p className="font-mono text-xl font-bold text-[#3BE68F]" data-testid="text-detail-price">{price}</p>
              <p className="mt-1 text-xs text-muted-foreground">{solution.price_rub ? 'с НДС, без доставки и ПНР' : 'Цена в каталоге не указана'}</p>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                <QuoteCta solutionId={solution.id} className="w-full" />
                <QuoteCta solutionId={solution.id} variant="leasing" className="w-full" />
                <Button type="button" variant={isSelected ? 'default' : 'outline'} aria-pressed={isSelected}
                  onClick={() => toggleSolution(solution.id)} className="w-full" data-testid="button-detail-toggle-calc">
                  {isSelected ? 'В расчёте' : 'Добавить в расчёт'}
                </Button>
                <Button type="button" variant={inComparison ? 'secondary' : 'outline'} aria-pressed={inComparison}
                  onClick={() => comparison.toggle(solution.id)} className="w-full" data-testid="button-detail-compare">
                  {inComparison ? 'Выбрано для сравнения' : 'Добавить к сравнению'}
                </Button>
              </div>
            </div>
          </div>
        </div>

        <section className="mt-10 grid gap-6 lg:grid-cols-2">
          <div className="rounded-2xl border border-border bg-card p-5" data-testid="panel-detail-specs">
            <h2 className="text-lg font-semibold">Характеристики из карточки</h2>
            {specs.length ? (
              <dl className="mt-4 divide-y divide-border">
                {specs.map(([key, value]) => (
                  <div key={key} className="flex justify-between gap-4 py-3 text-sm" data-testid={`row-spec-${key}`}>
                    <dt className="text-muted-foreground first-letter:uppercase">{getSolutionSpecLabel(key)}</dt>
                    <dd className="break-words text-right font-medium">{value}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
            <p className="mt-4 flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm leading-6 text-amber-200" data-testid="text-detail-data-status">
              <AlertTriangle className="mt-1 h-4 w-4 shrink-0" />
              {getSolutionDataStatus(solution).replace('Подтверждено в карточке:', 'Указано в карточке:')}
            </p>
            <div className="mt-4 border-t border-border pt-4">
              <h3 className="text-sm font-semibold">Источник характеристик</h3>
              {sources.length ? (
                <ul className="mt-2 space-y-1.5">
                  {sources.map((link, index) => (
                    <li key={link.url}>
                      <a href={link.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-start gap-2 break-all text-sm text-primary underline underline-offset-2" data-testid={`link-detail-source-${index}`}>
                        <ExternalLink className="mt-0.5 h-4 w-4 shrink-0" />{link.label || link.host}
                      </a>
                    </li>
                  ))}
                </ul>
              ) : <p className="mt-2 text-sm text-muted-foreground">Ссылка на источник в карточке не указана — значения нужно подтвердить у поставщика.</p>}
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card p-5" data-testid="panel-detail-company">
            <h2 className="text-lg font-semibold">Компания</h2>
            <dl className="mt-4 divide-y divide-border text-sm">
              {[
                ['Компания в каталоге', company.company],
                ['Бренд', company.brand],
                ['Юрлицо', company.legalEntity],
                ['Роль', company.roleLabel],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between gap-4 py-3">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="break-words text-right font-medium">{value}</dd>
                </div>
              ))}
            </dl>
            {company.roleSourceUrl ? (
              <a href={company.roleSourceUrl} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex items-center gap-2 text-sm text-primary underline underline-offset-2" data-testid="link-detail-role-source">
                <ShieldCheck className="h-4 w-4" /> Источник подтверждения роли
              </a>
            ) : <p className="mt-3 text-sm text-muted-foreground">Роль компании не подтверждена первичным источником.</p>}

            <h3 className="mt-6 text-sm font-semibold">Заявленное применение</h3>
            <p className="mt-1 text-xs text-muted-foreground">Текст каталога, не паспортные характеристики.</p>
            <p className="mt-2 text-sm leading-7 text-muted-foreground">{solution.case_study || solution.hero || 'Описание применения в карточке не указано.'}</p>
            {(solution.bullets ?? []).length > 0 && (
              <ul className="mt-3 space-y-2">
                {solution.bullets.map((bullet, index) => (
                  <li key={index} className="flex gap-2 text-sm"><Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />{bullet}</li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section className="mt-6 rounded-2xl border border-border bg-card p-5" data-testid="panel-detail-cases">
          <h2 className="flex items-center gap-2 text-lg font-semibold"><FileText className="h-5 w-5 text-primary" />Опыт применения в кейсах</h2>
          <p className="mt-1 text-sm text-muted-foreground">Результаты кейсов относятся к конкретному объекту и не заменяют ТТХ модели.</p>
          {cases.length ? (
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              {cases.map(item => (
                <button key={item.id} type="button" onClick={() => setLocation(`/cases/${item.id}`)}
                  className="flex flex-col rounded-xl border border-border bg-secondary/30 p-4 text-left transition-colors hover:border-primary/50"
                  data-testid={`link-detail-case-${item.id}`}>
                  <span className="font-mono text-xs text-muted-foreground">Кейс {item.number} · {item.client} · {item.region}</span>
                  <span className="mt-1 font-semibold leading-6">{item.title}</span>
                  <span className="mt-2 text-sm leading-6 text-muted-foreground">{item.lead}</span>
                  {item.metrics && <span className="mt-2 text-sm text-foreground">Результат на объекте: {item.metrics}</span>}
                  <span className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-primary">Открыть кейс <ArrowRight className="h-4 w-4" /></span>
                </button>
              ))}
            </div>
          ) : <p className="mt-4 rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">В базе кейсов нет записи, однозначно связанной с этой моделью.</p>}
        </section>

        <section className="mt-6 rounded-2xl border border-border bg-card p-5" data-testid="panel-detail-related">
          <h2 className="flex items-center gap-2 text-lg font-semibold"><Layers className="h-5 w-5 text-primary" />Другие модели того же сценария</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">Общий сценарий не означает взаимозаменяемость: применимость к вашему объекту нужно проверить отдельно.</p>
          {related.length ? (
            <div className="mt-4 grid gap-4 md:grid-cols-3">
              {related.map(item => (
                <button key={item.id} type="button" onClick={() => { setLocation(`/solutions/${item.id}`); window.scrollTo(0, 0); }}
                  className="flex items-center gap-3 rounded-xl border border-border bg-secondary/30 p-3 text-left transition-colors hover:border-primary/50"
                  data-testid={`link-related-${item.id}`}>
                  <span className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-lg border border-border bg-[#0B1424]">
                    {item.img ? <img src={item.img} alt={item.name} loading="lazy" className="h-full w-full object-contain p-1" /> : <IconRobotAmr size={32} className="text-primary/55" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block break-words font-semibold leading-6">{item.name}</span>
                    <span className="block break-words text-sm text-muted-foreground">{item.vendor}</span>
                    <span className="mt-1 inline-flex items-center gap-1 text-sm text-primary">Страница модели <ArrowRight className="h-3.5 w-3.5" /></span>
                  </span>
                </button>
              ))}
            </div>
          ) : <p className="mt-4 text-sm text-muted-foreground">В каталоге нет других моделей с тем же сценарием, типом и классом.</p>}
        </section>
      </article>
      <FloatingCompareBar />
    </main>
  );
}
