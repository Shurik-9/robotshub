import { fieldsForProcess, type ProcessKind, type SiteProcess } from './start-processes.ts';
import { gzipSync, gunzipSync, strToU8, strFromU8 } from 'fflate';
import {
  parseStartScopeDraft, startScopeObjectLabel, startScopeProcesses, START_SCOPE_LABELS,
  type StartObjectId, type StartScopeDraft,
} from './start-scope.ts';

export type BriefEvidence = { title: string; caseId: string; sourceLabel: string };
type Guidance = { opportunity: string; economicLever: string; checks: string[] };

// Mechanisms to investigate, not a suitability score or a forecast for an unknown site.
const guidance: Record<ProcessKind, Guidance> = {
  flow: {
    opportunity: 'Повторяющиеся перемещения между точками можно рассмотреть отдельно от приёмки и контроля груза.',
    economicLever: 'Сравнить время сотрудников на перевозку и ожидание со стоимостью автоматизированного маршрута.',
    checks: ['Что перевозят, откуда и куда', 'Как часто нужна доставка', 'Кто загружает, принимает и подтверждает передачу'],
  },
  storage: {
    opportunity: 'Разделить хранение, доступ к товару и его перевозку: для них нужны разные решения.',
    economicLever: 'Проверить затраты на поиск и подачу товара, а не считать всю площадь готовой к автоматизации.',
    checks: ['Устройство стеллажей и адресного хранения', 'Габариты и способы захвата груза', 'Действующая система учёта'],
  },
  replenishment: {
    opportunity: 'Рассмотреть регулярный подвоз материалов по запросу или по расписанию.',
    economicLever: 'Проверить время на подвоз и ожидание пополнения в месте потребления.',
    checks: ['Что запускает пополнение', 'Размер партии и частота запросов', 'Место передачи и резервный порядок при сбое'],
  },
  picking: {
    opportunity: 'Отделить перемещения комплектовщика от самого отбора: перевозка товара не равна автоматическому отбору.',
    economicLever: 'Сопоставить время ходьбы, отбора и проверки заказа — эффект у этих операций различается.',
    checks: ['Ассортимент, упаковка и захват товара', 'Структура заказов и пиковая нагрузка', 'Как выдаются и подтверждаются задания'],
  },
  shipping: {
    opportunity: 'Рассмотреть доставку готового груза к точке отправки; упаковку и погрузку проверить отдельно.',
    economicLever: 'Проверить затраты на перемещения и ожидание передачи перед отправкой.',
    checks: ['Маршрут и конечная точка передачи', 'Временные окна и пиковый поток', 'Кто отвечает за упаковку, загрузку и приёмку'],
  },
  cleaning: {
    opportunity: 'Рассмотреть регулярную уборку доступных поверхностей в заданные временные окна.',
    economicLever: 'Сравнить трудозатраты на регулярную уборку с обслуживанием техники; ручная доуборка может сохраниться.',
    checks: ['Тип пола, препятствия и доступные проходы', 'График и фактическая площадь регулярной уборки', 'Вода, обслуживание, зарядка и совместное движение с людьми'],
  },
  inspection: {
    opportunity: 'Отделить наблюдение и сбор данных от решения о ремонте или корректировке учёта.',
    economicLever: 'Проверить время обходов и обработки замечаний; наличие сенсора само по себе не доказывает точность контроля.',
    checks: ['Что и с какой точностью нужно обнаруживать', 'Частота и точки проверок', 'Кто обрабатывает результаты и отвечает за действие'],
  },
  service: {
    opportunity: 'Выделить повторяемые обращения, которые можно обслуживать по понятному сценарию.',
    economicLever: 'Проверить нагрузку на сотрудников и долю запросов, которым всё равно нужен человек.',
    checks: ['Типовые обращения и доступность интерфейса', 'Интеграция с действующими системами', 'Передача сложного запроса сотруднику'],
  },
  custom: {
    opportunity: 'Сначала обозначить начало, результат и повторяющиеся действия этого процесса.',
    economicLever: 'Оценить трудозатраты и ожидание только после описания фактической работы.',
    checks: ['Как начинается и заканчивается работа', 'Что повторяется и с какой частотой', 'Ограничения и участие сотрудников'],
  },
};

const sourceLabel = 'Кейс из каталога внедрений ФЦ БАС, 2026; не прогноз для вашей площадки';
const warehouseTransport: BriefEvidence = {
  title: 'Перемещение грузов на складах «Восток-Сервис»',
  caseId: 'ronavi-h1500-vostok', sourceLabel,
};
const productionTransport: BriefEvidence = {
  title: 'Внутренние перемещения в автопроме: Ronavi H1500',
  caseId: 'ronavi-h1500-avtoprom', sourceLabel,
};
const warehouseInventory: BriefEvidence = {
  title: 'Проверка складских запасов: AI Stock Counter во «ВкусВилл»',
  caseId: 'stock-counter-vkusvill', sourceLabel,
};
const airportCleaning: BriefEvidence = {
  title: 'Уборка: MARK 2 SE, среди указанных площадок — аэропорт Красноярск',
  caseId: 'mark2-se-multi', sourceLabel,
};

