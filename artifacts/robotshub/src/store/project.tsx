import { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import solutionsData from '@/data/solutions.json';
import { customBriefChanged, mergeCustomBrief, withoutOperationFields, type OperationKey } from '@/lib/operationEconomics';
import type { SceneGeometrySummary } from '@/sim/scene-builder';

export type ObjectType = 'warehouse' | 'airport' | 'medical' | 'custom' | null;

export interface ProjectState {
  objectType: ObjectType;
  sectorId: string | null;
  objectParams: Record<string, number | string | boolean>;
  selectedSolutions: string[];
  activeSolutionId: string | null;
  whatIfOverrides: Record<string, number>;
  assumptionsOverrides: Record<string, number>;
  simulationKpis: SimulationKpiSnapshot | null;
}

export interface SimulationKpiSnapshot {
  seed: number;
  signature: string;
  verticalTrips: number;
  geometry: SceneGeometrySummary | null;
  generatedAt?: string;
  sceneInputs?: SimulationSceneInputs;
  floorStats: {
    id: string;
    label: string;
    tasks: number;
    completed: number;
  }[];
}

export interface SimulationSceneInputs {
  sceneKind: string;
  areaM2: number | null;
  floors: number;
  rackRows: number;
  docks: number;
  chargeStations: number;
  elevatorIntegrationReady: boolean;
}

type SimulationSignatureState = Pick<
  ProjectState,
  'objectType' | 'objectParams' | 'selectedSolutions' | 'assumptionsOverrides'
>;

type SimulationSnapshotState = SimulationSignatureState & Pick<ProjectState, 'simulationKpis'>;

interface ProjectContextType {
  state: ProjectState;
  projectRecoveryNotice: boolean;
  projectStorageUnavailable: boolean;
  retryProjectStorage: () => void;
  setObjectType: (type: ObjectType) => void;
  setSectorId: (id: string | null) => void;
  updateObjectParams: (params: Record<string, number | string | boolean>) => void;
  toggleSolution: (id: string) => void;
  selectSolutionForCalculation: (id: string) => void;
  setActiveSolution: (id: string | null) => void;
  clearSelectedSolutions: () => void;
  setWhatIfOverrides: (overrides: Record<string, number>) => void;
  setAssumptionsOverrides: (overrides: Record<string, number>) => void;
  removeAssumptionsOverrides: (keys: string[]) => void;
  resetOperationInputs: (key: OperationKey) => void;
  setSimulationKpis: (snapshot: SimulationKpiSnapshot | null) => void;
  resetProject: () => void;
}

interface RestoredProject {
  state: ProjectState;
  recoveredFromCorruption: boolean;
  storageAvailable: boolean;
}

const defaultState: ProjectState = {
  objectType: null,
  sectorId: null,
  objectParams: {},
  selectedSolutions: [],
  activeSolutionId: null,
  whatIfOverrides: {},
  assumptionsOverrides: {},
  simulationKpis: null,
};

const PROJECT_RECOVERY_NOTICE_KEY = 'robotshub_project_recovery_notice';
const PROJECT_RECOVERY_CHANNEL_NAME = 'robotshub_project_recovery';

type ProjectPrimitive = number | string | boolean;

const objectTypes = new Set<Exclude<ObjectType, null>>([
  'warehouse',
  'airport',
  'medical',
  'custom',
]);
const solutionIds = new Set(solutionsData.items.map((solution) => solution.id));

function getProjectStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizePrimitiveRecord(value: unknown): Record<string, ProjectPrimitive> {
  if (!isRecord(value)) return {};

  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => (
      typeof entry === 'string'
      || typeof entry === 'boolean'
      || (typeof entry === 'number' && Number.isFinite(entry))
    )),
  ) as Record<string, ProjectPrimitive>;
}

function normalizeNumberRecord(value: unknown): Record<string, number> {
  if (!isRecord(value)) return {};

  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => (
      typeof entry === 'number' && Number.isFinite(entry)
    )),
  ) as Record<string, number>;
}

function isValidPrimitiveRecord(value: unknown): boolean {
  return isRecord(value) && Object.values(value).every((entry) => (
    typeof entry === 'string'
    || typeof entry === 'boolean'
    || (typeof entry === 'number' && Number.isFinite(entry))
  ));
}

