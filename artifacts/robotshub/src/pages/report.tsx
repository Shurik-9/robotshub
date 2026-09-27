import { useMemo } from 'react';
import { useLocation } from 'wouter';
import { getCurrentSimulationKpis, useProject } from '@/store/project';
import { evaluationLimit } from '@/lib/evaluationScope';
import { operationFor } from '@/lib/operationEconomics';
import OperationEvaluation from '@/components/OperationEvaluation';
import {
  buildScenarioConclusion,
  calculateEconomics,
  ECONOMIC_RISKS,
  formatPaybackYears,
  getPaybackVerdict,
  getPaybackRiskVerdict,
  simulatePaybackRisk,
} from '@/lib/calc';
import solutionsData from '@/data/solutions.json';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { IconChartRoi, IconClockPayback, IconInfoAssumption, IconSourceDoc } from '@/components/brand-icons';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { getSolutionDataStatus, getSolutionRole, getSolutionSummary, getSolutionTypeLabel } from '@/lib/solutionPresentation';
import { buildSimulationKpiCsvSection, getSimulationSnapshotDisplay } from '@/lib/report-export';
import warehouseTemplate from '@/data/object-templates/warehouse.json';
import airportTemplate from '@/data/object-templates/airport.json';
import medicalTemplate from '@/data/object-templates/medical.json';

const objectTemplates: Record<string, any> = {
  warehouse: warehouseTemplate,
  airport: airportTemplate,
  medical: medicalTemplate,
};

const operationReportPrintStyles = `
  @media print {
    .operation-seasonality-report .operation-evaluation-print-report {
      width: 100%;
      max-width: none;
      margin: 0;
      padding: 0;
    }

    .operation-seasonality-report [data-testid="operation-report-seasonal-monthly-assumptions"] {
      width: 100%;
      table-layout: fixed;
      border-collapse: collapse;
    }

    .operation-seasonality-report [data-testid="operation-report-seasonal-monthly-assumptions"] thead {
      display: table-header-group;
    }

    .operation-seasonality-report [data-testid="operation-report-seasonal-monthly-assumptions"] tr {
      break-inside: avoid;
      page-break-inside: avoid;
    }

    .operation-seasonality-report [data-testid="operation-report-seasonal-monthly-assumptions"] th,
    .operation-seasonality-report [data-testid="operation-report-seasonal-monthly-assumptions"] td {
      overflow: visible;
      overflow-wrap: anywhere;
      white-space: normal;
      vertical-align: top;
    }
  }
`;

const getObjectParameterLabels = (objectType: string | null) => {
  const template = objectType ? objectTemplates[objectType] : null;
  if (!template) return {};

  return Object.fromEntries(
    template.groups.flatMap((group: any) =>
      group.fields.map((field: any) => [
        field.key,
        field.unit ? `${field.label}, ${field.unit}` : field.label,
      ]),
    ),
  ) as Record<string, string>;
};

