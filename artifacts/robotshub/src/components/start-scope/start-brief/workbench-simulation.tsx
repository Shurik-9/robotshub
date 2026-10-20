import { useMemo, useState } from 'react';
import { Activity, AlertTriangle, RotateCcw } from 'lucide-react';
import type { SiteProcess } from '@/lib/start-processes';
import type { WorkbenchInputs } from '@/lib/start-workbench';
import { buildStartWorkbenchSimulation } from '@/lib/start-workbench-simulation';
import { SimCanvas } from '@/sim/SimCanvas';
import type { SimKpis } from '@/sim/sim-engine';
import { num } from './workbench-fields';

type Diag = Pick<SimKpis, 'tasksDone' | 'activeRobots' | 'queueLen' | 'elapsedSec'>;

const fmtTime = (s: number) => { const t = Math.max(0, Math.floor(s)); return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };

export default function WorkbenchSimulation({ objectId, process, inputs, hasErrors, children }: {
  objectId: string | null; process: SiteProcess; inputs: WorkbenchInputs | null; hasErrors: boolean; children?: React.ReactNode;
}) {
  const sig = inputs ? JSON.stringify([objectId, process.id, inputs]) : '';
  const sim = useMemo(() => inputs ? buildStartWorkbenchSimulation(objectId, process, inputs) : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sig]);
  const [run, setRun] = useState(0);
  const [firstSig] = useState(sig);
  const [diag, setDiag] = useState<{ key: string; d: Diag } | null>(null);
  const runKey = `${sig}#${run}`;
  const d = diag?.key === runKey ? diag.d : null;
  const ok = sim && sim.supported ? sim : null;
  const options = useMemo(() => ok ? { ...ok.options } : null, [ok]);

  return <section className="wbs" data-testid="workbench-simulation" aria-label="Живая модель маршрута">
    <div className="wbs-head">
      <div>
        <div className="sb-kicker"><Activity size={13} /> ЖИВАЯ МОДЕЛЬ МАРШРУТА</div>
        <p className="wbs-sub">Те же четыре параметра меняют и расчёт ниже, и движение роботов на схеме.</p>
      </div>
      {ok && <button type="button" className="of-secondary wbs-restart" onClick={() => setRun(r => r + 1)} data-testid="workbench-sim-restart"><RotateCcw size={15} /> Начать наблюдение заново</button>}
    </div>

    <div className="wbs-controls">{children}</div>

    {hasErrors || !inputs
      ? <div className="wbs-empty" role="alert" data-testid="workbench-sim-invalid"><AlertTriangle size={18} /> Исправьте ошибки ввода — модель остановлена, чтобы не показывать устаревший прогон.</div>
      : sim && !sim.supported
        ? <div className="wbs-empty" data-testid="workbench-sim-unsupported"><AlertTriangle size={18} /> <span><b>Схема для участка «{process.name}» не строится.</b> {sim.reason}</span></div>
        : ok && options && <>
          <div className="wbs-labels">
            <span><b>Формула</b> — мощность парка из темпа одного робота (допущение пользователя).</span>
            <span><b>Наблюдение</b> — что фактически успевают роботы на сгенерированном маршруте; скорость задаёт движок, не поле «темп».</span>
          </div>
          <div className="wbs-diag" data-testid="workbench-sim-diagnostics">
            <div><span>Выполнено рейсов</span><b data-testid="sim-tasks-done">{d ? num(d.tasksDone) : '—'}</b></div>
            <div><span>Роботов в работе</span><b data-testid="sim-active-robots">{d ? `${d.activeRobots} / ${ok.fleet.reduce((sum, entry) => sum + entry.count, 0)}` : '—'}</b></div>
            <div><span>Заданий в очереди</span><b data-testid="sim-queue">{d ? num(d.queueLen) : '—'}</b></div>
            <div><span>Время наблюдения</span><b data-testid="sim-elapsed">{d ? fmtTime(d.elapsedSec ?? 0) : '00:00'}</b></div>
          </div>
          <p className="wbs-note" data-testid="workbench-sim-restarted">{run > 0 || sig !== firstSig ? 'Наблюдение перезапущено с текущими параметрами. ' : ''}Короткий прогон — иллюстрация, не подтверждённая экономика и не сохраняется в задание.</p>
          {ok.fleet.length === 0 && <p className="sv-warn" data-testid="workbench-sim-zero">Парк — 0: рейсы не выполняются, мощность в расчёте равна нулю. Движок приостановлен и не накапливает очередь; нулевая очередь здесь не означает, что входящий поток обслужен.</p>}
          <div className="wbs-canvas">
            <SimCanvas key={runKey} scene={ok.scene} options={options} fleet={ok.fleet} seed={ok.seed} sceneKind="warehouse"
              onKpisChange={k => setDiag({ key: runKey, d: { tasksDone: k.tasksDone, activeRobots: k.activeRobots, queueLen: k.queueLen, elapsedSec: k.elapsedSec } })}
              title={`Схема: ${process.name}`} className="w-full h-full" />
          </div>
          {ok.assumptions.length > 0 && <details className="wb-adv"><summary>Допущения модели ({ok.assumptions.length})</summary>
            <ul className="wbs-assume">{ok.assumptions.map((a: string) => <li key={a}>{a}</li>)}</ul></details>}
        </>}
  </section>;
}