// Explicit process/object pairs. In particular, hospital-to-laboratory drones
// are NOT evidence of autonomous indoor medical logistics.
const evidenceByProcess: Record<string, BriefEvidence[]> = {
  'warehouse:receiving': [warehouseTransport],
  'warehouse:shipping': [warehouseTransport],
  'warehouse:inventory': [warehouseInventory],
  'production:line-supply': [productionTransport],
  'production:wip-transfer': [productionTransport],
  'production:finished-goods': [productionTransport],
  'airport:terminal-cleaning': [airportCleaning],
  'public:cleaning': [{
    title: 'Уборка общественных помещений: MARK 2 SE в ТЦ и техникуме',
    caseId: 'mark2-se-multi', sourceLabel,
  }],
};

export function briefForProcess(objectId: StartObjectId | null, process: SiteProcess) {
  return {
    ...guidance[process.kind],
    checks: [...guidance[process.kind].checks],
    evidence: [...(evidenceByProcess[`${objectId}:${process.id}`] ?? [])],
  };
}

function validatedBrief(draft: StartScopeDraft) {
  const parsed = parseStartScopeDraft({ ...draft, step: 4, activeProcess: null });
  if (!parsed) throw new Error('Не удалось собрать справку: проверьте выбранный объект и участки.');
  return parsed;
}

export function buildStartBriefText(input: StartScopeDraft): string {
  const draft = validatedBrief(input);
  const lines = [
    'Железный аргумент — краткий разбор площадки',
    `Объект: ${startScopeObjectLabel(draft)}`,
    `Охват: ${START_SCOPE_LABELS[draft.scope!]}`,
    '',
    'Типовой обзор процессов, а не обследование площадки и не расчёт парка или окупаемости.',
    'Примеры относятся к указанным в источниках объектам; их результаты не перенесены на ваш объект.',
    '',
  ];
  for (const process of startScopeProcesses(draft)) {
    const brief = briefForProcess(draft.objectId, process);
    lines.push(process.name, process.summary, `Что рассмотреть: ${brief.opportunity}`,
      `Что проверить в экономике: ${brief.economicLever}`, `Проверки: ${brief.checks.join('; ')}.`);
    for (const evidence of brief.evidence) {
      lines.push(`Пример: ${evidence.title}`, `Источник: ${evidence.sourceLabel}`,
        `https://robotshub.ru/cases/${evidence.caseId}`);
    }
    if (!brief.evidence.length) lines.push('Прямой кейс для этого процесса и типа объекта в этом разборе не подобран. Это не означает, что решений на рынке нет.');
    const answers = draft.details[process.id];
    if (answers) {
      const fields = fieldsForProcess(process.kind);
      for (const field of fields) {
        if (answers.unknown[field.key]) lines.push(`${field.label}: пока неизвестно`);
        else if (answers.values[field.key]?.trim()) lines.push(`${field.label}: ${answers.values[field.key]}${field.unit ? ` ${field.unit}` : ''}`);
      }
    }
    lines.push('');
  }
  lines.push('Неуказанные параметры остаются неизвестными. Уточнять все участки для продолжения не требуется.');
  return lines.join('\n');
}

const MAX_LINK_LENGTH = 24_000;

export function createStartBriefUrl(input: StartScopeDraft, origin: string): string {
  const draft = validatedBrief(input);
  const compact = {
    ...draft,
    // Restore current template text, never arbitrary metadata from a shared link.
    processes: draft.processes.map(process => process.kind === 'custom'
      ? { id: process.id, name: process.name } : { id: process.id }),
  };
  const url = new URL('/start', origin);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Недопустимый адрес для ссылки.');
  const serialized = strToU8(JSON.stringify(compact));
  if (serialized.length > 65536) throw new Error('Слишком много вводных для безопасной ссылки.');
  const encoded = btoa(Array.from(gzipSync(serialized), byte => String.fromCharCode(byte)).join(''))
    .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
  url.hash = `brief=z.${encoded}`;
  if (url.toString().length > MAX_LINK_LENGTH) {
    throw new Error('Вводных слишком много для ссылки. Скачайте справку: в ней сохранятся все ответы.');
  }
  return url.toString();
}

export function decodeStartBriefHash(hash: string): StartScopeDraft | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  if (!params.has('brief')) return null;
  if (hash.length > MAX_LINK_LENGTH) throw new Error('Ссылка слишком длинная. Локальные данные не изменены.');
  try {
    let serialized = params.get('brief') ?? '';
    if (serialized.startsWith('z.')) {
      const encoded = serialized.slice(2).replaceAll('-', '+').replaceAll('_', '/');
      const bytes = Uint8Array.from(atob(encoded), char => char.charCodeAt(0));
      if (bytes.length < 18 || bytes[0] !== 31 || bytes[1] !== 139) throw new Error('invalid gzip');
      const size = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(bytes.length - 4, true);
      if (size === 0 || size > 65536) throw new Error('oversized brief');
      serialized = strFromU8(gunzipSync(bytes, { out: new Uint8Array(size) }));
    }
    const raw: unknown = JSON.parse(serialized);
    if (!raw || typeof raw !== 'object' || !('step' in raw) || raw.step !== 4) throw new Error('invalid brief');
    const draft = parseStartScopeDraft(raw);
    if (!draft || !draft.objectId || !draft.scope) throw new Error('invalid brief');
    return { ...draft, step: 4, activeProcess: null };
  } catch {
    throw new Error('Ссылка на разбор повреждена или имеет неподдерживаемый формат. Локальные данные не изменены.');
  }
}
