import type { ObjectType } from '@/store/project';
import type { SolutionTaxonomy } from '@/lib/solutionTaxonomy';

export type MatchReasonStatus = 'positive' | 'warning' | 'critical' | 'neutral';

export type MatchReason = {
  id: string;
  label: string;
  detail: string;
  points: number;
  maxPoints: number;
  status: MatchReasonStatus;
};

export type SolutionMatchResult = {
  score: number;
  confidence: number;
  criticalMismatch: string | null;
  reasons: MatchReason[];
};

type ScoringSolution = {
  price_rub?: number | null;
  trl?: number | null;
  case_study?: string | null;
  source?: string | null;
  specs?: Record<string, unknown> | null;
};

type ScoringContext = {
  objectType: ObjectType;
  objectParams: Record<string, number | string | boolean>;
  taxonomy: SolutionTaxonomy;
};

const OBJECT_MATCH: Record<Exclude<ObjectType, null>, {
  areas: string[];
  operations: string[];
}> = {
  warehouse: {
    areas: ['warehouse', 'production', 'indoor'],
    operations: ['transport', 'handling', 'sorting', 'inventory', 'clean_indoor'],
  },
  airport: {
    areas: ['roads', 'public', 'indoor', 'outdoor', 'air'],
    operations: ['transport', 'handling', 'clean_indoor', 'clean_outdoor', 'security', 'monitoring'],
  },
  medical: {
    areas: ['healthcare', 'indoor'],
    operations: ['transport', 'clean_indoor', 'inventory', 'medical', 'service'],
  },
  custom: {
    areas: [],
    operations: [],
  },
};

