import solutionTypesData from '@/data/solution-types.json';

type SolutionLike = {
  id?: string;
  name?: string;
  kind?: string;
  subtype?: string;
  category?: string;
  description?: string;
  scenario?: string;
  specs?: Record<string, unknown>;
  vendor?: string;
  source?: string;
  case_study?: string;
  specs_verification?: unknown;
  company_verification?: CompanyVerification;
};

export type CompanyRoleId = 'manufacturer' | 'supplier' | 'integrator' | 'unconfirmed';
type ConfirmedCompanyRoleId = Exclude<CompanyRoleId, 'unconfirmed'>;
type VerificationStatus = 'confirmed' | 'unconfirmed' | 'disputed';

type VerificationClaim = {
  name?: string;
  status?: VerificationStatus;
  source_url?: string;
  checked_at?: string;
};

type RoleClaim = {
  role?: ConfirmedCompanyRoleId;
  status?: VerificationStatus;
  source_url?: string;
  checked_at?: string;
};

type CompanyVerification = {
  legal_entity?: VerificationClaim | null;
  brand?: VerificationClaim | null;
  roles?: RoleClaim[];
};

export type CompanyProfile = {
  brand: string;
  brandStatus: VerificationStatus;
  company: string;
  legalEntity: string;
  confirmedRoles: ConfirmedCompanyRoleId[];
  role: CompanyRoleId;
  roleLabel: string;
  roleStatus: VerificationStatus;
  roleSourceUrl: string | null;
};

const companyRoleLabels: Record<CompanyRoleId, string> = {
  manufacturer: 'Производитель',
  supplier: 'Поставщик',
  integrator: 'Интегратор',
  unconfirmed: 'Роль не подтверждена',
};

export function getCompanyProfile(solution: SolutionLike): CompanyProfile {
  const company = solution.vendor?.trim() || 'Компания не указана';
  const verification = solution.company_verification;
  const brandClaim = verification?.brand;
  const legalEntityClaim = verification?.legal_entity;
  const confirmedRoles = (verification?.roles ?? [])
    .filter((claim): claim is RoleClaim & { role: ConfirmedCompanyRoleId; status: 'confirmed'; source_url: string } =>
      claim.status === 'confirmed'
      && Boolean(claim.source_url?.trim())
      && (claim.role === 'manufacturer' || claim.role === 'supplier' || claim.role === 'integrator'),
    )
    .map(claim => claim.role);
  const uniqueConfirmedRoles = Array.from(new Set(confirmedRoles));
  const role = uniqueConfirmedRoles[0] ?? 'unconfirmed';
  const roleStatus: VerificationStatus = uniqueConfirmedRoles.length > 0 ? 'confirmed' : 'unconfirmed';
  const brandStatus: VerificationStatus = brandClaim?.status === 'confirmed' && Boolean(brandClaim.name?.trim())
    ? 'confirmed'
    : 'unconfirmed';
  const legalEntity = legalEntityClaim?.status === 'confirmed' && legalEntityClaim.name?.trim()
    ? legalEntityClaim.name.trim()
    : 'Юрлицо не подтверждено';

  return {
    brand: brandStatus === 'confirmed' ? brandClaim!.name!.trim() : 'Бренд не подтверждён',
    brandStatus,
    company,
    legalEntity,
    confirmedRoles: uniqueConfirmedRoles,
    role,
    roleLabel: uniqueConfirmedRoles.length > 0
      ? uniqueConfirmedRoles.map(roleId => companyRoleLabels[roleId]).join(' · ')
      : companyRoleLabels.unconfirmed,
    roleStatus,
    roleSourceUrl: verification?.roles?.find(claim =>
      claim.status === 'confirmed'
      && Boolean(claim.source_url?.trim())
      && uniqueConfirmedRoles.includes(claim.role as ConfirmedCompanyRoleId),
    )?.source_url?.trim() ?? null,
  };
}

