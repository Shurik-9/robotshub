import type { WbField } from './workbench-fields';

type Props = { field: WbField; unit: string; value: string; error?: string; onChange: (value: string) => void };

export default function WorkbenchField({ field, unit, value, error, onChange }: Props) {
  const n = Number(value.replace(',', '.'));
  const sMax = field.sliderMax ?? field.max;
  const sMin = field.min;
  const valid = value.trim() !== '' && Number.isFinite(n);
  const pos = valid ? Math.min(sMax, Math.max(sMin, n)) : sMin;
  const pct = ((pos - sMin) / (sMax - sMin || 1)) * 100;
  const u = field.unit.replace('{u}', unit);
  return <div className={`wb-field ${error ? 'bad' : ''}`}>
    <div className="wb-field-head">
      <label htmlFor={`wb-${field.key}`}>{field.label}</label>
      <span className="wb-num">
        <input id={`wb-${field.key}`} type="text" inputMode="decimal" value={value} placeholder={field.optional}
          aria-invalid={!!error} onChange={e => onChange(e.target.value)} data-testid={`workbench-input-${field.key}`} />
        <small>{u}</small>
      </span>
    </div>
    <input type="range" className="wb-range" min={sMin} max={sMax} step={field.step} value={pos}
      style={{ ['--p' as string]: `${pct}%` }} aria-label={`${field.label}, ползунок`}
      onChange={e => onChange(e.target.value)} />
    {error ? <small className="wb-err" role="alert">{error}</small> : field.hint && <small className="wb-hint">{field.hint}</small>}
  </div>;
}
