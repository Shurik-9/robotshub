import solutions from '../data/solutions.json' with { type: 'json' };
import warehouse from '../data/object-templates/warehouse.json' with { type: 'json' };
import airport from '../data/object-templates/airport.json' with { type: 'json' };
import medical from '../data/object-templates/medical.json' with { type: 'json' };
import type { FinancingScenario, ObjectType } from '../store/project.tsx';
import { deflateSync, inflateSync } from 'fflate';

type Primitive = string | number | boolean;
type Payload = {
  v: 1;
  demoProject?: boolean;
  objectType: Exclude<ObjectType, null>;
  params: Record<string, Primitive>;
  solutions: string[];
  activeSolution: string | null;
  sectorId: string | null;
  assumptions: Record<string, number>;
  whatIf: Record<string, number>;
  financing: FinancingScenario;
};

const templates = { warehouse, airport, medical } as const;
const solutionIds = new Set(solutions.items.map(item => item.id));
const MAX_SHARED_URL_LENGTH = 8000;
const MAX_SHARED_TOKEN_LENGTH = 7600;
const MAX_SHARED_PAYLOAD_BYTES = 64 * 1024;
export const ROBOTSHUB_PUBLIC_ORIGIN = 'https://robotshub.ru';

function defaultsFor(type: Payload['objectType']): Record<string, Primitive> {
  if (type === 'custom') return {};
  const template = templates[type];
  return Object.fromEntries(template.groups.flatMap(group =>
    group.fields.map(field => [field.key, field.base]),
  ));
}

function encodeBytesBase64Url(bytes: Uint8Array) {
  let binary = '';
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function decodeBytesBase64Url(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
    const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
    return Uint8Array.from(binary, character => character.charCodeAt(0));
  } catch {
    return null;
  }
}

function base64UrlEncode(value: string) {
  const compressed = deflateSync(new TextEncoder().encode(value), { level: 9 });
  return `z.${encodeBytesBase64Url(compressed)}`;
}

function base64UrlDecode(value: string) {
  const compressed = value.startsWith('z.');
  const bytes = decodeBytesBase64Url(compressed ? value.slice(2) : value);
  if (!bytes) return null;
  try {
    const decoded = compressed
      ? inflateSync(bytes, { out: new Uint8Array(MAX_SHARED_PAYLOAD_BYTES) })
      : bytes;
    if (compressed && decoded.length >= MAX_SHARED_PAYLOAD_BYTES) return null;
    return new TextDecoder('utf-8', { fatal: true }).decode(decoded);
  } catch {
    return null;
  }
}

export function createProjectSharePayload(state: {
  objectType: ObjectType;
  sectorId: string | null;
  objectParams: Record<string, Primitive>;
  selectedSolutions: string[];
  activeSolutionId: string | null;
  assumptionsOverrides: Record<string, number>;
  whatIfOverrides: Record<string, number>;
  financingScenario: FinancingScenario;
  demoProject?: boolean;
}): Payload {
  if (!state.objectType || state.selectedSolutions.length === 0) {
    throw new Error('Для ссылки выберите объект и хотя бы одно решение.');
  }
  const defaults = defaultsFor(state.objectType);
  const params = Object.fromEntries(Object.entries(state.objectParams).filter(
    ([key, value]) => !Object.hasOwn(defaults, key) || !Object.is(defaults[key], value),
  ));
  return {
    v: 1,
    objectType: state.objectType,
    params,
    solutions: state.selectedSolutions.filter(id => solutionIds.has(id)),
    activeSolution: state.activeSolutionId && solutionIds.has(state.activeSolutionId)
      ? state.activeSolutionId
      : state.selectedSolutions[0] ?? null,
    sectorId: state.sectorId,
    assumptions: state.assumptionsOverrides,
    whatIf: state.whatIfOverrides,
    financing: state.financingScenario,
    ...(state.demoProject ? { demoProject: true } : {}),
  };
}

export function encodeProjectShare(state: Parameters<typeof createProjectSharePayload>[0]) {
  const payload = base64UrlEncode(JSON.stringify(createProjectSharePayload(state)));
  if (payload.length > MAX_SHARED_TOKEN_LENGTH) {
    throw new Error('Ссылка получилась длиннее 8 000 символов. Уменьшите число дополнительных параметров.');
  }
  if (!decodeProjectShare(payload)) {
    throw new Error('Не удалось упаковать расчёт. Выберите не более 20 действующих решений и проверьте параметры объекта.');
  }
  return payload;
}

