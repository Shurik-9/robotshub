export const areaDefinitions = [
  { id: 'indoor', label: 'Помещения' },
  { id: 'warehouse', label: 'Склад и логистический центр' },
  { id: 'production', label: 'Производство' },
  { id: 'healthcare', label: 'Медицинские учреждения' },
  { id: 'public', label: 'Общественные пространства' },
  { id: 'outdoor', label: 'Открытая территория' },
  { id: 'roads', label: 'Дороги и транспортная инфраструктура' },
  { id: 'agriculture', label: 'Поля и сельхозобъекты' },
  { id: 'construction', label: 'Стройплощадка и сооружения' },
  { id: 'air', label: 'Воздушное пространство' },
  { id: 'water', label: 'Акватория и подводная среда' },
] as const;

export const operationDefinitions = [
  { id: 'clean_indoor', label: 'Уборка помещений' },
  { id: 'clean_outdoor', label: 'Уборка территории и дорог' },
  { id: 'vegetation', label: 'Покос и уход за растительностью' },
  { id: 'transport', label: 'Перевозка и доставка' },
  { id: 'handling', label: 'Погрузка и перемещение грузов' },
  { id: 'sorting', label: 'Сортировка и комплектация' },
  { id: 'inventory', label: 'Инвентаризация' },
  { id: 'inspection', label: 'Инспекция и диагностика' },
  { id: 'monitoring', label: 'Мониторинг и съёмка' },
  { id: 'security', label: 'Охрана и патрулирование' },
  { id: 'production', label: 'Производственные операции' },
  { id: 'construction', label: 'Строительство и демонтаж' },
  { id: 'agriculture', label: 'Сельскохозяйственные работы' },
  { id: 'medical', label: 'Медицинская помощь и реабилитация' },
  { id: 'emergency', label: 'Аварийно-спасательные работы' },
  { id: 'service', label: 'Обслуживание посетителей' },
  { id: 'software', label: 'Управление и аналитика' },
  { id: 'other', label: 'Прочие операции' },
] as const;

export type AreaId = typeof areaDefinitions[number]['id'];
export type OperationId = typeof operationDefinitions[number]['id'];
export type SimulationSceneId = 'warehouse' | 'airport' | 'hospital' | 'indoor-cleaning' | 'territory';

export type SolutionLike = {
  name?: string;
  subtype?: string;
  scenario?: string;
  description?: string;
  case_study?: string;
  category?: string;
  industry?: string;
  kind?: string;
  specs?: Record<string, unknown>;
};

export type SolutionTaxonomy = {
  areaId: AreaId;
  areaIds: AreaId[];
  operationId: OperationId;
  operationIds: OperationId[];
  specialization: string;
  confidence: 'confirmed' | 'derived' | 'needs_review';
};

const areaLabel = (id: AreaId) => areaDefinitions.find(item => item.id === id)?.label ?? id;
const operationLabel = (id: OperationId) => operationDefinitions.find(item => item.id === id)?.label ?? id;

function rawText(solution: SolutionLike) {
  return [
    solution.name,
    solution.subtype,
    solution.scenario,
    solution.description,
    solution.case_study,
    solution.category,
    solution.industry,
  ].filter(Boolean).join(' ').toLowerCase();
}

function addIf<T extends string>(target: T[], value: T, condition: boolean) {
  if (condition && !target.includes(value)) target.push(value);
}