function isValidNumberRecord(value: unknown): boolean {
  return isRecord(value)
    && Object.values(value).every((entry) => typeof entry === 'number' && Number.isFinite(entry));
}

function isValidSimulationSceneInputs(value: unknown): value is SimulationSceneInputs {
  if (!isRecord(value)) return false;

  const isFiniteNumber = (entry: unknown) => typeof entry === 'number' && Number.isFinite(entry);
  return typeof value.sceneKind === 'string'
    && (value.areaM2 === null || isFiniteNumber(value.areaM2))
    && isFiniteNumber(value.floors)
    && isFiniteNumber(value.rackRows)
    && isFiniteNumber(value.docks)
    && isFiniteNumber(value.chargeStations)
    && typeof value.elevatorIntegrationReady === 'boolean';
}

function isValidSimulationKpiSnapshot(value: unknown): value is SimulationKpiSnapshot {
  if (!isRecord(value)) return false;
  if (
    typeof value.seed !== 'number'
    || !Number.isFinite(value.seed)
    || typeof value.signature !== 'string'
    || typeof value.verticalTrips !== 'number'
    || !Number.isFinite(value.verticalTrips)
    || !Array.isArray(value.floorStats)
  ) {
    return false;
  }
  if (
    'generatedAt' in value
    && (typeof value.generatedAt !== 'string' || Number.isNaN(Date.parse(value.generatedAt)))
  ) {
    return false;
  }
  if ('sceneInputs' in value && !isValidSimulationSceneInputs(value.sceneInputs)) return false;

  return value.floorStats.every((floor) => (
    isRecord(floor)
    && typeof floor.id === 'string'
    && typeof floor.label === 'string'
    && typeof floor.tasks === 'number'
    && Number.isFinite(floor.tasks)
    && typeof floor.completed === 'number'
    && Number.isFinite(floor.completed)
  ));
}

export function getSimulationSignature(state: SimulationSignatureState): string {
  const sortRecord = (record: Record<string, unknown>) => (
    Object.fromEntries(Object.entries(record).sort(([left], [right]) => left.localeCompare(right)))
  );

  return JSON.stringify({
    objectType: state.objectType,
    objectParams: sortRecord(state.objectParams),
    selectedSolutions: state.selectedSolutions,
    assumptionsOverrides: sortRecord(state.assumptionsOverrides),
  });
}

export function getCurrentSimulationKpis(
  state: SimulationSnapshotState,
): SimulationKpiSnapshot | null {
  const snapshot = state.simulationKpis;
  return snapshot?.signature === getSimulationSignature(state) ? snapshot : null;
}

function isValidStoredProject(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;

  if (
    'objectType' in value
    && value.objectType !== null
    && (typeof value.objectType !== 'string'
      || !objectTypes.has(value.objectType as Exclude<ObjectType, null>))
  ) {
    return false;
  }
  if ('objectParams' in value && !isValidPrimitiveRecord(value.objectParams)) return false;
  if ('sectorId' in value && value.sectorId !== null
    && (typeof value.sectorId !== 'string' || !/^[\p{L}\p{N} _-]{1,80}$/u.test(value.sectorId))) return false;
  if (
    'selectedSolutions' in value
    && (!Array.isArray(value.selectedSolutions)
      || value.selectedSolutions.some((id) => typeof id !== 'string' || !solutionIds.has(id)))
  ) {
    return false;
  }
  if (
    'activeSolutionId' in value
    && value.activeSolutionId !== null
    && (typeof value.activeSolutionId !== 'string'
      || !Array.isArray(value.selectedSolutions)
      || !value.selectedSolutions.includes(value.activeSolutionId))
  ) {
    return false;
  }
  if ('whatIfOverrides' in value && !isValidNumberRecord(value.whatIfOverrides)) return false;
  if ('assumptionsOverrides' in value && !isValidNumberRecord(value.assumptionsOverrides)) return false;
  if ('simulationKpis' in value && value.simulationKpis !== null && !isValidSimulationKpiSnapshot(value.simulationKpis)) return false;

  return true;
}