export function decodeProjectShare(encoded: string) {
  if (
    !encoded
    || encoded.length > MAX_SHARED_TOKEN_LENGTH
    || !(encoded.startsWith('z.')
      ? /^z\.[A-Za-z0-9_-]+$/.test(encoded)
      : /^[A-Za-z0-9_-]+$/.test(encoded))
  ) return null;
  try {
    const decoded = base64UrlDecode(encoded);
    if (!decoded) return null;
    const value: unknown = JSON.parse(decoded);
    if (!value || typeof value !== 'object') return null;
    const raw = value as Partial<Payload> & {
      solutionIds?: string[];
      activeSolutionId?: string | null;
      assumptionsOverrides?: Record<string, number>;
      whatIfOverrides?: Record<string, number>;
      financingScenario?: FinancingScenario;
    };
    const data: Partial<Payload> = {
      ...raw,
      solutions: raw.solutions ?? raw.solutionIds,
      activeSolution: raw.activeSolution ?? raw.activeSolutionId,
      assumptions: raw.assumptions ?? raw.assumptionsOverrides,
      whatIf: raw.whatIf ?? raw.whatIfOverrides,
      financing: raw.financing ?? raw.financingScenario,
    };
    if (data.v !== 1 || !data.objectType || !['warehouse', 'airport', 'medical', 'custom'].includes(data.objectType)) return null;
    if ('demoProject' in data && typeof data.demoProject !== 'boolean') return null;
    if (!Array.isArray(data.solutions) || data.solutions.length === 0 || data.solutions.length > 20
      || data.solutions.some(id => typeof id !== 'string' || !solutionIds.has(id))) return null;
    const validRecord = (record: unknown): record is Record<string, Primitive> =>
      !!record && typeof record === 'object' && !Array.isArray(record)
      && Object.values(record).every(entry => typeof entry === 'string' || typeof entry === 'boolean'
        || (typeof entry === 'number' && Number.isFinite(entry)));
    const validNumbers = (record: unknown): record is Record<string, number> =>
      !!record && typeof record === 'object' && !Array.isArray(record)
      && Object.values(record).every(entry => typeof entry === 'number' && Number.isFinite(entry));
    if (!validRecord(data.params) || !validNumbers(data.assumptions) || !validNumbers(data.whatIf)) return null;
    if (!['purchase', 'leasing', 'raas'].includes(String(data.financing))) return null;
    const objectParams = { ...defaultsFor(data.objectType), ...data.params };
    if (Object.keys(objectParams).length > 100 || JSON.stringify(objectParams).length > 6000) return null;
    return {
      ...(data.demoProject ? { demoProject: true } : {}),
      objectType: data.objectType,
      objectParams,
      selectedSolutions: [...new Set(data.solutions)],
      activeSolutionId: typeof data.activeSolution === 'string' && data.solutions.includes(data.activeSolution)
        ? data.activeSolution
        : data.solutions[0],
      sectorId: typeof data.sectorId === 'string' ? data.sectorId : null,
      assumptionsOverrides: data.assumptions,
      whatIfOverrides: data.whatIf,
      financingScenario: data.financing,
      simulationKpis: null,
    };
  } catch {
    return null;
  }
}

export type ShareableProjectState = {
  demoProject?: boolean;
  objectType: ObjectType;
  sectorId: string | null;
  objectParams: Record<string, Primitive>;
  selectedSolutions: string[];
  activeSolutionId?: string | null;
  assumptionsOverrides: Record<string, number>;
  whatIfOverrides: Record<string, number>;
  financingScenario?: FinancingScenario;
};

function normalizeShareableState(state: ShareableProjectState) {
  return {
    ...state,
    activeSolutionId: state.activeSolutionId ?? state.selectedSolutions[0] ?? null,
    financingScenario: state.financingScenario ?? 'purchase',
  };
}

export function createSharedCalculationPayload(state: ShareableProjectState) {
  const payload = createProjectSharePayload(normalizeShareableState(state));
  return {
    v: payload.v,
    ...(payload.demoProject ? { demoProject: true } : {}),
    objectType: payload.objectType,
    sectorId: payload.sectorId,
    params: payload.params,
    solutionIds: payload.solutions,
    activeSolutionId: payload.activeSolution,
    assumptionsOverrides: payload.assumptions,
    whatIfOverrides: payload.whatIf,
    financingScenario: payload.financing,
  };
}

export function decodeSharedCalculation(encoded: string | null | undefined) {
  return encoded ? decodeProjectShare(encoded) : null;
}

export function createProjectShareUrl(
  state: Parameters<typeof createProjectSharePayload>[0],
  origin = ROBOTSHUB_PUBLIC_ORIGIN,
  basePath = import.meta.env.BASE_URL,
) {
  const baseSegments = basePath.split('/').filter(Boolean).join('/');
  const normalizedBase = baseSegments ? `/${baseSegments}/` : '/';
  const url = new URL(`${normalizedBase}calc`, origin);
  url.searchParams.set('p', encodeProjectShare(state));
  if (url.toString().length > MAX_SHARED_URL_LENGTH) {
    throw new Error('Ссылка получилась длиннее 8 000 символов. Уменьшите число дополнительных параметров.');
  }
  return url.toString();
}

export function createSharedCalculationUrl(
  state: ShareableProjectState,
  origin = ROBOTSHUB_PUBLIC_ORIGIN,
  basePath = import.meta.env.BASE_URL,
) {
  return createProjectShareUrl(normalizeShareableState(state), origin, basePath);
}

export function restoreSharedCalculationFromSearch(search: string) {
  return decodeSharedCalculation(new URLSearchParams(search).get('p'));
}

export const SHARED_CALCULATION_MAX_URL_LENGTH = MAX_SHARED_URL_LENGTH;
