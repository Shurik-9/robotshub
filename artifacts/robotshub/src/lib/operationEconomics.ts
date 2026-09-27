import type { ObjectType } from '@/store/project';

export type OperationKey = 'waterCleanup' | 'quarrySurvey' | 'medicalFlight' | 'rehabilitation';
export type OperationJournalKind = 'accepted' | 'cancelled' | 'rework' | 'downtime';
export type OperationJournalEntry = {
  date: string;
  kind: OperationJournalKind;
  volume: number | null;
  downtimeHours: number | null;
  reason: string;
};
export type OperationAvailabilityEvidence = {
  source: string;
  explanation: string;
};
export const operationMonthOptions = [
  { month: 1, label: 'Январь' },
  { month: 2, label: 'Февраль' },
  { month: 3, label: 'Март' },
  { month: 4, label: 'Апрель' },
  { month: 5, label: 'Май' },
  { month: 6, label: 'Июнь' },
  { month: 7, label: 'Июль' },
  { month: 8, label: 'Август' },
  { month: 9, label: 'Сентябрь' },
  { month: 10, label: 'Октябрь' },
  { month: 11, label: 'Ноябрь' },
  { month: 12, label: 'Декабрь' },
] as const;
export type OperationJournalSummary = {
  observedCalendarDays: number;
  journalDays: number;
  acceptedVolume: number;
  cancelledVolume: number;
  cancelledSharePercent: number;
  reworkVolume: number;
  reworkSharePercent: number;
  downtimeHours: number;
  scheduledOperatingHours: number | null;
  availableOperatingHours: number | null;
  availabilityPercent: number | null;
  annualizedCapacity: number | null;
  seasonallyAdjustedCapacity: number | null;
  observedSeasonalDays: number;
  annualSeasonalDays: number;
  operatingMonths: number[];
  offSeasonAvailabilityByMonth: Record<number, number>;
  offSeasonEvidenceByMonth: Record<number, OperationAvailabilityEvidence>;
  seasonalCoverageComplete: boolean;
  noDowntimeAnnualCapacity: number | null;
  downtimeCapacityLoss: number | null;
  sufficient: boolean;
  scenarioReasons: string[];
};
type Field = { key: string; label: string; unit: string };
export type OperationFinancialLine = {
  fieldKey: 'baselineUnitCost' | 'newUnitCost' | 'unitCapex' | 'annualFixedCost';
  composition: string;
  documents: string;
};
export type OperationFinancialReference = {
  label: string;
  value: string;
  publishedAt: string;
  sourceType: string;
  url: string;
  limitation: string;
};
export type OperationProfile = {
  key: OperationKey;
  title: string;
  unit: string;
  scope: string;
  exclusions: string;
  operationalRecord: {
    publicStatus: string;
    requiredEntries: string[];
  };
  evidence: { label: string; url: string; note: string }[];
  financialCostLines: OperationFinancialLine[];
  financialReferences: OperationFinancialReference[];
  fields: Field[];
  example: {
    values: Record<string, number>;
    operationalBasis: string;
    financialBasis: string;
    caveat: string;
  };
};

const commonFields: Field[] = [
  { key: 'annualVolume', label: 'Объём работ за год', unit: 'ед./год' },
  { key: 'annualCapacity', label: 'Резервное сценарное допущение мощности комплекта', unit: 'ед./год' },
  { key: 'baselineUnitCost', label: 'Стоимость текущего выполнения одной единицы', unit: '₽/ед.' },
  { key: 'newUnitCost', label: 'Переменные затраты робота на единицу', unit: '₽/ед.' },
  { key: 'unitCapex', label: 'Цена комплекта с внедрением', unit: '₽/комплект' },
  { key: 'annualFixedCost', label: 'Постоянные годовые затраты на комплект', unit: '₽/год' },
  { key: 'horizon', label: 'Горизонт оценки', unit: 'лет' },
  { key: 'discount', label: 'Ставка дисконтирования', unit: '%' },
];

export const operationFinancialReviewDate = '26.09.2026';
export const operationRecordReviewDate = '26.09.2026';
export const operationFinancialEvidenceStatus = (example: boolean) => example
  ? 'Иллюстративный сценарий: первичными финансовыми документами не подтверждён.'
  : 'Ввод пользователя: документы и суммы приложением независимо не проверены.';
export const operationRecordEvidenceStatus = (confirmed: boolean) => confirmed
  ? 'Источник и полноту полей подтвердил пользователь; журнал и заявленные значения приложением независимо не проверены.'
  : 'Операционный журнал для указанного объекта и интервала не подтверждён.';