export const solutionPurposeDefinitions = [
  { id: 'cleaning', label: 'Уборка помещений и территорий' },
  { id: 'warehouse', label: 'Складская логистика и сортировка' },
  { id: 'material_handling', label: 'Погрузка и перемещение грузов' },
  { id: 'indoor_delivery', label: 'Доставка внутри зданий' },
  { id: 'inventory', label: 'Инвентаризация и контроль запасов' },
  { id: 'production', label: 'Производственная автоматизация' },
  { id: 'security', label: 'Охрана и патрулирование' },
  { id: 'grounds_maintenance', label: 'Уход за территорией и растительностью' },
  { id: 'agriculture', label: 'Сельское хозяйство' },
  { id: 'drones', label: 'Мониторинг и БАС' },
  { id: 'marine', label: 'Морские и подводные работы' },
  { id: 'service', label: 'Сервис для посетителей' },
  { id: 'other', label: 'Другое назначение' },
] as const;

export type SolutionPurposeId = typeof solutionPurposeDefinitions[number]['id'];

export function getSolutionPurpose(solution: SolutionLike): {
  id: SolutionPurposeId;
  label: string;
} {
  const raw = `${solution.name || ''} ${solution.subtype || ''} ${solution.scenario || ''} ${solution.description || ''} ${solution.category || ''}`.toLowerCase();

  if (/мульчер|покос|измельчение растительност|дикорастущ|косил/.test(raw)) {
    return solutionPurposeDefinitions[7];
  }
  if (/уборк|клинбот|mark 2 se|бро 2|бро 3|surfex|ак-sc80/.test(raw)) {
    return solutionPurposeDefinitions[0];
  }
  if (/инвентар|stock counter/.test(raw)) {
    return solutionPurposeDefinitions[4];
  }
  if (/pick by voice|pick by light|склад|сортировк|комплектовщик/.test(raw)) {
    return solutionPurposeDefinitions[1];
  }
  if (/достав|курьер|робот-достав|медицин|питани|лекарств/.test(raw)) {
    return solutionPurposeDefinitions[3];
  }
  if (/охран|патрул|безопасност/.test(raw)) {
    return solutionPurposeDefinitions[6];
  }
  if (/сельск|агро|урожай|плод|поле|трактор/.test(raw)) {
    return solutionPurposeDefinitions[8];
  }
  if (/бас|бпла|бвс|дрон|мультиротор|самолет|vtol/.test(raw) || solution.kind === 'bas') {
    return solutionPurposeDefinitions[9];
  }
  if (/морск|подвод|тнпа|катер|барж|акватор/.test(raw)) {
    return solutionPurposeDefinitions[10];
  }
  if (/кафе|вендинг|напит|ресторан|посетител/.test(raw)) {
    return solutionPurposeDefinitions[11];
  }
  if (/манипулятор|свароч|роборука|производств|сборк|укладк|станк|промышлен/.test(raw)) {
    return solutionPurposeDefinitions[5];
  }
  if (/погруз|тягач|грузовик|паллет|amr|fmr|робот-штабелер|роботизированная тележка/.test(raw)) {
    return solutionPurposeDefinitions[2];
  }
  return solutionPurposeDefinitions[12];
}

type TypeDefinition = {
  name: string;
  description: string;
  parent?: string;
};

const subtypeDefinitions = new Map<string, TypeDefinition>(
  solutionTypesData.subtypes.map(subtype => [subtype.id, subtype]),
);

const categoryDefinitions = new Map<string, TypeDefinition>(
  solutionTypesData.categories.map(category => [category.id, category]),
);

const categoryIdByName = new Map(
  solutionTypesData.categories.map(category => [category.name, category.id]),
);

