import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { ArrowLeft, FlaskConical, Info } from "lucide-react";
import { SimCanvas } from "@/sim/SimCanvas";
import {
  SANDBOX_SCENES,
  type SandboxSceneId,
} from "@/sim/scenes";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const SANDBOX_SCENE_IDS: SandboxSceneId[] = ["warehouse", "airport", "hospital"];

export default function SimulationSandbox() {
  const [, setLocation] = useLocation();
  const [sceneId, setSceneId] = useState<SandboxSceneId>("warehouse");
  const definition = SANDBOX_SCENES[sceneId];
  const activeFleetCount = useMemo(
    () => definition.fleet.reduce((total, entry) => total + entry.count, 0),
    [definition.fleet],
  );

  return (
    <div
      className="container mx-auto flex h-full w-full max-w-none flex-col gap-6 px-4 py-8"
      data-testid="page-simulation-sandbox"
    >
      <div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-primary">
            <FlaskConical className="h-4 w-4" />
            Песочница
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Витринные сцены</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Статические примеры для знакомства с визуальной моделью объекта
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => setLocation("/simulation")}
          data-testid="button-back-to-simulation"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Вернуться к расчёту
        </Button>
      </div>

      <Card className="border-amber-500/30 bg-amber-500/5">
        <CardContent className="flex items-start gap-3 p-4 text-sm">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
          <p className="leading-relaxed text-muted-foreground">
            Это отдельный демонстрационный режим. Сцены загружаются из статических
            файлов и не используют параметры объекта, выбранный расчётный флот,
            экономику или сохранение проекта.
          </p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
        <div className="flex flex-col gap-6 lg:col-span-3">
          <Card className="overflow-hidden border-primary/20 shadow-sm">
            <div className="flex flex-col gap-3 border-b border-primary/10 bg-primary/5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-sm font-semibold">Сцена: {definition.label}</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">{definition.description}</p>
              </div>
              <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <span>Витрина</span>
                <select
                  value={sceneId}
                  onChange={(event) => setSceneId(event.target.value as SandboxSceneId)}
                  className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary"
                  data-testid="select-sandbox-scene"
                  aria-label="Выбрать витринную сцену"
                >
                  {SANDBOX_SCENE_IDS.map((id) => (
                    <option key={id} value={id}>
                      {SANDBOX_SCENES[id].label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <CardContent className="p-0">
              <div className="relative h-[min(70vh,720px)] min-h-[520px] max-h-[720px] w-full overflow-hidden border-b border-border bg-muted/30">
                <SimCanvas
                  scene={definition.scene}
                  options={{ tasksPerHour: 12, laborCostPerTaskRub: 0 }}
                  fleet={definition.fleet}
                  seed={42}
                   sceneKind={sceneId}
                  title={definition.title}
                  className="h-full w-full"
                />
              </div>
              <div className="grid grid-cols-1 gap-3 bg-[#0B1220] px-4 py-3 text-xs text-slate-400 sm:grid-cols-3">
                <div>
                  <span className="mb-1 block text-[10px] uppercase tracking-wider text-slate-500">Среда</span>
                  <span className="text-slate-200" data-testid="sandbox-scene-name">{definition.label}</span>
                </div>
                <div>
                  <span className="mb-1 block text-[10px] uppercase tracking-wider text-slate-500">Демо-флот</span>
                  <span className="font-mono tabular-nums text-slate-200">{activeFleetCount} ед.</span>
                </div>
                <div>
                  <span className="mb-1 block text-[10px] uppercase tracking-wider text-slate-500">Источник</span>
                  <span className="text-slate-200">Статическая сцена</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="h-fit shadow-sm">
          <CardHeader className="border-b border-border bg-muted/10">
            <CardTitle className="text-base">О режиме</CardTitle>
            <CardDescription>Три готовые сцены для демонстрации</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 p-4 text-sm">
            <p className="leading-relaxed text-muted-foreground">
              Переключатель меняет только статическую карту и демонстрационную технику
              на ней. Данные основного проекта остаются нетронутыми.
            </p>
            <div className="space-y-2">
              {SANDBOX_SCENE_IDS.map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setSceneId(id)}
                  className={`w-full rounded-md border px-3 py-2 text-left transition-colors ${
                    sceneId === id
                      ? "border-primary/50 bg-primary/10 text-foreground"
                      : "border-border text-muted-foreground hover:bg-secondary"
                  }`}
                  data-testid={`button-sandbox-scene-${id}`}
                >
                  <span className="block text-sm font-medium">{SANDBOX_SCENES[id].label}</span>
                  <span className="mt-0.5 block text-xs">{SANDBOX_SCENES[id].description}</span>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}