export const operationProfiles: Record<OperationKey, OperationProfile> = {
  waterCleanup: {
    key: 'waterCleanup', title: 'Сбор плавающего мусора', unit: 'м³ собранного мусора',
    scope: 'Только сбор плавающего мусора надводным аппаратом; не подводная инспекция, доставка, очистка воды или мелиорация.',
    exclusions: 'Погода, вывоз и утилизация отходов, разрешения и простой должны быть включены в затраты и фактическую годовую производительность.',
    operationalRecord: {
      publicStatus: 'В открытом кейсе названа Балаклавская бухта и приведена оценка около 2 м³ за четырёхчасовую смену на аппарат. Точный участок, период наблюдений и первичный сменный журнал не опубликованы.',
      requiredEntries: [
        'точный участок акватории и идентификатор аппарата для каждой смены',
        'дата и фактическая длительность каждой смены, собранный объём в м³',
        'штормовые и погодные отмены отдельно от отработанных смен',
        'ремонты, технические отказы и часы простоя',
        'объём вывезенных отходов и подтверждение передачи/приёмки',
      ],
    },
    evidence: [
      { label: 'Каталог ФЦ БАС — кейс «Морской скорпион»', url: '/cases/morskoy-skorpion-balaklava', note: 'Для Балаклавской бухты указано около 2 м³ за четырёхчасовую смену на аппарат и два аппарата. Даты и число фактически отработанных смен, погода, ремонты, погрузка и вывоз не раскрыты; первичный сменный журнал в открытых материалах не найден (проверено 26.09.2026).' },
      { label: 'СевГУ — сообщение о разработке «Морского скорпиона»', url: 'https://www.sevsu.ru/novosti/item/bespilotnoe_ustroystvo_dlya_uborki_musora_na_vode_razrabotali_studenty_sevgu?special_version=Y', note: 'Публикация от 19.01.2024 описывает разработку устройства, а не календарь эксплуатации, годовые замеры или простой.' },
    ],
    financialCostLines: [
      { fieldKey: 'baselineUnitCost', composition: 'Текущий сбор, труд экипажа, эксплуатация судна, подъём и погрузка мусора, доставка и утилизация — в расчёте на принятый м³.', documents: 'Счета/акты подрядчика и вывоза, табели экипажа, топливные документы и тариф утилизации за тот же период.' },
      { fieldKey: 'newUnitCost', composition: 'Энергия и расходники аппарата, труд оператора, выгрузка, доставка и утилизация — на принятый м³.', documents: 'Полевой журнал и первичные документы по энергии, расходникам, труду, перевозке и утилизации.' },
      { fieldKey: 'unitCapex', composition: 'Аппарат, доставка, оснастка, запуск и обучение; карточная цена аппарата не равна цене внедрённого комплекта.', documents: 'КП/договор с разбивкой оборудования, доставки, оснастки, ПНР, обучения и налогов; счёт или акт оплаты.' },
      { fieldKey: 'annualFixedCost', composition: 'Сервис, хранение, связь, страхование/разрешения и постоянная готовность персонала.', documents: 'Договоры и счета на обслуживание, хранение, связь, страхование, разрешения и штатные расходы за год.' },
    ],
    financialReferences: [
      { label: 'Модель затрат на уборку морского мусора', value: 'В статье приведён сценарный ориентир €1/кг; процитированы Seabin €2,65/день при ~1,5 кг/день (~€1,8/кг), Mr. Trash Wheel €430/день при ~472 кг/день (~€0,9/кг) и SeaVax ~€1,2/кг.', publishedAt: '10.11.2021', sourceType: 'Научная модель и опубликованные технологические ориентиры', url: 'https://www.frontiersin.org/journals/marine-science/articles/10.3389/fmars.2021.744208/full', limitation: 'Ссылки статьи ведут к более ранним описаниям технологий, а не к счетам; состав затрат не раскрыт. Единица — кг, а не м³; фильтры и барьеры не равны катамарану «Морской скорпион».' },
      { label: 'Контракт на реку Лос-Анджелес — рекомендация 2026 года', value: 'Рекомендованная годовая сумма $2,346,000; максимум $19,354,500 за срок до 90 месяцев. В образце соглашения одновременно указаны $5,865,000 за первые 3 года и $1,955,000 в год продления.', publishedAt: '07.07.2026', sourceType: 'Официальный проект решения и образец договора', url: 'https://file.lacounty.gov/SDSInter/bos/supdocs/218314.pdf', limitation: 'Это рекомендация о контракте для системы сбора мусора на реке, не подтверждение оплаты. Документ содержит разные годовые суммы; объём собранного мусора не указан. Система с бонами не сопоставима напрямую с площадкой или катамараном.' },
      { label: 'Контракт на реку Лос-Анджелес — присуждение 2016 года', value: 'Годовой контракт $971,050, включая $65,550 на вывоз/утилизацию и резерв $250,000 на ремонт или замену бонов; максимум до $5,340,775 на срок до 66 месяцев.', publishedAt: '29.03.2016', sourceType: 'Официально одобренное присуждение контракта', url: 'https://file.lacounty.gov/SDSInter/bos/supdocs/102353.pdf', limitation: 'Сумма зависит от месячных ставок и планового объёма услуг, но тоннаж/объём сбора не раскрыт. Это старый контракт на стационарную систему, не цена за м³ и не фактическая смета Балаклавы.' },
    ],
    fields: commonFields,
    example: {
      values: { annualVolume: 150, annualCapacity: 200, baselineUnitCost: 12000, newUnitCost: 4000, unitCapex: 5000000, annualFixedCost: 700000, horizon: 5, discount: 15 },
      operationalBasis: 'Площадка в опубликованном кейсе — Балаклавская бухта; заявлено около 2 м³ на аппарат за 4-часовую смену. Период наблюдений и число смен не указаны; в открытых источниках сменный журнал, календарь погоды и простоя не найден (проверено 26.09.2026). 200 м³/год — только сценарий 2 м³ × 100 предполагаемых смен, не измеренный годовой результат; 100 смен и спрос 150 м³ — допущения и предположения для этой модели акватории, не переносить на другой объект.',
      financialBasis: 'Каталожная цена 4 млн ₽ не включает доставку и ПНР. Пример: 5 млн ₽ за внедрённый комплект; 12 тыс./4 тыс. ₽ на м³ и 700 тыс. ₽/год — сценарные оценки, не коммерческое предложение.',
      caveat: 'До появления журнала конкретной акватории не считать примерную мощность подтверждённой. Нужны даты наблюдений, фактические смены и сбор за смену, штормовые/ветровые отмены, технические простои, загрузка, вывоз и утилизация.',
    },
  },
  quarrySurvey: {
    key: 'quarrySurvey', title: 'Фотограмметрическая съёмка карьера', unit: 'км² принятых съёмок',
    scope: 'Только аэрофотосъёмка открытого карьера с обработкой ортофотоплана; не подземная инспекция, изыскания или демонтаж.',
    exclusions: 'Требуемое разрешение, точность, перекрытие, рельеф, погода и стоимость обработки определяют годовую выработку и затраты.',
    operationalRecord: {
      publicStatus: 'В каталожном кейсе не указан конкретный карьер, интервал наблюдений или первичный журнал вылетов.',
      requiredEntries: [
        'точная площадка и границы периода наблюдений',
        'по каждому вылету: дата, плановая площадь, фактически снятая и принятая заказчиком площадь',
        'разрешение/допуск, погодные отмены и иные отменённые вылеты с причинами',
        'повторные вылеты и площадь, уже учтённая в предыдущих попытках',
        'время обработки результатов, ремонтов и технического простоя',
      ],
    },
    evidence: [{ label: 'Геоскан 401 Геодезия — страница производителя', url: 'https://www.geoscan.ru/ru/products/geoscan401/geo', note: 'Производитель указывает до 1,6/2,4/3,9 км² за полёт при 2/3/5 см на пиксель. Это предел отдельного полёта при заданном разрешении, а не журнал принятых съёмок; конкретный карьер, период, повторные вылеты и простой не установлены.' }],
    financialCostLines: [
      { fieldKey: 'baselineUnitCost', composition: 'Текущая полевая бригада/подрядчик, транспорт, оборудование и обработка одного принятого км².', documents: 'Договоры/акты на съёмку и обработку, путевые и трудовые документы, принятые заказчиком объёмы за период.' },
      { fieldKey: 'newUnitCost', composition: 'Полевые вылеты, расходники, труд оператора, контрольные точки и обработка на один принятый км²; повторные вылеты включаются.', documents: 'Журнал вылетов и приёмки плюс документы по труду, обработке, расходникам, транспорту и повторным съёмкам.' },
      { fieldKey: 'unitCapex', composition: 'БВС, полезная нагрузка, GNSS/контрольные средства, батареи, доставка, интеграция и обучение.', documents: 'КП/договор и счёт с отдельными позициями оборудования, полезной нагрузки, батарей, доставки, ПНР и обучения.' },
      { fieldKey: 'annualFixedCost', composition: 'ТО, поверки/калибровки, лицензии ПО, хранение данных, страхование и постоянный персонал.', documents: 'Годовые договоры и счета на ТО, ПО, хранение, поверки, страхование и персонал.' },
    ],
    financialReferences: [
      { label: 'Сравнение методов на карьере Njuli, Малави', value: 'Таблица исследования приводит UAS $1,316.50 против $2,235 за расчёт объёма; UAS $2,450 против наземного LiDAR $4,600 за топографическое картирование; ещё один метод — $1,944 против $3,200.', publishedAt: '02.11.2022', sourceType: 'Научная публикация; значения перепечатаны из Fitzpatrick (2015)', url: 'https://www.frontiersin.org/articles/10.3389/fbuil.2022.1037487/full', limitation: 'Это стоимость отдельных задач, не ставка за км²; площадь и состав затрат не приведены. Нельзя напрямую переносить на карьер в России или использовать как текущую смету.' },
      { label: 'Государственный тендер по съёмке и наблюдению карьеров в Гуджарате', value: 'ТЗ включает 480 часов наблюдения и 480 га съёмки за год, персонал, дроны, автомобили и инфраструктуру облачной панели; объявленная ставка или сумма присуждённого контракта в найденном документе отсутствует.', publishedAt: '03.04.2025', sourceType: 'Официальное дополнение к тендеру GeM', url: 'https://gil.gujarat.gov.in/tendercms/TenderDocs/2025516165343986.pdf', limitation: 'Документ помогает определить состав работ и затрат, но не даёт цены; территория и требования регулируются в Индии, а не в России.' },
      { label: 'Кейс фотограмметрии базальтового карьера Рафаливка, Украина', value: 'Съёмка 36 га заняла рабочий день; обработка заняла 7 часов на настольном компьютере. Публикация приводит цены оборудования, но не тариф услуги или стоимость принятой съёмки.', publishedAt: '19.10.2017', sourceType: 'Отраслевой технический кейс', url: 'https://www.gim-international.com/content/article/low-cost-uas-photogrammetry-for-mining', limitation: 'Показывает трудоёмкость процесса, но не подтверждает расходы на персонал, выезды, лицензии, контрольные точки и повторные полёты.' },
    ],
    fields: commonFields,
    example: {
      values: { annualVolume: 60, annualCapacity: 80, baselineUnitCost: 90000, newUnitCost: 30000, unitCapex: 5000000, annualFixedCost: 1200000, horizon: 5, discount: 15 },
      operationalBasis: 'Публичная страница Геоскана задаёт максимум до 1,6 км² за полёт при 2 см/пиксель. В кейсе каталога нет идентифицированного карьера и журнала вылетов; площадка и период наблюдений, погодные/разрешительные отмены, повторные вылеты и принятая после обработки площадь не раскрыты. Первичный журнал в открытых материалах не найден (проверено 26.09.2026). 80 км²/год — только сценарий 50 предполагаемых принятых полётов × 1,6 км², не наблюдаемая мощность; спрос 60 км² также задан условно. Оба значения остаются предположениями и их нельзя переносить на другой карьер или требуемое разрешение.',
      financialBasis: 'Каталог ФЦ БАС: 3,965 млн ₽ за аппарат (не смета проекта). Пример 5 млн ₽ с внедрением, 90 тыс./30 тыс. ₽ за км² и 1,2 млн ₽/год постоянных затрат — сценарные оценки.',
      caveat: 'Для расчёта по площадке нужны принятые ортофотосъёмки за датированный период, фактические площади и повторные пролёты, требования к GSD/перекрытию, погода, разрешения, обработка и ремонты. Паспортный максимум не заменяет эти данные.',
    },
  },
  medicalFlight: {
    key: 'medicalFlight', title: 'Межучрежденческая доставка биоматериалов', unit: 'доставок с соблюдением условий перевозки',
    scope: 'Только регулярные доставки между медицинскими учреждениями при подтверждённом маршруте и допустимом грузе.',
    exclusions: 'Разрешения на полёты, холодовая цепь, упаковка, обратная логистика и отменённые рейсы учитываются в стоимости и годовой мощности; клинический эффект не монетизируется.',
    operationalRecord: {
      publicStatus: 'Минздрав России сообщает об одном рейсе 18.02.2025 из Борской центральной районной больницы в Нижегородский областной центр по профилактике и борьбе со СПИД и инфекционными заболеваниями: около 100 пробирок, примерно 4 кг, 5,8 км в одну сторону и менее часа с предполётной подготовкой. Для пилота планировали около двух недель и 10 полётов «в одну и другую сторону», но фактические итоги пилота, период и первичный рейсовый журнал не опубликованы. Отдельное сообщение каталога об около 800 кг за год не содержит точных дат и подтверждающих записей.',
      requiredEntries: [
        'точные пункты отправления и получения, а также границы периода наблюдений',
        'каждый выполненный и отменённый рейс с датой и причиной отмены',
        'число завершённых доставок и масса груза по каждому рейсу',
        'температурные записи и итог соблюдения холодовой цепи по рейсу',
        'разрешительные ограничения, технические простои и недоступность персонала',
      ],
    },
    evidence: [
      { label: 'Минздрав России — первый рейс биоматериалов в Нижегородской области', url: 'https://minzdrav.gov.ru/regional_news/23173-perevozku-biomaterialov-mezhdu-meduchrezhdeniyami-s-pomoschyu-bespilotnika-vpervye-uspeshno-vypolnili-v-nizhegorodskoy-oblasti', note: 'Официальная публикация от 19.02.2025 подтверждает один рейс 18.02.2025 из Борской ЦРБ в Нижегородский областной СПИД-центр: около 100 пробирок, около 4 кг, 5,8 км в одну сторону; подготовка и перевозка заняли менее часа. Примерно двухнедельный пилот и 10 полётов «в одну и другую сторону» были планом, а не опубликованным итогом. В публикации нет рейсового журнала, температурных записей, отмен или фактического результата пилота; она не подтверждает годовую мощность.' },
      { label: 'Каталог ФЦ БАС — кейс «Курьер-30»', url: '/cases/kurier-30-biomaterialy', note: 'Для маршрута между медучреждениями в Нижегородской области сообщается около 800 кг за год и сокращение пути с 1,5 часа до 10 минут. Точные даты периода, число выполненных/отменённых рейсов, простой и журнал соблюдения условий перевозки не приведены; первичный рейсовый журнал в открытых материалах не найден (проверено 26.09.2026). Массу нельзя переводить в число доставок.' },
    ],
    financialCostLines: [
      { fieldKey: 'baselineUnitCost', composition: 'Курьер/автомобиль, труд, топливо, упаковка и соблюдение холодовой цепи на завершённую доставку.', documents: 'Договор перевозки или калькуляция учреждения, путевые/трудовые документы, счета за упаковку и температурный контроль.' },
      { fieldKey: 'newUnitCost', composition: 'Подготовка и упаковка груза, труд оператора на рейс, энергия, температурный контроль и доставка на завершённую перевозку.', documents: 'Рейсовый журнал с приёмкой и температурными логами плюс счета/акты по упаковке, энергии, труду и обработке отмен.' },
      { fieldKey: 'unitCapex', composition: 'БАС, контейнер/холодовая оснастка, площадки/зарядка, связь, разрешения, интеграция и обучение.', documents: 'КП/договор и счёт с отдельными позициями аппарата, контейнера, инфраструктуры, связи, разрешений, ПНР и обучения.' },
      { fieldKey: 'annualFixedCost', composition: 'ТО, страхование, разрешительная поддержка, ПО/связь, калибровка и доступность персонала.', documents: 'Действующие годовые договоры и счета на обслуживание, страхование, ПО/связь, разрешения и персонал.' },
    ],
    financialReferences: [
      { label: 'Перевозка компонентов крови между больницами Сабаха, Малайзия', value: 'Экономическая оценка сообщает RM1,313.28 (USD319.36 в статье) за круговой рейс для одного экстренного случая дроном; сопоставимый рейс скорой оценён в RM1,266.02.', publishedAt: '2021', sourceType: 'Рецензируемая оценка затрат методом ABC', url: 'https://pubmed.ncbi.nlm.nih.gov/34863156', limitation: 'Год цен и детализация состава расходов в доступном резюме не указаны. Это оценка конкретного маршрута и клинической задачи, а не счёт поставщика или цена другой доставки.' },
      { label: 'Модель медицинской доставки Всемирного банка для Восточной Африки', value: 'Модельные пороги безубыточности: около $19,000 на аппарат; менее $0.01 за литр-км для вакцин и около $0.68 за литр-км для забора лабораторных образцов на дорогих маршрутах.', publishedAt: '2021', sourceType: 'Модель Всемирного банка по данным полевых исследований 2019–2020 годов', url: 'https://documents1.worldbank.org/curated/en/800891621396276151/pdf/Unlocking-the-Lower-Skies-The-Costs-and-Benefits-of-Deploying-Drones-across-Use-Cases-in-East-Africa.pdf', limitation: 'Это пороги модели, не оплата выполненного рейса; разные показатели имеют разные единицы. Первоначальная закупка, импорт и развёртывание исключены, а результаты зависят от загрузки и маршрута.' },
    ],
    fields: commonFields,
    example: {
      values: { annualVolume: 300, annualCapacity: 450, baselineUnitCost: 13000, newUnitCost: 4500, unitCapex: 3300000, annualFixedCost: 1300000, horizon: 5, discount: 15 },
      operationalBasis: 'Минздрав России сообщил об одном рейсе 18.02.2025 из Борской ЦРБ в Нижегородский областной СПИД-центр: около 100 пробирок, примерно 4 кг, около 5,8 км в одну сторону и менее часа с подготовкой. Запланированный примерно двухнедельный пилот с 10 полётами «в одну и другую сторону» не сопровождается опубликованными итогами или журналом; температурные логи, отмены и простои неизвестны. Отдельное каталожное сообщение указывает около 800 кг за год без точных дат и первичной ведомости. 450 доставок/год и спрос 300 — сценарные числа, не выводятся ни из единичного рейса, ни из массы за год; это допущения и предположения, а не фактические значения, и их нельзя переносить на другой маршрут.',
      financialBasis: 'Каталог ФЦ БАС: 2,2 млн ₽ за Курьер-30 без внедрения. Пример 3,3 млн ₽ с инфраструктурой, 13 тыс./4,5 тыс. ₽ за доставку и 1,3 млн ₽/год — сценарные оценки.',
      caveat: 'До подтверждения мощности нужны фактические итоги пилота и журнал по тому же маршруту: даты, выполненные и отменённые рейсы, число доставок и масса на рейс, температурные записи, разрешения, погодные и технические простои. Один опубликованный рейс и агрегатный годовой вес не равны годовому числу доставок.',
    },
  },
  rehabilitation: {
    key: 'rehabilitation', title: 'Реабилитационные сеансы с ортезом', unit: 'завершённых сеансов',
    scope: 'Только дополнительная мощность проведения сеансов по утверждённому протоколу; не замена врача и не оценка клинической эффективности.',
    exclusions: 'Требования к персоналу, противопоказания, обслуживание, дезинфекция и загрузка пациентов учитываются в годовой мощности и расходах.',
    operationalRecord: {
      publicStatus: 'В открытых материалах не указаны клиника, версия протокола, интервал наблюдений или первичный журнал сеансов «Ортез-1».',
      requiredEntries: [
        'точное наименование клиники/кабинета, версия протокола и период наблюдений',
        'назначенные, завершённые и отменённые сеансы с датами и причинами отмен',
        'расписание и фактическая доступность персонала по сменам',
        'время подготовки, проведения и смены пациента по протоколу',
        'обслуживание, неисправности, дезинфекция и связанное с ними время простоя',
      ],
    },
    evidence: [
      { label: 'Ортез-1 — производитель НПО «Андроидная техника»', url: 'https://npo-at.com/product/ortez-1', note: 'Страница производителя описывает назначение комплекса и время непрерывной работы модуля >45 минут. Это не длительность завершённого сеанса и не годовой журнал; конкретная клиника, период наблюдений, число пациентов/сеансов и простои не раскрыты.' },
      { label: 'Отраслевой каталог — Ортез-1', url: '/solutions?sector=sector-medicine', note: 'Каталог описывает назначение ортеза, но не подтверждает экономию или клинический исход.' },
    ],
    financialCostLines: [
      { fieldKey: 'baselineUnitCost', composition: 'Время врача/терапевта и ассистента, помещение, оборудование, расходники и дезинфекция на завершённый сеанс.', documents: 'Тариф/калькуляция учреждения, табели и расписание, закупочные документы расходников и журнал завершённых сеансов.' },
      { fieldKey: 'newUnitCost', composition: 'Остаточное время клинициста, энергия, расходники, дезинфекция и износ на завершённый сеанс.', documents: 'Утверждённая калькуляция клиники и журнал сеансов с первичными документами на персонал, обслуживание и материалы.' },
      { fieldKey: 'unitCapex', composition: 'Комплекс, доставка, установка/подгонка, интеграция, обучение и ввод в клинический контур.', documents: 'КП/договор, спецификация, счёт и акт приёмки с отдельной стоимостью комплекса, доставки, монтажа и обучения.' },
      { fieldKey: 'annualFixedCost', composition: 'ТО, калибровка, ПО, клиническая поддержка, обучение и постоянная готовность кабинета.', documents: 'Годовые договоры и счета на сервис, калибровку, ПО, клиническую поддержку и содержание кабинета.' },
    ],
    financialReferences: [
      { label: 'Расчёт стоимости реабилитации с Lokomat в центре Словакии', value: 'В версии расчёта на 2022 год указан €137.25 за один часовой терапевтический блок (TU) и €2,745 за 20 TU; отдельно указаны €881,292 капитальных затрат и €20,400 ежегодного сервиса.', publishedAt: '11.09.2023 (модель затрат на 2022 год)', sourceType: 'Рецензируемый микрорасчёт затрат учреждения', url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC10496243', limitation: 'Состав включает персонал, расходники, энергию, администрацию, амортизацию и сервис; это локальная модель для пациентов с ДЦП, не прайс сеанса «Ортез-1» и не закупочный счёт.' },
      { label: 'Рамка отчётности по роботизированной реабилитации в рутинной практике', value: 'Численной цены сеанса статья не публикует; рекомендует отдельно фиксировать капитал и амортизацию, сервис, расходники, обучение, труд персонала, загрузку, отмены и простои.', publishedAt: '29.04.2026', sourceType: 'Рецензируемая методическая статья', url: 'https://www.frontiersin.org/journals/health-services/articles/10.3389/frhs.2026.1810720/full', limitation: 'Это структура сбора данных, а не финансовое предложение; авторы подчёркивают, что при низкой загрузке постоянные расходы сильнее влияют на стоимость сеанса.' },
    ],
    fields: commonFields,
    example: {
      values: { annualVolume: 1500, annualCapacity: 1200, baselineUnitCost: 2500, newUnitCost: 1500, unitCapex: 4500000, annualFixedCost: 300000, horizon: 5, discount: 15 },
      operationalBasis: 'Публичная страница производителя указывает для модуля непрерывную работу >45 минут. Клиника, протокол и длительность завершённого сеанса, период наблюдений, число пациентов, доступность персонала, обслуживание и дезинфекционные простои не опубликованы; первичный журнал сеансов по «Ортез-1» в открытых материалах не найден (проверено 26.09.2026). 1 200 сеансов/год и спрос 1 500 — только допущения и предположения этого примера, не выводятся из 45 минут и не подтверждены журналом. Не переносить клинический график другого учреждения или устройства.',
      financialBasis: 'Каталог ФЦ БАС: 4 млн ₽ за Ортез-1. Пример 4,5 млн ₽ с обучением и внедрением, 2,5 тыс./1,5 тыс. ₽ за сеанс и 300 тыс. ₽/год — сценарные оценки.',
      caveat: 'Для расчёта нужны журнал конкретного учреждения за обозначенный период, протокол завершённого сеанса, расписание персонала и фактические пропуски/отмены, обслуживание и дезинфекция. Производительность не подтверждает клиническую эффективность или экономию.',
    },
  },
};

const ids: Record<OperationKey, string[]> = {
  waterCleanup: ['018cc2dd-3dfe-4bd2-aac6-f54cbebd783e'],
  quarrySurvey: ['33fca97e-ef4f-459d-a773-ab58b7f84fd5'],
  medicalFlight: ['0861538d-75c8-473e-a2ab-499a6b8c1d49'],
  rehabilitation: ['0aaaa4d1-9ca6-4737-a3d6-92081635402c'],
};

export function operationFor(sector: string | null, solutionId?: string | null): OperationProfile | null {
  const key = (Object.keys(ids) as OperationKey[]).find(candidate =>
    ids[candidate].includes(solutionId ?? '') &&
    (candidate === 'waterCleanup' ? sector === 'sector-water'
      : candidate === 'quarrySurvey' ? sector === 'sector-mining'
        : sector === 'sector-medicine'));
  return key ? operationProfiles[key] : null;
}

export function operationScopeError(sector: string | null, objectType: ObjectType, solutionId?: string | null): string | null {
  const profile = operationFor(sector, solutionId);
  if (!profile) return 'Для этой операции и модели нет отдельной проверенной методики ТЭО. Каталожная принадлежность к отрасли не подтверждает применимость расчёта.';
  if (objectType !== 'custom') return 'Для этой операции выберите «Свой объект»: типовой шаблон склада, аэропорта или медучреждения не описывает её производственный цикл.';
  return null;
}

export const operationFieldKey = (profile: OperationProfile, field: string) => `operation:${profile.key}:${field}`;
export const isOperationExample = (profile: OperationProfile, params: Record<string, number | string | boolean>) =>
  params[operationFieldKey(profile, 'example')] === true;

export function serializeOperationCsv(rows: readonly (readonly string[])[]): string {
  return '\uFEFF' + rows
    .map(row => row.map(cell => `"${cell.replaceAll('"', '""')}"`).join(','))
    .join('\r\n');
}

const briefKeys = ['site_name', 'task', 'site_area_m2', 'shifts_per_day', 'constraints'] as const;

export function customBriefChanged(
  current: Record<string, number | string | boolean>,
  update: Record<string, number | string | boolean>,
  complete = false,
): boolean {
  return briefKeys.some(key => (complete || Object.hasOwn(update, key)) && current[key] !== update[key]);
}

export function mergeCustomBrief(
  current: Record<string, number | string | boolean>,
  update: Record<string, number | string | boolean>,
  complete: boolean,
): Record<string, number | string | boolean> {
  const changed = customBriefChanged(current, update, complete);
  const withoutMissingOptionals = complete
    ? Object.fromEntries(Object.entries(current).filter(([key]) => key !== 'site_area_m2' && key !== 'shifts_per_day'))
    : current;
  return { ...(changed ? withoutOperationFields(withoutMissingOptionals) : withoutMissingOptionals), ...update };
}

export function withoutOperationFields<T>(record: Record<string, T>, operation?: OperationKey): Record<string, T> {
  const prefix = operation ? `operation:${operation}:` : 'operation:';
  return Object.fromEntries(Object.entries(record).filter(([key]) => !key.startsWith(prefix)));
}

export type OperationInputs = {
  values: Record<string, number>;
  siteName: string;
  observedFrom: string;
  observedTo: string;
  operationalSource: string;
  scheduledOperatingHours: number;
  journal: OperationJournalEntry[];
  journalInvalid: boolean;
  operatingMonths: number[];
  offSeasonAvailabilityByMonth: Record<number, number>;
  offSeasonEvidenceByMonth: Record<number, OperationAvailabilityEvidence>;
  seasonalityInvalid: boolean;
  availabilityEvidenceInvalid: boolean;
  financialSource: string;
  scopeConfirmed: boolean;
  operationalCoverageConfirmed: boolean;
  illustrativeExample: boolean;
};

const journalKinds = new Set<OperationJournalKind>(['accepted', 'cancelled', 'rework', 'downtime']);
const validIsoDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

export function readOperationJournal(value: number | string | boolean | undefined): {
  entries: OperationJournalEntry[];
  invalid: boolean;
} {
  if (value === undefined || value === '') return { entries: [], invalid: false };
  if (typeof value !== 'string') return { entries: [], invalid: true };
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return { entries: [], invalid: true };
    const entries = parsed as unknown[];
    const valid = entries.every((entry) => (
      typeof entry === 'object'
      && entry !== null
      && !Array.isArray(entry)
      && typeof (entry as Record<string, unknown>).date === 'string'
      && journalKinds.has((entry as Record<string, unknown>).kind as OperationJournalKind)
      && ((entry as Record<string, unknown>).volume === null
        || (typeof (entry as Record<string, unknown>).volume === 'number'
          && Number.isFinite((entry as Record<string, unknown>).volume)))
      && ((entry as Record<string, unknown>).downtimeHours === null
        || (typeof (entry as Record<string, unknown>).downtimeHours === 'number'
          && Number.isFinite((entry as Record<string, unknown>).downtimeHours)))
      && typeof (entry as Record<string, unknown>).reason === 'string'
    ));
    return valid
      ? { entries: entries as OperationJournalEntry[], invalid: false }
      : { entries: [], invalid: true };
  } catch {
    return { entries: [], invalid: true };
  }
}