const subtypeAliases: Record<string, string> = {
  'шаттл': 'shuttle',
  'робот-шаттл': 'shuttle',
  'вилочный робот': 'fmr',
  'робот-тягач': 'tugger',
  'робот уборщик': 'cleaning_robot',
  'робот-уборщик': 'cleaning_robot',
  'роботизированный робот-уборщик': 'cleaning_robot',
  'роботизированная система хранения': 'cube_storage',
  'умная система хранения': 'cube_storage',
  'робот-штабелер': 'stacker_crane',
  'робот-штабелёр': 'stacker_crane',
  'кран-штабелёр': 'stacker_crane',
  'беспилотный погрузчик': 'unmanned_forklift',
  'мобильный робот-комплектовщик': 'amr',
  'робот-сортировщик': 'sorting_robot',
  'робот-курьер': 'delivery_robot',
  'робот-доставщик': 'delivery_robot',
  'робот-доставчик': 'delivery_robot',
  'беспилотный грузовик': 'truck',
  'беспилотный тягач': 'tugger',
  'беспилотный трактор': 'agri_robot',
  'агробот': 'agri_robot',
  'робот для сбора плодов': 'agri_robot',
  'коллаборативный робот-манипулятор': 'cobot',
  'коллаборативный манипулятор': 'cobot',
  'робот-манипулятор': 'manipulator',
  'манипулятор': 'manipulator',
  'сварочный робот': 'manipulator',
  'роботизированная установка': 'robotic_installation',
  'роботизированный сварочный комплекс': 'robotic_installation',
  'роботизированная пристаночная ячейка': 'robotic_installation',
  'робо-кафе': 'service_robot',
  'охранный робот': 'security_robot',
  'робот-охранник': 'security_robot',
  'мультиротор': 'drone_multicopter',
  'бас мультироторного типа': 'drone_multicopter',
  'самолет': 'drone_aircraft',
  'vtol': 'drone_aircraft',
  'тнпа': 'underwater_robot',
  'робот-ровер': 'rover',
  'ровер': 'rover',
  'робот-паук': 'inspection_robot',
  'привязной робот на базе октокоптера': 'drone_multicopter',
};

const subtypeOverrides: Record<string, { label: string; summary: string }> = {
  amr: {
    label: 'Автономная мобильная платформа (AMR)',
    summary: 'Самоходная платформа для перевозки паллет и тележек по объекту. Робот самостоятельно строит маршрут и объезжает препятствия; наличие механизма подъёма нужно подтверждать по ТТХ конкретной модели.',
  },
  fmr: {
    label: 'Автономный вилочный робот (FMR)',
    summary: 'Беспилотная вилочная машина для подхвата и перемещения паллет, включая работу со стеллажным хранением. Точная высота подъёма и операции штабелирования должны быть подтверждены в паспорте модели.',
  },
  shuttle: {
    label: 'Роботизированный шаттл для паллетных стеллажей',
    summary: 'Небольшая самоходная тележка, которая ездит внутри каналов стеллажной системы и перемещает паллеты в глубину или к выдаче. Это часть системы хранения, а не универсальный робот для поездок по всему складу.',
  },
  cube_storage: {
    label: 'Роботизированная система кубического хранения',
    summary: 'Плотная система хранения, в которой роботы перемещают контейнеры по верхней сетке и подают товар к рабочему месту оператора.',
  },
  tugger: {
    label: 'Автономный робот-тягач',
    summary: 'Беспилотный тягач, который буксирует тележки или ролл-кейджи по заданным маршрутам.',
  },
  unmanned_forklift: {
    label: 'Беспилотный вилочный погрузчик',
    summary: 'Автономная машина с вилочным захватом для загрузки, разгрузки и перемещения паллет.',
  },
  truck: {
    label: 'Беспилотный грузовой транспорт',
    summary: 'Автономное транспортное средство для перевозки грузов между площадками или зонами объекта.',
  },
  stacker_crane: {
    label: 'Робот-штабелёр',
    summary: 'Стационарная машина, которая обслуживает паллетные места в высотных стеллажах.',
  },
  delivery_robot: {
    label: 'Внутренний робот-доставщик',
    summary: 'Самоходный робот для доставки питания, медикаментов, анализов или расходных материалов внутри здания.',
  },
  cleaning_robot: {
    label: 'Автономный робот-уборщик',
    summary: 'Мобильная машина для плановой влажной или сухой уборки больших площадей.',
  },
  sorting_robot: {
    label: 'Сортировочный робот',
    summary: 'Робот для автоматического распределения отправлений, коробов или штучных товаров по направлениям.',
  },
  security_robot: {
    label: 'Охранный робот',
    summary: 'Мобильная платформа для патрулирования, видеоконтроля и фиксации событий на территории.',
  },
  manipulator: {
    label: 'Промышленный робот-манипулятор',
    summary: 'Стационарный робот с рабочим органом для выполнения операций сборки, сварки, укладки или обслуживания станка.',
  },
  robotic_installation: {
    label: 'Роботизированная производственная установка',
    summary: 'Комплекс оборудования, в котором робот выполняет отдельную производственную операцию на рабочем месте или линии.',
  },
  service_robot: {
    label: 'Сервисный робот',
    summary: 'Роботизированная система для обслуживания посетителей, приготовления напитков или выполнения другой сервисной операции.',
  },
  drone_multicopter: {
    label: 'БАС мультироторного типа',
    summary: 'Беспилотный летательный аппарат с вертикальным взлётом и посадкой для наблюдения, инспекции или доставки.',
  },
  drone_aircraft: {
    label: 'БАС самолётного типа',
    summary: 'Беспилотный летательный аппарат самолётного типа для мониторинга и съёмки протяжённых или больших территорий.',
  },
  underwater_robot: {
    label: 'Телеуправляемый подводный аппарат (ТНПА)',
    summary: 'Подводный аппарат с кабельным или дистанционным управлением для осмотра сооружений, обследования акватории и подводных работ.',
  },
  rover: {
    label: 'Мобильный робот-ровер',
    summary: 'Наземная роботизированная платформа для работы на сложном рельефе, мониторинга или перевозки груза.',
  },
  inspection_robot: {
    label: 'Робот для инспекции инфраструктуры',
    summary: 'Мобильный робот для визуального или инструментального обследования труднодоступных участков инфраструктуры.',
  },
  agri_robot: {
    label: 'Агроробот',
    summary: 'Автономная сельскохозяйственная машина для обработки полей, мониторинга посевов или сбора урожая.',
  },
};

