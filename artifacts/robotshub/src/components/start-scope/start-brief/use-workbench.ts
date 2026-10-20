import { useEffect, useMemo, useRef, useState } from 'react';
import type { SiteProcess } from '@/lib/start-processes';
import type { StartScopeDraft } from '@/lib/start-scope';
import { parseStartValueInputs } from '@/lib/start-value';
import {
  approveWorkbenchPlan, calculateWorkbench, createWorkbenchPlan, isWorkbenchApproved, parseWorkbenchInputs,
  parseWorkbenchPlan, updateWorkbenchVariant, workbenchContext, type WorkbenchPlan,
} from '@/lib/start-workbench';
import { parseTexts, toTexts, type WbKey, type WbTexts } from './workbench-fields';

export const MAX_VARIANTS = 6;

function planFor(draft: StartScopeDraft, id: string | undefined): WorkbenchPlan {
  const stored = id ? draft.workbenchPlans?.[id] : undefined;
  const parsed = stored ? parseWorkbenchPlan(stored) : null;
  if (parsed) return parsed;
  const legacyRaw = id ? draft.valueScenarios?.[id] : undefined;
  const legacy = legacyRaw ? parseStartValueInputs(legacyRaw) ?? undefined : undefined;
  return createWorkbenchPlan(legacy);
}
const textsFor = (plan: WorkbenchPlan) => Object.fromEntries(plan.variants.map(v => [v.id, toTexts(v.inputs)])) as Record<string, WbTexts>;
const strip = (p: WorkbenchPlan): WorkbenchPlan => { const { approval: _a, ...rest } = p; void _a; return rest; };

export function useWorkbench(draft: StartScopeDraft, focus: SiteProcess | null, onChange?: (processId: string, plan: WorkbenchPlan) => void) {
  const [plan, setPlan] = useState<WorkbenchPlan>(() => planFor(draft, focus?.id));
  const [texts, setTexts] = useState<Record<string, WbTexts>>(() => textsFor(plan));
  const [touched, setTouched] = useState(false);
  const lastEmitted = useRef<string>('');
  const lastValid = useRef(plan);
  const onChangeRef = useRef(onChange); onChangeRef.current = onChange;
  const incoming = JSON.stringify(focus?.id
    ? draft.workbenchPlans?.[focus.id] ?? { legacy: draft.valueScenarios?.[focus.id] ?? null }
    : null);

  // Reset on process switch or external plan change (e.g. same-page hash navigation), not on own echo.
  const lastFocus = useRef(focus?.id);
  useEffect(() => {
    if (lastFocus.current === focus?.id && incoming === lastEmitted.current) return;
    lastFocus.current = focus?.id;
    const next = planFor(draft, focus?.id);
    lastValid.current = next;
    lastEmitted.current = incoming;
    setPlan(next); setTexts(textsFor(next)); setTouched(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.id, incoming]);

  const commit = (next: WorkbenchPlan) => {
    setPlan(next); setTouched(true);
    if (focus && onChangeRef.current) {
      const valid = parseWorkbenchPlan(next);
      // Keep an empty name editable, but never persist an unreadable plan.
      const saved = valid ?? strip(lastValid.current);
      if (valid) lastValid.current = valid;
      lastEmitted.current = JSON.stringify(saved);
      onChangeRef.current(focus.id, saved);
    }
  };

  const parsed = useMemo(() => Object.fromEntries(plan.variants.map(v => [v.id, parseTexts(texts[v.id] ?? toTexts(v.inputs), parseWorkbenchInputs)])), [plan.variants, texts]);
  const results = useMemo(() => Object.fromEntries(plan.variants.map(v => [v.id, parsed[v.id]?.inputs ? calculateWorkbench(parsed[v.id].inputs!) : null])), [plan.variants, parsed]);
  const allValid = !!parseWorkbenchPlan(plan) && plan.variants.every(v => !!parsed[v.id]?.inputs);
  const selected = plan.variants.find(v => v.id === plan.selectedId) ?? plan.variants[0];
  const context = focus ? workbenchContext(draft, focus) : '';
  const approved = allValid && !!focus && isWorkbenchApproved(plan, context);

  const edit = (key: WbKey, value: string) => {
    if (!selected) return;
    const vt = { ...(texts[selected.id] ?? toTexts(selected.inputs)), [key]: value };
    setTexts(t => ({ ...t, [selected.id]: vt }));
    const p = parseTexts(vt, parseWorkbenchInputs);
    commit(p.inputs ? updateWorkbenchVariant(plan, selected.id, p.inputs) : strip(plan));
  };
  const select = (id: string) => commit(strip({ ...plan, selectedId: id }));
  const copy = () => {
    if (!selected || plan.variants.length >= MAX_VARIANTS) return;
    const src = parsed[selected.id]?.inputs ?? selected.inputs;
    const id = `v${Date.now().toString(36)}${plan.variants.length}`;
    const name = `${selected.name} — копия`.slice(0, 60);
    setTexts(t => ({ ...t, [id]: { ...(t[selected.id] ?? toTexts(src)) } }));
    commit(strip({ ...plan, selectedId: id, variants: [...plan.variants, { id, name, inputs: { ...src } }] }));
  };
  const rename = (id: string, name: string) => commit(strip({ ...plan, variants: plan.variants.map(v => v.id === id ? { ...v, name } : v) }));
  const remove = (id: string) => {
    if (plan.variants.length <= 1) return;
    const variants = plan.variants.filter(v => v.id !== id);
    commit(strip({ ...plan, variants, selectedId: plan.selectedId === id ? variants[0].id : plan.selectedId }));
  };
  const approve = () => { if (focus && allValid) commit(approveWorkbenchPlan(plan, context)); };

  return { plan, texts, parsed, results, allValid, selected, approved, touched, edit, select, copy, rename, remove, approve };
}