export function readOperationInputs(profile: OperationProfile, params: Record<string, number | string | boolean>, overrides: Record<string, number>): OperationInputs {
  const journal = readOperationJournal(params[operationFieldKey(profile, 'journal')]);
  const scheduledValue = params[operationFieldKey(profile, 'scheduledOperatingHours')];
  const operatingMonthsValue = params[operationFieldKey(profile, 'operatingMonths')];
  let operatingMonths = operationMonthOptions.map(({ month }) => month);
  let seasonalityInvalid = false;
  if (operatingMonthsValue !== undefined) {
    try {
      const parsed: unknown = typeof operatingMonthsValue === 'string' ? JSON.parse(operatingMonthsValue) : null;
      if (!Array.isArray(parsed) || !parsed.every(month => Number.isInteger(month) && month >= 1 && month <= 12)
        || new Set(parsed).size !== parsed.length) {
        seasonalityInvalid = true;
        operatingMonths = [];
      } else {
        operatingMonths = [...parsed].sort((a, b) => a - b);
      }
    } catch {
      seasonalityInvalid = true;
      operatingMonths = [];
    }
  }
  const legacyAvailabilityValue = params[operationFieldKey(profile, 'offSeasonAvailabilityPercent')];
  const legacyAvailabilityPercent = legacyAvailabilityValue === undefined
    ? 0
    : legacyAvailabilityValue === ''
      ? Number.NaN
      : typeof legacyAvailabilityValue === 'number' || typeof legacyAvailabilityValue === 'string'
        ? Number(legacyAvailabilityValue)
        : Number.NaN;
  const availabilityByMonthValue = params[operationFieldKey(profile, 'offSeasonAvailabilityByMonth')];
  const offSeasonAvailabilityByMonth: Record<number, number> = Object.fromEntries(
    operationMonthOptions.map(({ month }) => [month, legacyAvailabilityPercent]),
  );
  if (availabilityByMonthValue !== undefined) {
    try {
      const parsed: unknown = typeof availabilityByMonthValue === 'string'
        ? JSON.parse(availabilityByMonthValue)
        : null;
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        seasonalityInvalid = true;
      } else {
        for (const [monthKey, value] of Object.entries(parsed)) {
          const month = Number(monthKey);
          if (!Number.isInteger(month) || month < 1 || month > 12) {
            seasonalityInvalid = true;
            continue;
          }
          offSeasonAvailabilityByMonth[month] = typeof value === 'number' && Number.isFinite(value)
            ? value
            : typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))
              ? Number(value)
              : Number.NaN;
        }
      }
    } catch {
      seasonalityInvalid = true;
    }
  }
  const availabilityEvidenceValue = params[operationFieldKey(profile, 'offSeasonEvidenceByMonth')];
  const offSeasonEvidenceByMonth: Record<number, OperationAvailabilityEvidence> = Object.fromEntries(
    operationMonthOptions.map(({ month }) => [month, { source: '', explanation: '' }]),
  );
  let availabilityEvidenceInvalid = false;
  if (availabilityEvidenceValue !== undefined) {
    try {
      const parsed: unknown = typeof availabilityEvidenceValue === 'string'
        ? JSON.parse(availabilityEvidenceValue)
        : null;
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        availabilityEvidenceInvalid = true;
      } else {
        for (const [monthKey, value] of Object.entries(parsed)) {
          const month = Number(monthKey);
          if (!Number.isInteger(month) || month < 1 || month > 12
            || typeof value !== 'object' || value === null || Array.isArray(value)) {
            availabilityEvidenceInvalid = true;
            continue;
          }
          const evidence = value as Record<string, unknown>;
          const source = evidence.source === undefined ? '' : evidence.source;
          const explanation = evidence.explanation === undefined ? '' : evidence.explanation;
          if (typeof source !== 'string' || typeof explanation !== 'string') {
            availabilityEvidenceInvalid = true;
            continue;
          }
          offSeasonEvidenceByMonth[month] = { source, explanation };
        }
      }
    } catch {
      availabilityEvidenceInvalid = true;
    }
  }
  const scheduledOperatingHours = scheduledValue === undefined || scheduledValue === ''
    ? Number.NaN
    : typeof scheduledValue === 'number' || typeof scheduledValue === 'string'
      ? Number(scheduledValue)
      : Number.NaN;
  return {
    values: Object.fromEntries(profile.fields.map(field => [field.key, overrides[operationFieldKey(profile, field.key)]])),
    siteName: String(params.site_name ?? ''),
    observedFrom: String(params[operationFieldKey(profile, 'observedFrom')] ?? ''),
    observedTo: String(params[operationFieldKey(profile, 'observedTo')] ?? ''),
    operationalSource: String(params[operationFieldKey(profile, 'operationalSource')] ?? ''),
    scheduledOperatingHours,
    journal: journal.entries,
    journalInvalid: journal.invalid,
    operatingMonths,
    offSeasonAvailabilityByMonth,
    offSeasonEvidenceByMonth,
    seasonalityInvalid,
    availabilityEvidenceInvalid,
    financialSource: String(params[operationFieldKey(profile, 'financialSource')] ?? ''),
    scopeConfirmed: params[operationFieldKey(profile, 'scopeConfirmed')] === true,
    operationalCoverageConfirmed: params[operationFieldKey(profile, 'operationalCoverageConfirmed')] === true,
    illustrativeExample: isOperationExample(profile, params),
  };
}