const specLabels: Record<string, string> = {
  payload_kg: 'грузоподъёмность',
  own_weight_kg: 'собственная масса',
  dims_mm: 'габариты',
  speed_mps: 'скорость',
  navigation: 'навигация',
  charge_time_min: 'время зарядки',
  runtime_h: 'время работы',
  throughput: 'производительность',
  positioning_accuracy_mm: 'точность позиционирования',
  min_aisle_mm: 'минимальная ширина проезда',
  operating_temp_c: 'рабочая температура',
  reach_mm: 'рабочий радиус',
  accuracy_mm: 'точность',
  range_km: 'дальность',
  max_depth_m: 'рабочая глубина',
  flight_time_min: 'время полёта',
  flight_time_h: 'время полёта',
  ground_speed_mps: 'скорость',
  floor_requirement: 'требования к полу',
};

const expectedSpecsByType: Record<string, string[]> = {
  amr: ['payload_kg', 'navigation', 'speed_mps', 'runtime_h'],
  fmr: ['payload_kg', 'navigation', 'speed_mps', 'runtime_h'],
  tugger: ['payload_kg', 'navigation', 'speed_mps', 'runtime_h'],
  unmanned_forklift: ['payload_kg', 'navigation', 'speed_mps', 'runtime_h'],
  truck: ['payload_kg', 'speed_mps', 'runtime_h'],
  cleaning_robot: ['throughput', 'navigation', 'runtime_h'],
  manipulator: ['payload_kg', 'reach_mm', 'accuracy_mm'],
  cobot: ['payload_kg', 'reach_mm', 'accuracy_mm'],
  drone_multicopter: ['payload_kg', 'flight_time_min', 'range_km'],
  drone_aircraft: ['payload_kg', 'flight_time_h', 'range_km'],
  underwater_robot: ['max_depth_m', 'range_km', 'payload_kg'],
  marine_surface: ['payload_kg', 'range_km', 'runtime_h'],
};

function getSubtypeDefinition(solution: SolutionLike) {
  const subtypeKey = solution.subtype?.trim().toLowerCase();
  const normalizedKey = subtypeKey ? subtypeAliases[subtypeKey] || subtypeKey : undefined;
  return normalizedKey ? subtypeDefinitions.get(normalizedKey) : undefined;
}

function getSubtypeKey(solution: SolutionLike) {
  const subtypeKey = solution.subtype?.trim().toLowerCase();
  return subtypeKey ? subtypeAliases[subtypeKey] || subtypeKey : undefined;
}

