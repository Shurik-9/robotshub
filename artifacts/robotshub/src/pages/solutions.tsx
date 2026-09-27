import { useState, useMemo, type ReactNode } from 'react';
import { useLocation } from 'wouter';
import { useProject } from '@/store/project';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Search, Info, Check, X, Building2, MapPin, Activity, ArrowRight, ChevronDown, Target, ShieldAlert } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { IconRobotAmr } from '@/components/brand-icons';
import {
  getCompanyProfile,
  type CompanyRoleId,
} from '@/lib/solutionPresentation';
import {
  getMergedSolutionTaxonomy,
  getSolutionTaxonomy,
  areaDefinitions,
  operationDefinitions
} from '@/lib/solutionTaxonomy';
import { scoreSolutionMatch, type MatchReasonStatus } from '@/lib/solutionScoring';
import { evaluationLimit } from '@/lib/evaluationScope';
import { useSectorMap } from '@/lib/useSectorMap';

import solutionsData from '@/data/solutions.json';

const solutionGroups = new Map<string, typeof solutionsData.items>();
solutionsData.items.forEach((solution, index) => {
  const key = `${solution.name}|${solution.vendor}` || `${solution.id}-${index}`;
  const group = solutionGroups.get(key) ?? [];
  group.push(solution);
  solutionGroups.set(key, group);
});

const ALL_SOLUTIONS = Array.from(solutionGroups.values()).map(variants => ({
  ...variants[0],
  variants,
}));

const MAP_SECTOR_LABELS: Record<string, string> = {
  'sector-water': 'Водное хозяйство, акватории',
  'sector-mining': 'Горнодобыча и карьеры',
  'sector-medicine': 'Медицина',
};

function readMapSectorFilter() {
  const params = new URLSearchParams(window.location.search);
  const id = params.get('sector') ?? '';
  if (!Object.hasOwn(MAP_SECTOR_LABELS, id)) return null;
  const ids = new Set((params.get('ids') ?? '').split(',').filter(value =>
    /^[a-f0-9-]{36}$/i.test(value),
  ));
  return { id, label: MAP_SECTOR_LABELS[id], ids };
}

const MATCH_REASON_STYLES: Record<MatchReasonStatus, string> = {
  positive: 'text-[#3BE68F]',
  warning: 'text-[#FBBF24]',
  critical: 'text-destructive',
  neutral: 'text-muted-foreground',
};

type FilterSectionProps = {
  title: string;
  icon: ReactNode;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
};

function FilterSection({ title, icon, open, onToggle, children }: FilterSectionProps) {
  return (
    <section className="border-b border-border last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 py-3 text-left"
        data-testid={`filter-section-${title}`}
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
          {icon}
          {title}
        </span>
        <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
          {open ? 'Свернуть' : 'Раскрыть'}
          <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
        </span>
      </button>
      {open && <div className="pb-4">{children}</div>}
    </section>
  );
}

type SolutionImageProps = {
  id: string;
  name: string;
  img: string | null;
  imgKind: string | null;
  imgSource: string | null;
  imgLowres: boolean;
  status: string;
  statusLabel: string;
  trl: number;
};