const standardMonthDays = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function getSeasonalCalendar(input: OperationInputs): {
  observedSeasonalDays: number;
  annualSeasonalDays: number;
  observedMonths: Set<number>;
} {
  const operatingMonths = new Set(input.operatingMonths);
  const monthWeight = (month: number) => operatingMonths.has(month)
    ? 1
    : input.offSeasonAvailabilityByMonth[month] / 100;
  const annualSeasonalDays = standardMonthDays.reduce(
    (days, monthDays, index) => days + monthDays * monthWeight(index + 1),
    0,
  );
  const observedMonths = new Set<number>();
  let observedSeasonalDays = 0;
  if (!validIsoDate(input.observedFrom) || !validIsoDate(input.observedTo) || input.observedFrom > input.observedTo) {
    return { observedSeasonalDays, annualSeasonalDays, observedMonths };
  }

  const dayMilliseconds = 86_400_000;
  const end = Date.parse(`${input.observedTo}T00:00:00Z`);
  let cursor = Date.parse(`${input.observedFrom}T00:00:00Z`);
  while (cursor <= end) {
    const date = new Date(cursor);
    const month = date.getUTCMonth() + 1;
    const nextMonth = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
    const segmentEnd = Math.min(end, nextMonth - dayMilliseconds);
    const daysInSegment = Math.floor((segmentEnd - cursor) / dayMilliseconds) + 1;
    observedMonths.add(month);
    observedSeasonalDays += daysInSegment * monthWeight(month);
    cursor = segmentEnd + dayMilliseconds;
  }
  return { observedSeasonalDays, annualSeasonalDays, observedMonths };
}

