import JSZip from 'jszip';
import QRCode from 'qrcode';
import { buildStartValueTask, calculateStartValue, type StartValueInputs } from './start-value.ts';
import { startScopeObjectLabel, START_SCOPE_LABELS, startScopeProcesses, parseStartScopeDraft, type StartScopeDraft } from './start-scope.ts';
import { briefForProcess, decodeStartBriefHash } from './start-brief.ts';
import type { SiteProcess } from './start-processes.ts';
import { calculateWorkbench, isWorkbenchApproved, parseWorkbenchPlan, workbenchContext, workbenchUnit,
  WORKBENCH_LABELS, type WorkbenchInputs, type WorkbenchPlan } from './start-workbench.ts';
import { fieldsForProcess } from './start-processes.ts';
import { startSimulationConditions } from './start-workbench-simulation.ts';

const escape = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
const paragraph = (text: string, heading = false) => `<w:p><w:pPr>${heading ? '<w:pStyle w:val="Heading1"/>' : ''}<w:spacing w:after="120"/></w:pPr><w:r><w:t xml:space="preserve">${escape(text)}</w:t></w:r></w:p>`;
function image(id: string, number: number, label: string, size: number) {
  return `<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${size}" cy="${size}"/><wp:docPr id="${number}" name="${label}" descr="${label}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${number}" name="${label}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${size}" cy="${size}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
}
const n = (value: number) => value.toLocaleString('ru-RU', { maximumFractionDigits: 2 });

export async function generateStartValueDocx({ draft, process, inputs, url, logoUrl }: {
  draft: StartScopeDraft; process: SiteProcess; inputs: StartValueInputs; url: string; logoUrl: string;
}): Promise<Blob> {
  const result = calculateStartValue(inputs);
  const target = new URL(url);
  if (target.origin !== 'https://robotshub.ru' || target.pathname !== '/start' || !target.hash.startsWith('#brief=')) {
    throw new Error('Документ должен ссылаться на сценарий Железный аргумент, а не на служебный адрес.');
  }
  const shared = decodeStartBriefHash(target.hash);
  if (!shared || shared.objectId !== draft.objectId || shared.valueFocusId !== process.id
    || JSON.stringify(shared.valueScenarios?.[process.id]) !== JSON.stringify(inputs)) {
    throw new Error('Ссылка в QR не соответствует показанному процессу и числам. Документ не сформирован.');
  }
  const task = buildStartValueTask(draft, process, inputs);
  const evidence = briefForProcess(draft.objectId, process).evidence;
  const paragraphs = [
    image('rIdLogo', 1, 'Железный аргумент', 548640),
    paragraph('Центр подбора роботизации «Железный аргумент»', true),
    paragraph('Задание на предпроектную проверку', true),
    paragraph(`Объект: ${startScopeObjectLabel(draft)}. Охват: ${draft.scope ? START_SCOPE_LABELS[draft.scope] : 'не определён'}.`),
    paragraph(`Процессы в охвате: ${startScopeProcesses(draft).map(item => item.name).join('; ')}.`),
    paragraph(`Расчёт ниже относится только к процессу «${process.name}», не ко всему объекту.`),
    paragraph('Краткий вывод', true),
    paragraph(`В условном сценарии высвобождается ${n(result.freedHoursPerShift)} чел·ч/смену (${n(result.annualFreedHours)} чел·ч/год). Денежный эффект при монетизации ${n(inputs.cashablePct)}% — ${n(result.annualCashEffectRub)} ₽/год.`),
    paragraph(`Предел полной стоимости владения за ${n(inputs.targetYears)} года — ${n(result.maxOwnershipBudgetRub)} ₽. В него должны войти оборудование, интеграция, сервис, энергия и остальные затраты. Это не цена робота.`),
    paragraph(result.verdict),
    paragraph('Исходные допущения и формулы', true),
    paragraph(`Ручная работа: ${n(inputs.manualHoursPerShift)} чел·ч/смену; возможное высвобождение: ${n(inputs.automationPct)}%; час: ${n(inputs.hourCostRub)} ₽; смен: ${n(inputs.shiftsYear)} в год; денежная реализация: ${n(inputs.cashablePct)}%; срок: ${n(inputs.targetYears)} года. Все эти значения — допущения сценария, пока не подтверждены замерами.`),
    paragraph('Высвобождённое время = ручные чел·ч × доля высвобождения. Денежный эффект в год = высвобождённые чел·ч × смены в год × стоимость часа × доля реальной денежной экономии. Предел полной стоимости = годовой денежный эффект × выбранный срок. Без дисконтирования. Часы не равны автоматически сокращённым должностям.'),
    ...task.split('\n').map(line => paragraph(line)),
    ...(evidence.length ? [paragraph('Примеры других площадок — не прогноз для этого объекта', true),
      ...evidence.map(item => paragraph(`${item.title}. ${item.sourceLabel}. https://robotshub.ru/cases/${item.caseId}`))]
      : [paragraph('Прямой подтверждённый кейс для этого сочетания объекта и процесса в данном разборе пока не подобран.')]),
    paragraph('Открыть тот же сценарий', true),
    paragraph('QR-код и ссылка открывают выбранный процесс с теми же числами. Включённые ответы доступны любому получателю ссылки. Финансовый проект получателя не заменяется при просмотре.'),
    image('rIdQr', 2, 'QR-ссылка на этот сценарий', 1828800),
    `<w:p><w:hyperlink r:id="rIdLink"><w:r><w:rPr><w:color w:val="007D92"/><w:u w:val="single"/></w:rPr><w:t>Открыть сценарий на robotshub.ru</w:t></w:r></w:hyperlink></w:p>`,
    paragraph('Это задание на проверку гипотезы, не технико-экономическое обоснование, не подтверждение применимости робота и не обещание окупаемости.'),
  ].join('');
  return packStartDocx(paragraphs, url, logoUrl);
}