function SolutionImage({
  id,
  name,
  img,
  imgKind,
  imgSource,
  imgLowres,
  status,
  statusLabel,
  trl,
}: SolutionImageProps) {
  const [failed, setFailed] = useState(false);
  const statusClasses = status === 'operation'
    ? 'border-[#3BE68F]/45 bg-[#3BE68F]/15 text-[#3BE68F]'
    : status === 'pilot'
      ? 'border-[#38D6F0]/45 bg-[#38D6F0]/15 text-[#38D6F0]'
      : 'border-[#B49AF8]/45 bg-[#B49AF8]/15 text-[#B49AF8]';
  const showPlaceholder = !img || failed;

  return (
    <div
      className="relative aspect-[16/10] overflow-hidden border-b border-border bg-[#0B1424]"
      data-testid={`photo-${id}`}
    >
      {showPlaceholder ? (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3 text-muted-foreground">
          <IconRobotAmr size={54} className="text-primary/55" />
          <span className="font-mono text-[11px] uppercase tracking-[0.12em]">Изображение не найдено</span>
        </div>
      ) : (
        <img
          src={img}
          alt={imgKind === 'vendor-photo' ? name : `Типовое изображение: ${name}`}
          width={1280}
          height={800}
          loading="lazy"
          decoding="async"
          className={imgLowres ? 'h-full w-full object-scale-down' : 'h-full w-full object-cover'}
          onError={() => setFailed(true)}
          data-testid={`img-${id}`}
        />
      )}
      <span className={`absolute left-3 top-3 rounded-full border px-2.5 py-1 font-mono text-[10px] font-semibold backdrop-blur-sm ${statusClasses}`} data-testid={`badge-status-${id}`}>
        {statusLabel}
      </span>
      <span className="absolute right-3 top-3 rounded-full border border-white/20 bg-[#07101f]/80 px-2.5 py-1 font-mono text-[10px] font-semibold text-slate-100 backdrop-blur-sm" data-testid={`badge-trl-${id}`}>
        УГТ {trl}/9
      </span>
      {!showPlaceholder && imgKind === 'vendor-photo' && (
        <div className="absolute inset-x-3 bottom-3 flex flex-wrap items-end justify-between gap-2">
          <span className="max-w-[75%] rounded-md border border-white/15 bg-[#07101f]/85 px-2 py-1 font-mono text-[9px] leading-tight text-slate-200 backdrop-blur-sm" data-testid={`credit-photo-${id}`}>
            Фото: {imgSource || 'источник не указан'}
          </span>
          {imgLowres && (
            <span className="rounded-full border border-[#FBBF24]/45 bg-[#FBBF24]/15 px-2 py-1 font-mono text-[9px] font-semibold text-[#FBBF24] backdrop-blur-sm" data-testid={`badge-lowres-${id}`}>
              низкое разрешение
            </span>
          )}
        </div>
      )}
      {!showPlaceholder && imgKind !== 'vendor-photo' && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="Об изображении"
              className="absolute bottom-3 left-3 flex h-7 w-7 items-center justify-center rounded-full border border-[#B49AF8]/45 bg-[#B49AF8]/15 font-mono text-xs font-bold text-[#B49AF8] backdrop-blur-sm"
              data-testid={`button-render-info-${id}`}
            >
              i
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">Типовое изображение класса техники, не фото вендора</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

export default function Solutions() {
  const [personalizedMode, setPersonalizedMode] = useState(false);
  const [, setLocation] = useLocation();
  const {
    state,
    setSectorId,
    projectRecoveryNotice,
    toggleSolution,
    selectSolutionForCalculation,
    clearSelectedSolutions,
  } = useProject();
  const [industryFilter, setIndustryFilter] = useState(
    () => new URLSearchParams(window.location.search).get('industry')?.trim() ?? '',
  );
  const [sectorFilter, setSectorFilter] = useState(readMapSectorFilter);
  const { sectors, error: sectorLoadError } = useSectorMap();
  const storedSector = sectors?.find(item => item.id === state.sectorId);
  const unresolvedSector = Boolean(state.sectorId && !storedSector && !industryFilter && !sectorFilter);
  const activeIndustry = industryFilter || (!sectorFilter && storedSector && !storedSector.thematic ? storedSector.id : '');
  const activeSector = sectorFilter || (!industryFilter && storedSector?.thematic
    ? {
        id: storedSector.id,
        label: storedSector.label,
        ids: new Set((storedSector.records ?? []).map(record => record.split('|')[0])),
      } : null);
  const activeDirectionId = activeSector?.id ?? activeIndustry;
  const directionMismatch = Boolean(activeDirectionId && state.objectType && state.sectorId !== activeDirectionId);
  const directionWarning = 'Текущий объект был выбран вне этого направления. Перед расчётом подтвердите отрасль и параметры площадки.';
  
  const [search, setSearch] = useState('');
  const [areaFilter, setAreaFilter] = useState('all');
  const [operationFilter, setOperationFilter] = useState('all');
  const [brandFilter, setBrandFilter] = useState('all');
  const [companyFilter, setCompanyFilter] = useState('all');
  const [roleFilter, setRoleFilter] = useState<'all' | CompanyRoleId>('all');
  const [openFilters, setOpenFilters] = useState({
    area: true,
    operation: true,
    brand: false,
    company: false,
  });

  const toggleFilter = (section: keyof typeof openFilters) => {
    setOpenFilters(current => ({ ...current, [section]: !current[section] }));
  };

  const resetCatalogFilters = () => {
    setSearch('');
    setAreaFilter('all');
    setOperationFilter('all');
    setBrandFilter('all');
    setCompanyFilter('all');
    setRoleFilter('all');
    setIndustryFilter('');
    setSectorFilter(null);
    setSectorId(null);
    setLocation('/solutions');
  };

  const hasActiveFilters = search.trim() !== ''
    || activeIndustry !== ''
    || activeSector !== null
    || areaFilter !== 'all'
    || operationFilter !== 'all'
    || brandFilter !== 'all'
    || companyFilter !== 'all'
    || roleFilter !== 'all';

  const rankedSolutions = useMemo(() => {
    const evaluated = ALL_SOLUTIONS.map(sol => {
      const tax = getMergedSolutionTaxonomy(sol.variants) ?? getSolutionTaxonomy(sol);
      const companyProfile = getCompanyProfile(sol);
      const match = scoreSolutionMatch(sol, {
        objectType: state.objectType,
        objectParams: state.objectParams,
        taxonomy: tax,
      });

      return {
        ...sol,
        matchScore: match.score,
        matchConfidence: match.confidence,
        matchReasons: match.reasons,
        criticalMismatch: match.criticalMismatch,
        tax,
        companyProfile,
      };
    });

    if (!personalizedMode) return evaluated;
    return evaluated.sort((a, b) => {
      if (Boolean(a.criticalMismatch) !== Boolean(b.criticalMismatch)) {
        return a.criticalMismatch ? 1 : -1;
      }
      return b.matchScore - a.matchScore || b.matchConfidence - a.matchConfidence;
    });
  }, [personalizedMode, state.objectParams, state.objectType]);

  const filterResults = useMemo(() => {
    type FilterDimension = 'area' | 'operation' | 'brand' | 'company' | 'role';

    const matches = (
      s: (typeof rankedSolutions)[number],
      ignoredDimension?: FilterDimension,
    ) => {
      const taxOpLabel = operationDefinitions.find(o => o.id === s.tax.operationId)?.label || '';
      const taxAreaLabel = areaDefinitions.find(a => a.id === s.tax.areaId)?.label || '';
      const haystack = `${s.name} ${s.vendor} ${s.scenario || ''} ${s.description || ''} ${taxOpLabel} ${taxAreaLabel} ${s.companyProfile.brand} ${s.companyProfile.roleLabel}`.toLowerCase();
      
      const matchSearch = haystack.includes(search.toLowerCase());
      const matchArea = ignoredDimension === 'area'
        || areaFilter === 'all'
        || s.tax.areaIds.includes(areaFilter as typeof s.tax.areaId);
      const matchOperation = ignoredDimension === 'operation'
        || operationFilter === 'all'
        || s.tax.operationIds.includes(operationFilter as typeof s.tax.operationId);
      const matchBrand = ignoredDimension === 'brand'
        || brandFilter === 'all'
        || s.companyProfile.brand === brandFilter;
      const matchCompany = ignoredDimension === 'company'
        || companyFilter === 'all'
        || s.companyProfile.company === companyFilter;
      const matchRole = ignoredDimension === 'role'
        || roleFilter === 'all'
        || (roleFilter === 'unconfirmed'
          ? s.companyProfile.confirmedRoles.length === 0
          : s.companyProfile.confirmedRoles.includes(roleFilter));
      const matchIndustry = activeIndustry === ''
        || s.variants.some(variant => variant.industry === activeIndustry);
      const matchSector = activeSector === null
        || s.variants.some(variant => activeSector.ids.has(variant.id));
      
      return !unresolvedSector && matchSearch && matchArea && matchOperation && matchBrand && matchCompany && matchRole && matchIndustry && matchSector;
    };

    const countBy = <T extends string>(
      values: readonly T[],
      dimension: FilterDimension,
      predicate: (solution: (typeof rankedSolutions)[number], value: T) => boolean,
    ) => new Map(values.map(value => [
      value,
      rankedSolutions.filter(solution => matches(solution, dimension) && predicate(solution, value)).length,
    ]));

    const roleIds: CompanyRoleId[] = ['manufacturer', 'supplier', 'integrator', 'unconfirmed'];

    return {
      filteredSolutions: rankedSolutions.filter(solution => matches(solution)),
      areaCounts: countBy(
        areaDefinitions.map(area => area.id),
        'area',
        (solution, areaId) => solution.tax.areaIds.includes(areaId),
      ),
      operationCounts: countBy(
        operationDefinitions.map(operation => operation.id),
        'operation',
        (solution, operationId) => solution.tax.operationIds.includes(operationId),
      ),
      brandCounts: countBy(
        Array.from(new Set(rankedSolutions.map(solution => solution.companyProfile.brand))),
        'brand',
        (solution, brand) => solution.companyProfile.brand === brand,
      ),
      companyCounts: countBy(
        Array.from(new Set(rankedSolutions.map(solution => solution.companyProfile.company))),
        'company',
        (solution, company) => solution.companyProfile.company === company,
      ),
      roleCounts: countBy(
        roleIds,
        'role',
        (solution, role) => role === 'unconfirmed'
          ? solution.companyProfile.confirmedRoles.length === 0
          : solution.companyProfile.confirmedRoles.includes(role),
      ),
      totalsWithout: {
        area: rankedSolutions.filter(solution => matches(solution, 'area')).length,
        operation: rankedSolutions.filter(solution => matches(solution, 'operation')).length,
        brand: rankedSolutions.filter(solution => matches(solution, 'brand')).length,
        company: rankedSolutions.filter(solution => matches(solution, 'company')).length,
      },
    };
  }, [rankedSolutions, search, areaFilter, operationFilter, brandFilter, companyFilter, roleFilter, activeIndustry, activeSector, unresolvedSector]);

  const {
    filteredSolutions,
    areaCounts,
    operationCounts,
    brandCounts,
    companyCounts,
    roleCounts,
    totalsWithout,
  } = filterResults;

  const availableAreas = useMemo(() => {
    const present = new Set(rankedSolutions.flatMap(s => s.tax.areaIds));
    return areaDefinitions.filter(a => present.has(a.id));
  }, [rankedSolutions]);

  const availableOperations = useMemo(() => {
    const present = new Set(rankedSolutions.flatMap(s => s.tax.operationIds));
    return operationDefinitions.filter(o => present.has(o.id));
  }, [rankedSolutions]);

  const availableBrands = useMemo(() => {
    const present = new Set(
      rankedSolutions
        .filter(s => s.companyProfile.brandStatus === 'confirmed')
        .map(s => s.companyProfile.brand),
    );
    return Array.from(present).sort((a, b) => a.localeCompare(b, 'ru'));
  }, [rankedSolutions]);

  const availableCompanies = useMemo(() => {
    const counts = new Map<string, number>();
    rankedSolutions.forEach(solution => {
      counts.set(solution.companyProfile.company, (counts.get(solution.companyProfile.company) ?? 0) + 1);
    });
    return Array.from(counts.entries()).sort(([a], [b]) => a.localeCompare(b, 'ru'));
  }, [rankedSolutions]);

  const availableRoles: Array<{ id: CompanyRoleId; label: string }> = [
    { id: 'manufacturer', label: 'Производитель' },
    { id: 'supplier', label: 'Поставщик' },
    { id: 'integrator', label: 'Интегратор' },
    { id: 'unconfirmed', label: 'Роль не подтверждена' },
  ];

  return (
    <div className="container mx-auto flex h-[calc(100vh-64px)] max-w-none flex-col px-4 py-8" data-testid="page-solutions">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between mb-6 gap-4 shrink-0">
        <div>
          <h1 className="text-3xl font-bold tracking-tight" data-testid="text-page-title">Каталог решений</h1>
          <p className="text-muted-foreground mt-1 text-sm" data-testid="text-page-subtitle">
            {activeSector
              ? `Решения направления «${activeSector.label}» · одинаковые отраслевые варианты объединены в карточки`
              : activeIndustry
              ? `Решения отрасли «${storedSector?.label ?? activeIndustry}»`
              : personalizedMode
                ? 'Выдача ранжирована по объяснимому расчёту соответствия'
                : 'Нейтральный порядок каталога — персональный скоринг выключен'}
          </p>
          {activeIndustry && (
            <button
              type="button"
              onClick={() => {
                setIndustryFilter('');
                setSectorId(null);
                setLocation('/solutions');
              }}
              className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/15"
              data-testid="button-clear-industry-filter"
            >
              Отрасль: {storedSector?.label ?? activeIndustry}
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          {activeSector && (
            <button
              type="button"
              onClick={() => {
                setSectorFilter(null);
                setSectorId(null);
                setLocation('/solutions');
              }}
              className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/15"
              data-testid="button-clear-sector-filter"
            >
              Направление: {activeSector.label}
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          {activeDirectionId && (
            <button
              type="button"
              onClick={() => {
                setLocation(`/quick-select?sector=${encodeURIComponent(activeDirectionId)}`);
              }}
              className="mt-2 ml-2 inline-flex items-center gap-1.5 rounded-md border border-primary/40 px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/10"
              data-testid="button-research-object"
            >
              Описать мой объект и продолжить исследование <ArrowRight className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant={personalizedMode ? 'default' : 'outline'}
            size="sm"
            aria-pressed={personalizedMode}
            onClick={() => {
              if (!state.objectType || state.objectType === 'custom') {
                setLocation(activeDirectionId
                  ? `/quick-select?sector=${encodeURIComponent(activeDirectionId)}`
                  : '/quick-select');
                return;
              }
              setPersonalizedMode(current => !current);
            }}
            className="gap-2"
            data-testid="button-personalized-ranking"
          >
            <Target className="h-4 w-4" />
            {personalizedMode ? 'По объекту: вкл.' : 'По параметрам объекта'}
          </Button>
          <div className="bg-secondary/50 border border-border px-3 py-1.5 rounded-md text-sm flex items-center gap-2">
            <span className="text-muted-foreground">Для сравнения:</span>
            <span className="text-primary font-bold" data-testid="text-selected-count">{state.selectedSolutions.length}</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={state.selectedSolutions.length === 0}
            onClick={clearSelectedSolutions}
            className="gap-1.5"
            data-testid="button-clear-selected"
          >
            <X className="h-4 w-4" />
            Сбросить выбор
          </Button>
          <Button 
            disabled={state.selectedSolutions.length === 0 || directionMismatch || Boolean(evaluationLimit(
              activeDirectionId || state.sectorId,
              state.objectType,
              state.objectParams,
              state.activeSolutionId ?? state.selectedSolutions[0],
            ))}
            onClick={() => setLocation('/calc')}
            data-testid="button-go-calc"
          >
            Расчёт экономики <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
        </div>
      </div>

      {unresolvedSector && (
        <Alert className="mb-4 shrink-0 border-amber-500/40 bg-amber-500/10" data-testid="alert-sector-unavailable">
          <Info className="h-4 w-4" />
          <AlertTitle>{sectorLoadError ? 'Не удалось открыть выбранное направление' : 'Загружаем направление карты'}</AlertTitle>
          <AlertDescription>
            {sectorLoadError ?? 'Подождите: каталог будет отфильтрован по выбранной отрасли.'}
            {sectorLoadError && <button type="button" className="ml-2 underline" onClick={resetCatalogFilters} data-testid="button-clear-unavailable-sector">Сбросить направление</button>}
          </AlertDescription>
        </Alert>
      )}
      {(activeDirectionId || state.sectorId) && (
        <Alert className="mb-4 shrink-0 border-primary/30 bg-primary/5" data-testid="alert-evidence-scope">
          <Info className="h-4 w-4" />
          <AlertTitle>Доказательства и расчёт — разные этапы</AlertTitle>
          <AlertDescription>
            Здесь показаны записи выбранного направления. Совпадение с отраслью не доказывает пригодность робота для вашей задачи.
            Ранжирование учитывает тип и параметры объекта, но не подтверждает применимость к каждой операции.
            Для сбора плавающего мусора, съёмки карьера, доставки биоматериалов и реабилитационных сеансов
            предусмотрены отдельные модели. Годовую мощность подтверждают только журналы конкретной площадки за обозначенный период: смены, принятые съёмки, выполненные рейсы или завершённые сеансы вместе с отменами и простоями. Условия объекта, погода, разрешения, персонал и обработка должны быть учтены отдельно; паспортный максимум и разовый кейс не заменяют эти данные.
            Для других операций универсальный расчёт не применяется.
          </AlertDescription>
        </Alert>
      )}
      {directionMismatch && (
        <Alert className="mb-4 shrink-0 border-amber-500/40 bg-amber-500/10" data-testid="alert-direction-mismatch">
          <Info className="h-4 w-4" />
          <AlertTitle>Объект нужно связать с выбранным направлением</AlertTitle>
          <AlertDescription>{directionWarning}</AlertDescription>
        </Alert>
      )}
      {typeof state.objectParams.site_name === 'string' && state.objectType === 'custom' && (
        <Alert className="mb-4 shrink-0" data-testid="panel-site-brief">
          <Building2 className="h-4 w-4" />
          <AlertTitle>Ваш объект: {state.objectParams.site_name}</AlertTitle>
          <AlertDescription>
            Задача: {String(state.objectParams.task ?? 'не указана')}. Каталог отобран по направлению, а не по свободному описанию задачи:
            проверяйте каждый сценарий и его источник отдельно.
            <button type="button" className="ml-2 font-medium text-primary underline" onClick={() => setLocation('/object')} data-testid="button-edit-site-brief">Изменить бриф</button>
          </AlertDescription>
        </Alert>
      )}

      {projectRecoveryNotice && (
        <Alert className="mb-6 shrink-0 border-amber-500/40 bg-amber-500/10 text-amber-100" data-testid="alert-project-recovery">
          <Info className="h-4 w-4" />
          <AlertTitle>Сохранённый расчёт нельзя продолжить</AlertTitle>
          <AlertDescription className="text-amber-100/80">
            Мы начали новый расчёт. Выберите решение, чтобы собрать его заново.
          </AlertDescription>
        </Alert>
      )}

      <div className="flex flex-col md:flex-row gap-6 flex-1 min-h-0">
        {/* Filters Sidebar */}
        <div className="w-full md:w-80 shrink-0 flex flex-col gap-4 overflow-y-auto pr-1 pb-4">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input 
              placeholder="Поиск решений..." 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 bg-card shadow-sm"
              data-testid="input-search"
            />
          </div>

          <div className="bg-card border border-border shadow-sm rounded-xl p-4 flex flex-col">
            <FilterSection
              title="Где работает"
              icon={<MapPin className="w-4 h-4 text-primary" />}
              open={openFilters.area}
              onToggle={() => toggleFilter('area')}
            >
              <div className="flex flex-col gap-1">
                <button
                  onClick={() => setAreaFilter('all')}
                  data-testid="filter-area-all"
                  className={`text-left text-sm px-2.5 py-1.5 rounded-md transition-colors flex items-center justify-between group ${
                    areaFilter === 'all' ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-secondary text-muted-foreground'
                  }`}
                >
                  <span>Все среды</span>
                  <span className="text-[10px] bg-secondary/80 group-hover:bg-background px-1.5 py-0.5 rounded text-muted-foreground">{totalsWithout.area}</span>
                </button>
                {availableAreas.map(area => (
                  <button
                    key={area.id}
                    onClick={() => setAreaFilter(current => current === area.id ? 'all' : area.id)}
                    disabled={(areaCounts.get(area.id) ?? 0) === 0 && areaFilter !== area.id}
                    data-testid={`filter-area-${area.id}`}
                    className={`text-left text-sm px-2.5 py-1.5 rounded-md transition-colors flex items-center justify-between group ${
                      areaFilter === area.id ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-secondary text-muted-foreground'
                    } disabled:cursor-not-allowed disabled:opacity-40`}
                  >
                    <span className="min-w-0 flex-1 whitespace-normal break-words pr-2 leading-5">{area.label}</span>
                    <span className="text-[10px] bg-secondary/80 group-hover:bg-background px-1.5 py-0.5 rounded text-muted-foreground">
                      {areaCounts.get(area.id) ?? 0}
                    </span>
                  </button>
                ))}
              </div>
            </FilterSection>

            <FilterSection
              title="Что делает"
              icon={<Activity className="w-4 h-4 text-primary" />}
              open={openFilters.operation}
              onToggle={() => toggleFilter('operation')}
            >
              <div className="flex flex-col gap-1">
                <button
                  onClick={() => setOperationFilter('all')}
                  data-testid="filter-op-all"
                  className={`text-left text-sm px-2.5 py-1.5 rounded-md transition-colors flex items-center justify-between group ${
                    operationFilter === 'all' ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-secondary text-muted-foreground'
                  }`}
                >
                  <span>Все операции</span>
                  <span className="text-[10px] bg-secondary/80 group-hover:bg-background px-1.5 py-0.5 rounded text-muted-foreground">{totalsWithout.operation}</span>
                </button>
                {availableOperations.map(op => (
                  <button
                    key={op.id}
                    onClick={() => setOperationFilter(current => current === op.id ? 'all' : op.id)}
                    disabled={(operationCounts.get(op.id) ?? 0) === 0 && operationFilter !== op.id}
                    data-testid={`filter-op-${op.id}`}
                    className={`text-left text-sm px-2.5 py-1.5 rounded-md transition-colors flex items-center justify-between group ${
                      operationFilter === op.id ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-secondary text-muted-foreground'
                    } disabled:cursor-not-allowed disabled:opacity-40`}
                  >
                    <span className="min-w-0 flex-1 whitespace-normal break-words pr-2 leading-5">{op.label}</span>
                    <span className="text-[10px] bg-secondary/80 group-hover:bg-background px-1.5 py-0.5 rounded text-muted-foreground">
                      {operationCounts.get(op.id) ?? 0}
                    </span>
                  </button>
                ))}
              </div>
            </FilterSection>

            <FilterSection
              title="Бренд"
              icon={<span className="w-4 text-center text-primary font-bold">B</span>}
              open={openFilters.brand}
              onToggle={() => toggleFilter('brand')}
            >
              <div className="flex max-h-64 flex-col gap-1 overflow-y-auto pr-1">
                <button
                  type="button"
                  onClick={() => setBrandFilter('all')}
                  data-testid="filter-brand-all"
                  className={`text-left text-sm px-2.5 py-1.5 rounded-md transition-colors flex items-center justify-between group ${
                    brandFilter === 'all' ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-secondary text-muted-foreground'
                  }`}
                >
                  <span>Все бренды</span>
                  <span className="text-[10px] bg-secondary/80 px-1.5 py-0.5 rounded text-muted-foreground">{totalsWithout.brand}</span>
                </button>
                {availableBrands.map(brand => (
                  <button
                    type="button"
                    key={brand}
                    onClick={() => setBrandFilter(current => current === brand ? 'all' : brand)}
                    disabled={(brandCounts.get(brand) ?? 0) === 0 && brandFilter !== brand}
                    data-testid={`filter-brand-${brand}`}
                    className={`text-left text-sm px-2.5 py-1.5 rounded-md transition-colors flex items-center justify-between group ${
                      brandFilter === brand ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-secondary text-muted-foreground'
                    } disabled:cursor-not-allowed disabled:opacity-40`}
                  >
                    <span className="min-w-0 flex-1 whitespace-normal break-words pr-2 leading-5">{brand}</span>
                    <span className="text-[10px] bg-secondary/80 px-1.5 py-0.5 rounded text-muted-foreground">
                      {brandCounts.get(brand) ?? 0}
                    </span>
                  </button>
                ))}
              </div>
            </FilterSection>

            <FilterSection
              title="Компания и роль"
              icon={<Building2 className="w-4 h-4 text-primary" />}
              open={openFilters.company}
              onToggle={() => toggleFilter('company')}
            >
              <div className="mb-3 flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setRoleFilter('all')}
                  className={`rounded-md border px-2 py-1 text-[11px] ${roleFilter === 'all' ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-secondary'}`}
                >
                  Все роли
                </button>
                {availableRoles.map(role => (
                  <button
                    type="button"
                    key={role.id}
                    onClick={() => setRoleFilter(current => current === role.id ? 'all' : role.id)}
                    disabled={(roleCounts.get(role.id) ?? 0) === 0 && roleFilter !== role.id}
                    data-testid={`filter-role-${role.id}`}
                    className={`rounded-md border px-2 py-1 text-[11px] disabled:cursor-not-allowed disabled:opacity-40 ${roleFilter === role.id ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-secondary'}`}
                  >
                    {role.label} ({roleCounts.get(role.id) ?? 0})
                  </button>
                ))}
              </div>
              <div className="flex max-h-64 flex-col gap-1 overflow-y-auto pr-1">
                <button
                  type="button"
                  onClick={() => setCompanyFilter('all')}
                  data-testid="filter-company-all"
                  className={`text-left text-sm px-2.5 py-1.5 rounded-md transition-colors flex items-center justify-between group ${
                    companyFilter === 'all' ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-secondary text-muted-foreground'
                  }`}
                >
                  <span>Все компании</span>
                  <span className="text-[10px] bg-secondary/80 px-1.5 py-0.5 rounded text-muted-foreground">{totalsWithout.company}</span>
                </button>
                {availableCompanies.map(([company]) => (
                  <button
                    type="button"
                    key={company}
                    onClick={() => setCompanyFilter(current => current === company ? 'all' : company)}
                    disabled={(companyCounts.get(company) ?? 0) === 0 && companyFilter !== company}
                    data-testid={`filter-company-${company}`}
                    className={`text-left text-sm px-2.5 py-1.5 rounded-md transition-colors flex items-center justify-between group ${
                      companyFilter === company ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-secondary text-muted-foreground'
                    } disabled:cursor-not-allowed disabled:opacity-40`}
                  >
                    <span className="min-w-0 flex-1 whitespace-normal break-words pr-2 leading-5">{company}</span>
                    <span className="text-[10px] bg-secondary/80 px-1.5 py-0.5 rounded text-muted-foreground">{companyCounts.get(company) ?? 0}</span>
                  </button>
                ))}
              </div>
            </FilterSection>
          </div>
        </div>

        {/* Results Grid */}
        <div className="flex-1 flex flex-col min-h-0 bg-muted/30 border border-border rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border bg-card/50 flex items-center justify-between gap-3 text-sm shrink-0">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Найдено решений:</span>
              <span className="font-mono font-semibold" data-testid="text-results-count">{filteredSolutions.length}</span>
            </div>
            {hasActiveFilters && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={resetCatalogFilters}
                className="h-7 gap-1.5 px-2 text-xs"
                data-testid="button-reset-filters"
              >
                <X className="h-3.5 w-3.5" />
                Сбросить фильтры
              </Button>
            )}
          </div>
          
          <ScrollArea className="flex-1 p-4">
            <div className="grid grid-cols-1 gap-5 pb-8 min-[700px]:grid-cols-2 min-[1100px]:grid-cols-3">
              {filteredSolutions.map((sol) => {
                const isSelected = state.selectedSolutions.includes(sol.id);
                const estimateLimit = (directionMismatch ? directionWarning : null) || evaluationLimit(
                  activeDirectionId || state.sectorId,
                  state.objectType,
                  state.objectParams,
                  sol.id,
                );
                const statusLabel = sol.status === 'operation'
                  ? 'В эксплуатации'
                  : sol.status === 'pilot'
                    ? 'Пилот'
                    : 'НИОКР';
                const price = sol.price_rub
                  ? `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(sol.price_rub)} ₽`
                  : 'По запросу';
                const description = sol.desc_real || sol.description;
                
                return (
                  <article
                    key={sol.id}
                    className={`flex min-w-0 flex-col overflow-hidden rounded-[18px] border bg-card shadow-sm transition-all duration-200 hover:-translate-y-1 hover:border-primary/40 ${
                      isSelected ? 'border-primary/60 ring-2 ring-primary' : 'border-border'
                    }`}
                    data-testid={`card-solution-${sol.id}`}
                  >
                    <SolutionImage
                      id={sol.id}
                      name={sol.name}
                      img={sol.img}
                      imgKind={sol.img_kind ?? null}
                      imgSource={sol.img_source ?? null}
                      imgLowres={sol.img_lowres}
                      status={sol.status}
                      statusLabel={statusLabel}
                      trl={sol.trl}
                    />

                    <div className="flex flex-1 flex-col gap-3 px-[18px] py-4">
                      {personalizedMode && (
                        <div className="rounded-xl border border-primary/20 bg-primary/[0.06] p-3" data-testid={`match-panel-${sol.id}`}>
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <Badge
                                className={sol.criticalMismatch
                                  ? 'border-destructive/40 bg-destructive/10 text-destructive'
                                  : 'border-[#3BE68F]/35 bg-[#3BE68F]/10 text-[#3BE68F]'}
                                variant="outline"
                                data-testid={`badge-match-score-${sol.id}`}
                              >
                                соответствие {sol.matchScore}/100
                              </Badge>
                              <span className="font-mono text-[10px] text-muted-foreground" data-testid={`text-match-confidence-${sol.id}`}>
                                уверенность {sol.matchConfidence}%
                              </span>
                            </div>
                            {sol.criticalMismatch && (
                              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-destructive">
                                <ShieldAlert className="h-3.5 w-3.5" />
                                не подходит
                              </span>
                            )}
                          </div>
                          {sol.criticalMismatch && (
                            <p className="mt-2 text-xs leading-5 text-destructive" data-testid={`text-critical-mismatch-${sol.id}`}>
                              {sol.criticalMismatch}
                            </p>
                          )}
                          <details className="mt-2">
                            <summary className="cursor-pointer text-xs font-medium text-foreground">
                              Почему такой балл
                            </summary>
                            <ul className="mt-2 space-y-2" data-testid={`list-match-reasons-${sol.id}`}>
                              {sol.matchReasons.map(reason => (
                                <li key={reason.id} className="grid grid-cols-[auto_1fr] gap-x-2 text-[11px] leading-4">
                                  <span className={`font-mono font-semibold ${MATCH_REASON_STYLES[reason.status]}`}>
                                    {reason.maxPoints > 0 ? `${reason.points >= 0 ? '+' : ''}${reason.points}` : '×'}
                                  </span>
                                  <span>
                                    <b className="font-medium text-foreground">{reason.label}</b>
                                    <span className="block text-muted-foreground">{reason.detail}</span>
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </details>
                        </div>
                      )}
                      <div className="min-w-0">
                        <h2 className="line-clamp-2 min-h-[3rem] text-[19px] font-semibold leading-6 text-foreground" data-testid={`title-${sol.id}`} title={sol.name}>
                          {sol.name}
                        </h2>
                        <p className="mt-2 line-clamp-2 min-h-10 text-[13px] leading-5 text-muted-foreground" data-testid={`text-tagline-${sol.id}`}>
                          {sol.tagline}
                        </p>
                      </div>

                      <ul className="space-y-1.5" data-testid={`list-bullets-${sol.id}`}>
                        {sol.bullets.slice(0, 3).map((bullet, index) => (
                          <li key={`${sol.id}-bullet-${index}`} className="flex items-start gap-2 text-xs leading-[1.45] text-foreground">
                            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#3BE68F]" />
                            <span>{bullet}</span>
                          </li>
                        ))}
                      </ul>

                      <div className="flex flex-wrap gap-1.5">
                        <Badge variant="outline" className="border-[#38D6F0]/30 bg-[#38D6F0]/10 px-2 py-1 font-mono text-[10px] text-[#38D6F0]" data-testid={`chip-industry-${sol.id}`}>
                          {sol.industry}
                        </Badge>
                        <Badge variant="outline" className="border-border bg-secondary/60 px-2 py-1 font-mono text-[10px] text-muted-foreground" data-testid={`chip-region-${sol.id}`}>
                          {sol.region}
                        </Badge>
                      </div>

                      <div className="border-t border-dashed border-border pt-3">
                        <p className="line-clamp-3 text-xs leading-[1.55] text-muted-foreground" data-testid={`text-description-${sol.id}`}>
                          {description}
                        </p>
                        {sol.desc_real && sol.specs_source && (
                          <p className="mt-2 font-mono text-[9px] leading-4 text-muted-foreground/75" data-testid={`text-description-source-${sol.id}`}>
                            Источник описания: {sol.specs_source}
                          </p>
                        )}
                      </div>

                      <footer className="mt-auto border-t border-border pt-4">
                        <p className="font-mono text-lg font-bold text-[#3BE68F]" data-testid={`text-price-${sol.id}`}>{price}</p>
                        <p className="mt-1 text-[10px] text-muted-foreground">с НДС, без доставки и ПНР</p>
                        <div className="mt-4 grid gap-2">
                          <Button
                            type="button"
                            onClick={() => {
                              if (estimateLimit) {
                                if (!state.objectType || Object.keys(state.objectParams).length === 0) {
                                  setLocation(activeDirectionId
                                    ? `/quick-select?sector=${encodeURIComponent(activeDirectionId)}`
                                    : '/quick-select');
                                }
                                return;
                              }
                              selectSolutionForCalculation(sol.id);
                              setLocation('/calc');
                            }}
                            disabled={Boolean(estimateLimit && state.objectType
                              && Object.keys(state.objectParams).length > 0)}
                            className="w-full"
                            data-testid={`button-calculate-${sol.id}`}
                          >
                            {estimateLimit
                              ? (!state.objectType || Object.keys(state.objectParams).length === 0
                                ? 'Описать объект'
                                : 'Нет модели ТЭО для задачи')
                              : 'Предварительное ТЭО'}
                          </Button>
                          {estimateLimit && state.objectType
                            && Object.keys(state.objectParams).length > 0 && (
                            <p className="text-xs text-amber-300" data-testid={`text-evaluation-limit-${sol.id}`}>{estimateLimit}</p>
                          )}
                          <Button
                            type="button"
                            variant={isSelected ? 'default' : 'outline'}
                            onClick={() => toggleSolution(sol.id)}
                            className="w-full"
                            data-testid={`button-toggle-${sol.id}`}
                          >
                            {isSelected ? 'В сравнении' : 'В сравнение'}
                          </Button>
                        </div>
                      </footer>
                      <span
                        aria-hidden="true"
                        className="hidden"
                        dangerouslySetInnerHTML={{ __html: '<!-- ref-slot: место для реферальной ссылки вендора (v2) -->' }}
                      />
                    </div>
                  </article>
                );
              })}
              
              {filteredSolutions.length === 0 && (
                <div className="col-span-full py-16 text-center" data-testid="empty-state">
                  <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mx-auto mb-3">
                    <Search className="w-6 h-6 text-muted-foreground/50" />
                  </div>
                  <p className="text-foreground font-medium mb-1">Решений не найдено</p>
                  <p className="text-sm text-muted-foreground mb-4">Выбранные фильтры не пересекаются между собой</p>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={resetCatalogFilters}
                    data-testid="button-reset-empty-filters"
                  >
                    Сбросить все фильтры
                  </Button>
                </div>
              )}
            </div>
          </ScrollArea>
        </div>
      </div>
    </div>
  );
}