export function normalizeProjectState(value: unknown): ProjectState {
  if (!isRecord(value)) return { ...defaultState };

  const selectedSolutions = Array.isArray(value.selectedSolutions)
    ? value.selectedSolutions.filter((id): id is string => (
      typeof id === 'string' && solutionIds.has(id)
    ))
    : [];
  const activeSolutionId = typeof value.activeSolutionId === 'string'
    && selectedSolutions.includes(value.activeSolutionId)
    ? value.activeSolutionId
    : selectedSolutions[0] ?? null;
  const objectType = typeof value.objectType === 'string' && objectTypes.has(value.objectType as Exclude<ObjectType, null>)
    ? value.objectType as Exclude<ObjectType, null>
    : null;
  const simulationKpis = isValidSimulationKpiSnapshot(value.simulationKpis)
    ? {
        seed: value.simulationKpis.seed,
        signature: value.simulationKpis.signature,
        verticalTrips: value.simulationKpis.verticalTrips,
        geometry: isValidSceneGeometrySummary(value.simulationKpis.geometry)
          ? value.simulationKpis.geometry
          : null,
        generatedAt: typeof value.simulationKpis.generatedAt === 'string'
          ? value.simulationKpis.generatedAt
          : undefined,
        sceneInputs: isValidSimulationSceneInputs(value.simulationKpis.sceneInputs)
          ? {
              sceneKind: value.simulationKpis.sceneInputs.sceneKind,
              areaM2: value.simulationKpis.sceneInputs.areaM2,
              floors: value.simulationKpis.sceneInputs.floors,
              rackRows: value.simulationKpis.sceneInputs.rackRows,
              docks: value.simulationKpis.sceneInputs.docks,
              chargeStations: value.simulationKpis.sceneInputs.chargeStations,
              elevatorIntegrationReady: value.simulationKpis.sceneInputs.elevatorIntegrationReady,
            }
          : undefined,
        floorStats: value.simulationKpis.floorStats.map((floor) => ({
          id: floor.id,
          label: floor.label,
          tasks: floor.tasks,
          completed: floor.completed,
        })),
      }
    : null;

  return {
    objectType,
    sectorId: typeof value.sectorId === 'string' && /^[\p{L}\p{N} _-]{1,80}$/u.test(value.sectorId)
      ? value.sectorId : null,
    objectParams: normalizePrimitiveRecord(value.objectParams),
    selectedSolutions,
    activeSolutionId,
    whatIfOverrides: normalizeNumberRecord(value.whatIfOverrides),
    assumptionsOverrides: normalizeNumberRecord(value.assumptionsOverrides),
    simulationKpis,
  };
}

function isValidSceneGeometrySummary(value: unknown): value is SceneGeometrySummary {
  if (!isRecord(value)) return false;
  const isFiniteNumber = (entry: unknown) => typeof entry === 'number' && Number.isFinite(entry);
  const isCategory = (entry: unknown, hasPerFloor: boolean) => (
    isRecord(entry)
    && typeof entry.applicable === 'boolean'
    && isFiniteNumber(entry.total)
    && (!hasPerFloor || isFiniteNumber(entry.perFloor))
  );

  return isFiniteNumber(value.floors)
    && isCategory(value.rows, true)
    && isCategory(value.posts, false)
    && isCategory(value.charges, true);
}

function restoreProject(): RestoredProject {
  const storage = getProjectStorage();
  if (!storage) {
    return {
      state: { ...defaultState },
      recoveredFromCorruption: false,
      storageAvailable: false,
    };
  }

  try {
    const saved = storage.getItem('robotshub_project');
    if (!saved) {
      return {
        state: { ...defaultState },
        recoveredFromCorruption: false,
        storageAvailable: true,
      };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(saved);
    } catch {
      return {
        state: { ...defaultState },
        recoveredFromCorruption: true,
        storageAvailable: true,
      };
    }

    let recoveryNoticeVisible = false;
    try {
      recoveryNoticeVisible = storage.getItem(PROJECT_RECOVERY_NOTICE_KEY) === '1';
    } catch {
      return {
        state: normalizeProjectState(parsed),
        recoveredFromCorruption: !isValidStoredProject(parsed),
        storageAvailable: false,
      };
    }

    return {
      state: normalizeProjectState(parsed),
      recoveredFromCorruption: !isValidStoredProject(parsed)
        || recoveryNoticeVisible,
      storageAvailable: true,
    };
  } catch {
    return {
      state: { ...defaultState },
      recoveredFromCorruption: false,
      storageAvailable: false,
    };
  }
}