export function summarizeOperationJournal(input: OperationInputs): OperationJournalSummary {
  const observedCalendarDays = validIsoDate(input.observedFrom) && validIsoDate(input.observedTo)
    && input.observedFrom <= input.observedTo
    ? Math.floor((Date.parse(`${input.observedTo}T00:00:00Z`) - Date.parse(`${input.observedFrom}T00:00:00Z`)) / 86_400_000) + 1
    : 0;
  const journalDays = new Set(input.journal.filter(entry => validIsoDate(entry.date)).map(entry => entry.date)).size;
  const acceptedVolume = input.journal.reduce((total, entry) => total + (entry.kind === 'accepted' ? entry.volume ?? 0 : 0), 0);
  const cancelledVolume = input.journal.reduce((total, entry) => total + (entry.kind === 'cancelled' ? entry.volume ?? 0 : 0), 0);
  const reworkVolume = input.journal.reduce((total, entry) => total + (entry.kind === 'rework' ? entry.volume ?? 0 : 0), 0);
  const downtimeHours = input.journal.reduce((total, entry) => total + (entry.kind === 'downtime' ? entry.downtimeHours ?? 0 : 0), 0);
  const recordedAttemptVolume = acceptedVolume + cancelledVolume + reworkVolume;
  const scheduledOperatingHours = Number.isFinite(input.scheduledOperatingHours) && input.scheduledOperatingHours > 0
    ? input.scheduledOperatingHours
    : null;
  const availableOperatingHours = scheduledOperatingHours === null
    ? null
    : Math.max(0, scheduledOperatingHours - downtimeHours);
  const availabilityPercent = scheduledOperatingHours === null
    ? null
    : (availableOperatingHours! / scheduledOperatingHours) * 100;
  const annualizedCapacity = observedCalendarDays > 0 && acceptedVolume > 0
    ? acceptedVolume / observedCalendarDays * 365
    : null;
  const seasonalCalendar = getSeasonalCalendar(input);
  const seasonallyAdjustedCapacity = acceptedVolume > 0 && seasonalCalendar.observedSeasonalDays > 0
    ? acceptedVolume / seasonalCalendar.observedSeasonalDays * seasonalCalendar.annualSeasonalDays
    : null;
  const seasonalCoverageComplete = observedCalendarDays >= 365 && seasonalCalendar.observedMonths.size === 12;
  const noDowntimeAnnualCapacity = observedCalendarDays > 0
    && acceptedVolume > 0
    && scheduledOperatingHours !== null
    && availableOperatingHours !== null
    && availableOperatingHours > 0
    ? acceptedVolume / availableOperatingHours * (scheduledOperatingHours / observedCalendarDays * 365)
    : null;
  const downtimeCapacityLoss = noDowntimeAnnualCapacity !== null && annualizedCapacity !== null
    ? Math.max(0, noDowntimeAnnualCapacity - annualizedCapacity)
    : null;
  const scenarioReasons: string[] = [];
  if (observedCalendarDays < 30) scenarioReasons.push('период наблюдений короче 30 календарных дней');
  if (journalDays < 10) scenarioReasons.push('журнал содержит менее 10 разных дат');
  if (acceptedVolume <= 0) scenarioReasons.push('нет положительного принятого объёма');
  if (!input.operationalCoverageConfirmed) scenarioReasons.push('полнота журнала не подтверждена пользователем');
  if (!seasonalCoverageComplete) scenarioReasons.push('наблюдения не покрывают полный годовой сезонный цикл: нужны не менее 365 календарных дней и все 12 месяцев');
  return {
    observedCalendarDays,
    journalDays,
    acceptedVolume,
    cancelledVolume,
    cancelledSharePercent: recordedAttemptVolume > 0 ? cancelledVolume / recordedAttemptVolume * 100 : 0,
    reworkVolume,
    reworkSharePercent: recordedAttemptVolume > 0 ? reworkVolume / recordedAttemptVolume * 100 : 0,
    downtimeHours,
    scheduledOperatingHours,
    availableOperatingHours,
    availabilityPercent,
    annualizedCapacity,
    seasonallyAdjustedCapacity,
    observedSeasonalDays: seasonalCalendar.observedSeasonalDays,
    annualSeasonalDays: seasonalCalendar.annualSeasonalDays,
    operatingMonths: input.operatingMonths,
    offSeasonAvailabilityByMonth: input.offSeasonAvailabilityByMonth,
    offSeasonEvidenceByMonth: input.offSeasonEvidenceByMonth,
    seasonalCoverageComplete,
    noDowntimeAnnualCapacity,
    downtimeCapacityLoss,
    sufficient: scenarioReasons.length === 0,
    scenarioReasons,
  };
}