async function packStartDocx(paragraphs: string, url: string, logoUrl: string): Promise<Blob> {
  const logo = await fetch(logoUrl);
  if (!logo.ok) throw new Error('Не удалось загрузить логотип. Документ без логотипа не сформирован.');
  const logoBytes = new Uint8Array(await logo.arrayBuffer());
  if (logoBytes[0] !== 0xff || logoBytes[1] !== 0xd8) throw new Error('Неверный формат логотипа.');
  let qr: string;
  try { qr = await QRCode.toDataURL(url, { width: 640, margin: 4, errorCorrectionLevel: 'M' }); }
  catch { throw new Error('Набор вводных слишком велик для читаемого QR. Сократите длинные описания; данные в браузере сохранены.'); }
  const qrBytes = Uint8Array.from(atob(qr.split(',')[1]), char => char.charCodeAt(0));
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpg" ContentType="image/jpeg"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdDocument" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><w:body>${paragraphs}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1000" w:right="1000" w:bottom="1000" w:left="1000"/></w:sectPr></w:body></w:document>`);
  zip.file('word/styles.xml', `<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="24"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:keepNext/></w:pPr><w:rPr><w:b/><w:color w:val="007D92"/><w:sz w:val="30"/></w:rPr></w:style></w:styles>`);
  zip.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdLogo" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/logo.jpg"/><Relationship Id="rIdQr" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/scenario.png"/><Relationship Id="rIdLink" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${escape(url)}" TargetMode="External"/><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  zip.file('word/media/logo.jpg', logoBytes);
  zip.file('word/media/scenario.png', qrBytes);
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', compression: 'DEFLATE' });
}