export function getSolutionTaxonomy(solution: SolutionLike): SolutionTaxonomy {
  const raw = rawText(solution);
  const scenario = solution.scenario?.toLowerCase() ?? '';
  const areas: AreaId[] = [];
  const operations: OperationId[] = [];

  addIf(areas, 'air', solution.kind === 'bas' || /бпла|бвс|беспилотн.{0,20}(летат|авиац)|мультиротор|квадрокоптер|самол[её]тн.{0,10}тип/.test(raw));
  addIf(areas, 'water', /морск|подвод|акватор|катер|тнпа|безэкипажн.{0,10}(суд|платформ)|гидрограф/.test(raw));
  addIf(areas, 'agriculture', /сельск|агро|урожай|посев|поле|садов|теплиц|трактор|почв/.test(raw));
  addIf(areas, 'construction', /строитель|стройплощад|возведен|демонтаж|фасад|бетон|кран/.test(raw));
  addIf(areas, 'production', /производств|завод|цех|сварк|станк|конвейер|паллетиз/.test(raw));
  addIf(areas, 'warehouse', /склад|логистическ.{0,12}центр|стеллаж|паллет|комплектов|хранени|распределительн.{0,10}центр/.test(raw));
  addIf(areas, 'healthcare', /медицин|больниц|клиник|реабилитац|пациент|аптек|лаборатор/.test(raw));
  addIf(areas, 'roads', /дорог|тротуар|парковк|перрон|аэропорт|трасс|асфальт|ж\/д|железнодорож/.test(raw));
  addIf(areas, 'public', /торгов.{0,10}центр|бизнес-центр|вокзал|терминал|ресторан|кафе|музе|университет|общественн/.test(raw));
  addIf(areas, 'outdoor', /улиц|открыт.{0,12}территор|территор|парк|двор|газон|снег|раститель|лес|карьер|рудник/.test(raw));

  const explicitIndoorCleaning = /уборк.{0,12}помещен|мойк.{0,12}(пол|помещен)|внутренн.{0,12}уборк/.test(scenario);
  const explicitOutdoorCleaning = /уборк.{0,12}(улиц|территор|дорог|снег)|коммунальн.{0,12}работ/.test(scenario);
  const cleaning = /уборк|поломо|пылесос|мойк|мыть|очистк|дезинфек/.test(raw) && !/не клинингов/.test(raw);
  const vegetation = /мульчер|косил|покос|измельчение растительност|дикорастущ|кустарник|газон/.test(raw);
  const outdoorCleaning = !explicitIndoorCleaning && cleaning && (
    explicitOutdoorCleaning
    || areas.some(area => ['outdoor', 'roads'].includes(area))
    || /улиц|снег|тротуар|двор|парк|дорог|территор/.test(raw)
  );
  addIf(operations, 'vegetation', vegetation);
  addIf(operations, 'clean_outdoor', outdoorCleaning);
  addIf(operations, 'clean_indoor', cleaning && !outdoorCleaning);
  addIf(operations, 'inventory', /инвентар|уч[её]т запас|stock counter|сканирован.{0,10}полок/.test(raw));
  addIf(operations, 'sorting', /сортиров|комплектов|отбор заказ|pick by|штучн.{0,10}отбор/.test(raw));
  addIf(operations, 'handling', /погруз|разгруз|паллет|штабел|укладк|подъ[её]м груз|тягач|буксир/.test(raw));
  addIf(operations, 'transport', /достав|перевоз|транспортиров|курьер|перемещен.{0,12}(груз|материал|багаж)|логистик/.test(raw));
  addIf(operations, 'emergency', /спасатель|эвакуац|тушени.{0,10}пожар|чс|аварийн/.test(raw));
  addIf(operations, 'medical', /реабилитац|медицинск.{0,10}помощ|локомотор|экзоскелет|операционн.{0,10}робот/.test(raw));
  addIf(operations, 'construction', /строитель|возведен|демонтаж|кладк.{0,10}кирпич|асфальтоуклад|дорожн.{0,10}работ/.test(raw));
  addIf(operations, 'agriculture', /сбор урож|вспаш|посев|внесени.{0,12}(веществ|удобр)|обработк.{0,10}пол|агроробот|сельскохозяйственн.{0,12}работ/.test(raw));
  addIf(operations, 'production', /сварк|сборк|производств|паллетиз|упаков|обслуживани.{0,10}станк|манипулятор/.test(raw));
  addIf(operations, 'inspection', /инспекц|обследован|диагност|дефектоскоп|неразрушающ|контрол.{0,12}(труб|сооруж|состояни)|провер[кя]/.test(raw));
  addIf(operations, 'security', /охран|патрул|безопасност|противодрон|периметр/.test(raw));
  addIf(operations, 'monitoring', /мониторинг|съ[её]мк|геодез|картограф|фотограмметр|наблюдени|поиск пропав|разведк/.test(raw));
  addIf(operations, 'service', /робо-кафе|кафе|вендинг|приготовлени.{0,12}(напит|кофе|еды)|обслуживани.{0,12}посетител|экскурсовод|промоутер/.test(raw));
  addIf(operations, 'software', solution.kind === 'software' || /программ|по брс|систем.{0,12}управлен|платформ.{0,12}аналитик|автопилот/.test(raw));

  if (areas.length === 0) {
    if (/помещен|внутри здан|внутренн/.test(raw)) areas.push('indoor');
    else areas.push('indoor');
  }
  if (operations.length === 0) operations.push('other');

  let primaryOperation = operations[0];
  let primaryArea = areas[0];
  if (areas.includes('healthcare') && operations.includes('medical')) {
    primaryArea = 'healthcare';
    primaryOperation = 'medical';
  }
  if (areas.includes('air') && operations.includes('monitoring')) primaryOperation = 'monitoring';
  if (explicitIndoorCleaning) {
    primaryArea = areas.find(area => ['warehouse', 'healthcare', 'public', 'production', 'indoor'].includes(area)) ?? 'indoor';
    primaryOperation = 'clean_indoor';
  }
  if (primaryOperation === 'clean_indoor') primaryArea = areas.find(area => ['warehouse', 'healthcare', 'public', 'production', 'indoor'].includes(area)) ?? 'indoor';
  if (primaryOperation === 'clean_outdoor' || primaryOperation === 'vegetation') primaryArea = areas.find(area => ['outdoor', 'roads', 'agriculture'].includes(area)) ?? 'outdoor';

  const subtype = solution.subtype?.trim();
  const specialization = subtype
    || (operations.length > 1
      ? operations.slice(0, 2).map(operationLabel).join(' · ')
      : operationLabel(primaryOperation));

  return {
    areaId: primaryArea,
    areaIds: areas,
    operationId: primaryOperation,
    operationIds: operations,
    specialization,
    confidence: solution.scenario?.trim() && (subtype || solution.description?.trim()) ? 'derived' : 'needs_review',
  };
}

