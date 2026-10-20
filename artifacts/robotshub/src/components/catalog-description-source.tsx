import audit from '@/data/catalog-enrichment-audit.json';

type Props = {
  solution: { id: string; name: string; vendor: string; description?: string | null };
};

/** Attribute imported text only while it still matches the reviewed import. */
export function CatalogDescriptionSource({ solution }: Props) {
  const entry = audit.entries.find(item =>
    item.id === solution.id && item.name === solution.name && item.vendor === solution.vendor
    && item.fields.includes('description') && item.after.description === solution.description,
  );
  const source = entry?.description_source;
  if (!source) return null;
  const primary = source.status === 'primary-purpose-checked';
  return (
    <a
      href={source.url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={event => event.stopPropagation()}
      className="mt-2 block text-xs leading-5 text-muted-foreground underline decoration-dotted underline-offset-4 hover:text-primary"
      title={primary
        ? 'Назначение сверено с сайтом разработчика. Это не подтверждение всех ТТХ и данных карточки.'
        : 'Краткое описание по демонстрационному Робопорталу. Характеристики и применимость требуют подтверждения разработчиком.'}
    >
      {primary ? 'Описание: сайт разработчика' : 'Описание: вторичный источник'}
    </a>
  );
}