const conciseRub = (value: number) => Math.abs(value) >= 1e6 ? `${n(value / 1e6)} млн ₽` : `${n(value)} ₽`;
function compareTable(plan: WorkbenchPlan): string {
  const rows = [
    ['Вариант', 'Парк', 'Вложения', 'Чистый эффект/год', 'Окупаемость', 'Нагрузка'],
    ...plan.variants.map(variant => {
      const r = calculateWorkbench(variant.inputs);
      return [`${variant.id === plan.selectedId ? 'ВЫБРАН: ' : ''}${variant.name}`, n(r.robotCount),
        conciseRub(r.capexRub), conciseRub(r.annualNetCashRub),
        r.paybackYears === null ? 'Не подтверждена' : `${n(r.paybackYears)} г.`,
        r.meetsDemand ? 'Покрыта с резервом' : 'Не покрыта'];
    }),
  ];
  return `<w:tbl><w:tblPr><w:tblW w:w="9900" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblBorders><w:top w:val="single" w:sz="4"/><w:left w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/><w:right w:val="single" w:sz="4"/><w:insideH w:val="single" w:sz="4"/><w:insideV w:val="single" w:sz="4"/></w:tblBorders></w:tblPr><w:tblGrid>${[2200, 650, 1700, 1900, 1600, 1850].map(width => `<w:gridCol w:w="${width}"/>`).join('')}</w:tblGrid>${rows.map((row, index) =>
    `<w:tr>${index === 0 ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}${row.map(cell => `<w:tc><w:tcPr>${index === 0 ? '<w:shd w:fill="E7F4F7"/>' : ''}</w:tcPr><w:p><w:r><w:rPr><w:sz w:val="20"/>${index === 0 ? '<w:b/>' : ''}</w:rPr><w:t>${escape(cell)}</w:t></w:r></w:p></w:tc>`).join('')}</w:tr>`).join('')}</w:tbl>`;
}