export default function Report() {
  const [, setLocation] = useLocation();
  const { state } = useProject();
  const brandLogo = `${import.meta.env.BASE_URL}brand/logo.jpg`;

  const selectedSolutions = useMemo(
    () => state.selectedSolutions
      .map(id => solutionsData.items.find(solution => solution.id === id))
      .filter((solution): solution is (typeof solutionsData.items)[number] => Boolean(solution)),
    [state.selectedSolutions],
  );
  const reportLimit = selectedSolutions
    .map(solution => evaluationLimit(state.sectorId, state.objectType, state.objectParams, solution.id))
    .find(Boolean) ?? (selectedSolutions.length > 1
      && selectedSolutions.some(solution => operationFor(state.sectorId, solution.id))
      ? 'Операционные модели не объединяются с другими решениями в универсальный отчёт. Выберите одну модель для ТЭО.'
      : null);
  const operation = selectedSolutions.length === 1
    ? operationFor(state.sectorId, selectedSolutions[0].id)
    : null;
  const simulationKpis = getCurrentSimulationKpis(state);
  const geometry = simulationKpis?.geometry ?? null;
  const simulationSnapshotDisplay = getSimulationSnapshotDisplay(simulationKpis);
  const solutionCalculations = useMemo(
    () => reportLimit || operation ? [] : selectedSolutions.map(solution => ({
      solution,
      results: calculateEconomics({
        objectParams: state.objectParams,
        solution,
        whatIf: { salaryMultiplier: 1, priceMultiplier: 1, volumeMultiplier: 1 },
        assumptionsOverrides: state.assumptionsOverrides,
      }),
      paybackRisk: simulatePaybackRisk({
        objectParams: state.objectParams,
        solution,
        whatIf: { salaryMultiplier: 1, priceMultiplier: 1, volumeMultiplier: 1 },
        assumptionsOverrides: state.assumptionsOverrides,
      }),
    })),
    [reportLimit, operation, selectedSolutions, state.objectParams, state.assumptionsOverrides],
  );
  const results = solutionCalculations[0]?.results ?? [];
  const purchase = results.find(result => result.id === 'purchase');
  const purchaseRisk = solutionCalculations[0]?.paybackRisk;
  const purchaseVerdict = getPaybackRiskVerdict(purchaseRisk?.nonPaybackProbability ?? 0)
    ?? getPaybackVerdict(purchase?.paybackYears ?? null);
  const verdictToneClasses = {
    success: 'border-emerald-500/40 bg-emerald-500/5 text-emerald-600',
    warning: 'border-amber-500/40 bg-amber-500/5 text-amber-600',
    danger: 'border-red-400/40 bg-red-400/5 text-red-500',
    muted: 'border-border text-muted-foreground',
  } as const;

  if (!state.objectType) {
    setLocation('/solutions');
    return null;
  }
  if (selectedSolutions.length === 0) {
    setLocation('/solutions');
    return null;
  }
  if (reportLimit) return (
    <div className="container mx-auto max-w-3xl px-4 py-12" data-testid="alert-report-unavailable">
      <h1 className="text-2xl font-bold">Отчёт ТЭО для этой задачи пока недоступен</h1>
      <p className="mt-4 text-muted-foreground">{reportLimit}</p>
      <Button className="mt-6" onClick={() => setLocation('/solutions')} data-testid="button-report-back-evidence">Вернуться к решениям</Button>
    </div>
  );
  if (operation) return (
    <>
      <style>{operationReportPrintStyles}</style>
      <div className="operation-seasonality-report" data-testid="operation-seasonality-report" data-operation-profile={operation.key}>
        <OperationEvaluation profile={operation} mode="report" solution={selectedSolutions[0]} />
      </div>
    </>
  );

  const formatCurrency = (val: number) => new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(val);
  const objectParameterLabels = getObjectParameterLabels(state.objectType);
  const formatScenarioPayback = (result: (typeof results)[number]) => formatPaybackYears(
    result.paybackYears,
    result.id === 'purchase' ? purchaseRisk?.nonPaybackProbability ?? 0 : 0,
  );

  const handlePrint = () => {
    window.print();
  };

  const handleExportCSV = () => {
    // Generate simple CSV
    let csv = '\uFEFF'; // BOM
    csv += 'Показатель,Сценарий 1 (Как есть),Сценарий 2 (Покупка),Сценарий 3 (Лизинг),Сценарий 4 (RaaS)\n';
    csv += `CAPEX,${results.map(r => r.capex).join(',')}\n`;
    csv += `OPEX в год,${results.map(r => r.opexAnnual).join(',')}\n`;
    csv += `Эффект в год,${results.map(r => r.annualSavings).join(',')}\n`;
    csv += `Окупаемость (лет),${results.map(r => r.paybackYears?.toFixed(1) || '-').join(',')}\n`;
    csv += `ROI за период (%),${results.map(r => r.roi === null ? '-' : r.roi.toFixed(1)).join(',')}\n`;
    csv += `TCO (${results[0]?.assumptions.horizonYears ?? 5} лет),${results.map(r => r.tco).join(',')}\n`;
    csv += `Производительность (ед./ч),${results.map(r => r.assumptions.throughputUnitsPerHour).join(',')}\n`;
    csv += `Допущение производительности,${results.map(r => r.assumptions.throughputConfirmed ? 'нет' : 'да').join(',')}\n`;
    csv += buildSimulationKpiCsvSection(simulationKpis);
    csv += '\nСостав геометрии сцены\n';
    csv += 'Категория,Количество,На этаж,Применимость\n';
    if (geometry) {
      csv += `Этажи,${geometry.floors},-,применяется\n`;
      csv += `Ряды,${geometry.rows.applicable ? geometry.rows.total : '-'},${geometry.rows.applicable ? geometry.rows.perFloor : '-'},${geometry.rows.applicable ? 'применяется' : 'не применяется'}\n`;
      csv += `Посты,${geometry.posts.applicable ? geometry.posts.total : '-'},-,${geometry.posts.applicable ? 'применяется' : 'не применяется'}\n`;
      csv += `Зарядки,${geometry.charges.total},${geometry.charges.perFloor},применяется\n`;
    } else {
      csv += 'Этажи,-,-,снимок недоступен\nРяды,-,-,снимок недоступен\nПосты,-,-,снимок недоступен\nЗарядки,-,-,снимок недоступен\n';
    }
    csv += '\nРиск окупаемости покупки\n';
    csv += 'Решение,P10 (лет),Медиана (лет),P90 (лет),Вероятность окупаемости ≤ 3 лет,Seed\n';
    solutionCalculations.forEach(({ solution, paybackRisk }) => {
      const value = (years: number | null) => years === null ? '-' : years.toFixed(1);
      csv += `"${solution.name.replaceAll('"', '""')}",${value(paybackRisk.p10Years)},${value(paybackRisk.medianYears)},${value(paybackRisk.p90Years)},${Math.round(paybackRisk.probabilityWithinThreeYears * 100)}%,${paybackRisk.seed}\n`;
    });
    csv += '\nИсточники допущений риска окупаемости\n';
    csv += 'Решение,Допущение,База,Диапазон,Единица,Источник,Ручное переопределение\n';
    solutionCalculations.forEach(({ solution, paybackRisk }) => {
      paybackRisk.assumptions.forEach(item => {
        csv += `"${solution.name.replaceAll('"', '""')}","${item.label.replaceAll('"', '""')}",${item.base},"${item.range[0]}–${item.range[1]}","${item.unit.replaceAll('"', '""')}","${item.source.replaceAll('"', '""')}",${item.overridden ? 'да' : 'нет'}\n`;
      });
    });
    csv += '\nВыбранные решения для сравнения\n';
    csv += 'Наименование,Вендор,Тип оборудования,Категория,Позиция в сравнении\n';
    selectedSolutions.forEach(solution => {
      csv += `"${solution.name.replaceAll('"', '""')}","${solution.vendor.replaceAll('"', '""')}","${getSolutionTypeLabel(solution).replaceAll('"', '""')}","${solution.category.replaceAll('"', '""')}",1\n`;
    });
    
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `robotshub_report_${format(new Date(), 'yyyyMMdd')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="container mx-auto w-full max-w-none py-6 sm:py-8 px-4 flex flex-col h-full gap-6 print:py-0 print:gap-4">
      {/* Non-printable header */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 print:hidden">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Отчет об оценке</h1>
          <p className="text-muted-foreground mt-1">Итоговые параметры для принятия решения</p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:gap-3">
          <Button
            variant="outline"
            onClick={handleExportCSV}
            className="w-full sm:w-auto"
            data-testid="button-export-csv"
          >
             Экспорт CSV
          </Button>
          <Button onClick={handlePrint} className="w-full sm:w-auto">
             Печать (PDF)
          </Button>
        </div>
      </div>

      {/* Printable Area */}
      <div className="space-y-6 print:space-y-4">
         <div className="flex flex-col items-start gap-3 justify-between border-b border-border pb-4 sm:flex-row sm:items-end">
           <div className="flex min-w-0 items-center gap-3">
            <img
              src={brandLogo}
              alt=""
              className="h-12 w-12 rounded-lg border border-border object-cover"
            />
             <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                 Центр подбора роботизации «Железный аргумент»
              </p>
               <h2 className="mt-1 text-xl sm:text-2xl font-bold">Оценка роботизации</h2>
              <p className="text-muted-foreground text-sm mt-1">
              Объект: {state.objectType === 'warehouse' ? 'Склад' : state.objectType === 'airport' ? 'Аэропорт' : 'Медучреждение'}
              </p>
            </div>
          </div>
           <div className="text-left text-sm text-muted-foreground sm:text-right">
            Дата: {format(new Date(), 'dd MMMM yyyy', { locale: ru })}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 print:grid-cols-2">
          <Card className="shadow-none">
            <CardHeader className="py-4">
              <CardTitle className="text-base">Параметры объекта</CardTitle>
            </CardHeader>
            <CardContent className="py-0 pb-4 text-sm">
              <ul className="space-y-2">
                {Object.entries(state.objectParams).slice(0, 8).map(([k, v]) => (
                  <li key={k} className="flex justify-between border-b border-border/50 pb-1">
                     <span className="text-muted-foreground">{objectParameterLabels[k] ?? 'Дополнительный параметр'}</span>
                     <span className="font-medium font-mono">{typeof v === 'boolean' ? (v ? 'Да' : 'Нет') : String(v)}</span>
                  </li>
                ))}
              </ul>
              {Object.keys(state.objectParams).length > 8 && (
                <p className="text-xs text-muted-foreground mt-2 italic">+ еще {Object.keys(state.objectParams).length - 8} параметров</p>
              )}
            </CardContent>
          </Card>

          <Card className="shadow-none bg-primary/5">
            <CardHeader className="py-4">
              <CardTitle className="text-base">Выбранные решения — {selectedSolutions.length} позиции</CardTitle>
            </CardHeader>
            <CardContent className="py-0 pb-4 text-sm">
              {selectedSolutions.length ? (
                <div className="space-y-3">
                   {selectedSolutions.map((solution, index) => (
                     <div key={`${solution.id}-${solution.name}`} className="flex flex-col items-start justify-between gap-2 border-b border-border/50 pb-2 last:border-0 sm:flex-row sm:items-start">
                       <div className="min-w-0">
                        <p className="font-bold">{index + 1}. {solution.name}</p>
                        <p className="text-xs text-muted-foreground">{solution.vendor} · {solution.category}</p>
                        <p className="text-sm font-semibold mt-2">{getSolutionTypeLabel(solution)}</p>
                        <p className="text-xs text-muted-foreground mt-1">
                           Цена: {solution.price_rub ? formatCurrency(solution.price_rub) : 'по запросу'} · с НДС, без доставки и пусконаладки
                        </p>
                        <p className="text-sm text-muted-foreground mt-1">{getSolutionSummary(solution)}</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Назначение: <span className="text-foreground">{getSolutionRole(solution)}</span>
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">{getSolutionDataStatus(solution)}</p>
                      </div>
                       <span className="font-mono font-bold text-primary sm:shrink-0">1 позиция</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground">Решение не выбрано</p>
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="shadow-none border-violet-500/30" data-testid="card-report-floor-kpis">
          <CardHeader className="py-4">
            <CardTitle className="text-base">Межэтажная логистика</CardTitle>
          </CardHeader>
          <CardContent className="py-0 pb-4">
            {simulationKpis ? (
              <>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
                    <p className="text-xs text-muted-foreground">Поездки через вертикальный переход</p>
                    <p className="mt-1 font-mono text-2xl font-bold text-violet-600" data-testid="report-vertical-trips">
                      {simulationKpis.verticalTrips.toLocaleString('ru-RU')}
                    </p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Снимок симуляции · seed {simulationKpis.seed} ·
                    </p>
                    {simulationSnapshotDisplay ? (
                      <div className="mt-2 space-y-1 text-[11px] text-muted-foreground">
                        <p data-testid="report-snapshot-generated-at">
                          {simulationSnapshotDisplay.floorCount} · сформирован {simulationSnapshotDisplay.generatedAt}
                        </p>
                        <p data-testid="report-snapshot-inputs">{simulationSnapshotDisplay.sceneInputs}</p>
                      </div>
                    ) : (
                      <p className="mt-2 text-[11px] text-muted-foreground">
                        Состав входных параметров и момент формирования для этого снимка недоступны.
                      </p>
                    )}
                  </div>
                  {simulationKpis.floorStats.length === 1 && (
                    <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm text-emerald-700">
                      <p className="font-semibold">Одноэтажный объект</p>
                      <p className="mt-1 text-xs">Вертикальные поездки отсутствуют: в сцене один этаж.</p>
                    </div>
                  )}
                </div>
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full min-w-[420px] text-sm text-left">
                    <thead>
                      <tr className="border-b border-border text-muted-foreground">
                        <th className="py-2 font-normal">Этаж</th>
                        <th className="py-2 text-right font-normal">Задачи назначено</th>
                        <th className="py-2 text-right font-normal">Выполнено</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/50">
                      {simulationKpis.floorStats.map((floor) => (
                        <tr key={floor.id} data-testid={`report-floor-kpis-${floor.id}`}>
                          <td className="py-2">{floor.label}</td>
                          <td className="py-2 text-right font-mono tabular-nums">{floor.tasks.toLocaleString('ru-RU')}</td>
                          <td className="py-2 text-right font-mono tabular-nums">{floor.completed.toLocaleString('ru-RU')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                Снимок симуляции для этого состава объекта недоступен. Откройте симуляцию и сформируйте отчёт повторно.
              </p>
            )}
          </CardContent>
        </Card>

         <Card className="shadow-none border-sky-500/30" data-testid="card-report-geometry">
           <CardHeader className="py-4">
             <CardTitle className="text-base">Состав геометрии сцены</CardTitle>
           </CardHeader>
           <CardContent className="py-0 pb-4">
             {geometry ? (
               <div className="overflow-x-auto">
                 <table className="w-full min-w-[520px] text-sm text-left">
                   <thead>
                     <tr className="border-b border-border text-muted-foreground">
                       <th className="py-2 font-normal">Категория</th>
                       <th className="py-2 text-right font-normal">Количество</th>
                       <th className="py-2 text-right font-normal">На этаж</th>
                       <th className="py-2 text-right font-normal">Применимость</th>
                     </tr>
                   </thead>
                   <tbody className="divide-y divide-border/50">
                     <tr data-testid="report-geometry-floors">
                       <td className="py-2">Этажи</td>
                       <td className="py-2 text-right font-mono tabular-nums">{geometry.floors.toLocaleString('ru-RU')}</td>
                       <td className="py-2 text-right text-muted-foreground">—</td>
                       <td className="py-2 text-right">Применяется</td>
                     </tr>
                     <tr data-testid="report-geometry-rows">
                       <td className="py-2">Ряды</td>
                       <td className="py-2 text-right font-mono tabular-nums">{geometry.rows.applicable ? geometry.rows.total.toLocaleString('ru-RU') : '—'}</td>
                       <td className="py-2 text-right font-mono tabular-nums">{geometry.rows.applicable ? geometry.rows.perFloor.toLocaleString('ru-RU') : '—'}</td>
                       <td className="py-2 text-right">{geometry.rows.applicable ? 'Применяется' : 'Не применяется'}</td>
                     </tr>
                     <tr data-testid="report-geometry-posts">
                       <td className="py-2">Посты</td>
                       <td className="py-2 text-right font-mono tabular-nums">{geometry.posts.applicable ? geometry.posts.total.toLocaleString('ru-RU') : '—'}</td>
                       <td className="py-2 text-right text-muted-foreground">—</td>
                       <td className="py-2 text-right">{geometry.posts.applicable ? 'Применяется' : 'Не применяется'}</td>
                     </tr>
                     <tr data-testid="report-geometry-charges">
                       <td className="py-2">Зарядки</td>
                       <td className="py-2 text-right font-mono tabular-nums">{geometry.charges.total.toLocaleString('ru-RU')}</td>
                       <td className="py-2 text-right font-mono tabular-nums">{geometry.charges.perFloor.toLocaleString('ru-RU')}</td>
                       <td className="py-2 text-right">Применяется</td>
                     </tr>
                   </tbody>
                 </table>
               </div>
             ) : (
               <p className="text-sm text-muted-foreground">
                 Снимок состава сцены для этого расчёта недоступен. Откройте симуляцию и сформируйте отчёт повторно.
               </p>
             )}
           </CardContent>
         </Card>

        <Card className="shadow-none">
          <CardHeader className="py-4">
            <CardTitle className="text-base">Расчёт по каждому выбранному решению</CardTitle>
          </CardHeader>
           <CardContent className="py-0 pb-4">
             <div className="hidden overflow-x-auto md:block">
             <table className="w-full text-sm text-left">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="py-2 font-normal">Решение</th>
                  <th className="py-2 font-normal">В сравнении</th>
                  <th className="py-2 font-normal">Расчётная потребность</th>
                  <th className="py-2 font-normal">CAPEX покупки</th>
                  <th className="py-2 font-normal">Окупаемость</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {solutionCalculations.map(({ solution, results: calculationResults, paybackRisk }) => {
                  const purchase = calculationResults.find(result => result.id === 'purchase');
                  return (
                    <tr key={`${solution.id}-${solution.name}`}>
                      <td className="py-2 font-medium">{solution.name}</td>
                      <td className="py-2 font-mono">1 позиция</td>
                      <td className="py-2 font-mono">{purchase?.robotCount ?? 0} роб.</td>
                      <td className="py-2 font-mono">{formatCurrency(purchase?.capex ?? 0)}</td>
                      <td className="py-2 font-mono">{formatPaybackYears(purchase?.paybackYears ?? null, paybackRisk.nonPaybackProbability)}</td>
                    </tr>
                  );
                })}
              </tbody>
             </table>
             </div>
             <div className="space-y-3 md:hidden">
               {solutionCalculations.map(({ solution, results: calculationResults, paybackRisk }) => {
                 const purchase = calculationResults.find(result => result.id === 'purchase');
                 return (
                   <div key={`${solution.id}-${solution.name}`} className="rounded-lg border border-border/60 p-3">
                     <p className="font-medium break-words">{solution.name}</p>
                     <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                       <div>
                         <dt className="text-xs text-muted-foreground">В сравнении</dt>
                         <dd className="font-mono">1 позиция</dd>
                       </div>
                       <div>
                         <dt className="text-xs text-muted-foreground">Потребность</dt>
                         <dd className="font-mono">{purchase?.robotCount ?? 0} роб.</dd>
                       </div>
                       <div>
                         <dt className="text-xs text-muted-foreground">CAPEX покупки</dt>
                         <dd className="font-mono break-words">{formatCurrency(purchase?.capex ?? 0)}</dd>
                       </div>
                       <div>
                         <dt className="text-xs text-muted-foreground">Окупаемость</dt>
                         <dd className="font-mono">{formatPaybackYears(purchase?.paybackYears ?? null, paybackRisk.nonPaybackProbability)}</dd>
                       </div>
                     </dl>
                   </div>
                 );
               })}
             </div>
          </CardContent>
        </Card>

        <Card className="shadow-none">
          <CardHeader className="py-4">
            <CardTitle className="text-base">Экономические показатели (по сценариям финансирования)</CardTitle>
          </CardHeader>
           <CardContent className="py-0 pb-4">
             <div className="hidden overflow-x-auto md:block">
             <table className="w-full text-sm text-left">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="py-2 font-normal">Показатель</th>
                  {results.map(r => (
                    <th key={r.id} className="py-2 font-semibold text-foreground">{r.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                <tr>
                  <td className="py-2 text-muted-foreground">CAPEX</td>
                  {results.map(r => (
                    <td key={r.id} className="py-2 font-mono tabular-nums">{formatCurrency(r.capex)}</td>
                  ))}
                </tr>
                <tr>
                  <td className="py-2 text-muted-foreground">OPEX (в год)</td>
                  {results.map(r => (
                    <td key={r.id} className="py-2 font-mono tabular-nums">{formatCurrency(r.opexAnnual)}</td>
                  ))}
                </tr>
                <tr>
                  <td className="py-2 text-muted-foreground">Годовой эффект</td>
                  {results.map(r => (
                    <td key={r.id} className={`py-2 font-mono tabular-nums font-medium ${r.annualSavings > 0 ? 'text-emerald-600' : ''}`}>
                      {r.annualSavings > 0 ? '+' : ''}{formatCurrency(r.annualSavings)}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="py-2 text-muted-foreground">Срок окупаемости</td>
                  {results.map(r => (
                    <td key={r.id} className="py-2 font-mono tabular-nums font-medium">
                       {formatScenarioPayback(r)}
                       {r.id === 'raas' && <span className="block text-[10px] text-muted-foreground">Подписочная модель: инвестиции 0. Сравнение — по TCO и годовому эффекту</span>}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="py-2 text-muted-foreground">ROI за период</td>
                  {results.map(r => (
                    <td key={r.id} className="py-2 font-mono tabular-nums font-medium">
                      {r.roi === null ? '—' : `${r.roi.toFixed(1)}%`}
                      {r.roi === null && <span className="block text-[10px] text-muted-foreground">RaaS: инвестиции 0, сравнение по TCO и годовому эффекту</span>}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="py-2 text-muted-foreground">TCO ({results[0]?.assumptions.horizonYears ?? 5} лет)</td>
                  {results.map(r => (
                    <td key={r.id} className="py-2 font-mono tabular-nums font-bold">{formatCurrency(r.tco)}</td>
                  ))}
                </tr>
              </tbody>
             </table>
             </div>
             <div className="space-y-3 md:hidden">
               {results.map(result => (
                 <div key={result.id} className="rounded-lg border border-border/60 p-3">
                   <p className="font-semibold break-words">{result.name}</p>
                   <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                     <div>
                       <dt className="text-xs text-muted-foreground">CAPEX</dt>
                       <dd className="font-mono tabular-nums break-words">{formatCurrency(result.capex)}</dd>
                     </div>
                     <div>
                       <dt className="text-xs text-muted-foreground">OPEX (в год)</dt>
                       <dd className="font-mono tabular-nums break-words">{formatCurrency(result.opexAnnual)}</dd>
                     </div>
                     <div>
                       <dt className="text-xs text-muted-foreground">Годовой эффект</dt>
                       <dd className={`font-mono tabular-nums break-words font-medium ${result.annualSavings > 0 ? 'text-emerald-600' : ''}`}>
                         {result.annualSavings > 0 ? '+' : ''}{formatCurrency(result.annualSavings)}
                       </dd>
                     </div>
                     <div>
                       <dt className="text-xs text-muted-foreground">Срок окупаемости</dt>
                       <dd className="font-mono tabular-nums font-medium">
                         {formatScenarioPayback(result)}
                       </dd>
                       {result.id === 'raas' && <span className="mt-1 block text-[10px] text-muted-foreground">Инвестиции 0; сравнение по TCO и годовому эффекту</span>}
                     </div>
                     <div>
                       <dt className="text-xs text-muted-foreground">ROI за период</dt>
                       <dd className="font-mono tabular-nums font-medium">{result.roi === null ? '—' : `${result.roi.toFixed(1)}%`}</dd>
                       {result.roi === null && <span className="mt-1 block text-[10px] text-muted-foreground">RaaS: инвестиции 0; сравнение по TCO и годовому эффекту</span>}
                     </div>
                     <div>
                       <dt className="text-xs text-muted-foreground">TCO ({result.assumptions.horizonYears} лет)</dt>
                       <dd className="font-mono tabular-nums font-bold break-words">{formatCurrency(result.tco)}</dd>
                     </div>
                   </dl>
                 </div>
               ))}
             </div>
          </CardContent>
        </Card>

        {results.length > 0 && (
          <>
            <Card className="shadow-none border-primary/20">
              <CardHeader className="py-4">
                <CardTitle className="text-base flex items-center gap-2"><IconChartRoi size={18} className="text-primary" />Текстовое заключение</CardTitle>
              </CardHeader>
              <CardContent className="py-0 pb-4 text-sm text-muted-foreground leading-relaxed">
                {buildScenarioConclusion(results)}
              </CardContent>
            </Card>
            <Card className={`shadow-none ${verdictToneClasses[purchaseVerdict.tone]}`}>
              <CardHeader className="py-4">
                <CardTitle className="text-base flex items-center gap-2"><IconClockPayback size={18} className="text-primary" />Вердикт и риски</CardTitle>
              </CardHeader>
              <CardContent className="py-0 pb-4 text-sm">
                {(() => {
                  return (
                    <>
                      <p className="font-semibold">{purchaseVerdict.label}</p>
                      <p className="text-muted-foreground mt-1">{purchaseVerdict.detail}</p>
                      <ul className="mt-3 space-y-1 list-disc pl-4 text-muted-foreground text-xs">
                        {ECONOMIC_RISKS.map(risk => <li key={risk}>{risk}</li>)}
                      </ul>
                    </>
                  );
                })()}
              </CardContent>
            </Card>
             <Card className="shadow-none border-cyan-500/30" data-testid="card-report-payback-risk">
               <CardHeader className="py-4">
                 <CardTitle className="text-base flex items-center gap-2">
                   <IconChartRoi size={18} className="text-cyan-600" />
                   Риск окупаемости покупки
                 </CardTitle>
               </CardHeader>
               <CardContent className="py-0 pb-4 space-y-4">
                 {solutionCalculations.map(({ solution, paybackRisk }) => (
                   <div key={`payback-risk-${solution.id}`} className="rounded-lg border border-border/70 p-3 last:pb-3" data-testid={`report-payback-risk-${solution.id}`}>
                     <div className="flex flex-col justify-between gap-1 sm:flex-row sm:items-baseline">
                       <p className="font-semibold">{solution.name}</p>
                       <p className="text-[11px] text-muted-foreground">
                         {paybackRisk.iterations.toLocaleString('ru-RU')} сценариев · seed {paybackRisk.seed}
                       </p>
                     </div>
                     {getPaybackRiskVerdict(paybackRisk.nonPaybackProbability) && (
                       <p className="mt-3 rounded-md border border-red-400/40 bg-red-400/10 px-3 py-2 text-xs font-semibold text-red-600" data-testid={`report-payback-status-${solution.id}`}>
                         Статус: Не окупается. {getPaybackRiskVerdict(paybackRisk.nonPaybackProbability)?.detail}
                       </p>
                     )}
                     <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                       {[
                         ['P10', formatPaybackYears(paybackRisk.p10Years, paybackRisk.nonPaybackProbability), 'быстрый сценарий'],
                         ['Медиана', formatPaybackYears(paybackRisk.medianYears, paybackRisk.nonPaybackProbability), 'типичный сценарий'],
                         ['P90', formatPaybackYears(paybackRisk.p90Years, paybackRisk.nonPaybackProbability), 'консервативный сценарий'],
                         ['Окупится ≤ 3 лет', `${Math.round(paybackRisk.probabilityWithinThreeYears * 100)}%`, 'из всех итераций'],
                       ].map(([label, value, hint]) => (
                         <div key={label} className="rounded-md bg-muted/40 p-2">
                           <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
                           <p className="mt-1 font-mono text-sm font-bold tabular-nums">{value}</p>
                           <p className="mt-1 text-[10px] text-muted-foreground">{hint}</p>
                         </div>
                       ))}
                     </div>
                     {paybackRisk.nonPaybackProbability > 0 && (
                       <p className="mt-3 text-xs text-amber-700">
                         В {Math.round(paybackRisk.nonPaybackProbability * 100)}% сценариев положительный эффект не подтверждён, поэтому окупаемость не наступает.
                       </p>
                     )}
                     <details className="mt-3 rounded-md border border-border/70 px-3 py-2">
                       <summary className="cursor-pointer text-xs font-medium">Источники допущений и ручные переопределения</summary>
                       <div className="mt-2 space-y-2">
                         <p className="text-[11px] leading-relaxed text-muted-foreground">
                           Базовый расчёт: {formatPaybackYears(paybackRisk.basePaybackYears, paybackRisk.nonPaybackProbability)}.
                           В {Math.round(paybackRisk.baseProbability * 100)}% прогонов используется базовое значение, в остальных — равномерная выборка по диапазону.
                         </p>
                         <ul className="space-y-1.5">
                           {paybackRisk.assumptions.map(item => (
                             <li key={item.key} className="flex flex-col gap-0.5 text-[11px] sm:flex-row sm:items-baseline sm:justify-between">
                               <span className="text-muted-foreground">{item.label}</span>
                               <span className="font-mono tabular-nums">
                                 база {item.base} · {item.range[0]}–{item.range[1]} {item.unit}
                                 {item.overridden ? ' · переопределено вручную' : ''}
                               </span>
                             </li>
                           ))}
                         </ul>
                         <p className="border-t border-border/70 pt-2 text-[10px] text-muted-foreground">
                           Источник расчёта: assumptions.json · {paybackRisk.assumptions.map(item => item.source).join(' · ')}.
                         </p>
                       </div>
                     </details>
                   </div>
                 ))}
               </CardContent>
             </Card>
            <Card className="shadow-none">
              <CardHeader className="py-4"><CardTitle className="text-base flex items-center gap-2"><IconInfoAssumption size={18} className="text-primary" />Допущения и источники</CardTitle></CardHeader>
              <CardContent className="py-0 pb-4 text-xs text-muted-foreground space-y-1">
                <p><IconSourceDoc size={14} className="inline mr-1" />Ставка дисконтирования: {results[0].assumptions.discountRatePct}%; сервис: {results[0].assumptions.servicePct}%; электричество: {results[0].assumptions.electricityTariffRubKwh} ₽/кВт·ч; амортизация: {results[0].assumptions.depreciationYears} лет.</p>
                <p>Производительность: {results[0].assumptions.throughputUnitsPerHour} ед./ч — {results[0].assumptions.throughputOverridden ? 'переопределено пользователем' : results[0].assumptions.throughputConfirmed ? 'подтверждено в ТТХ' : 'допущение, значение редактируемо'}.</p>
              </CardContent>
            </Card>
          </>
        )}
        
        <div className="pt-8 text-xs text-muted-foreground print:pt-4 border-t border-border text-center">
          <p>Внимание: Данный расчет является предварительным (индикативным) и не является публичной офертой.</p>
          <p>Для формирования точного коммерческого предложения требуется детальный технологический аудит объекта.</p>
        </div>
      </div>
    </div>
  );
}
