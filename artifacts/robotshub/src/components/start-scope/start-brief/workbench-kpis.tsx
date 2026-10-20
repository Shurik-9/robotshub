import type { calculateWorkbench } from '@/lib/start-workbench';
import { num, rubShort } from './workbench-fields';

type Result = ReturnType<typeof calculateWorkbench>;

export default function WorkbenchKpis({ result, unit }: { result: Result | null; unit: string }) {
  if (!result) return <div className="wb-kpis wb-kpis-off" data-testid="workbench-kpis-invalid">
    <p>Показатели скрыты: исправьте отмеченные параметры. Неверные значения не подменяются.</p>
  </div>;
  const capex = rubShort(result.capexRub);
  const net = rubShort(result.annualNetCashRub);
  return <div className="wb-kpis">
    <div className="wb-kpi hero" data-testid="workbench-kpi-fleet">
      <b>{result.robotCount}<em>шт.</em></b>
      <span>парк · нужно {result.requiredRobotCount}</span>
      <small>Мощность {num(result.capacityPerHour)}; нужно с резервом {num(result.peakDemandPerHour)} {unit}. Средний поток покрыт на {num(result.coveragePct)}%.</small>
    </div>
    <div className="wb-kpi" data-testid="workbench-kpi-capex">
      <b>{capex.v}<em>{capex.u}</em></b><span>вложения (CAPEX)</span>
      <small>OPEX {rubShort(result.opexAnnualRub).v} {rubShort(result.opexAnnualRub).u}/год</small>
    </div>
    <div className={`wb-kpi ${result.annualNetCashRub <= 0 ? 'neg' : ''}`} data-testid="workbench-kpi-net">
      <b>{net.v}<em>{net.u}</em></b><span>чистая экономия в год</span>
      <small>валовая {rubShort(result.annualGrossCashRub).v} {rubShort(result.annualGrossCashRub).u} − OPEX</small>
    </div>
    <div className={`wb-kpi ${result.paybackYears == null ? 'neg' : ''}`} data-testid="workbench-kpi-payback">
      <b>{result.paybackYears == null ? 'нет' : num(result.paybackYears)}<em>{result.paybackYears == null ? '' : 'лет'}</em></b>
      <span>простая окупаемость</span>
      <small>{result.paybackYears == null ? (result.meetsDemand ? 'экономия не покрывает OPEX' : 'парк не покрывает нагрузку') : 'CAPEX ÷ чистая экономия'}</small>
    </div>
  </div>;
}