const ProjectContext = createContext<ProjectContextType | undefined>(undefined);

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [restoredProject] = useState<RestoredProject>(restoreProject);
  const [state, setState] = useState<ProjectState>(restoredProject.state);
  const [projectRecoveryNotice, setProjectRecoveryNotice] = useState(
    restoredProject.recoveredFromCorruption,
  );
  const [projectStorageUnavailable, setProjectStorageUnavailable] = useState(
    !restoredProject.storageAvailable,
  );
  const recoveryChannelRef = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key === PROJECT_RECOVERY_NOTICE_KEY) {
        setProjectRecoveryNotice(event.newValue === '1');
        return;
      }

      if (event.key !== 'robotshub_project' || event.newValue === null) return;

      try {
        if (!isValidStoredProject(JSON.parse(event.newValue))) {
          setProjectRecoveryNotice(true);
        }
      } catch {
        setProjectRecoveryNotice(true);
      }
    };

    window.addEventListener('storage', handleStorage);

    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel(PROJECT_RECOVERY_CHANNEL_NAME);
      recoveryChannelRef.current = channel;
      channel.addEventListener('message', (event: MessageEvent<unknown>) => {
        if (!isRecord(event.data) || event.data.type !== 'project-recovery-notice') return;
        if (typeof event.data.visible !== 'boolean') return;
        setProjectRecoveryNotice(event.data.visible);
      });
    }

    return () => {
      window.removeEventListener('storage', handleStorage);
      recoveryChannelRef.current?.close();
      recoveryChannelRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (projectStorageUnavailable) return;

    try {
      const storage = getProjectStorage();
      if (!storage) {
        setProjectStorageUnavailable(true);
        return;
      }
      storage.setItem('robotshub_project', JSON.stringify(state));
    } catch {
      setProjectStorageUnavailable(true);
    }
  }, [projectStorageUnavailable, state]);

  useEffect(() => {
    if (projectStorageUnavailable) return;

    try {
      const storage = getProjectStorage();
      if (!storage) {
        setProjectStorageUnavailable(true);
        return;
      }
      if (projectRecoveryNotice) {
        storage.setItem(PROJECT_RECOVERY_NOTICE_KEY, '1');
      } else {
        storage.removeItem(PROJECT_RECOVERY_NOTICE_KEY);
      }
    } catch {
      setProjectStorageUnavailable(true);
    }

    try {
      recoveryChannelRef.current?.postMessage({
        type: 'project-recovery-notice',
        visible: projectRecoveryNotice,
      });
    } catch {
      // BroadcastChannel is optional; storage state remains the source of truth.
    }
  }, [projectRecoveryNotice, projectStorageUnavailable]);

  const clearProjectRecoveryNotice = () => {
    setProjectRecoveryNotice(false);
    if (projectStorageUnavailable) return;

    try {
      const storage = getProjectStorage();
      if (!storage) {
        setProjectStorageUnavailable(true);
        return;
      }
      storage.removeItem(PROJECT_RECOVERY_NOTICE_KEY);
    } catch {
      setProjectStorageUnavailable(true);
    }
  };

  const retryProjectStorage = () => {
    try {
      const storage = getProjectStorage();
      if (!storage) {
        setProjectStorageUnavailable(true);
        return;
      }

      storage.setItem('robotshub_project', JSON.stringify(state));
      if (projectRecoveryNotice) {
        storage.setItem(PROJECT_RECOVERY_NOTICE_KEY, '1');
      } else {
        storage.removeItem(PROJECT_RECOVERY_NOTICE_KEY);
      }
      setProjectStorageUnavailable(false);
    } catch {
      setProjectStorageUnavailable(true);
    }
  };

  const setObjectType = (type: ObjectType) => {
    setState((s) => s.objectType === type ? s : ({
      ...s, objectType: type, objectParams: {}, selectedSolutions: [], activeSolutionId: null,
      whatIfOverrides: {}, assumptionsOverrides: {}, simulationKpis: null,
    }));
  };

  const setSectorId = (id: string | null) => {
    setState((s) => s.sectorId === id ? s : ({
      ...s, sectorId: id,
      ...(id === null ? {} : {
        objectType: null, objectParams: {},
        selectedSolutions: [], activeSolutionId: null,
        whatIfOverrides: {}, assumptionsOverrides: {}, simulationKpis: null,
      }),
    }));
  };

  const updateObjectParams = (params: Record<string, number | string | boolean>) => {
    setState((s) => {
      const complete = s.objectType === 'custom' && ['site_name', 'task', 'constraints'].every(key => Object.hasOwn(params, key));
      const changed = s.objectType === 'custom' && customBriefChanged(s.objectParams, params, complete);
      return {
        ...s,
        objectParams: s.objectType === 'custom'
          ? mergeCustomBrief(s.objectParams, params, complete)
          : { ...s.objectParams, ...params },
        assumptionsOverrides: changed ? withoutOperationFields(s.assumptionsOverrides) : s.assumptionsOverrides,
        whatIfOverrides: changed ? {} : s.whatIfOverrides,
        simulationKpis: null,
      };
    });
  };

  const toggleSolution = (id: string) => {
    clearProjectRecoveryNotice();
    setState((s) => {
      const isSelected = s.selectedSolutions.includes(id);
      if (isSelected) {
        const selectedSolutions = s.selectedSolutions.filter((sid) => sid !== id);
        return {
          ...s,
          selectedSolutions,
          activeSolutionId: s.activeSolutionId === id
            ? selectedSolutions[0] ?? null
            : s.activeSolutionId,
          simulationKpis: null,
        };
      }
      return {
        ...s,
        selectedSolutions: [...s.selectedSolutions, id],
        activeSolutionId: s.activeSolutionId ?? id,
        simulationKpis: null,
      };
    });
  };

  const selectSolutionForCalculation = (id: string) => {
    clearProjectRecoveryNotice();
    setState((s) => ({
      ...s,
      objectType: s.objectType ?? 'custom',
      selectedSolutions: [id],
      activeSolutionId: id,
      simulationKpis: null,
    }));
  };

  const setActiveSolution = (id: string | null) => {
    setState((s) => (
      id === null || s.selectedSolutions.includes(id)
        ? { ...s, activeSolutionId: id }
        : s
    ));
  };

  const clearSelectedSolutions = () => {
    setState((s) => ({ ...s, selectedSolutions: [], activeSolutionId: null, simulationKpis: null }));
  };

  const setWhatIfOverrides = (overrides: Record<string, number>) => {
    setState((s) => ({ ...s, whatIfOverrides: { ...s.whatIfOverrides, ...overrides } }));
  };

  const setAssumptionsOverrides = (overrides: Record<string, number>) => {
    setState((s) => ({
      ...s,
      assumptionsOverrides: { ...s.assumptionsOverrides, ...overrides },
      simulationKpis: null,
    }));
  };

  const removeAssumptionsOverrides = (keys: string[]) => {
    setState((s) => ({
      ...s,
      assumptionsOverrides: Object.fromEntries(
        Object.entries(s.assumptionsOverrides).filter(([key]) => !keys.includes(key)),
      ),
      simulationKpis: null,
    }));
  };

  const resetOperationInputs = (key: OperationKey) => {
    setState((s) => ({
      ...s,
      objectParams: withoutOperationFields(s.objectParams, key),
      assumptionsOverrides: withoutOperationFields(s.assumptionsOverrides, key),
      whatIfOverrides: {},
      simulationKpis: null,
    }));
  };

  const setSimulationKpis = useCallback((snapshot: SimulationKpiSnapshot | null) => {
    setState((s) => {
      const next = snapshot && snapshot.signature === getSimulationSignature(s)
        ? snapshot
        : null;
      return s.simulationKpis === next ? s : { ...s, simulationKpis: next };
    });
  }, []);

  const resetProject = () => setState(defaultState);

  return (
    <ProjectContext.Provider
      value={{
        state,
        projectRecoveryNotice,
        projectStorageUnavailable,
        retryProjectStorage,
        setObjectType,
        setSectorId,
        updateObjectParams,
        toggleSolution,
        selectSolutionForCalculation,
        setActiveSolution,
        clearSelectedSolutions,
        setWhatIfOverrides,
        setAssumptionsOverrides,
        removeAssumptionsOverrides,
        resetOperationInputs,
        setSimulationKpis,
        resetProject,
      }}
    >
      {children}
    </ProjectContext.Provider>
  );
}

export function useProject() {
  const context = useContext(ProjectContext);
  if (context === undefined) {
    throw new Error('useProject must be used within a ProjectProvider');
  }
  return context;
}