export function validateOperationInputs(profile: OperationProfile, input: OperationInputs): string[] {
  const errors: string[] = [];
  if (input.seasonalityInvalid) errors.push('Сохранённый сезонный календарь имеет неизвестный формат. Выберите месяцы сезона заново.');
  if (input.availabilityEvidenceInvalid) errors.push('Сохранённые основания помесячной доступности имеют неизвестный формат. Повторно укажите источник и пояснение для месяцев вне сезона.');
  if (input.operatingMonths.length === 0 || input.operatingMonths.some(month => !Number.isInteger(month) || month < 1 || month > 12)
    || new Set(input.operatingMonths).size !== input.operatingMonths.length) {
    errors.push('Отметьте хотя бы один месяц обычной работы объекта.');
  }
  const operatingMonths = new Set(input.operatingMonths);
  for (const { month, label } of operationMonthOptions) {
    const availability = input.offSeasonAvailabilityByMonth[month];
    if (!operatingMonths.has(month)
      && (!Number.isFinite(availability) || availability < 0 || availability > 100)) {
      errors.push(`Доступность работ за месяц «${label}» вне сезона должна быть от 0 до 100%.`);
    }
  }
  const journalAcceptedVolume = input.journalInvalid
    ? 0
    : input.journal.reduce((total, entry) => total + (entry.kind === 'accepted' ? entry.volume ?? 0 : 0), 0);
  const hasJournalCapacity = journalAcceptedVolume > 0
    && validIsoDate(input.observedFrom)
    && validIsoDate(input.observedTo)
    && input.observedFrom <= input.observedTo;
  errors.push(...profile.fields.filter(field => {
    if (field.key === 'annualCapacity' && hasJournalCapacity) return false;
    const n = input.values[field.key];
    return !Number.isFinite(n) || (field.key === 'discount' ? n < 0 || n > 100
      : field.key === 'newUnitCost' || field.key === 'annualFixedCost' ? n < 0
      : n <= 0 || (field.key === 'horizon' && (!Number.isInteger(n) || n > 50)) || n > 1e12);
  }).map(field => `Укажите допустимое значение: ${field.label}.`));
  if (!input.illustrativeExample) {
    if (!input.siteName.trim()) errors.push('Укажите точное название площадки, маршрута или клиники.');
    if (!validIsoDate(input.observedFrom) || !validIsoDate(input.observedTo)) {
      errors.push('Укажите точные даты начала и окончания периода наблюдений.');
    } else if (input.observedFrom > input.observedTo) {
      errors.push('Дата начала периода не может быть позже даты окончания.');
    }
    if (!input.operationalSource.trim()) errors.push('Укажите документ или журнал измерений объёма и производительности.');
    if (input.journalInvalid) errors.push('Журнал операций повреждён или имеет неизвестный формат. Добавьте записи заново.');
    if (!input.journalInvalid && input.journal.length === 0) errors.push('Добавьте фактические записи операций из журнала площадки.');
    if (!Number.isFinite(input.scheduledOperatingHours) || input.scheduledOperatingHours <= 0) {
      errors.push('Укажите плановое рабочее время за период наблюдений в часах.');
    }
    if (validIsoDate(input.observedFrom) && validIsoDate(input.observedTo)) {
      input.journal.forEach((entry, index) => {
        const label = `Запись ${index + 1}`;
        if (!validIsoDate(entry.date)) errors.push(`${label}: укажите корректную дату.`);
        else if (entry.date < input.observedFrom || entry.date > input.observedTo) {
          errors.push(`${label}: дата должна попадать в период наблюдений.`);
        }
        if (entry.kind === 'accepted' || entry.kind === 'cancelled' || entry.kind === 'rework') {
          if (!Number.isFinite(entry.volume) || (entry.volume ?? 0) <= 0 || (entry.volume ?? 0) > 1e12) {
            errors.push(`${label}: укажите положительный объём операции не более 1 000 000 000 000.`);
          }
          if (entry.downtimeHours !== null) errors.push(`${label}: для объёмной операции не указывайте часы простоя.`);
        }
        if (entry.kind === 'downtime') {
          if (!Number.isFinite(entry.downtimeHours) || (entry.downtimeHours ?? 0) <= 0 || (entry.downtimeHours ?? 0) > 24) {
            errors.push(`${label}: укажите простой от 0 до 24 часов.`);
          }
          if (entry.volume !== null) errors.push(`${label}: для простоя поле объёма должно быть пустым.`);
        }
        if (entry.kind !== 'accepted' && !entry.reason.trim()) {
          errors.push(`${label}: укажите причину отмены, повтора или простоя.`);
        }
      });
      const downtimeHours = input.journal.reduce((total, entry) => total + (entry.kind === 'downtime' ? entry.downtimeHours ?? 0 : 0), 0);
      if (Number.isFinite(input.scheduledOperatingHours) && input.scheduledOperatingHours > 0
        && downtimeHours > input.scheduledOperatingHours) {
        errors.push('Суммарный простой не может превышать плановое рабочее время за период.');
      } else if (input.journal.some(entry => entry.kind === 'accepted' && (entry.volume ?? 0) > 0)
        && downtimeHours >= input.scheduledOperatingHours && downtimeHours > 0) {
        errors.push('Простой не может занимать всё плановое рабочее время, если за период была принята выработка.');
      }
      const downtimeByDate = new Map<string, number>();
      input.journal.filter(entry => entry.kind === 'downtime' && validIsoDate(entry.date)).forEach(entry => {
        downtimeByDate.set(entry.date, (downtimeByDate.get(entry.date) ?? 0) + (entry.downtimeHours ?? 0));
      });
      if ([...downtimeByDate.values()].some(hours => hours > 24)) {
        errors.push('Суммарный простой за одну календарную дату не может превышать 24 часа.');
      }
      const periodDays = validIsoDate(input.observedFrom) && validIsoDate(input.observedTo)
        && input.observedFrom <= input.observedTo
        ? Math.floor((Date.parse(`${input.observedTo}T00:00:00Z`) - Date.parse(`${input.observedFrom}T00:00:00Z`)) / 86_400_000) + 1
        : 0;
      if (periodDays > 0 && input.scheduledOperatingHours > periodDays * 24) {
        errors.push('Плановое рабочее время не может превышать 24 часа на каждый календарный день периода.');
      }
    }
  }
  if (!input.financialSource.trim()) errors.push('Укажите источник текущих затрат, сметы и цены внедрения.');
  if (!input.scopeConfirmed && !input.illustrativeExample) errors.push('Подтвердите соответствие задачи области применимости методики.');
  if (!input.operationalCoverageConfirmed && !input.illustrativeExample) errors.push('Сверьте журнал со списком обязательных записей операции и отметьте отдельно выявленные пробелы.');
  return errors;
}

