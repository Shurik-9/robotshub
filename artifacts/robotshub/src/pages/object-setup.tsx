import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'wouter';
import { useForm } from 'react-hook-form';
import { ArrowLeft, ArrowRight, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Form } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useSectorMap, sectorCatalogPath } from '@/lib/useSectorMap';
import { useProject } from '@/store/project';
import warehouseTemplate from '@/data/object-templates/warehouse.json';
import airportTemplate from '@/data/object-templates/airport.json';
import medicalTemplate from '@/data/object-templates/medical.json';

type Field = { key: string; label: string; type: string; base: string | number | boolean; unit?: string; min?: number; max?: number; note?: string; options?: string[] };
type Template = { name: string; groups: { id: string; name: string; fields: Field[] }[] };
type Params = Record<string, string | number | boolean>;
const templates: Record<string, Template> = { warehouse: warehouseTemplate, airport: airportTemplate, medical: medicalTemplate };

function CustomSite({ initial, onSave }: { initial: Params; onSave: (data: Params) => void }) {
  const form = useForm<{ site_name: string; task: string; site_area_m2: string; shifts_per_day: string; constraints: string }>({
    defaultValues: {
      site_name: String(initial.site_name ?? ''),
      task: String(initial.task ?? ''),
      site_area_m2: initial.site_area_m2 == null ? '' : String(initial.site_area_m2),
      shifts_per_day: initial.shifts_per_day == null ? '' : String(initial.shifts_per_day),
      constraints: String(initial.constraints ?? ''),
    },
  });
  const submit = form.handleSubmit(values => onSave({
    site_name: values.site_name.trim(),
    task: values.task.trim(),
    ...(values.site_area_m2 ? { site_area_m2: Number(values.site_area_m2) } : {}),
    ...(values.shifts_per_day ? { shifts_per_day: Number(values.shifts_per_day) } : {}),
    constraints: values.constraints.trim(),
  }));
  return <Form {...form}><form onSubmit={submit} className="space-y-6" data-testid="custom-object-form">
    <Card>
      <CardHeader><CardTitle>Исследовательский бриф площадки</CardTitle><CardDescription>Только ваши фактические данные. Базовые значения для нестандартного объекта не подставляются.</CardDescription></CardHeader>
      <CardContent className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-2 sm:col-span-2"><Label htmlFor="site-name">Название объекта</Label><Input id="site-name" placeholder="Например, корпус сборки № 2" required maxLength={120} {...form.register('site_name')} data-testid="input-site-name" /></div>
        <div className="space-y-2 sm:col-span-2"><Label htmlFor="site-task">Задача робота</Label><Textarea id="site-task" placeholder="Что именно нужно перемещать, контролировать или обслуживать?" required rows={3} maxLength={1000} {...form.register('task')} data-testid="input-site-task" /></div>
        <div className="space-y-2"><Label htmlFor="site-area">Площадь площадки, м²</Label><Input id="site-area" type="number" inputMode="decimal" min="0.01" step="any" placeholder="Если известна" {...form.register('site_area_m2')} data-testid="input-site-area" /></div>
        <div className="space-y-2"><Label htmlFor="site-shifts">Смен в сутки</Label><Input id="site-shifts" type="number" inputMode="numeric" min="1" max="4" step="1" placeholder="Если известно" {...form.register('shifts_per_day')} data-testid="input-site-shifts" /></div>
        <div className="space-y-2 sm:col-span-2"><Label htmlFor="site-constraints">Ограничения и условия</Label><Textarea id="site-constraints" rows={3} placeholder="Ширина проходов, покрытие, безопасность, интеграции и другие известные условия" maxLength={1500} {...form.register('constraints')} data-testid="input-site-constraints" /></div>
      </CardContent>
    </Card>
    <p className="rounded-md border border-accent/40 bg-accent/5 p-4 text-sm leading-6" data-testid="status-custom-brief">Это исследовательский бриф, а не исходные данные для ТЭО. Для четырёх поддерживаемых операций отдельный расчёт откроется после выбора подходящей модели в каталоге; в нём потребуются измерения площадки и финансовые документы. Для остальных задач расчёт недоступен.</p>
    <div className="flex justify-end"><Button type="submit" size="lg" className="w-full sm:w-auto" data-testid="object-submit">Сохранить бриф и перейти в каталог<ArrowRight className="ml-2 h-4 w-4" /></Button></div>
  </form></Form>;
}