function asPositiveNumber(value: unknown): number | null {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function getRequiredPayloadKg(
  objectType: ObjectType,
  params: Record<string, number | string | boolean>,
): number | null {
  if (objectType === 'warehouse') return asPositiveNumber(params.pallet_weight_kg);
  if (objectType === 'airport') return asPositiveNumber(params.baggage_avg_weight_kg);
  if (objectType === 'medical') {
    const candidates = [
      params.food_cart_weight_kg,
      params.laundry_container_weight_kg,
    ].map(asPositiveNumber).filter((value): value is number => value !== null);
    return candidates.length ? Math.max(...candidates) : null;
  }
  return null;
}

function getAvailableWidthMm(
  objectType: ObjectType,
  params: Record<string, number | string | boolean>,
): number | null {
  const widthM = objectType === 'warehouse'
    ? asPositiveNumber(params.rack_aisle_width_m ?? params.main_aisle_width_m)
    : objectType === 'medical'
      ? asPositiveNumber(params.corridor_width_m)
      : null;
  return widthM ? widthM * 1000 : null;
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function scoreSolutionMatch(
  solution: ScoringSolution,
  context: ScoringContext,
): SolutionMatchResult {
  const { objectType, objectParams, taxonomy } = context;
  const specs = solution.specs ?? {};
  const reasons: MatchReason[] = [];
  let score = 0;
  let confidencePoints = 0;
  let criticalMismatch: string | null = null;

  const matchConfig = objectType ? OBJECT_MATCH[objectType] : null;
  const areaMatch = Boolean(taxonomy.areaIds.some(area => matchConfig?.areas.includes(area)));
  const operationMatch = Boolean(taxonomy.operationIds.some(operation => matchConfig?.operations.includes(operation)));

  if (!objectType) {
    reasons.push({
      id: 'object',
      label: 'Объект не задан',
      detail: 'Выберите объект, чтобы рассчитать соответствие.',
      points: 0,
      maxPoints: 35,
      status: 'warning',
    });
  } else if (objectType === 'custom') {
    score += 15;
    reasons.push({
      id: 'object',
      label: 'Универсальный объект',
      detail: 'Для точного сопоставления не хватает отраслевого шаблона.',
      points: 15,
      maxPoints: 35,
      status: 'neutral',
    });
  } else if (areaMatch && operationMatch) {
    score += 35;
    reasons.push({
      id: 'object',
      label: 'Назначение соответствует объекту',
      detail: 'Совпадают среда применения и тип выполняемой операции.',
      points: 35,
      maxPoints: 35,
      status: 'positive',
    });
  } else if (areaMatch || operationMatch) {
    score += 18;
    reasons.push({
      id: 'object',
      label: 'Частичное соответствие объекту',
      detail: areaMatch
        ? 'Подходит среда применения, но операция требует проверки.'
        : 'Операция подходит, но среда эксплуатации требует проверки.',
      points: 18,
      maxPoints: 35,
      status: 'warning',
    });
  } else {
    reasons.push({
      id: 'object',
      label: 'Назначение не подтверждено',
      detail: 'В карточке нет прямого совпадения со средой и операциями объекта.',
      points: 0,
      maxPoints: 35,
      status: 'warning',
    });
  }
  confidencePoints += taxonomy.confidence === 'needs_review' ? 8 : 20;

  const payloadRequired = taxonomy.operationIds.some(operation => ['transport', 'handling'].includes(operation));
  const requiredPayloadKg = getRequiredPayloadKg(objectType, objectParams);
  const payloadKg = asPositiveNumber(specs.payload_kg);
  if (!payloadRequired) {
    score += 25;
    reasons.push({
      id: 'payload',
      label: 'Грузоподъёмность не является ограничением',
      detail: 'Для указанного типа операции вес груза не используется как критерий.',
      points: 25,
      maxPoints: 25,
      status: 'neutral',
    });
    confidencePoints += 20;
  } else if (!requiredPayloadKg) {
    score += 10;
    reasons.push({
      id: 'payload',
      label: 'Вес груза не задан',
      detail: 'Добавьте вес груза в параметрах объекта для проверки грузоподъёмности.',
      points: 10,
      maxPoints: 25,
      status: 'warning',
    });
    confidencePoints += payloadKg ? 10 : 0;
  } else if (!payloadKg) {
    reasons.push({
      id: 'payload',
      label: 'Грузоподъёмность не подтверждена',
      detail: `Требуется не менее ${requiredPayloadKg.toLocaleString('ru-RU')} кг, но в карточке нет числового ТТХ.`,
      points: 0,
      maxPoints: 25,
      status: 'warning',
    });
  } else if (payloadKg >= requiredPayloadKg) {
    score += 25;
    reasons.push({
      id: 'payload',
      label: 'Грузоподъёмность подходит',
      detail: `${payloadKg.toLocaleString('ru-RU')} кг ≥ ${requiredPayloadKg.toLocaleString('ru-RU')} кг.`,
      points: 25,
      maxPoints: 25,
      status: 'positive',
    });
    confidencePoints += 20;
  } else {
    criticalMismatch = `Грузоподъёмность ${payloadKg.toLocaleString('ru-RU')} кг ниже требуемых ${requiredPayloadKg.toLocaleString('ru-RU')} кг`;
    reasons.push({
      id: 'payload',
      label: 'Критическое несоответствие по грузу',
      detail: criticalMismatch,
      points: 0,
      maxPoints: 25,
      status: 'critical',
    });
    confidencePoints += 20;
  }

  const availableWidthMm = getAvailableWidthMm(objectType, objectParams);
  const minAisleMm = asPositiveNumber(specs.min_aisle_mm);
  if (!criticalMismatch && availableWidthMm && minAisleMm && minAisleMm > availableWidthMm) {
    criticalMismatch = `Требуется проезд ${minAisleMm.toLocaleString('ru-RU')} мм, доступно ${Math.round(availableWidthMm).toLocaleString('ru-RU')} мм`;
    reasons.push({
      id: 'width',
      label: 'Критическое несоответствие по ширине',
      detail: criticalMismatch,
      points: 0,
      maxPoints: 0,
      status: 'critical',
    });
  }

  const budgetMln = asPositiveNumber(objectParams.capex_budget_mln);
  const priceRub = asPositiveNumber(solution.price_rub);
  if (!budgetMln) {
    score += 10;
    reasons.push({
      id: 'budget',
      label: 'Бюджет не задан',
      detail: 'Цена не влияет на место в выдаче, пока бюджет объекта не указан.',
      points: 10,
      maxPoints: 20,
      status: 'neutral',
    });
    confidencePoints += priceRub ? 10 : 0;
  } else if (!priceRub) {
    score += 4;
    reasons.push({
      id: 'budget',
      label: 'Цена не опубликована',
      detail: 'Соответствие бюджету нельзя подтвердить.',
      points: 4,
      maxPoints: 20,
      status: 'warning',
    });
  } else if (priceRub <= budgetMln * 1_000_000) {
    score += 20;
    reasons.push({
      id: 'budget',
      label: 'Цена единицы укладывается в бюджет',
      detail: `${(priceRub / 1_000_000).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} млн ₽ ≤ ${budgetMln.toLocaleString('ru-RU')} млн ₽.`,
      points: 20,
      maxPoints: 20,
      status: 'positive',
    });
    confidencePoints += 20;
  } else {
    reasons.push({
      id: 'budget',
      label: 'Цена единицы выше бюджета',
      detail: `${(priceRub / 1_000_000).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} млн ₽ > ${budgetMln.toLocaleString('ru-RU')} млн ₽.`,
      points: 0,
      maxPoints: 20,
      status: 'warning',
    });
    confidencePoints += 20;
  }

  const trl = asPositiveNumber(solution.trl);
  const maturityPoints = trl ? Math.round(Math.min(trl, 9) / 9 * 10) : 0;
  score += maturityPoints;
  reasons.push({
    id: 'maturity',
    label: trl ? `Зрелость УГТ ${trl}/9` : 'Зрелость не указана',
    detail: trl && trl >= 8
      ? 'Есть признаки готовности к промышленной эксплуатации.'
      : 'Зрелость учитывается отдельно от технической применимости.',
    points: maturityPoints,
    maxPoints: 10,
    status: trl && trl >= 8 ? 'positive' : 'warning',
  });
  if (trl) confidencePoints += 15;

  const hasCase = Boolean(solution.case_study?.trim());
  const sourceUrl = typeof specs.source_url === 'string' && specs.source_url.trim()
    ? specs.source_url.trim()
    : null;
  const evidencePoints = (hasCase ? 6 : 0) + (sourceUrl ? 4 : 0);
  score += evidencePoints;
  reasons.push({
    id: 'evidence',
    label: evidencePoints === 10 ? 'Есть кейс и первичный источник' : 'Доказательная база неполная',
    detail: [
      hasCase ? 'кейс указан' : 'кейс не указан',
      sourceUrl ? 'ТТХ ведут на источник' : 'ссылка на источник ТТХ отсутствует',
    ].join(' · '),
    points: evidencePoints,
    maxPoints: 10,
    status: evidencePoints === 10 ? 'positive' : 'warning',
  });
  confidencePoints += hasCase ? 10 : 0;
  confidencePoints += sourceUrl ? 15 : 0;

  return {
    score: criticalMismatch ? Math.min(clampScore(score), 49) : clampScore(score),
    confidence: clampScore(confidencePoints),
    criticalMismatch,
    reasons,
  };
}