export function calculateOperation(profile: OperationProfile, input: OperationInputs, multipliers = { volumeMultiplier: 1, priceMultiplier: 1 }): {
  annualVolume: number; annualCapacity: number; fleet: number; journalSummary: OperationJournalSummary; baselineAnnual: number; capex: number; newAnnual: number;
  savings: number; tcoBaseline: number; tcoNew: number; npv: number; payback: number | null;
} {
  const errors = validateOperationInputs(profile, input);
  if (errors.length) throw new Error(errors.join(' '));
  const v = input.values;
  const journalSummary = summarizeOperationJournal(input);
  const annualCapacity = journalSummary.seasonallyAdjustedCapacity
    ?? journalSummary.annualizedCapacity
    ?? v.annualCapacity;
  const annualVolume = v.annualVolume * multipliers.volumeMultiplier;
  const fleet = Math.ceil(annualVolume / annualCapacity);
  const baselineAnnual = annualVolume * v.baselineUnitCost;
  const capex = fleet * v.unitCapex * multipliers.priceMultiplier;
  const newAnnual = annualVolume * v.newUnitCost + fleet * v.annualFixedCost;
  const savings = baselineAnnual - newAnnual;
  const discount = v.discount / 100;
  const npv = -capex + Array.from({ length: v.horizon }, (_, i) => savings / (1 + discount) ** (i + 1)).reduce((a, b) => a + b, 0);
  return {
    annualVolume, annualCapacity, fleet, journalSummary, baselineAnnual, capex, newAnnual, savings,
    tcoBaseline: baselineAnnual * v.horizon,
    tcoNew: capex + newAnnual * v.horizon,
    npv, payback: savings > 0 ? capex / savings : null,
  };
}