function TemplateSite({ template, initial, onSave, onProgress }: { template: Template; initial: Params; onSave: (data: Params) => void; onProgress: (data: Params) => void }) {
  const [activeGroup, setActiveGroup] = useState(0);
  const [openEnumKey, setOpenEnumKey] = useState<string | null>(null);
  const defaults = useMemo(() => Object.fromEntries(template.groups.flatMap(group => group.fields.map(field => [field.key, field.base]))), [template]);
  const form = useForm<Params>({ defaultValues: { ...defaults, ...initial }, shouldUnregister: false });

  useEffect(() => {
    if (!openEnumKey) return;
    const frame = window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>('[role="listbox"] [role="option"][data-state="checked"]')?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [openEnumKey]);

  const advance = form.handleSubmit(data => {
    onProgress(data);
    if (activeGroup < template.groups.length - 1) {
      setActiveGroup(previous => previous + 1);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else onSave(data);
  });

  return <div className="flex min-w-0 flex-col gap-8 md:flex-row">
    <aside className="w-full shrink-0 md:w-64">
      <h2 className="mb-2 text-lg font-bold">{template.name}</h2>
      <p className="mb-4 text-xs leading-5 text-muted-foreground">Параметры шаблона заполнены типовыми значениями. Проверьте их по своей площадке перед расчётом.</p>
      <div className="flex gap-2 overflow-x-auto pb-3 md:flex-col md:overflow-visible" data-testid="object-groups">
        {template.groups.map((group, index) => <button type="button" key={group.id} onClick={() => setActiveGroup(index)} aria-current={activeGroup === index ? 'step' : undefined} data-testid={`object-group-${group.id}`}
          className={`whitespace-nowrap rounded-md px-4 py-2 text-left text-sm font-medium transition-colors ${activeGroup === index ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary hover:text-foreground'}`}>{String(index + 1).padStart(2, '0')} / {group.name}</button>)}
      </div>
    </aside>
    <div className="min-w-0 flex-1"><Form {...form}><form onSubmit={advance} className="min-w-0 space-y-6" data-testid="object-setup-form">
      <Card className="min-w-0 max-w-full" data-testid="object-setup-card">
        <CardHeader><p className="font-mono text-xs text-primary">Группа {activeGroup + 1} из {template.groups.length}</p><CardTitle>{template.groups[activeGroup].name}</CardTitle><CardDescription>Уточните значения для вашей площадки. Типовые значения — ориентир, а не подтверждённые данные.</CardDescription></CardHeader>
        <CardContent className="space-y-6">
          {template.groups[activeGroup].fields.map(field => <div key={field.key} className="space-y-2" data-testid={`object-field-${field.key}`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <Label htmlFor={`field-${field.key}`} className="flex min-w-0 flex-1 items-start gap-2 font-semibold leading-snug">{field.label}
                {field.note && <Tooltip><TooltipTrigger type="button" aria-label={`Пояснение: ${field.label}`} data-testid={`button-field-info-${field.key}`}><Info className="h-4 w-4 shrink-0 text-muted-foreground" /></TooltipTrigger><TooltipContent side="bottom" className="max-w-[calc(100vw-2rem)] break-words text-xs">{field.note}</TooltipContent></Tooltip>}
              </Label>
              {field.unit && <span className="shrink-0 font-mono text-xs text-muted-foreground">{field.unit}</span>}
            </div>
            {field.type === 'number' || field.type === 'int' ? <div>
              <Input id={`field-${field.key}`} type="number" inputMode={field.type === 'int' ? 'numeric' : 'decimal'} step={field.type === 'int' ? '1' : 'any'} min={field.min} max={field.max} {...form.register(field.key, { valueAsNumber: true })} className="bg-secondary/30 font-mono" data-testid={`input-object-${field.key}`} />
              <div className="mt-1 flex flex-wrap justify-between gap-2 text-[10px] text-muted-foreground"><span>Мин.: {field.min}</span><span>Макс.: {field.max}</span></div>
            </div> : field.type === 'text' ? <Input id={`field-${field.key}`} {...form.register(field.key)} className="bg-secondary/30 font-mono" data-testid={`input-object-${field.key}`} />
              : field.type === 'bool' ? <div className="flex h-10 items-center"><Switch id={`field-${field.key}`} checked={Boolean(form.watch(field.key))} onCheckedChange={value => form.setValue(field.key, value)} data-testid={`switch-object-${field.key}`} /></div>
              : field.type === 'enum' ? <Select value={String(form.watch(field.key) || '')} open={openEnumKey === field.key} onOpenChange={open => setOpenEnumKey(open ? field.key : null)} onValueChange={value => form.setValue(field.key, value)}>
                <SelectTrigger id={`field-${field.key}`} className="bg-secondary/30" data-testid={`select-object-${field.key}`}><SelectValue /></SelectTrigger>
                <SelectContent>{field.options?.map(option => <SelectItem key={option} value={option}>{option}</SelectItem>)}</SelectContent>
              </Select> : null}
          </div>)}
        </CardContent>
      </Card>
      <div className="flex justify-end">
        <Button type="submit" size="lg" className="w-full sm:w-auto" data-testid={activeGroup === template.groups.length - 1 ? 'object-submit' : 'object-next-step'}>
          {activeGroup === template.groups.length - 1 ? 'Сохранить и выбрать решения' : 'Далее'}<ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    </form></Form></div>
  </div>;
}

export default function ObjectSetup() {
  const [, setLocation] = useLocation();
  const { state, updateObjectParams } = useProject();
  const { sectors, error } = useSectorMap();
  const [waitingForCatalog, setWaitingForCatalog] = useState(false);
  const sector = sectors?.find(item => item.id === state.sectorId);
  const destination = sector ? sectorCatalogPath(sector) : '/solutions';
  const template = state.objectType && state.objectType !== 'custom' ? templates[state.objectType] : null;
  useEffect(() => {
    if (waitingForCatalog && sector) setLocation(sectorCatalogPath(sector));
  }, [waitingForCatalog, sector, setLocation]);
  const save = (data: Params) => {
    updateObjectParams(data);
    if (state.sectorId && !sector) {
      setWaitingForCatalog(true);
      return;
    }
    setLocation(destination);
  };

  if (!state.objectType) return <div className="container mx-auto max-w-5xl px-4 py-12" data-testid="page-object-setup"><Card><CardContent className="space-y-4 py-8"><h1 className="text-xl font-semibold">Объект ещё не выбран</h1><p className="text-sm text-muted-foreground">Сначала укажите направление и тип площадки.</p><Button onClick={() => setLocation('/quick-select')} data-testid="button-choose-object">К выбору объекта<ArrowRight className="ml-2 h-4 w-4" /></Button></CardContent></Card></div>;

  return <div className="container mx-auto w-full max-w-none px-4 py-8" data-testid="page-object-setup">
    <div className="mx-auto max-w-6xl">
      <div className="mb-7 flex flex-wrap items-center justify-between gap-3">
        <Button type="button" variant="ghost" onClick={() => setLocation(state.sectorId ? `/quick-select?sector=${encodeURIComponent(state.sectorId)}` : '/quick-select')} className="pl-0 hover:bg-transparent" data-testid="button-back-quick-select"><ArrowLeft className="mr-2 h-4 w-4" />К выбору направления</Button>
        <Button type="button" variant="outline" size="sm" disabled={Boolean(state.sectorId && !sector)} onClick={() => setLocation(destination)} data-testid="button-open-catalog">Каталог<ArrowRight className="ml-2 h-4 w-4" /></Button>
      </div>
      <p className="mb-2 font-mono text-xs uppercase tracking-widest text-primary">Маршрут подбора / 02 — Площадка</p>
      <h1 className="mb-3 text-3xl font-bold tracking-tight">Опишите объект</h1>
      <div className="mb-8 flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-secondary/30 p-4">
        <div><p className="text-xs uppercase tracking-widest text-muted-foreground">Направление карты</p><p className="mt-1 font-medium" data-testid="text-object-sector">{sector?.label ?? (error ? 'Данные направлений недоступны' : sectors ? 'Не выбрано' : 'Загрузка направления…')}</p><p className="mt-1 text-xs text-muted-foreground">Направление определяет каталог; шаблон объекта описывает физическую площадку.</p></div>
        <Button type="button" variant="outline" size="sm" onClick={() => setLocation('/quick-select')} data-testid="button-change-sector">Изменить направление</Button>
      </div>
      {!sectors && !error && state.sectorId && <p className="mb-5 rounded-md border border-border p-3 text-sm text-muted-foreground" role="status" data-testid="status-object-sector-loading">Загружаем направление для фильтрации каталога…</p>}
      {error && state.sectorId && <p className="mb-5 rounded-md border border-destructive/40 p-3 text-sm" role="alert" data-testid="status-object-sector-error">Не удалось проверить направление: {error}. Параметры сохранятся, но переход в отраслевой каталог возможен после загрузки карты. <button type="button" className="underline" onClick={() => window.location.reload()} data-testid="button-retry-object-sector">Повторить загрузку</button></p>}
      {waitingForCatalog && <p className="mb-5 rounded-md border border-border bg-secondary/30 p-3 text-sm" role="status" data-testid="status-waiting-catalog">Параметры сохранены. Ожидаем данные направления, чтобы открыть отфильтрованный каталог.</p>}
      {state.objectType === 'custom' ? <CustomSite initial={state.objectParams} onSave={save} /> : template ? <TemplateSite key={state.objectType} template={template} initial={state.objectParams} onSave={save} onProgress={updateObjectParams} /> : null}
    </div>
  </div>;
}