export function getMergedSolutionTaxonomy(solutions: SolutionLike[]): SolutionTaxonomy | null {
  if (solutions.length === 0) return null;
  const taxonomies = solutions.map(getSolutionTaxonomy);
  const areaIds = Array.from(new Set(taxonomies.flatMap(item => item.areaIds)));
  const operationIds = Array.from(new Set(taxonomies.flatMap(item => item.operationIds)));
  const primary = taxonomies[0];
  const specializations = Array.from(new Set(taxonomies.map(item => item.specialization)));
  return {
    ...primary,
    areaIds,
    operationIds,
    specialization: specializations.slice(0, 3).join(' · '),
    confidence: taxonomies.some(item => item.confidence === 'needs_review') ? 'needs_review' : 'derived',
  };
}

export function getSimulationProfile(solution: SolutionLike, objectType: string) {
  const tax = getSolutionTaxonomy(solution);
  let sceneId: SimulationSceneId;
  let profileName: string;
  let reason: string;
  let representative = true;
  let limitation: string | null = null;

  if (tax.areaId === 'air') {
    sceneId = 'territory';
    profileName = 'Воздушный мониторинг территории';
    reason = 'Назначение определено как мониторинг или инспекция с применением БАС.';
    representative = false;
    limitation = 'Текущий двумерный движок показывает только наземную проекцию маршрута и не моделирует высоту, ветер, полезную нагрузку и правила воздушного движения.';
  } else if (tax.areaId === 'water') {
    sceneId = 'territory';
    profileName = 'Мониторинг акватории или подводная инспекция';
    reason = 'Назначение определено по морской или подводной среде эксплуатации.';
    representative = false;
    limitation = 'Текущий движок не моделирует глубину, течение, связь под водой и гидрометеорологические условия.';
  } else if (tax.operationId === 'medical' && !tax.operationIds.includes('transport')) {
    sceneId = 'hospital';
    profileName = 'Медицинская помощь и реабилитация';
    reason = 'Решение применяется внутри медицинского учреждения, но не выполняет транспортный маршрут.';
    representative = false;
    limitation = 'Маршрутная симуляция не описывает реабилитационный или хирургический цикл; для него нужна отдельная модель рабочего места и загрузки по пациентам.';
  } else if (tax.operationId === 'clean_indoor') {
    sceneId = 'indoor-cleaning';
    profileName = 'Автономная уборка помещений';
    reason = 'Маршруты строятся внутри здания между зонами уборки и зарядной станцией.';
  } else if (tax.operationId === 'clean_outdoor') {
    sceneId = 'territory';
    profileName = 'Коммунальная уборка территории';
    reason = 'Используется открытая сцена с протяжёнными маршрутами, дорожками и зонами накопления загрязнений.';
  } else if (tax.operationId === 'vegetation') {
    sceneId = 'territory';
    profileName = 'Уход за растительностью';
    reason = 'Сцена моделирует последовательную обработку газонов и заросших участков, а не клининг помещения.';
  } else if (objectType === 'medical' || tax.areaIds.includes('healthcare')) {
    sceneId = 'hospital';
    profileName = tax.operationIds.includes('medical') ? 'Медицинская роботизация' : 'Внутрибольничная логистика';
    reason = 'Потоки проходят между отделениями, аптекой, лабораторией и техническими зонами.';
  } else if (objectType === 'airport') {
    sceneId = 'airport';
    profileName = tax.operationIds.includes('security') ? 'Патрулирование терминала' : 'Операции аэропорта';
    reason = 'Сцена учитывает терминал, багажные потоки, перрон и зарядную инфраструктуру.';
  } else {
    sceneId = 'warehouse';
    profileName = tax.operationIds.some(id => ['handling', 'sorting', 'inventory'].includes(id))
      ? 'Складская логистика и обработка грузов'
      : `${areaLabel(tax.areaId)} · ${operationLabel(tax.operationId)}`;
    reason = 'Сцена использует рабочие потоки между приёмкой, хранением, комплектацией и отгрузкой.';
  }

  return { sceneId, profileName, reason, taxonomy: tax, representative, limitation };
}