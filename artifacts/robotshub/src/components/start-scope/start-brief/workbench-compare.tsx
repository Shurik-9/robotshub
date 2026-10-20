import { calculateWorkbench, type WorkbenchPlan } from '@/lib/start-workbench';
import { num, rubShort } from './workbench-fields';

type Props = { plan: WorkbenchPlan; validInputs: Record<string, ReturnType<typeof calculateWorkbench> | null>; unit: string };

export default function WorkbenchCompare({ plan, validInputs, unit }: Props) {
  if (plan.variants.length < 2) return <p className="sb-muted wb-compare-empty" data-testid="workbench-compare">Создайте копию варианта, чтобы сравнить сценарии бок о бок.</p>;
  const money = (n: number) => { const r = rubShort(n); return `${r.v} ${r.u}`; };
  return <div className="wb-compare" data-testid="workbench-compare">
    {plan.variants.map(v => {
      const r = validInputs[v.id];
      return <div key={v.id} className={`wb-cmp ${v.id === plan.selectedId ? 'sel' : ''}`}>
        <strong>{v.name}{v.id === plan.selectedId && <span> · выбран</span>}</strong>
        {r ? <dl>
          <div><dt>Нагрузка</dt><dd>{num(v.inputs.loadPerHour)} {unit}</dd></div>
          <div><dt>Парк / средний поток</dt><dd>{r.robotCount} шт. / {num(r.coveragePct)}%</dd></div>
          <div><dt>CAPEX</dt><dd>{money(r.capexRub)}</dd></div>
          <div><dt>Чистая экономия</dt><dd>{money(r.annualNetCashRub)}/год</dd></div>
          <div><dt>Окупаемость</dt><dd>{r.paybackYears == null ? 'нет' : `${num(r.paybackYears)} лет`}</dd></div>
          <div><dt>Стоимость владения</dt><dd>{money(r.tcoRub)}</dd></div>
        </dl> : <p className="wb-err">Есть ошибки ввода</p>}
      </div>;
    })}
  </div>;
}
