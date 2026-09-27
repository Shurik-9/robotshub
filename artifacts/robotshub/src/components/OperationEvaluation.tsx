import { useLocation } from 'wouter';
import { useProject } from '@/store/project';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  calculateOperation, isOperationExample, operationFieldKey, operationFinancialEvidenceStatus,
  operationFinancialReviewDate, operationMonthOptions, operationRecordEvidenceStatus, operationRecordReviewDate,
  readOperationInputs, serializeOperationCsv, summarizeOperationJournal, validateOperationInputs,
  type OperationAvailabilityEvidence, type OperationJournalEntry, type OperationJournalKind, type OperationProfile,
} from '@/lib/operationEconomics';

const rub = (n: number) => new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(n);
const formatNumber = (n: number) => n.toLocaleString('ru-RU', { maximumFractionDigits: 1 });
const formatCsvNumber = (n: number) => String(Number(n.toFixed(6)));
const safeExternalHttpUrl = (value: string) => {
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
};
const formatEvidenceExplanation = (value: string) => {
  const explanation = value.trim() || 'не указано';
  return /[.!?…]$/.test(explanation) ? explanation : `${explanation}.`;
};
const journalKindLabels: Record<OperationJournalKind, string> = {
  accepted: 'Принятая операция',
  cancelled: 'Отмена',
  rework: 'Повторная работа',
  downtime: 'Простой',
};

type CatalogSolutionReference = {
  name: string;
  price_rub?: number | null;
  source?: string | null;
  specs_source?: string | null;
};

