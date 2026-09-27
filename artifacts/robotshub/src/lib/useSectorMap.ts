import { useEffect, useState } from 'react';

export interface MapSector {
  id: string;
  label: string;
  n: number;
  op: number;
  pil: number;
  rnd: number;
  color: string;
  thematic?: boolean;
  uniqueModels?: number;
  records?: string[];
  sourceNote?: string;
  mix: { name: string; n: number }[];
  ex: { name: string; text: string; vendor: string }[];
}

declare global {
  interface Window {
    MAP_EXTRA_SECTORS?: (base: { apps: unknown[] }) => MapSector[];
  }
}

let sectorsPromise: Promise<MapSector[]> | null = null;
let scriptPromise: Promise<void> | null = null;

function loadExtraSectors(): Promise<void> {
  if (window.MAP_EXTRA_SECTORS) return Promise.resolve();
  if (!scriptPromise) {
    scriptPromise = new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = `${import.meta.env.BASE_URL}map/extra-sectors.js`;
      script.onload = () => window.MAP_EXTRA_SECTORS
        ? resolve()
        : reject(new Error('Список тематических направлений недоступен'));
      script.onerror = () => reject(new Error('Не удалось загрузить направления карты'));
      document.head.appendChild(script);
    }).catch(error => {
      scriptPromise = null;
      throw error;
    });
  }
  return scriptPromise!;
}

export function loadMapSectors(): Promise<MapSector[]> {
  if (!sectorsPromise) {
    sectorsPromise = (async () => {
      const response = await fetch(`${import.meta.env.BASE_URL}map/map-data.json`);
      if (!response.ok) throw new Error('Не удалось загрузить отрасли карты');
      const base = await response.json() as { industries: MapSector[]; apps: unknown[] };
      await loadExtraSectors();
      if (!window.MAP_EXTRA_SECTORS) throw new Error('Нет данных тематических направлений');
      return [...base.industries, ...window.MAP_EXTRA_SECTORS(base)];
    })().catch(error => {
      sectorsPromise = null;
      throw error;
    });
  }
  return sectorsPromise;
}

export function useSectorMap() {
  const [sectors, setSectors] = useState<MapSector[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let mounted = true;
    loadMapSectors().then(
      data => { if (mounted) setSectors(data); },
      reason => { if (mounted) setError(reason instanceof Error ? reason.message : 'Не удалось загрузить карту'); },
    );
    return () => { mounted = false; };
  }, []);
  return { sectors, error };
}

export function sectorCatalogPath(sector: MapSector) {
  if (!sector.thematic) return `/solutions?industry=${encodeURIComponent(sector.id)}`;
  const ids = [...new Set((sector.records ?? []).map(record => record.split('|')[0]))];
  return `/solutions?sector=${encodeURIComponent(sector.id)}&ids=${encodeURIComponent(ids.join(','))}`;
}