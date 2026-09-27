import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const artifactDir = resolve(scriptDir, '..');
const catalogPath = resolve(artifactDir, 'src/data/solutions.json');
const registryPath = resolve(artifactDir, 'src/data/source-registry.json');

const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
const checkedAt = catalog.ttx_verification?.checked_at ?? catalog.updated;
const requestVersion = `RFI-${checkedAt}-v1`;
const senderEmail = 'robots2b@yandex.com';
const outreachResult = {
  status: 'blocked',
  outcome: 'sender_integration_unavailable',
  recorded_at: checkedAt,
  attempted_at: null,
  channel: 'supplier_contact_required',
  sender_email: senderEmail,
  note: 'Подключить Yandex по OAuth не удалось; RFI не отправлен, ответ и документ не получены.',
};

const items = catalog.items
  .map((solution, catalogIndex) => ({ solution, catalogIndex }))
  .filter(({ solution }) => solution.specs_verification?.unconfirmed?.length)
  .map(({ solution, catalogIndex }) => {
    const verification = solution.specs_verification;
    const confirmedFields = verification.confirmed ?? [];
    const requestedFields = verification.unconfirmed.map((field) => ({
      field,
      status: 'unconfirmed',
    }));

    return {
      card_ref: `${solution.id}::${catalogIndex + 1}`,
      catalog_index: catalogIndex + 1,
      solution_id: solution.id,
      solution_name: solution.name,
      vendor: solution.vendor,
      catalog_source: solution.source,
      request: {
        status: 'rejected_or_unavailable',
        previous_status: 'request_registered',
        status_reason: 'sender_integration_unavailable',
        request_type: 'passport_or_written_confirmation',
        requested_at: checkedAt,
        request_version: requestVersion,
        requested_fields: requestedFields,
        confirmed_fields_unchanged: confirmedFields,
        delivery_channel: 'supplier_contact_required',
        sent_at: null,
      },
      outreach: outreachResult,
      documents: [],
      note: 'Обращение заблокировано из-за отсутствия подключённого канала поставщика. Паспорт или письменный ответ не получен; поля остаются в unconfirmed.',
    };
  })
  .sort((a, b) => a.card_ref.localeCompare(b.card_ref));

const registry = {
  registry_version: '1.0',
  generated_at: checkedAt,
  request_version: requestVersion,
  catalog_snapshot: {
    file: 'solutions.json',
    updated: catalog.updated,
    item_count: catalog.items.length,
    unconfirmed_card_count: items.length,
  },
  outreach_summary: {
    recorded_at: checkedAt,
    status: 'sender_integration_unavailable',
    sender_email: senderEmail,
    total_requests: items.length,
    sent_requests: 0,
    responses_received: 0,
    documents_received: 0,
    note: 'Подключение Yandex по OAuth не завершено. До подключения почтового канала RFI не отправляются.',
  },
  purpose: 'Рабочий реестр запросов паспортов и письменного подтверждения применимых числовых ТТХ.',
  request_template: {
    subject: 'Запрос паспорта модели и подтверждения технических характеристик',
    body: 'Просим предоставить действующий паспорт, спецификацию или письменное подтверждение применимых числовых характеристик для указанной модели. Для каждого поля укажите значение, единицу измерения, условия измерения и версию документа. Если поле неприменимо, укажите это явно.',
    required_response: ['Значение и единица измерения по каждому requested_field', 'Версия или дата документа', 'Ограничения применимости и условия измерения'],
  },
  status_policy: {
    request_registered: 'Запрос сформирован для карточки; результат передачи поставщику ещё не зафиксирован, это не подтверждение ТТХ.',
    document_received: 'Документ получен, сохранён с датой и версией; только после проверки его поля можно перенести в specs.',
    rejected_or_unavailable: 'Поставщик отказал, не предоставил данные или канал отправителя недоступен; поля остаются в unconfirmed.',
  },
  document_policy: {
    required_metadata: ['document_id', 'document_type', 'version', 'received_at', 'file_or_link'],
    source_rule: 'Числовое поле переносится в specs только из document_received с явным значением и ссылкой на документ.',
  },
  items,
};

const catalogUnconfirmedIds = new Set(
  catalog.items
    .flatMap((solution, catalogIndex) => solution.specs_verification?.unconfirmed?.length
      ? [`${solution.id}::${catalogIndex + 1}`]
      : []),
);
const registryCardRefs = new Set(items.map((item) => item.card_ref));
if (catalogUnconfirmedIds.size !== registryCardRefs.size || [...catalogUnconfirmedIds].some((cardRef) => !registryCardRefs.has(cardRef))) {
  throw new Error('Source registry is out of sync with the catalog unconfirmed set.');
}

await writeFile(registryPath, `${JSON.stringify(registry, null, 2)}\n`);
console.log(`Generated ${items.length} request records at ${registryPath}`);