export default function OperationEvaluation({
  profile,
  mode,
  solution,
}: {
  profile: OperationProfile;
  mode: 'calc' | 'report';
  solution?: CatalogSolutionReference;
}) {
  const [, navigate] = useLocation();
  const { state, setAssumptionsOverrides, removeAssumptionsOverrides, resetOperationInputs, updateObjectParams, setWhatIfOverrides, selectSolutionForCalculation } = useProject();
  const input = readOperationInputs(profile, state.objectParams, state.assumptionsOverrides);
  const journalSummary = summarizeOperationJournal(input);
  const fieldUnit = (key: string, unit: string) => (
    key === 'annualVolume' || key === 'annualCapacity' ? `${profile.unit}/год` : unit
  );
  const errors = validateOperationInputs(profile, input);
  const result = errors.length ? null : calculateOperation(profile, input, {
    volumeMultiplier: state.whatIfOverrides.volumeMultiplier ?? 1,
    priceMultiplier: state.whatIfOverrides.priceMultiplier ?? 1,
  });
  const annualizedStatus = journalSummary.sufficient
    ? 'полный годовой сезонный цикл охвачен; это оценка по пользовательским данным, не независимая проверка.'
    : `сценарная: ${journalSummary.scenarioReasons.join('; ') || 'первичный журнал не подтверждён'}.`;
  const seasonalStatus = journalSummary.seasonalCoverageComplete
    ? 'наблюдения включают не менее 365 дней и все 12 месяцев; сезонные допущения и источник всё равно не проверены приложением.'
    : 'сценарный: наблюдения не покрывают полный годовой сезонный цикл; результат не является подтверждённой годовой мощностью.';
  const operationalKey = operationFieldKey(profile, 'operationalSource');
  const observedFromKey = operationFieldKey(profile, 'observedFrom');
  const observedToKey = operationFieldKey(profile, 'observedTo');
  const journalKey = operationFieldKey(profile, 'journal');
  const scheduledHoursKey = operationFieldKey(profile, 'scheduledOperatingHours');
  const operatingMonthsKey = operationFieldKey(profile, 'operatingMonths');
  const offSeasonAvailabilityKey = operationFieldKey(profile, 'offSeasonAvailabilityByMonth');
  const offSeasonEvidenceKey = operationFieldKey(profile, 'offSeasonEvidenceByMonth');
  const operationalCoverageKey = operationFieldKey(profile, 'operationalCoverageConfirmed');
  const financialKey = operationFieldKey(profile, 'financialSource');
  const scopeKey = operationFieldKey(profile, 'scopeConfirmed');
  const exampleKey = operationFieldKey(profile, 'example');
  const example = isOperationExample(profile, state.objectParams);
  const monthlySeasonalAssumptions = operationMonthOptions.map(({ month, label }) => ({
    month,
    label,
    isOperating: journalSummary.operatingMonths.includes(month),
    availability: journalSummary.operatingMonths.includes(month)
      ? 100
      : journalSummary.offSeasonAvailabilityByMonth[month],
    evidence: journalSummary.offSeasonEvidenceByMonth[month],
  }));
  const offSeasonAssumptionsText = monthlySeasonalAssumptions
    .filter(assumption => !assumption.isOperating)
    .map(assumption => `${assumption.label} — ${formatNumber(assumption.availability)}%`)
    .join('; ');
  const financialStatus = operationFinancialEvidenceStatus(example);
  const operationalStatus = operationRecordEvidenceStatus(input.operationalCoverageConfirmed && !example);
  const loadExample = () => {
    setAssumptionsOverrides(Object.fromEntries(Object.entries(profile.example.values).map(([key, value]) => [operationFieldKey(profile, key), value])));
    updateObjectParams({
      [operationalKey]: profile.example.operationalBasis,
      [journalKey]: '[]',
      [scheduledHoursKey]: '',
      [financialKey]: profile.example.financialBasis,
      [scopeKey]: false,
      [exampleKey]: true,
    });
  };
  const clearExample = () => {
    resetOperationInputs(profile.key);
  };
  const saveJournal = (journal: OperationJournalEntry[]) => {
    updateObjectParams({ [journalKey]: JSON.stringify(journal) });
  };
  const updateOffSeasonEvidence = (month: number, update: Partial<OperationAvailabilityEvidence>) => {
    updateObjectParams({
      [offSeasonEvidenceKey]: JSON.stringify({
        ...input.offSeasonEvidenceByMonth,
        [month]: { ...input.offSeasonEvidenceByMonth[month], ...update },
      }),
    });
  };
  const updateJournalEntry = (index: number, update: Partial<OperationJournalEntry>) => {
    saveJournal(input.journal.map((entry, entryIndex) => entryIndex === index ? { ...entry, ...update } : entry));
  };
  const addJournalEntry = () => saveJournal([
    ...input.journal,
    { date: '', kind: 'accepted', volume: null, downtimeHours: null, reason: '' },
  ]);
  const removeJournalEntry = (index: number) => saveJournal(input.journal.filter((_, entryIndex) => entryIndex !== index));
  const evidence = (
    <div className="space-y-2 text-sm text-muted-foreground">
      <p><strong className="text-foreground">Область применимости:</strong> {profile.scope}</p>
      <p><strong className="text-foreground">Не включено автоматически:</strong> {profile.exclusions}</p>
      <div className="rounded border p-3">
        <p><strong className="text-foreground">Операционный журнал:</strong> {profile.operationalRecord.publicStatus}</p>
        <p className="mt-1">Список обязательных записей для проверки мощности:</p>
        <ul className="list-disc pl-5">
          {profile.operationalRecord.requiredEntries.map(entry => <li key={entry}>{entry}</li>)}
        </ul>
        <p className="mt-1 text-xs">Проверка открытых материалов: {operationRecordReviewDate}. Каталожные и паспортные числа не заменяют журнал.</p>
      </div>
      <p>Отраслевые свидетельства подтверждают назначение, но не подставляются в числовой расчёт:</p>
      <ul className="list-disc pl-5">
        {profile.evidence.map(item => <li key={item.url}><a className="underline" href={item.url} target={item.url.startsWith('http') ? '_blank' : undefined} rel="noreferrer">{item.label}</a> — {item.note}</li>)}
      </ul>
    </div>
  );

  const resultView = result && (
    <Card data-testid="operation-results">
      <CardHeader><CardTitle>Сравнение за {input.values.horizon} лет</CardTitle></CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p>Годовой объём работ: {result.annualVolume.toLocaleString('ru-RU')} {profile.unit}; расчётная мощность комплекта: {formatNumber(result.annualCapacity)} {profile.unit}/год.</p>
        <p>Объект и период: {input.siteName || 'не указаны'} · {input.observedFrom || '—'} — {input.observedTo || '—'}.</p>
        <p>Операционный источник: {example ? 'сценарный пример; первичный журнал не подтверждён' : `${input.operationalSource} · ${operationalStatus}`}</p>
        <div className={`rounded border p-3 ${journalSummary.sufficient || example ? '' : 'border-amber-500/50 bg-amber-500/5'}`} data-testid="operation-annualization">
          <p className="font-semibold">Годовая экстраполяция по наблюдениям</p>
          <p>Период: {journalSummary.observedCalendarDays} календарных дней; журнал: {journalSummary.journalDays} разных дат.</p>
          {journalSummary.annualizedCapacity !== null ? <>
            <p data-testid="operation-linear-estimate">Базовая линейная оценка без сезонной поправки: {formatNumber(journalSummary.acceptedVolume)} {profile.unit} ÷ {journalSummary.observedCalendarDays} календарных дней × 365 = <strong data-testid="operation-linear-capacity-value">{formatNumber(journalSummary.annualizedCapacity)} {profile.unit}/год</strong>.</p>
            <p data-testid="operation-linear-status">Статус базовой оценки: {annualizedStatus}</p>
            {journalSummary.seasonallyAdjustedCapacity !== null
              ? <p data-testid="operation-seasonal-estimate">Сезонно скорректированный сценарий: {formatNumber(journalSummary.acceptedVolume)} {profile.unit} ÷ {formatNumber(journalSummary.observedSeasonalDays)} сезонно доступных дней × {formatNumber(journalSummary.annualSeasonalDays)} ожидаемых дней в году = <strong data-testid="operation-seasonal-capacity-value">{formatNumber(journalSummary.seasonallyAdjustedCapacity)} {profile.unit}/год</strong>. По выбранным месяцам обычной работы ({journalSummary.operatingMonths.map(month => operationMonthOptions[month - 1].label).join(', ')}) доступность принята за 100%; для остальных месяцев учтены отдельные значения: {offSeasonAssumptionsText}.</p>
              : <p data-testid="operation-seasonal-estimate">Сезонный сценарий не рассчитан: в периоде наблюдений нет дней, доступных по заданному сезонному календарю.</p>}
            <p data-testid="operation-seasonal-status">Сезонный статус: {seasonalStatus}</p>
          </> : <p>По журналу нет принятого объёма для экстраполяции; в расчёте используется введённое резервное допущение {formatNumber(input.values.annualCapacity)} {profile.unit}/год.</p>}
          <p>Мощность, применённая для расчёта числа комплектов: <strong>{formatNumber(result.annualCapacity)} {profile.unit}/год</strong>{journalSummary.seasonallyAdjustedCapacity !== null ? ' (сезонно скорректированный сценарий)' : ' (резервное допущение или линейная оценка)'}.</p>
          {journalSummary.scheduledOperatingHours !== null && <p>Простой: {formatNumber(journalSummary.downtimeHours)} из {formatNumber(journalSummary.scheduledOperatingHours)} плановых часов; доступность {formatNumber(journalSummary.availabilityPercent ?? 0)}%.</p>}
          {journalSummary.noDowntimeAnnualCapacity !== null && <p>Сценарная мощность без наблюдавшихся простоев: {formatNumber(journalSummary.noDowntimeAnnualCapacity)} {profile.unit}/год; оценочная потеря из-за простоев: {formatNumber(journalSummary.downtimeCapacityLoss ?? 0)} {profile.unit}/год.</p>}
          <p>Отменено: {formatNumber(journalSummary.cancelledVolume)} {profile.unit} ({formatNumber(journalSummary.cancelledSharePercent)}% записанного объёма); повторная работа: {formatNumber(journalSummary.reworkVolume)} {profile.unit} ({formatNumber(journalSummary.reworkSharePercent)}%). Они не прибавляются к принятой выработке.</p>
        </div>
        <p>Потребность: ⌈{result.annualVolume.toLocaleString('ru-RU')} / {formatNumber(result.annualCapacity)}⌉ = <strong>{result.fleet} компл.</strong></p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded border p-3"><strong>Текущий способ</strong><p>CAPEX: 0</p><p>OPEX в год: {rub(result.baselineAnnual)}</p><p>TCO: {rub(result.tcoBaseline)}</p></div>
          <div className="rounded border p-3"><strong>Роботизированный способ</strong><p>CAPEX: {rub(result.capex)}</p><p>OPEX в год: {rub(result.newAnnual)}</p><p>TCO: {rub(result.tcoNew)}</p></div>
        </div>
        <p>Годовой эффект: {rub(result.savings)} = текущая стоимость − переменные и постоянные затраты.</p>
        <p>Простой срок окупаемости: {result.payback === null ? 'не окупается при этих вводных' : `${result.payback.toFixed(2)} лет`}; NPV: {rub(result.npv)} при ставке {input.values.discount}%.</p>
        <p className="text-muted-foreground">TCO не учитывает финансирование или остаточную стоимость. NPV = −CAPEX + сумма дисконтированного годового эффекта. Количество комплектов округляется вверх; рост объёма может изменить потребность ступенчато.</p>
      </CardContent>
    </Card>
  );

  const csv = () => {
    if (!result) return;
    const rows = [
      ['Модель', profile.title], ['Объект', String(state.objectParams.site_name ?? '')],
      ['Операция', String(state.objectParams.task ?? '')], ['Область применимости', profile.scope],
      ['Ограничения', profile.exclusions], ['Решение каталога', state.activeSolutionId ?? ''],
      ['Статус первичного операционного журнала', profile.operationalRecord.publicStatus],
      ['Дата проверки доступности журнала', operationRecordReviewDate],
      ['Период наблюдений с', input.observedFrom || 'не указан'],
      ['Период наблюдений по', input.observedTo || 'не указан'],
      ...profile.fields.map(field => [
        field.label + ' (' + fieldUnit(field.key, field.unit) + ')',
        field.key === 'annualCapacity' && journalSummary.annualizedCapacity !== null && !Number.isFinite(input.values[field.key])
          ? journalSummary.seasonallyAdjustedCapacity === null
            ? 'не введено: сезонный сценарий не рассчитан; базовая линейная мощность определена по журналу'
            : 'не введено: сезонно скорректированная мощность рассчитана по журналу'
          : String(input.values[field.key]),
      ]),
      ['Метод годовой экстраполяции', journalSummary.annualizedCapacity === null
        ? 'По журналу нет принятой выработки; использовано ручное сценарное допущение.'
        : `Принятый объём ${journalSummary.acceptedVolume} / ${journalSummary.observedCalendarDays} календарных дней × 365.`],
      ['Календарных дней наблюдений', String(journalSummary.observedCalendarDays)],
      ['Разных дат журнала', String(journalSummary.journalDays)],
      ['Принятый объём за период', String(journalSummary.acceptedVolume)],
      ['Отменённый объём за период', String(journalSummary.cancelledVolume)],
      ['Доля отмен от записанного объёма, %', String(journalSummary.cancelledSharePercent)],
      ['Объём повторной работы за период', String(journalSummary.reworkVolume)],
      ['Доля повторной работы от записанного объёма, %', String(journalSummary.reworkSharePercent)],
      ['Простой, часов', String(journalSummary.downtimeHours)],
      ['Плановые рабочие часы за период', String(journalSummary.scheduledOperatingHours ?? 'не указаны')],
      ['Доступность по журналу, %', String(journalSummary.availabilityPercent ?? 'не рассчитана')],
       ['Базовая линейная годовая мощность по журналу', journalSummary.annualizedCapacity === null ? 'не рассчитана' : formatCsvNumber(journalSummary.annualizedCapacity)],
      ['Месяцы обычной работы', journalSummary.operatingMonths.map(month => operationMonthOptions[month - 1].label).join(', ')],
        ...monthlySeasonalAssumptions.map(({ label, isOperating, availability }) => [
         `Доступность работ — ${label}${isOperating ? ' (обычная работа)' : ' (вне сезона)'}, % от обычной выработки`,
         formatCsvNumber(availability),
       ]),
        ...monthlySeasonalAssumptions.filter(({ isOperating }) => !isOperating).flatMap(({ label, evidence }) => [
          [
            `Основание доступности работ — ${label}: источник`,
            evidence.source.trim() || 'не указан — значение является допущением',
          ],
          [
            `Основание доступности работ — ${label}: пояснение`,
            evidence.explanation.trim() || 'не указано',
          ],
        ]),
      ['Сезонно доступные дни периода наблюдений', String(journalSummary.observedSeasonalDays)],
       ['Сезонно доступные дни в расчётном году', formatCsvNumber(journalSummary.annualSeasonalDays)],
       ['Сезонно скорректированная годовая мощность, сценарий', journalSummary.seasonallyAdjustedCapacity === null ? 'не рассчитана' : formatCsvNumber(journalSummary.seasonallyAdjustedCapacity)],
      ['Покрыт полный сезонный цикл', journalSummary.seasonalCoverageComplete ? 'да: не менее 365 дней и 12 месяцев' : 'нет: результат сценарный'],
       ['Статус базовой линейной оценки', annualizedStatus],
       ['Статус сезонного сценария', seasonalStatus],
      ['Годовая мощность без наблюдавшихся простоев, сценарий', String(journalSummary.noDowntimeAnnualCapacity ?? 'не рассчитана')],
      ['Потеря мощности из-за простоев, сценарий', String(journalSummary.downtimeCapacityLoss ?? 'не рассчитана')],
       ['Статус годовой экстраполяции', annualizedStatus],
      ['Мощность, использованная в расчёте', String(result.annualCapacity)],
      ...input.journal.map((entry, index) => [
        `Журнал ${index + 1}: ${journalKindLabels[entry.kind]}`,
        `Дата: ${entry.date}; объём: ${entry.volume ?? '—'} ${profile.unit}; простой: ${entry.downtimeHours ?? '—'} ч; причина: ${entry.reason || '—'}`,
      ]),
      ['Источник операционных данных', input.operationalSource], ['Источник финансовых данных', input.financialSource],
      ['Статус операционных данных', example ? 'Иллюстративный сценарий; журнал не подтверждён.' : operationalStatus],
      ['Проверка обязательных записей журнала пользователем', input.operationalCoverageConfirmed ? 'отмечена; независимо не проверена приложением' : 'нет'],
      ...profile.operationalRecord.requiredEntries.map((entry, index) => [`Обязательная запись ${index + 1}`, entry]),
      ['Статус финансовых данных', financialStatus],
      ['Проверка доступных финансовых документов', `Первичные документы по площадке не представлены в доступных материалах; проверено ${operationFinancialReviewDate}`],
      ['Каталожная цена оборудования', solution?.price_rub ? rub(solution.price_rub) : 'не указана'],
      ['Источник цены оборудования', solution?.source ?? 'не указан'],
      ['Источник ТТХ модели', solution?.specs_source ?? 'не указан'],
      ...profile.financialCostLines.flatMap(line => {
        const label = profile.fields.find(field => field.key === line.fieldKey)?.label ?? line.fieldKey;
        return [
          [`Состав затрат: ${label}`, line.composition],
          [`Документы для подтверждения: ${label}`, line.documents],
          [`Подтверждение: ${label}`, 'первичный финансовый документ не представлен; значение не подтверждено'],
        ];
      }),
      ['Соответствие области применимости подтверждено пользователем', input.scopeConfirmed ? 'да' : 'нет'],
      ['Статус данных', financialStatus],
      ...profile.evidence.map(item => ['Свидетельство применимости: ' + item.label, item.url + ' — ' + item.note]),
      ...profile.financialReferences.map(item => [
        'Публичный финансовый ориентир: ' + item.label,
        `${item.value}; опубликовано: ${item.publishedAt}; тип: ${item.sourceType}; ограничение: ${item.limitation}; источник: ${item.url}`,
      ]),
      ...(example ? [
        ['Основание примерной производительности', profile.example.operationalBasis],
        ['Основание примерной экономики', profile.example.financialBasis],
        ['Ограничение примера', profile.example.caveat],
      ] : []),
      ['Множитель объёма', String(state.whatIfOverrides.volumeMultiplier ?? 1)],
      ['Множитель цены', String(state.whatIfOverrides.priceMultiplier ?? 1)],
      ['Комплектов', String(result.fleet)], ['Текущий OPEX', String(result.baselineAnnual)],
      ['CAPEX', String(result.capex)], ['Новый OPEX', String(result.newAnnual)],
      ['Годовой эффект', String(result.savings)], ['TCO текущий', String(result.tcoBaseline)],
      ['TCO новый', String(result.tcoNew)], ['NPV', String(result.npv)],
      ['Окупаемость, лет', result.payback === null ? 'не окупается' : String(result.payback)],
    ];
    const text = serializeOperationCsv(rows);
    const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url; link.download = `robotshub_${profile.key}.csv`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  if (mode === 'report' && !result) {
    return (
      <div className="container mx-auto max-w-5xl space-y-4 px-4 py-8" data-testid="operation-report-blocked">
        <h1 className="text-2xl font-bold">Отчёт ТЭО пока недоступен</h1>
        <p>Для {profile.title.toLowerCase()} нужны исходные значения, источники данных и подтверждение области применимости. Неполный расчёт нельзя напечатать или экспортировать как отчёт.</p>
        <ul className="list-disc pl-5 text-sm">{errors.map(error => <li key={error}>{error}</li>)}</ul>
        <Button onClick={() => navigate('/calc')}>Заполнить расчёт</Button>
      </div>
    );
  }

  return (
    <div className={`container mx-auto max-w-5xl space-y-6 px-4 py-8 ${mode === 'report' ? 'operation-evaluation-print-report' : ''}`} data-testid={`operation-${mode}-${profile.key}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-2xl font-bold">{mode === 'report' ? 'Отчёт ТЭО' : 'Расчёт ТЭО'}: {profile.title}</h1><p className="text-sm text-muted-foreground">Объект: {String(state.objectParams.site_name ?? '')} · модель по операции, не универсальный шаблон</p></div>
        {mode === 'report' ? <div className="flex gap-2 print:hidden"><Button onClick={csv} data-testid="operation-export-csv">Экспорт CSV</Button><Button onClick={() => window.print()}>Печать (PDF)</Button></div> : null}
      </div>
      <Card><CardHeader><CardTitle>Метод и свидетельства применимости</CardTitle></CardHeader><CardContent>{evidence}</CardContent></Card>
      <Card data-testid="operation-financial-evidence">
        <CardHeader><CardTitle>Проверка финансовых документов и состав затрат</CardTitle></CardHeader>
        <CardContent className="space-y-4 text-sm">
          <p className="text-muted-foreground">
            На {operationFinancialReviewDate} в доступных материалах нет счетов, исполненных договоров или подтверждённых клиентом смет для объекта, введённого в расчёт.
            {` ${financialStatus}`}
          </p>
          <div className="rounded border p-3">
            <p><strong>Цена оборудования по карточке:</strong> {solution?.price_rub ? rub(solution.price_rub) : 'не указана'}{solution?.name ? ` · ${solution.name}` : ''}</p>
            <p className="mt-1 text-muted-foreground">Источник карточки: {solution?.source ?? 'не указан'}{solution?.specs_source ? `; источник ТТХ: ${solution.specs_source}` : ''}.</p>
            <p className="mt-1 text-muted-foreground">Эта цена относится к оборудованию, не подтверждает стоимость внедрённого комплекта, переменных расходов или годового обслуживания и не подменяет документы площадки.</p>
          </div>
          <ul className="space-y-3">
            {profile.financialCostLines.map(line => {
              const field = profile.fields.find(item => item.key === line.fieldKey);
              return (
                <li key={line.fieldKey} className="rounded border p-3">
                  <p className="font-semibold">{field?.label ?? line.fieldKey} · {field?.unit}</p>
                  <p className="mt-1"><strong>Что включать:</strong> {line.composition}</p>
                  <p className="mt-1"><strong>Чем подтвердить:</strong> {line.documents}</p>
                  <p className="mt-1 text-amber-700 dark:text-amber-400">Статус: первичный документ не представлен; значение не подтверждено.</p>
                </li>
              );
            })}
          </ul>
          <div className="space-y-3 border-t pt-4" data-testid="operation-financial-benchmarks">
            <div>
              <h3 className="font-semibold">Открытые стоимостные ориентиры</h3>
              <p className="mt-1 text-muted-foreground">Они описывают другие объекты или модели. Эти цифры не подставляются в расчёт и не подтверждают расходы выбранной площадки.</p>
            </div>
            <ul className="space-y-3">
              {profile.financialReferences.map(reference => (
                <li key={reference.url} className="rounded border p-3">
                  <p><strong>{reference.label}:</strong> {reference.value}</p>
                  <p className="mt-1 text-muted-foreground">{reference.publishedAt} · {reference.sourceType}</p>
                  <p className="mt-1 text-muted-foreground">{reference.limitation}</p>
                  <a className="mt-1 inline-block underline" href={reference.url} target="_blank" rel="noreferrer">Открыть источник</a>
                </li>
              ))}
            </ul>
          </div>
          <p className="text-muted-foreground">Текст источника, введённый пользователем, сохраняется в отчёте, но сам по себе не подтверждает сумму. Иллюстративные финансовые значения остаются сценарными до сверки со счетами, договором и составом затрат.</p>
        </CardContent>
      </Card>
      {example && <Card className="border-amber-500/50 bg-amber-500/5" data-testid="operation-example-warning">
        <CardContent className="space-y-2 pt-5 text-sm">
          <p className="font-bold">Иллюстративный сценарий — НЕ подтверждённое ТЭО</p>
          <p>Операционная опора: {profile.example.operationalBasis}</p>
          <p>Финансы: {profile.example.financialBasis}</p>
          <p>Ограничение: {profile.example.caveat}</p>
          <p>Меняя цифры этого примера, вы не превращаете их в фактические данные. Для собственного расчёта начните с пустой формы и укажите документы.</p>
          {mode === 'calc' && <Button variant="outline" onClick={clearExample} data-testid="operation-clear-example">Перейти к фактическим данным</Button>}
        </CardContent>
      </Card>}
      {state.selectedSolutions.length > 1 && mode === 'calc' && <Card className="border-amber-500/40"><CardContent className="space-y-2 pt-5 text-sm"><p>Отчёт для разных операций нельзя объединить в одну методику. Чтобы продолжить с текущим решением, оставьте только его в расчёте.</p><Button variant="outline" onClick={() => state.activeSolutionId && selectSolutionForCalculation(state.activeSolutionId)}>Оставить текущее решение</Button></CardContent></Card>}
      {mode === 'calc' && <Card>
        <CardHeader><CardTitle>Измерения площадки и документы</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">Для расчёта по фактической площадке обязательны точное название объекта, интервал наблюдений, ссылка или идентификатор журнала и проверка полей из списка выше. Учитывайте только принятую выработку; отдельно отражайте отмены, повторы и простой. Приложение не проверяет приложенный пользователем источник. Все восемь чисел и финансовый источник также обязательны.</p>
          {!example && <Button variant="outline" onClick={loadExample} data-testid="operation-load-example">Загрузить иллюстративный пример по открытым источникам</Button>}
          <div className="grid gap-4 sm:grid-cols-2">
            {profile.fields.map(field => <label key={field.key} className="space-y-1 text-sm"><span>{field.key === 'annualCapacity' ? 'Резервное сценарное допущение мощности комплекта (обязательно, только если в журнале нет принятого объёма)' : field.label} · {fieldUnit(field.key, field.unit)}</span><Input type="number" min="0" step={field.key === 'horizon' ? 1 : 'any'} placeholder="Нет данных" value={Number.isFinite(state.assumptionsOverrides[operationFieldKey(profile, field.key)]) ? state.assumptionsOverrides[operationFieldKey(profile, field.key)] : ''} onChange={e => {
              const key = operationFieldKey(profile, field.key);
              if (e.target.value === '') removeAssumptionsOverrides([key]);
              else {
                const value = Number(e.target.value);
                if (Number.isFinite(value)) setAssumptionsOverrides({ [key]: value });
              }
            }} data-testid={`operation-input-${field.key}`} /></label>)}
          </div>
          <div className="rounded border p-3 text-sm">
            <p><strong>Объект по брифу:</strong> {input.siteName || 'не указан'}</p>
            <p className="mt-1 text-muted-foreground">Если это не точное место/маршрут/клиника, вернитесь к брифу объекта и уточните его. Данные разных площадок нельзя объединять.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1 text-sm"><span>Начало периода наблюдений</span><Input type="date" value={input.observedFrom} onChange={e => updateObjectParams({ [observedFromKey]: e.target.value })} data-testid="operation-observed-from" /></label>
            <label className="space-y-1 text-sm"><span>Конец периода наблюдений</span><Input type="date" value={input.observedTo} onChange={e => updateObjectParams({ [observedToKey]: e.target.value })} data-testid="operation-observed-to" /></label>
          </div>
          <fieldset className="space-y-3 rounded border p-3" data-testid="operation-seasonality">
            <legend className="px-1 text-sm font-semibold">Сезонность и доступность работ</legend>
            <p className="text-xs text-muted-foreground">Отметьте месяцы обычной работы. Для остальных месяцев задайте долю доступности относительно выработки в обычный рабочий день и укажите источник с кратким пояснением. Без источника ставка останется допущением; данные не проверяются приложением.</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {operationMonthOptions.map(({ month, label }) => <label key={month} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={input.operatingMonths.includes(month)}
                  onChange={() => {
                    const operatingMonths = input.operatingMonths.includes(month)
                      ? input.operatingMonths.filter(value => value !== month)
                      : [...input.operatingMonths, month].sort((a, b) => a - b);
                    updateObjectParams({ [operatingMonthsKey]: JSON.stringify(operatingMonths) });
                  }}
                  data-testid={`operation-season-month-${month}`}
                />
                <span>{label}</span>
              </label>)}
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {operationMonthOptions.map(({ month, label }) => {
                const isOperating = input.operatingMonths.includes(month);
                const availability = input.offSeasonAvailabilityByMonth[month];
                const evidence = input.offSeasonEvidenceByMonth[month];
                return <div key={month} className="min-w-0 space-y-2 rounded border p-3" data-testid={`operation-season-month-card-${month}`}>
                  <label className="block space-y-1 text-sm">
                    <span className="flex flex-wrap items-center justify-between gap-2">
                      <span className="min-w-0 break-words">{label}</span>
                      <span className={`inline-flex shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${isOperating ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-muted text-muted-foreground'}`}>
                        {isOperating ? 'обычная работа · 100%' : 'вне сезона'}
                      </span>
                    </span>
                    <Input
                      type="number"
                      min="0"
                      max="100"
                      step="1"
                      disabled={isOperating}
                      aria-label={`Доступность работ в месяце «${label}»${isOperating ? ', обычная работа, 100%' : ', % от обычной выработки'}`}
                      value={Number.isFinite(availability) ? availability : ''}
                      onChange={e => updateObjectParams({
                        [offSeasonAvailabilityKey]: JSON.stringify({
                          ...input.offSeasonAvailabilityByMonth,
                          [month]: e.target.value === '' ? Number.NaN : Number(e.target.value),
                        }),
                      })}
                      data-testid={`operation-off-season-availability-${month}`}
                    />
                  </label>
                  {!isOperating && <>
                    <label className="block space-y-1 text-sm">
                      <span>Источник ставки для месяца «{label}»</span>
                      <Input
                        maxLength={500}
                        placeholder="Метеоданные, разрешение или оценка спроса"
                        value={evidence.source}
                        onChange={e => updateOffSeasonEvidence(month, { source: e.target.value })}
                        data-testid={`operation-off-season-source-${month}`}
                      />
                    </label>
                    <label className="block space-y-1 text-sm">
                      <span>Краткое пояснение</span>
                      <Textarea
                        maxLength={300}
                        rows={2}
                        placeholder="Как источник обосновывает указанную доступность"
                        value={evidence.explanation}
                        onChange={e => updateOffSeasonEvidence(month, { explanation: e.target.value })}
                        data-testid={`operation-off-season-explanation-${month}`}
                      />
                    </label>
                  </>}
                </div>;
              })}
            </div>
          </fieldset>
          <label className="block space-y-1 text-sm">
            <span>Плановое рабочее время за этот период, часов</span>
            <Input
              type="number"
              min="0"
              step="0.5"
              placeholder="Например, 160"
              value={Number.isFinite(input.scheduledOperatingHours) && input.scheduledOperatingHours > 0 ? input.scheduledOperatingHours : ''}
              onChange={e => updateObjectParams({ [scheduledHoursKey]: e.target.value === '' ? '' : Number(e.target.value) })}
              data-testid="operation-scheduled-hours"
            />
            <span className="block text-xs text-muted-foreground">Укажите суммарные часы, когда операции планировались на выбранном интервале, до вычета простоев. Это нужно, чтобы показать долю доступности.</span>
          </label>
          <div className="space-y-3 rounded border p-3" data-testid="operation-journal">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="font-semibold">Фактический журнал операций</h3>
                <p className="text-xs text-muted-foreground">Принятый объём формирует выработку. Отмены, повторы и простой сохраняются отдельно и не прибавляются к ней.</p>
              </div>
              <Button type="button" variant="outline" onClick={addJournalEntry} data-testid="operation-journal-add">Добавить запись</Button>
            </div>
            {input.journalInvalid && <p role="alert" className="text-sm text-destructive">Сохранённый журнал не читается. Добавьте записи заново: первая новая запись заменит повреждённые данные.</p>}
            {input.journal.length === 0 && !input.journalInvalid && <p className="text-sm text-muted-foreground">Записей пока нет.</p>}
            <div className="space-y-3">
              {input.journal.map((entry, index) => (
                <div key={index} className="grid gap-3 rounded border p-3 sm:grid-cols-2 lg:grid-cols-6" data-testid={`operation-journal-entry-${index}`}>
                  <label className="space-y-1 text-sm">
                    <span>Дата</span>
                    <Input type="date" value={entry.date} onChange={e => updateJournalEntry(index, { date: e.target.value })} data-testid={`operation-journal-date-${index}`} />
                  </label>
                  <label className="space-y-1 text-sm">
                    <span>Тип события</span>
                    <select
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      value={entry.kind}
                      onChange={e => {
                        const kind = e.target.value as OperationJournalKind;
                        updateJournalEntry(index, {
                          kind,
                          volume: kind === 'downtime' ? null : entry.volume,
                          downtimeHours: kind === 'downtime' ? entry.downtimeHours : null,
                        });
                      }}
                      data-testid={`operation-journal-kind-${index}`}
                    >
                      {Object.entries(journalKindLabels).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}
                    </select>
                  </label>
                  {entry.kind !== 'downtime' ? (
                    <label className="space-y-1 text-sm">
                      <span>Объём · {profile.unit}</span>
                      <Input
                        type="number"
                        min="0"
                        step="any"
                        value={entry.volume ?? ''}
                        onChange={e => updateJournalEntry(index, { volume: e.target.value === '' ? null : Number(e.target.value) })}
                        data-testid={`operation-journal-volume-${index}`}
                      />
                    </label>
                  ) : (
                    <label className="space-y-1 text-sm">
                      <span>Простой · часов</span>
                      <Input
                        type="number"
                        min="0"
                        max="24"
                        step="0.5"
                        value={entry.downtimeHours ?? ''}
                        onChange={e => updateJournalEntry(index, { downtimeHours: e.target.value === '' ? null : Number(e.target.value) })}
                        data-testid={`operation-journal-downtime-${index}`}
                      />
                    </label>
                  )}
                  <label className="space-y-1 text-sm sm:col-span-2 lg:col-span-2">
                    <span>{entry.kind === 'accepted' ? 'Примечание (необязательно)' : 'Причина события'}</span>
                    <Input
                      maxLength={250}
                      placeholder={entry.kind === 'accepted' ? 'Необязательно' : 'Укажите причину'}
                      value={entry.reason}
                      onChange={e => updateJournalEntry(index, { reason: e.target.value })}
                      data-testid={`operation-journal-reason-${index}`}
                    />
                  </label>
                  <div className="flex items-end lg:col-span-6">
                    <Button type="button" variant="outline" onClick={() => removeJournalEntry(index)} data-testid={`operation-journal-remove-${index}`}>Удалить запись</Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <label className="block space-y-1 text-sm"><span>Источник операционных данных (журнал, протокол замера, дата)</span><Input maxLength={500} value={input.operationalSource} onChange={e => updateObjectParams({ [operationalKey]: e.target.value })} data-testid="operation-operational-source" /></label>
          <label className="block space-y-1 text-sm"><span>Источник финансовых данных (договор, смета, дата)</span><Input maxLength={500} value={input.financialSource} onChange={e => updateObjectParams({ [financialKey]: e.target.value })} data-testid="operation-financial-source" /></label>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={input.scopeConfirmed} onChange={e => updateObjectParams({ [scopeKey]: e.target.checked })} data-testid="operation-scope-confirmed" /><span>Подтверждаю, что задача площадки соответствует указанной операции и все исключения учтены в вводных. Это не заменяет независимую проверку документов.</span></label>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={input.operationalCoverageConfirmed} onChange={e => updateObjectParams({ [operationalCoverageKey]: e.target.checked })} data-testid="operation-record-coverage-confirmed" /><span>Сверил журнал с перечнем обязательных записей выше: принятая выработка отделена от отмен, повторов и простоев; пробелы явно указаны в источнике. Приложение не проверяет документ или значения.</span></label>
          <p className="text-xs text-muted-foreground">Базовый прогноз — принятый объём ÷ календарные дни периода × 365. Отдельный сезонный сценарий делит принятый объём на сезонно доступные дни периода и умножает на ожидаемые сезонно доступные дни года. Период короче 30 дней, менее 10 дат или неполный годовой сезонный цикл оставляют оценку сценарной; короткие наблюдения не подтверждают годовую мощность. Повторные работы не считаются новой выработкой. Настройки привязаны к текущей площадке и очищаются при изменении её брифа.</p>
          <div className="flex flex-wrap gap-4 text-sm">
            {(['volumeMultiplier', 'priceMultiplier'] as const).map(key => <label key={key} className="space-y-1"><span>{key === 'volumeMultiplier' ? 'Объём' : 'Цена'}: ×{state.whatIfOverrides[key] ?? 1}</span><Input type="number" min="0.1" max="3" step="0.1" value={state.whatIfOverrides[key] ?? 1} onChange={e => { const n = Number(e.target.value); if (n >= 0.1 && n <= 3) setWhatIfOverrides({ [key]: n }); }} /></label>)}
          </div>
        </CardContent>
      </Card>}
      {errors.length > 0 && <Card className="border-amber-500/40" data-testid="operation-missing-data"><CardContent className="pt-5"><p className="font-medium">Расчёт не готов — отсутствуют первичные данные:</p><ul className="mt-2 list-disc pl-5 text-sm">{errors.map(error => <li key={error}>{error}</li>)}</ul></CardContent></Card>}
      {mode === 'report' && <Card data-testid="operation-report-source-data">
        <CardHeader><CardTitle>Исходные данные и происхождение</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <ul className="space-y-1">{profile.fields.map(field => <li key={field.key}>
            {field.label}: {field.key === 'annualCapacity' && !Number.isFinite(input.values[field.key]) && journalSummary.annualizedCapacity !== null
              ? journalSummary.seasonallyAdjustedCapacity !== null
                ? `не введено; сезонно скорректированная мощность по журналу — ${formatNumber(journalSummary.seasonallyAdjustedCapacity)} ${profile.unit}/год`
                : `не введено; сезонный сценарий не рассчитан, базовая мощность по журналу — ${formatNumber(journalSummary.annualizedCapacity)} ${profile.unit}/год`
              : `${input.values[field.key]} ${fieldUnit(field.key, field.unit)}`}
          </li>)}</ul>
          <p>Объект: {input.siteName || 'не указан'}; операция: {String(state.objectParams.task ?? 'не указана')}; период: {input.observedFrom || '—'} — {input.observedTo || '—'} ({journalSummary.observedCalendarDays} календарных дней).</p>
          <p>Плановое рабочее время за период: {Number.isFinite(input.scheduledOperatingHours) ? `${formatNumber(input.scheduledOperatingHours)} ч` : 'не указано'}.</p>
            <p data-testid="operation-report-linear-estimate">Базовая линейная оценка: {journalSummary.annualizedCapacity === null
            ? 'принятый объём в журнале отсутствует; использовано резервное сценарное допущение.'
             : <>принятый объём {formatNumber(journalSummary.acceptedVolume)} {profile.unit} ÷ {journalSummary.observedCalendarDays} календарных дней × 365 = <strong data-testid="operation-report-linear-capacity-value">{formatNumber(journalSummary.annualizedCapacity)} {profile.unit}/год</strong>.</>}</p>
            <p data-testid="operation-report-linear-status">Статус базовой линейной оценки: {annualizedStatus}</p>
            <div data-testid="operation-report-seasonal-assumptions">
              <p>Сезонные допущения: месяцы обычной работы ({journalSummary.operatingMonths.map(month => operationMonthOptions[month - 1].label).join(', ')}) рассчитаны с доступностью 100%. Для остальных месяцев заданы отдельные значения доступности относительно обычной выработки:</p>
              <table className="w-full table-fixed border-collapse text-left text-sm" data-testid="operation-report-seasonal-monthly-assumptions">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th scope="col" className="w-[28%] py-2 pr-3 font-medium">Месяц и ставка доступности</th>
                    <th scope="col" className="py-2 font-medium">Основание ставки</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {monthlySeasonalAssumptions.map(({ month, label, isOperating, availability, evidence }) => {
                    const sourceUrl = safeExternalHttpUrl(evidence.source);
                    return <tr key={month} data-testid={`operation-report-seasonal-month-${month}`}>
                      <th scope="row" className="py-2 pr-3 text-left align-top font-medium">
                        <span data-testid={`operation-report-seasonal-rate-${month}`}>
                          {label}: {formatNumber(availability)}% ({isOperating ? 'обычная работа' : 'вне сезона'})
                        </span>
                      </th>
                      <td className="py-2 align-top break-words" data-testid={`operation-report-seasonal-basis-${month}`}>
                        {isOperating
                          ? 'Обычная работа: принято 100% относительно обычной выработки; отдельное основание ставки не задаётся.'
                          : <>
                            <p><strong>Источник:</strong>{' '}
                              {sourceUrl
                                ? <a
                                  className="underline"
                                  href={sourceUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >{evidence.source.trim()}</a>
                                : evidence.source.trim() || 'не указан — значение является допущением'}
                            </p>
                            <p className="mt-1"><strong>пояснение:</strong> {formatEvidenceExplanation(evidence.explanation)}</p>
                          </>}
                      </td>
                    </tr>;
                  })}
                </tbody>
              </table>
              <p>Сезонно доступно {formatNumber(journalSummary.observedSeasonalDays)} дней наблюдений и {formatNumber(journalSummary.annualSeasonalDays)} дней расчётного года.</p>
            </div>
            <p data-testid="operation-report-seasonal-estimate">Сезонно скорректированный сценарий: {journalSummary.seasonallyAdjustedCapacity === null
             ? 'не рассчитан: сезонная доступность в периоде наблюдений равна нулю.'
              : <>{formatNumber(journalSummary.acceptedVolume)} {profile.unit} ÷ {formatNumber(journalSummary.observedSeasonalDays)} сезонно доступных дней × {formatNumber(journalSummary.annualSeasonalDays)} ожидаемых дней в году = <strong data-testid="operation-report-seasonal-capacity-value">{formatNumber(journalSummary.seasonallyAdjustedCapacity)} {profile.unit}/год</strong>; это отдельный сценарий, не подтверждённая фактическая мощность.</>}</p>
            <p data-testid="operation-report-seasonal-status">Сезонный статус: {seasonalStatus}</p>
            <p data-testid="operation-report-extrapolation-status">Статус экстраполяции: {annualizedStatus}</p>
          <p>Операционные данные: {input.operationalSource || 'не указаны'} · {example ? 'сценарный пример; первичный журнал не подтверждён' : operationalStatus}</p>
          <p>Итоги периода: принято {formatNumber(journalSummary.acceptedVolume)} {profile.unit}; отменено {formatNumber(journalSummary.cancelledVolume)} {profile.unit} ({formatNumber(journalSummary.cancelledSharePercent)}% записанного объёма); повторная работа {formatNumber(journalSummary.reworkVolume)} {profile.unit} ({formatNumber(journalSummary.reworkSharePercent)}%); простой {formatNumber(journalSummary.downtimeHours)} ч.</p>
          {journalSummary.noDowntimeAnnualCapacity !== null && <p>Сценарная оценка без простоев: {formatNumber(journalSummary.noDowntimeAnnualCapacity)} {profile.unit}/год; влияние наблюдавшегося простоя: −{formatNumber(journalSummary.downtimeCapacityLoss ?? 0)} {profile.unit}/год.</p>}
          <div className="pt-2">
            <h3 className="font-semibold">Исходные записи журнала</h3>
            {input.journal.length
              ? <ul className="mt-1 list-disc space-y-1 pl-5" data-testid="operation-report-journal">
                {input.journal.map((entry, index) => <li key={index}>
                  {entry.date} · {journalKindLabels[entry.kind]}
                  {entry.kind === 'downtime'
                    ? ` · ${formatNumber(entry.downtimeHours ?? 0)} ч`
                    : ` · ${formatNumber(entry.volume ?? 0)} ${profile.unit}`}
                  {entry.reason ? ` · причина/примечание: ${entry.reason}` : ''}
                </li>)}
              </ul>
              : <p className="mt-1">Журнал событий не приложен; результат остаётся сценарным.</p>}
          </div>
          <p>Финансовые данные: {input.financialSource || 'не указаны'}</p>
          <p>Статус финансовых данных: {financialStatus}</p>
          <p>Соответствие области применимости: {input.scopeConfirmed ? 'подтверждено пользователем' : 'не подтверждено'}</p>
          <p>What-If: объём ×{state.whatIfOverrides.volumeMultiplier ?? 1}; цена ×{state.whatIfOverrides.priceMultiplier ?? 1}</p>
        </CardContent>
      </Card>}
      {resultView}
      <div className="flex gap-3 print:hidden">{mode === 'calc' ? <Button onClick={() => navigate('/report')} disabled={!result || state.selectedSolutions.length !== 1} data-testid="operation-open-report">Открыть отчёт</Button> : <Button onClick={() => navigate('/calc')} data-testid="operation-back-to-calc">Изменить вводные</Button>}<Button variant="outline" onClick={() => navigate('/solutions')}>Каталог</Button></div>
    </div>
  );
}