function workbenchSection(draft: StartScopeDraft, process: SiteProcess, plan: WorkbenchPlan): string {
  const selected = plan.variants.find(item => item.id === plan.selectedId)!;
  const input = selected.inputs, r = calculateWorkbench(input), unit = workbenchUnit(process);
  const simulation = startSimulationConditions(draft.objectId, process, input);
  const facts = draft.details[process.id];
  const evidence = briefForProcess(draft.objectId, process).evidence;
  const body = [
    paragraph(`Участок: ${process.name}`, true),
    paragraph(`Выбранный вариант: ${selected.name}. Зафиксирован: ${plan.approval!.at}. Модель: ${plan.approval!.modelVersion}. Фиксация параметров не является электронной подписью или подтверждением применимости робота.`),
    paragraph(`Парк: ${n(r.robotCount)}; требуется по модели: ${n(r.requiredRobotCount)}. Вложения: ${n(r.capexRub)} ₽; эксплуатация: ${n(r.opexAnnualRub)} ₽/год; чистый денежный эффект: ${n(r.annualNetCashRub)} ₽/год.`),
    paragraph(`Простая окупаемость: ${r.paybackYears === null ? 'не подтверждена' : `${n(r.paybackYears)} года`}. Полная стоимость за ${n(input.targetYears)} года: ${n(r.tcoRub)} ₽. ${r.verdict}`),
    paragraph(`Объём: ${n(r.operationsPerShift)} за смену (${n(input.loadPerHour)} ${unit}). Пиковая нагрузка с резервом: ${n(r.peakDemandPerHour)} ${unit}; расчётная мощность парка с рабочей загрузкой и зарядкой: ${n(r.capacityPerHour)} ${unit}. Покрытие среднего потока: ${n(r.coveragePct)}%.`),
    paragraph(`Высвобождение с поправкой на обслуживаемый поток: ${n(r.freedHoursPerShift)} чел·ч/смену. До эксплуатации денежный эффект: ${n(r.annualGrossCashRub)} ₽/год. Это не автоматическое сокращение должностей.`),
    paragraph('Утверждённые параметры — допущения до проверки источников и замеров', true),
    ...Object.entries(input).map(([key, value]) => paragraph(`${WORKBENCH_LABELS[key as keyof WorkbenchInputs]}: ${value === null ? (key === 'robotCount' ? 'автоподбор' : 'не указано') : n(value)}.`)),
    paragraph('Условия наглядного просмотра', true),
    ...(simulation.supported ? [
      paragraph(`Маршрутный просмотр: ${n(input.loadPerHour)} перемещений/ч, ${n(simulation.robotCount)} машин, автономность ${n(input.batteryHours)} ч, зарядка ${n(input.chargeHours)} ч. Начальная очередь: ${simulation.initialTasks} заданий.`),
      ...simulation.assumptions.map(text => paragraph(text)),
      paragraph('Краткие живые KPI не включены в задание как доказанная производительность. Проверить на площадке цикл рейса, загрузку, зарядку и устойчивое выполнение потока; сопоставить с допущением темпа одного робота.'),
    ] : [paragraph(simulation.reason)]),
    paragraph('Сравнение альтернатив на тех же правилах', true),
    compareTable(plan),
    ...plan.variants.filter(item => item.id !== plan.selectedId).map(variant => {
      const differences = (Object.keys(input) as (keyof WorkbenchInputs)[]).filter(key => variant.inputs[key] !== input[key]);
      return paragraph(`${variant.name} — отличия от выбранного: ${differences.length
        ? differences.map(key => `${WORKBENCH_LABELS[key]}: ${variant.inputs[key] === null ? 'авто / не указано' : n(variant.inputs[key]!)}`).join('; ')
        : 'параметры совпадают'}.`);
    }),
    paragraph('Что проверить до решения о закупке', true),
    paragraph(`1. Подтвердить измерениями фактический поток ${n(input.loadPerHour)} ${unit}, пик, график ${n(input.hoursPerShift)} ч/смену и ограничения участка. Площадь объекта не использовалась для определения потока или персонала.`),
    paragraph(`2. На пилоте подтвердить производительность, время зарядки, передачу человеку, безопасность и качество. Требуемая мощность с резервом — ${n(r.peakDemandPerHour)} ${unit}; в текущей гипотезе — ${n(r.capacityPerHour)} ${unit}. Сортировка, захват и весь объект автоматически не считаются роботизированными.`),
    paragraph(`3. Измерить чистое высвобождение ручного труда до и после. Проверить ${n(input.cashablePct)}% реальной монетизации: какие сверхурочные, подряд или другие расходы исчезнут. Остаточный ручной труд и обслуживание силами своих людей не учитывать дважды.`),
    paragraph(`4. Получить предложение на весь состав затрат: ${n(r.capexRub)} ₽ первоначально и ${n(r.opexAnnualRub)} ₽/год эксплуатации — пока лишь значения сценария. Подтвердить оборудование, интеграцию, инфраструктуру, сервис, энергию и налоги в едином ценовом контуре.`),
    paragraph('5. Итог проверки — подтверждённые замеры, состав затрат и решение, оставлять, менять или отклонять выбранный вариант. Экономику не улучшать уменьшением реально существующей нагрузки.'),
    paragraph('Методика и ограничения', true),
    paragraph('Эффективная мощность одного робота = номинальная производительность × рабочая загрузка × время работы от батареи / (время работы + зарядка). Это усреднённая модель непрерывного цикла; она не описывает планировку, узкие места, лифты и расписание зарядки. Длительность смены определяет объём за смену, не выводит поток из площади.'),
    paragraph('Парк = округление вверх (поток × (1 + резерв) / эффективная мощность). При недостаточном парке высвобождение времени пропорционально покрытию среднего потока; окупаемость не подтверждается, если парк не покрывает пик с резервом.'),
    paragraph('Денежный эффект до эксплуатации = ручные чел·ч × доля высвобождения × покрытие потока × смены в год × стоимость часа × реальная монетизация. Чистый эффект = этот эффект − сервис оборудования − энергия и прочие дополнительные расходы. Вложения = парк × цена робота + внедрение. Простая окупаемость = вложения / положительный чистый годовой эффект; без дисконтирования и остаточной стоимости. Отрицательный эффект не заменяется положительным числом.'),
  ];
  const recorded = fieldsForProcess(process.kind).filter(field => facts && (facts.unknown[field.key] || facts.values[field.key]?.trim()));
  if (recorded.length) body.push(paragraph('Уже собранные сведения об участке', true), ...recorded.map(field =>
    paragraph(`${field.label}: ${facts!.unknown[field.key] ? 'неизвестно' : `${facts!.values[field.key]} ${field.unit ?? ''}`}.`)));
  if (evidence.length) body.push(paragraph('Примеры других площадок — не прогноз для этого объекта', true),
    ...evidence.map(item => paragraph(`${item.title}. ${item.sourceLabel}. https://robotshub.ru/cases/${item.caseId}`)));
  return body.join('');
}

