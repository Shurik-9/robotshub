import { useMemo, useEffect } from 'react';
import { useLocation } from 'wouter';
import { useProject } from '@/store/project';
import { evaluationLimit } from '@/lib/evaluationScope';
import { operationFor } from '@/lib/operationEconomics';
import OperationEvaluation from '@/components/OperationEvaluation';
import solutionsData from '@/data/solutions.json';
import {
  buildScenarioConclusion,
  calculateEconomics,
  ECONOMIC_RISKS,
  formatPaybackYears,
  getPaybackVerdict,
  getPaybackRiskVerdict,
  PAYBACK_HISTOGRAM_BOUNDARY_NOTE,
  simulatePaybackRisk,
} from '@/lib/calc';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { getSolutionDataStatus, getSolutionRole, getSolutionSummary, getSolutionTypeLabel } from '@/lib/solutionPresentation';
import { IconCalculator, IconChartRoi, IconClockPayback, IconInfoAssumption, IconSliders, IconVisualization } from '@/components/brand-icons';

// Charting
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer } from 'recharts';

export default function Calc() {
  const [, setLocation] = useLocation();
  const {
    state,
    setActiveSolution,
    setWhatIfOverrides,
    setAssumptionsOverrides,
    resetProject,
  } = useProject();

  const activeSolutionId = state.selectedSolutions.includes(state.activeSolutionId ?? '')
    ? state.activeSolutionId
    : state.selectedSolutions[0] || null;

  const salaryMultiplier = state.whatIfOverrides?.salaryMultiplier ?? 1;
  const priceMultiplier = state.whatIfOverrides?.priceMultiplier ?? 1;
  const volumeMultiplier = state.whatIfOverrides?.volumeMultiplier ?? 1;

  const solution = useMemo(() => {
    return solutionsData.items.find((s: any) => s.id === activeSolutionId);
  }, [activeSolutionId]);
  const evaluationWarning = evaluationLimit(
    state.sectorId, state.objectType, state.objectParams, activeSolutionId,
  );
  const operation = operationFor(state.sectorId, activeSolutionId);

  const results = useMemo(() => {
    if (!solution || evaluationWarning || operation) return [];
    return calculateEconomics({
      objectParams: state.objectParams,
      solution,
      whatIf: { salaryMultiplier, priceMultiplier, volumeMultiplier },
      assumptionsOverrides: state.assumptionsOverrides,
    });
  }, [solution, evaluationWarning, operation, state.objectParams, state.assumptionsOverrides, salaryMultiplier, priceMultiplier, volumeMultiplier]);

  const paybackRisk = useMemo(() => {
    if (!solution || evaluationWarning || operation) return null;
    return simulatePaybackRisk({
      objectParams: state.objectParams,
      solution,
      whatIf: { salaryMultiplier, priceMultiplier, volumeMultiplier },
      assumptionsOverrides: state.assumptionsOverrides,
    });
  }, [solution, evaluationWarning, operation, state.objectParams, state.assumptionsOverrides, salaryMultiplier, priceMultiplier, volumeMultiplier]);

  useEffect(() => {
    if (state.activeSolutionId !== activeSolutionId) {
      setActiveSolution(activeSolutionId);
    }
  }, [activeSolutionId, setActiveSolution, state.activeSolutionId]);

  useEffect(() => {
    if (!state.objectType || state.selectedSolutions.length === 0) {
      setLocation('/solutions');
    }
  }, [setLocation, state.objectType, state.selectedSolutions.length]);

  if (!state.objectType || state.selectedSolutions.length === 0) return null;
  if (evaluationWarning) return (
    <div className="container mx-auto max-w-3xl px-4 py-12" data-testid="alert-calculation-unavailable">
      <h1 className="text-2xl font-bold">ТЭО для этой задачи пока недоступно</h1>
      <p className="mt-4 text-muted-foreground">{evaluationWarning}</p>
      <p className="mt-2 text-muted-foreground">Изучить решение и источники можно в каталоге, но универсальная формула не заменит расчёт по вашей задаче.</p>
      <Button className="mt-6" onClick={() => setLocation('/solutions')} data-testid="button-back-evidence">Вернуться к решениям</Button>
    </div>
  );
  if (operation) return <OperationEvaluation profile={operation} mode="calc" solution={solution} />;

  const formatCurrency = (val: number) => new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(val);
  const assumptions = results[1]?.assumptions;
  const purchase = results.find(result => result.id === 'purchase');
  const purchaseRiskVerdict = paybackRisk
    ? getPaybackRiskVerdict(paybackRisk.nonPaybackProbability)
    : null;
  const purchaseVerdict = purchaseRiskVerdict ?? getPaybackVerdict(purchase?.paybackYears ?? null);
  const verdictToneClasses = {
    success: 'border-emerald-500/40 bg-emerald-500/5 text-emerald-400',
    warning: 'border-amber-500/40 bg-amber-500/5 text-amber-400',
    danger: 'border-red-400/40 bg-red-400/5 text-red-400',
    muted: 'border-border text-muted-foreground',
  } as const;
  const throughputKey = assumptions?.throughputOverrideKey;
  const setOverride = (key: string, value: string) => {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) setAssumptionsOverrides({ [key]: numeric });
  };

  const chartData = results.map(r => ({
    name: r.name,
    CAPEX: r.capex,
    OPEX: r.opexAnnual * r.assumptions.horizonYears,
    TCO: r.tco,
  }));
  const formatProbability = (value: number) => `${Math.round(value * 100)}%`;

  return (
    <div className="container mx-auto w-full max-w-none py-6 sm:py-8 px-4 flex flex-col h-full gap-6">
      <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Экономический расчет</h1>
          <p className="text-muted-foreground mt-1">Сравнение сценариев финансирования и анализ чувствительности</p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          <Button
            variant="outline"
            onClick={() => {
              resetProject();
              setLocation('/solutions');
            }}
            className="w-full sm:w-auto"
            data-testid="button-new-calculation"
          >
            Новый расчёт
          </Button>
          <Button onClick={() => setLocation('/simulation')} className="w-full sm:w-auto">
            Перейти к симуляции <IconVisualization size={18} className="ml-2" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-6 items-start">
        {/* Left Column: What-If Controls & Solutions */}
        <div className="lg:col-span-3 space-y-6">
          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="text-lg">Решения</CardTitle>
              <CardDescription>Выберите решение для расчёта</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {state.selectedSolutions.map(id => {
                const sol = solutionsData.items.find(s => s.id === id);
                if (!sol) return null;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setActiveSolution(id)}
                    aria-pressed={activeSolutionId === id}
                    data-testid={`button-calc-solution-${id}`}
                    className={`text-left text-sm px-3 py-2 rounded-md transition-colors ${
                      activeSolutionId === id ? 'bg-primary text-primary-foreground font-medium' : 'hover:bg-secondary text-muted-foreground'
                    }`}
                  >
                    {sol.name}
                  </button>
                );
              })}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="text-lg flex items-center gap-2">
                <IconSliders size={18} className="text-primary" />
                What-If анализ
                <Tooltip>
                  <TooltipTrigger><IconInfoAssumption size={16} className="text-muted-foreground" /></TooltipTrigger>
                  <TooltipContent>Анализ чувствительности к изменению базовых параметров</TooltipContent>
                </Tooltip>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-3">
                <div className="flex justify-between text-sm">
                  <Label>Рост ФОТ</Label>
                  <span className="font-mono text-muted-foreground">{((salaryMultiplier - 1) * 100).toFixed(0)}%</span>
                </div>
                <Slider 
                  min={0.8} max={1.5} step={0.05} 
                  value={[salaryMultiplier]} 
                  onValueChange={([v]) => setWhatIfOverrides({ salaryMultiplier: v })}
                  data-testid="slider-what-if-salary"
                />
              </div>

              <div className="space-y-3">
                <div className="flex justify-between text-sm">
                  <Label>Цена техники</Label>
                  <span className="font-mono text-muted-foreground">{((priceMultiplier - 1) * 100).toFixed(0)}%</span>
                </div>
                <Slider 
                  min={0.7} max={1.3} step={0.05} 
                  value={[priceMultiplier]} 
                  onValueChange={([v]) => setWhatIfOverrides({ priceMultiplier: v })}
                  data-testid="slider-what-if-price"
                />
              </div>

              <div className="space-y-3">
                <div className="flex justify-between text-sm">
                  <Label>Объём операций</Label>
                  <span className="font-mono text-muted-foreground">{((volumeMultiplier - 1) * 100).toFixed(0)}%</span>
                </div>
                <Slider 
                  min={0.5} max={2.0} step={0.1} 
                  value={[volumeMultiplier]} 
                  onValueChange={([v]) => setWhatIfOverrides({ volumeMultiplier: v })}
                  data-testid="slider-what-if-volume"
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="text-lg flex items-center gap-2">
                <IconCalculator size={18} className="text-primary" />
                Допущения расчёта
              </CardTitle>
              <CardDescription>Сохраняются в проекте и попадают в отчёт</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {[
                ['discountRatePct', 'Ставка дисконтирования', '%', 15],
                ['servicePct', 'Сервис от цены техники', '%', 10],
                ['electricityTariff', 'Тариф электричества', '₽/кВт·ч', 8],
                ['depreciationYears', 'Срок амортизации', 'лет', 7],
              ].map(([key, label, unit, fallback]) => (
                <label key={key as string} className="block space-y-1">
                  <span className="flex justify-between text-xs text-muted-foreground">
                    <span>{label as string}</span><span>{unit as string}</span>
                  </span>
                  <Input
                    type="number"
                    min={0}
                    step={key === 'electricityTariff' ? 0.1 : 1}
                    value={state.assumptionsOverrides[key as string] ?? fallback as number}
                    onChange={event => setOverride(key as string, event.target.value)}
                    className="font-mono tabular-nums"
                    data-testid={`input-assumption-${key}`}
                  />
                </label>
              ))}
              {solution && assumptions && (
                <label className="block space-y-1 border-t border-border pt-3">
                  <span className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>Производительность решения</span><span>ед./ч</span>
                  </span>
                  <Input
                    type="number"
                    min={1}
                    step={1}
                    value={state.assumptionsOverrides[throughputKey!] ?? assumptions.throughputUnitsPerHour}
                    onChange={event => throughputKey && setOverride(throughputKey, event.target.value)}
                    className="font-mono tabular-nums"
                    data-testid="input-throughput"
                  />
                  <span className="flex items-start gap-1 text-[11px] text-muted-foreground">
                    <IconInfoAssumption size={14} className="mt-0.5 shrink-0" />
                    {assumptions.throughputOverridden
                      ? 'Переопределено пользователем и сохранено в допущениях.'
                      : assumptions.throughputConfirmed
                        ? 'Подтверждено в ТТХ решения.'
                        : 'Производительность не задана — принято 50 ед./ч (допущение). Значение можно изменить.'}
                  </span>
                </label>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Middle/Right Column: Results */}
        <div className="lg:col-span-9 space-y-6">
          {solution && (
            <Card className="bg-primary/5 border-primary/20">
              <CardContent className="p-4 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <h3 className="font-bold text-lg" data-testid="calc-active-solution-name">{solution.name}</h3>
                  <p className="text-sm text-muted-foreground">{solution.vendor}</p>
                  <p className="text-sm font-medium mt-2">{getSolutionTypeLabel(solution)}</p>
                  <p className="text-sm text-muted-foreground mt-1 max-w-2xl">{getSolutionSummary(solution)}</p>
                  <p className="text-xs text-muted-foreground mt-2">Сценарий: {getSolutionRole(solution)}</p>
                  <p className="text-xs text-muted-foreground mt-1">{getSolutionDataStatus(solution)}</p>
                </div>
                <div className="w-full text-left sm:w-auto sm:shrink-0 sm:text-right">
                  <p className="text-sm text-muted-foreground">Расчетное кол-во роботов</p>
                   <p className="text-2xl font-bold font-mono tabular-nums text-primary">{results[1]?.robotCount || 0} шт.</p>
                    <p className="text-xs text-muted-foreground mt-1">Цена: с НДС, без доставки и пусконаладки</p>
                </div>
              </CardContent>
            </Card>
          )}

          <Tabs defaultValue="cards" className="w-full">
            <TabsList className="mb-4 h-auto w-full flex-wrap justify-start gap-1">
              <TabsTrigger value="cards" data-testid="tab-tco-cards" className="min-w-[8rem] flex-1 text-xs sm:text-sm">Сравнение сценариев</TabsTrigger>
              <TabsTrigger value="chart" data-testid="tab-tco-chart" className="min-w-[8rem] flex-1 text-xs sm:text-sm">График TCO ({assumptions?.horizonYears ?? 5} лет)</TabsTrigger>
              <TabsTrigger value="details" className="min-w-[8rem] flex-1 text-xs sm:text-sm">Детализация</TabsTrigger>
            </TabsList>
            
            <TabsContent value="cards" className="m-0">
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                {results.map(res => (
                  <Card key={res.id} className={res.id === 'as_is' ? 'bg-secondary/30' : ''}>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-md">{res.name}</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">CAPEX</p>
                         <p className="font-mono tabular-nums font-medium">{formatCurrency(res.capex)}</p>
                         <p className="text-[10px] text-muted-foreground">с НДС, без доставки и пусконаладки</p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">OPEX (в год)</p>
                         <p className="font-mono tabular-nums font-medium">{formatCurrency(res.opexAnnual)}</p>
                      </div>
                      <div className="pt-2 border-t border-border space-y-2">
                        <div className="flex justify-between">
                          <span className="text-xs text-muted-foreground">Эффект (год)</span>
                          <span className={`font-mono text-xs font-bold ${res.annualSavings > 0 ? 'text-emerald-500' : ''}`}>
                            {res.annualSavings > 0 ? '+' : ''}{formatCurrency(res.annualSavings)}
                          </span>
                        </div>
                        <div className="flex justify-between">
                           <span className="flex items-center gap-1 text-xs text-muted-foreground">
                             Окупаемость
                             {res.id === 'raas' && (
                               <Tooltip>
                                 <TooltipTrigger><IconInfoAssumption size={13} /></TooltipTrigger>
                                 <TooltipContent>Подписочная модель: инвестиции 0. Сравнение — по TCO и годовому эффекту.</TooltipContent>
                               </Tooltip>
                             )}
                           </span>
                            <span className="font-mono tabular-nums text-xs font-bold">
                             {res.paybackYears !== null ? `${res.paybackYears.toFixed(1)} лет` : '—'}
                          </span>
                        </div>
                         <div className="flex justify-between">
                           <span className="flex items-center gap-1 text-xs text-muted-foreground">
                             ROI за {res.assumptions.horizonYears} лет
                              {res.id === 'raas' && (
                               <Tooltip>
                                 <TooltipTrigger><IconInfoAssumption size={13} /></TooltipTrigger>
                                 <TooltipContent>Подписочная модель: инвестиции 0. Сравнение — по TCO и годовому эффекту.</TooltipContent>
                               </Tooltip>
                             )}
                           </span>
                           <span className="font-mono tabular-nums text-xs font-bold">{res.roi === null ? '—' : `${res.roi.toFixed(1)}%`}</span>
                         </div>
                        <div className="flex justify-between">
                           <span className="text-xs text-muted-foreground">TCO ({res.assumptions.horizonYears} лет)</span>
                           <span className="font-mono tabular-nums text-xs font-bold">{formatCurrency(res.tco)}</span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
              {purchase && (
                <Card className={`mt-4 ${verdictToneClasses[purchaseVerdict.tone]}`}>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2">
                      <IconClockPayback size={18} />
                      <span className="font-semibold text-sm">Вердикт окупаемости: {purchaseVerdict.label}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">{purchaseVerdict.detail}</p>
                    <ul className="mt-3 space-y-1 text-xs text-muted-foreground list-disc pl-4">
                      {ECONOMIC_RISKS.map(risk => <li key={risk}>{risk}</li>)}
                    </ul>
                  </CardContent>
                </Card>
              )}
              {purchase && paybackRisk && (
                <Card className="mt-4 border-cyan-500/30 bg-cyan-500/[0.03]" data-testid="card-payback-risk">
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-sm">
                      <IconVisualization size={17} className="text-cyan-400" />
                      Риск окупаемости покупки
                    </CardTitle>
                    <CardDescription>
                      {paybackRisk.iterations.toLocaleString('ru-RU')} воспроизводимых сценариев · seed {paybackRisk.seed}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {purchaseRiskVerdict && (
                      <p className="rounded-lg border border-red-400/40 bg-red-400/10 px-3 py-2 text-xs font-semibold text-red-300" data-testid="payback-risk-status">
                        Статус: {purchaseRiskVerdict.label}. {purchaseRiskVerdict.detail}
                      </p>
                    )}
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {[
                        ['P10', formatPaybackYears(paybackRisk.p10Years, paybackRisk.nonPaybackProbability), 'быстрый сценарий'],
                        ['Медиана', formatPaybackYears(paybackRisk.medianYears, paybackRisk.nonPaybackProbability), 'типичный сценарий'],
                        ['P90', formatPaybackYears(paybackRisk.p90Years, paybackRisk.nonPaybackProbability), 'консервативный сценарий'],
                        ['Окупится ≤ 3 лет', formatProbability(paybackRisk.probabilityWithinThreeYears), 'из всех итераций'],
                      ].map(([label, value, hint]) => (
                        <div key={label} className="rounded-lg border border-border/80 bg-background/50 p-3">
                          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
                          <p className="mt-1 font-mono text-base font-bold tabular-nums text-foreground">{value}</p>
                          <p className="mt-1 text-[10px] text-muted-foreground">{hint}</p>
                        </div>
                      ))}
                    </div>
                    <div>
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <p className="text-xs font-medium text-foreground">Распределение срока окупаемости</p>
                        <p className="text-[11px] text-muted-foreground">
                          Базовый расчёт: {formatPaybackYears(paybackRisk.basePaybackYears, paybackRisk.nonPaybackProbability)}
                        </p>
                      </div>
                      <div
                        className="h-[190px] w-full"
                        data-testid="chart-payback-risk"
                        aria-hidden="true"
                      >
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={paybackRisk.histogram} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" opacity={0.5} />
                            <XAxis
                              dataKey="label"
                              axisLine={false}
                              tickLine={false}
                              tick={{ fontSize: 10 }}
                              interval={0}
                              angle={-25}
                              textAnchor="end"
                              height={42}
                            />
                            <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fontSize: 10 }} />
                            <RechartsTooltip
                              formatter={(value: number) => [`${value} сценариев`, 'Количество']}
                              labelFormatter={label => `Окупаемость: ${label}`}
                            />
                            <Bar dataKey="count" name="Сценарии" fill="#22d3ee" radius={[3, 3, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                      <ul
                        className="sr-only"
                        data-testid="payback-risk-bin-accessible-list"
                        aria-label="Все интервалы и количество сценариев по сроку окупаемости"
                      >
                        {paybackRisk.histogram.map((bin, index) => (
                          <li
                            key={bin.label}
                            data-testid={`payback-risk-bin-sr-${index}`}
                            aria-label={`${bin.label}: ${bin.count.toLocaleString('ru-RU')} сценариев`}
                          >
                            {bin.label}: {bin.count.toLocaleString('ru-RU')} сценариев
                          </li>
                        ))}
                      </ul>
                      <div
                        className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-5"
                        data-testid="payback-risk-bin-labels"
                        aria-hidden="true"
                      >
                        {paybackRisk.histogram.map((bin, index) => (
                          <div
                            key={bin.label}
                            data-testid={`payback-risk-bin-${index}`}
                            className={`flex items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-[10px] ${
                              bin.count === 0
                                ? 'border-dashed border-border/70 text-muted-foreground'
                                : 'border-cyan-500/30 bg-cyan-500/[0.06] text-foreground'
                            }`}
                          >
                            <span className="font-medium">{bin.label}</span>
                            <span className="font-mono tabular-nums">{bin.count.toLocaleString('ru-RU')}</span>
                          </div>
                        ))}
                      </div>
                      <p className="mt-2 text-[10px] text-muted-foreground">
                        Пустые интервалы сохранены в разметке и обозначены как 0 сценариев — отсутствие столбца не означает отсутствие диапазона.
                      </p>
                      <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground" data-testid="payback-risk-boundary-note">
                        {PAYBACK_HISTOGRAM_BOUNDARY_NOTE}
                      </p>
                    </div>
                    {paybackRisk.nonPaybackProbability > 0 && (
                      <p className="text-xs text-amber-300">
                        В {formatProbability(paybackRisk.nonPaybackProbability)} сценариев положительный эффект не подтверждён, поэтому окупаемость не наступает.
                      </p>
                    )}
                    <details className="rounded-lg border border-border/80 bg-background/30 px-3 py-2">
                      <summary className="cursor-pointer text-xs font-medium text-foreground">
                        Источники допущений и диапазоны
                      </summary>
                      <div className="mt-3 space-y-2">
                        <p className="text-[11px] leading-relaxed text-muted-foreground">
                          В симуляции меняются только диапазоны из блока <span className="font-mono">payback_simulation</span> файла assumptions.json.
                          Значения с ручным переопределением фиксируются на указанном пользователем уровне.
                        </p>
                        <ul className="space-y-1.5">
                          {paybackRisk.assumptions.map(item => (
                            <li key={item.key} className="flex flex-col gap-0.5 text-[11px] sm:flex-row sm:items-baseline sm:justify-between">
                              <span className="text-muted-foreground">{item.label}</span>
                              <span className="font-mono tabular-nums text-foreground">
                                база {item.base} · {item.range[0]}–{item.range[1]} {item.unit}
                                {item.overridden ? ' · переопределено' : ''}
                              </span>
                            </li>
                          ))}
                        </ul>
                        <p className="border-t border-border/70 pt-2 text-[10px] text-muted-foreground">
                          Источники: assumptions.json · {paybackRisk.assumptions.map(item => item.source).join(' · ')}.
                          В {Math.round(paybackRisk.baseProbability * 100)}% прогонов используется базовое значение, в остальных — равномерная выборка по диапазону.
                        </p>
                      </div>
                    </details>
                  </CardContent>
                </Card>
              )}
              <Card className="mt-4 border-primary/20">
                <CardHeader className="py-3">
                  <CardTitle className="text-sm flex items-center gap-2"><IconChartRoi size={17} className="text-primary" />Заключение</CardTitle>
                </CardHeader>
                <CardContent className="pt-0 text-sm text-muted-foreground leading-relaxed">
                  {buildScenarioConclusion(results)}
                </CardContent>
              </Card>
            </TabsContent>
            
              <TabsContent value="chart" className="m-0 bg-card rounded-xl border border-border p-3 sm:p-6 h-[320px] sm:h-[400px]">
                <div data-testid="chart-tco" aria-hidden="true" className="h-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                      <XAxis dataKey="name" axisLine={false} tickLine={false} />
                      <YAxis axisLine={false} tickLine={false} tickFormatter={(val) => `${(val/1000000).toFixed(0)}М`} />
                      <RechartsTooltip formatter={(val: number) => formatCurrency(val)} />
                      <Legend />
                      <Bar dataKey="CAPEX" stackId="a" fill="#1e293b" />
                      <Bar dataKey="OPEX" stackId="a" fill="#eab308" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <table
                  className="sr-only"
                  data-testid="tco-chart-accessible-table"
                >
                  <caption>
                    Распределение TCO по сценариям за {assumptions?.horizonYears ?? 5} лет
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Сценарий</th>
                      <th scope="col">CAPEX</th>
                      <th scope="col">OPEX за {assumptions?.horizonYears ?? 5} лет</th>
                      <th scope="col">TCO за {assumptions?.horizonYears ?? 5} лет</th>
                    </tr>
                  </thead>
                  <tbody>
                    {chartData.map((item, index) => (
                      <tr key={item.name} data-testid={`tco-chart-sr-row-${index}`}>
                        <th scope="row">{item.name}</th>
                        <td>{formatCurrency(item.CAPEX)}</td>
                        <td>{formatCurrency(item.OPEX)}</td>
                        <td>{formatCurrency(item.TCO)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TabsContent>

            <TabsContent value="details" className="m-0">
              <Card>
                <CardContent className="p-6 prose max-w-none dark:prose-invert">
                  <h3>Допущения расчётного ядра</h3>
                   <p className="text-sm text-muted-foreground">Значения основаны на assumptions.json и могут быть переопределены.</p>
                  <ul>
                     <li>Амортизация: Линейная, {assumptions?.depreciationYears ?? 7} лет.</li>
                     <li>Горизонт оценки TCO: {assumptions?.horizonYears ?? 5} лет.</li>
                     <li>Ставка дисконтирования для NPV: {assumptions?.discountRatePct ?? 15}%.</li>
                     <li>Стоимость электроэнергии: {assumptions?.electricityTariffRubKwh ?? 8} руб/кВт·ч.</li>
                    <li>Налоги на ФОТ: 30.2%.</li>
                     <li>Обслуживание: {assumptions?.servicePct ?? 10}% от CAPEX в год.</li>
                  </ul>
                   {assumptions && (!assumptions.throughputConfirmed || assumptions.throughputOverridden) && (
                     <p className="text-xs text-amber-400 mt-3">
                       {assumptions.throughputOverridden ? 'Переопределение производительности' : 'Допущение производительности'}: {assumptions.throughputUnitsPerHour} ед./ч.
                     </p>
                   )}
                  <p className="text-xs text-muted-foreground mt-4 italic">
                    * Предварительная оценка. Для точного расчета требуется технологический аудит объекта. 
                    Органическое ранжирование и расчет производятся независимо от коммерческих условий вендора.
                  </p>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>

        </div>
      </div>
    </div>
  );
}