function getCategoryDefinition(solution: SolutionLike) {
  const categoryId = solution.category ? categoryIdByName.get(solution.category) : undefined;
  return categoryId ? categoryDefinitions.get(categoryId) : undefined;
}

export function getSolutionTypeLabel(solution: SolutionLike) {
  const subtype = getSubtypeKey(solution);
  return subtype && subtypeOverrides[subtype]?.label
    ? subtypeOverrides[subtype].label
    : getSubtypeDefinition(solution)?.name
      || solution.subtype?.trim()
      || inferTypeLabel(solution)
      || solution.category?.trim()
      || 'Тип оборудования не подтверждён';
}

export function getSolutionSummary(solution: SolutionLike) {
  const description = solution.description?.trim();
  if (description) return description;

  const subtype = getSubtypeKey(solution);
  const genericTypeDescription = subtype && subtypeOverrides[subtype]?.summary
    ? subtypeOverrides[subtype].summary
    : getSubtypeDefinition(solution)?.description
      || getCategoryDefinition(solution)?.description;
  const role = getSolutionRole(solution);
  if (genericTypeDescription && role !== 'Сценарий применения не указан') {
    return `${genericTypeDescription} Назначение этой позиции: ${role.toLowerCase()}.`;
  }
  return genericTypeDescription
    || `Назначение: ${role}. Тип и область применения требуют подтверждения по паспорту решения.`;
}

export function getSolutionDataStatus(solution: SolutionLike) {
  const specs = solution.specs || {};
  const confirmed = Object.keys(specs)
    .filter(key => key !== 'source_url' && key !== 'purpose')
    .map(key => specLabels[key] || key)
    .filter((label, index, labels) => labels.indexOf(label) === index);
  const expected = expectedSpecsByType[getSubtypeKey(solution) || ''] || [];
  const missing = expected
    .filter(key => !(key in specs))
    .map(key => specLabels[key] || key);

  if (confirmed.length === 0) {
    return 'ТТХ не подтверждены в карточке; ключевые характеристики нужно запросить у поставщика.';
  }
  const confirmedText = `Подтверждено в карточке: ${confirmed.join(', ')}.`;
  return missing.length > 0
    ? `${confirmedText} Не подтверждено: ${missing.join(', ')}.`
    : confirmedText;
}

export function getSolutionRole(solution: SolutionLike) {
  return solution.scenario?.trim() || 'Сценарий применения не указан';
}

function inferTypeLabel(solution: SolutionLike) {
  const raw = `${solution.name || ''} ${solution.category || ''}`.toLowerCase();
  const category = solution.category?.trim();
  if (category === 'Стационарные роботизированные системы') {
    return 'Стационарная роботизированная система';
  }
  if (category === 'Морские роботы' || /катер|катамаран|баржа|тнпа|подводн|оркaн|оркан|бриз|сарган|калкан|ровероход/.test(raw)) {
    return 'Морская роботизированная система';
  }
  if (solution.kind === 'software' || /^по\b/.test(raw)) {
    return 'Программное решение';
  }
  if (category === 'Роботы-манипуляторы' || category === 'Мобильные манипуляторы') {
    return 'Робот-манипулятор';
  }
  if (category === 'Автономные наземные транспортные средства') {
    return 'Автономная наземная машина';
  }
  if (category === 'Мобильные роботы') {
    return 'Мобильная роботизированная платформа';
  }
  if (solution.kind === 'bas' || /бпла|бвс|бас|дрон|supercam|геоскан|диам|sigma|сигма|альбатрос/.test(raw)) {
    return 'Беспилотная авиационная система (БАС)';
  }
  if (/манипулятор|свароч|роборука|дельта-робот/.test(raw)) {
    return 'Робот-манипулятор';
  }
  if (/погруз|тягач|грузовик|трактор|каток|бульдозер|асфальтоукладчик/.test(raw)) {
    return 'Автономная наземная машина';
  }
  if (/робот|платформ|тележк|ровeр|ровер/.test(raw)) {
    return 'Роботизированная платформа';
  }
  return undefined;
}