export async function generateStartWorkbenchDocx({ draft, process, plan: rawPlan, url, logoUrl }: {
  draft: StartScopeDraft; process: SiteProcess; plan: WorkbenchPlan; url: string; logoUrl: string;
}): Promise<Blob> {
  const plan = parseWorkbenchPlan(rawPlan);
  if (!plan || !isWorkbenchApproved(plan, workbenchContext(draft, process))) throw new Error('Сначала утвердите выбранный вариант и сравнение. После изменений требуется новое утверждение.');
  const target = new URL(url);
  if (target.origin !== 'https://robotshub.ru' || target.pathname !== '/start') throw new Error('QR должен вести на сценарий robotshub.ru.');
  const shared = decodeStartBriefHash(target.hash);
  const effective = parseStartScopeDraft({ ...draft, workbenchPlans: { ...draft.workbenchPlans, [process.id]: plan } });
  const plans = effective?.workbenchPlans;
  if (!effective || !plans) throw new Error('Не удалось проверить состав задания. Исходные данные не изменены.');
  if (!shared || shared.valueFocusId !== process.id || workbenchContext(shared, process) !== workbenchContext(effective, process)
    || JSON.stringify(shared.workbenchPlans) !== JSON.stringify(plans)) throw new Error('Ссылка не соответствует утверждённым вариантам. Документ не сформирован.');
  const included = startScopeProcesses(effective).filter(item => {
    const candidate = plans[item.id];
    return candidate && isWorkbenchApproved(candidate, workbenchContext(effective, item));
  });
  const missing = startScopeProcesses(effective).filter(item => !included.some(entry => entry.id === item.id));
  const paragraphs = [
    image('rIdLogo', 1, 'Железный аргумент', 548640),
    paragraph('Центр подбора роботизации «Железный аргумент»', true),
    paragraph('Задание на предпроектную проверку', true),
    paragraph(`Железный аргумент · ${startScopeObjectLabel(draft)} · ${draft.scope ? START_SCOPE_LABELS[draft.scope] : 'охват не определён'}`),
    paragraph(`В документ включены утверждённые участки: ${included.map(item => item.name).join('; ')}.`),
    ...(missing.length ? [paragraph(`Другие участки в охвате, не утверждённые для этого задания: ${missing.map(item => item.name).join('; ')}.`)] : []),
    paragraph('Числа являются гипотезой сценария до подтверждения замерами и предложением поставщика. Утверждение фиксирует набор параметров для проверки, не является разрешением на закупку. Эффекты участков не складываются: одни и те же сотрудники и часы могут быть учтены несколько раз.'),
    ...included.map(item => workbenchSection(effective, item, plans[item.id])),
    paragraph('Открыть тот же набор вариантов', true),
    paragraph('Ссылка и QR содержат выбранные варианты, альтернативы и сведения об участках. Они доступны любому обладателю ссылки. Просмотр не заменяет собственные расчёты получателя.'),
    image('rIdQr', 2, 'QR-ссылка на утверждённые сценарии', 1828800),
    '<w:p><w:hyperlink r:id="rIdLink"><w:r><w:rPr><w:color w:val="007D92"/><w:u w:val="single"/></w:rPr><w:t>Открыть сценарии на robotshub.ru</w:t></w:r></w:hyperlink></w:p>',
  ].join('');
  return packStartDocx(paragraphs, url, logoUrl);
}
