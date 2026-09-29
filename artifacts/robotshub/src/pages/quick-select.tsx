import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { ArrowLeft, ArrowRight, Building2, Database, Plane, RotateCcw, Stethoscope, Warehouse } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useSectorMap, sectorCatalogPath, type MapSector } from '@/lib/useSectorMap';
import { useProject, type ObjectType } from '@/store/project';
import { ObjectQuestionnaire } from '@/components/object-questionnaire';

const objects: { type: Exclude<ObjectType, null>; title: string; description: string; icon: typeof Warehouse }[] = [
  { type: 'warehouse', title: 'Склад', description: 'Склад, распределительный центр или зона хранения.', icon: Warehouse },
  { type: 'airport', title: 'Аэропорт', description: 'Терминал, багажная или перронная инфраструктура.', icon: Plane },
  { type: 'medical', title: 'Медучреждение', description: 'Больница, клиника или лаборатория.', icon: Stethoscope },
  { type: 'custom', title: 'Свой объект', description: 'Опишите площадку и задачу своими словами без типовых допущений.', icon: Building2 },
];

export default function QuickSelect() {
  const [, setLocation] = useLocation();
  const { state, setSectorId, setObjectType } = useProject();
  const { sectors, error } = useSectorMap();
  const [selectedId, setSelectedId] = useState<string | null>(state.sectorId);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [resetNotice, setResetNotice] = useState(false);
  const [showMobileSectors, setShowMobileSectors] = useState(false);
  const queryHandled = useRef(false);

  useEffect(() => {
    if (!sectors || queryHandled.current) return;
    queryHandled.current = true;
    const requested = new URLSearchParams(window.location.search).get('sector');
    const match = sectors.find(sector => sector.id === requested);
    if (!match) return;
    if (state.sectorId !== match.id) {
      if (state.objectType || state.selectedSolutions.length || Object.keys(state.objectParams).length || state.simulationKpis) {
        setPendingId(match.id);
        return;
      }
      setSectorId(match.id);
    }
    setSelectedId(match.id);
  }, [sectors, state.sectorId, state.objectType, state.selectedSolutions.length, state.objectParams, state.simulationKpis, setSectorId]);

  const sector = sectors?.find(item => item.id === selectedId);
  const existingWork = Boolean(state.objectType || state.selectedSolutions.length || Object.keys(state.objectParams).length || state.simulationKpis);

  const selectSector = (next: MapSector) => {
    if (next.id === selectedId && next.id === state.sectorId) return;
    if (state.sectorId !== next.id && existingWork) {
      setPendingId(next.id);
      return;
    }
    setSectorId(next.id);
    setSelectedId(next.id);
    setPendingId(null);
    setResetNotice(false);
    setShowMobileSectors(false);
  };

  const confirmSector = () => {
    if (!pendingId) return;
    setSectorId(pendingId);
    setSelectedId(pendingId);
    setPendingId(null);
    setResetNotice(true);
    setShowMobileSectors(false);
  };

  const chooseObject = (type: Exclude<ObjectType, null>) => {
    if (!sector) return;
    setObjectType(type);
    setLocation('/object');
  };

  return (
    <div className="container mx-auto w-full max-w-none px-4 py-8 sm:py-10" data-testid="page-quick-select">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
          <Button variant="ghost" onClick={() => setLocation('/')} className="pl-0 text-muted-foreground hover:bg-transparent hover:text-foreground" data-testid="button-back-map">
            <ArrowLeft className="mr-2 h-4 w-4" />К карте направлений
          </Button>
          <Button variant="outline" size="sm" onClick={() => setLocation(sector ? sectorCatalogPath(sector) : '/solutions')} data-testid="button-open-catalog">
            Открыть каталог<ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>

        <div className="mb-8 max-w-3xl">
          <p className="mb-3 font-mono text-xs uppercase tracking-[0.18em] text-primary">Маршрут подбора / 01 — Направление</p>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">От отраслевой практики к вашей площадке</h1>
          <p className="mt-3 text-sm leading-7 text-muted-foreground sm:text-base">Сначала выберите направление карты и изучите подтверждённые сценарии. Затем укажите физический объект, для которого нужен робот. Отрасль и тип объекта — разные признаки.</p>
        </div>

        <ObjectQuestionnaire onApplied={() => setLocation('/object')} />
        {error ? (
          <Card className="border-destructive/40" data-testid="status-sectors-error"><CardContent className="space-y-4 py-8">
            <p className="font-semibold">Данные карты не загрузились</p>
            <p className="text-sm text-muted-foreground">{error}. Выбор направления пока недоступен.</p>
            <Button variant="outline" onClick={() => window.location.reload()} data-testid="button-retry-sectors"><RotateCcw className="mr-2 h-4 w-4" />Повторить загрузку</Button>
          </CardContent></Card>
        ) : !sectors ? (
          <div className="grid gap-4 lg:grid-cols-[19rem_1fr]" role="status" aria-label="Загрузка направлений карты" data-testid="status-sectors-loading">
            <div className="h-96 animate-pulse rounded-lg bg-secondary" /><div className="h-96 animate-pulse rounded-lg bg-secondary" />
          </div>
        ) : (
          <>
            {sector && (
              <button
                type="button"
                onClick={() => setShowMobileSectors(value => !value)}
                className="mb-4 flex w-full items-center justify-between rounded-md border border-border bg-card px-4 py-3 text-left text-sm lg:hidden"
                aria-expanded={showMobileSectors}
                data-testid="button-mobile-sector-list"
              >
                <span>Направление: <strong>{sector.label}</strong></span>
                <span className="ml-3 shrink-0 text-primary">Сменить</span>
              </button>
            )}
            <div className="grid items-start gap-5 lg:grid-cols-[19rem_minmax(0,1fr)]">
              <Card className={`overflow-hidden ${sector && !showMobileSectors ? 'hidden lg:block' : ''}`}>
                <CardHeader className="border-b border-border pb-4">
                  <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Карта практики</p>
                  <CardTitle className="text-lg">Все направления <span className="font-mono text-primary">{sectors.length}</span></CardTitle>
                </CardHeader>
                <div className="max-h-[38rem] overflow-y-auto p-2" data-testid="list-sectors">
                  {sectors.map((item, index) => (
                    <button key={item.id} type="button" onClick={() => selectSector(item)} aria-pressed={selectedId === item.id}
                      data-testid={`button-sector-${index}`}
                      className={`flex w-full items-center gap-3 rounded-md px-3 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selectedId === item.id ? 'bg-primary/10 text-foreground' : 'text-muted-foreground hover:bg-secondary hover:text-foreground'}`}>
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: item.color }} aria-hidden="true" />
                      <span className="min-w-0 flex-1 text-sm font-medium leading-snug">{item.label}</span>
                      <span className="font-mono text-xs tabular-nums">{item.n}</span>
                    </button>
                  ))}
                </div>
              </Card>

              <div className="min-w-0 space-y-5">
                {pendingId && (
                  <Card className="border-accent/50 bg-accent/5" data-testid="status-sector-reset-warning">
                    <CardContent className="space-y-3 p-5">
                      <p className="font-semibold">Сменить направление?</p>
                      <p className="text-sm leading-6 text-muted-foreground">При смене отрасли прежний объект, параметры, выбранная модель и расчёт будут сброшены. Новое направление: {sectors.find(item => item.id === pendingId)?.label}.</p>
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" onClick={confirmSector} data-testid="button-confirm-sector">Сменить направление</Button>
                        <Button size="sm" variant="outline" onClick={() => setPendingId(null)} data-testid="button-cancel-sector">Оставить прежнее</Button>
                      </div>
                    </CardContent>
                  </Card>
                )}
                {resetNotice && <p className="rounded-md border border-accent/40 bg-accent/5 px-4 py-3 text-sm leading-6" role="status" data-testid="status-sector-reset">Направление изменено. Предыдущие объект, модель и расчёт сброшены — параметры площадки потребуется указать заново.</p>}
                {!sector ? (
                  <Card className="min-h-64 border-dashed"><CardContent className="flex min-h-64 flex-col items-start justify-center gap-3 p-7">
                    <Database className="h-6 w-6 text-primary" />
                    <h2 className="text-xl font-semibold">Выберите направление слева</h2>
                    <p className="max-w-lg text-sm leading-6 text-muted-foreground">Здесь появятся сценарии, примеры решений и состав данных из карты. Ничего не подобрано заранее.</p>
                  </CardContent></Card>
                ) : (
                  <Card data-testid="panel-sector-evidence">
                    <CardHeader className="border-b border-border">
                      <p className="font-mono text-xs uppercase tracking-widest text-primary">{sector.thematic ? 'Тематическое направление' : 'Отраслевое направление'} / данные карты</p>
                      <CardTitle className="text-2xl" data-testid="text-selected-sector">{sector.label}</CardTitle>
                      {sector.sourceNote && <p className="text-xs leading-5 text-muted-foreground" data-testid="text-sector-source">{sector.sourceNote}</p>}
                    </CardHeader>
                    <CardContent className="space-y-7 pt-6">
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                        {[
                          { label: sector.thematic ? 'Записи подборки' : 'Записи карты', value: sector.n },
                          { label: 'Эксплуатация', value: sector.op },
                          { label: 'Пилоты', value: sector.pil },
                          { label: 'НИОКР', value: sector.rnd },
                        ].map(metric => (
                          <div key={metric.label} className="rounded-md border border-border bg-secondary/30 p-3" data-testid={`metric-sector-${metric.label}`}>
                            <div className="font-mono text-2xl font-semibold tabular-nums">{metric.value}</div>
                            <div className="mt-1 text-xs leading-5 text-muted-foreground">{metric.label}</div>
                          </div>
                        ))}
                      </div>
                      {sector.thematic && <p className="text-xs leading-5 text-muted-foreground">Тематическая подборка пересекается с отраслевой картой. Статусы и записи могут относиться к одним и тем же решениям; эти числа нельзя складывать как независимые итоги.{sector.uniqueModels != null ? ` Уникальных моделей: ${sector.uniqueModels}.` : ''}</p>}
                      <div>
                        <h3 className="mb-3 text-sm font-semibold">Сценарии применения</h3>
                        <div className="divide-y divide-border border-y border-border">
                          {sector.mix.length ? sector.mix.map((item, index) => (
                            <div key={`${item.name}-${index}`} className="flex items-start justify-between gap-3 py-2.5 text-sm" data-testid={`row-scenario-${index}`}>
                              <span>{item.name}</span><span className="font-mono tabular-nums text-muted-foreground">{item.n}</span>
                            </div>
                          )) : <p className="py-3 text-sm text-muted-foreground">Сценарии для направления не указаны.</p>}
                        </div>
                      </div>
                      <div>
                        <h3 className="mb-3 text-sm font-semibold">Примеры из карты</h3>
                        <div className="space-y-3">
                          {sector.ex.length ? sector.ex.map((example, index) => (
                            <div key={`${example.name}-${index}`} className="rounded-md border border-border p-4" data-testid={`card-example-${index}`}>
                              <div className="flex flex-wrap items-baseline justify-between gap-2"><h4 className="font-semibold">{example.name}</h4><span className="text-xs text-muted-foreground">{example.vendor}</span></div>
                              <p className="mt-2 text-sm leading-6 text-muted-foreground">{example.text}</p>
                            </div>
                          )) : <p className="text-sm text-muted-foreground">Примеры для направления не указаны.</p>}
                        </div>
                      </div>
                      <Button variant="outline" onClick={() => setLocation(sectorCatalogPath(sector))} data-testid="button-sector-catalog">Посмотреть решения направления<ArrowRight className="ml-2 h-4 w-4" /></Button>
                    </CardContent>
                  </Card>
                )}
              </div>
            </div>

            {sector && (
              <section className="mt-9 border-t border-border pt-8" data-testid="section-object-choices">
                <p className="font-mono text-xs uppercase tracking-widest text-primary">02 — Физическая площадка</p>
                <h2 className="mt-2 text-2xl font-bold">Где будет работать робот?</h2>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">Шаблон объекта определяет вопросы о площадке, а не подменяет выбранную отрасль. Например, склад может быть частью медицинского учреждения или производства.</p>
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  {objects.map(choice => {
                    const Icon = choice.icon;
                    return <Card key={choice.type} className="flex flex-col" data-testid={`card-object-${choice.type}`}>
                      <CardContent className="flex flex-1 flex-col p-5">
                        <Icon className="mb-4 h-5 w-5 text-primary" />
                        <h3 className="font-semibold">{choice.title}</h3>
                        <p className="mt-1 flex-1 text-sm leading-6 text-muted-foreground">{choice.description}</p>
                        <Button className="mt-5 justify-between" variant={state.objectType === choice.type ? 'default' : 'outline'} onClick={() => chooseObject(choice.type)} data-testid={`button-choose-object-${choice.type}`}>
                          {state.objectType === choice.type ? 'Продолжить' : 'Указать объект'}<ArrowRight className="h-4 w-4" />
                        </Button>
                      </CardContent>
                    </Card>;
                  })}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}