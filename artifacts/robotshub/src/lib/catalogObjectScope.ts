import { getSolutionTaxonomy } from './solutionTaxonomy.ts';

type CatalogVariant = Parameters<typeof getSolutionTaxonomy>[0];

/** Match evidence on one record, never combine the area of one variant with another's operation. */
export function matchesWarehouseCatalog(variants: CatalogVariant[]): boolean {
  return variants.some(variant => {
    const tax = getSolutionTaxonomy(variant);
    if (tax.areaIds.includes('air') || tax.areaIds.includes('water')) return false;
    const warehouseOperations = ['transport', 'handling', 'sorting', 'inventory', 'production', 'clean_indoor'];
    if (!warehouseOperations.includes(tax.operationId)) return false;
    const cleaningDescription = [variant.name, variant.subtype, variant.scenario, variant.description].filter(Boolean).join(' ').toLowerCase();
    const floorCleaning = /поломо|пылесос|уборк.{0,20}(помещен|пол)|мойк.{0,12}пол|мыть.{0,12}пол/.test(cleaningDescription);
    return tax.areaIds.includes('warehouse')
      || (tax.operationId === 'clean_indoor' && floorCleaning &&
        tax.areaIds.some(area => ['indoor', 'production', 'public'].includes(area)));
  });
}

/** Warehouse logistics precedes auxiliary floor cleaning; this is relevance, not a technical fitness score. */
export function warehouseCatalogPriority(variants: CatalogVariant[]): number {
  return variants.some(variant =>
    matchesWarehouseCatalog([variant]) && getSolutionTaxonomy(variant).operationId !== 'clean_indoor',
  ) ? 0 : 1;
}
