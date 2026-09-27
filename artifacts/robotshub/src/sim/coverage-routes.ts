import type {
  Flow,
  FlowFloorStop,
  SimScene,
} from "./sim-engine";

/**
 * Одна полилиния на поток слишком быстро сводит парк к одному коридору.
 * В реальном объекте диспетчер выбирает док, ряд, отделение или сервисную
 * зону из операционной матрицы. Здесь варианты маршрутов дают тот же эффект
 * без выдумывания новых типов техники или потоков.
 */
export function withCoverageRoutes(scene: SimScene): SimScene {
  if (scene.id === "warehouse-v2") {
    return {
      ...scene,
      flows: scene.flows.map((flow) => ({
        ...flow,
        routeVariants: warehouseVariants(flow),
      })),
    };
  }

  if (scene.id === "hospital") {
    return {
      ...scene,
      flows: scene.flows.map((flow) => ({
        ...flow,
        routeVariants: hospitalVariants(flow),
      })),
    };
  }

  return scene;
}

function warehouseVariants(flow: Flow) {
  const variants: Record<string, [number, number][][]> = {
    putaway: [
      [[100, 95], [270, 95], [270, 215], [385, 215]],
      [[180, 95], [470, 95], [470, 215], [565, 215]],
      [[1020, 240], [835, 240], [835, 215], [745, 215]],
      [[1100, 240], [930, 240], [930, 395], [835, 395], [745, 395]],
    ],
    picking: [
      [[385, 215], [270, 215], [270, 570], [230, 570]],
      [[565, 395], [470, 395], [470, 570], [230, 570]],
      [[745, 215], [835, 215], [835, 600], [230, 600]],
      [[745, 575], [835, 575], [835, 620], [270, 620], [230, 620]],
    ],
    shipping: [
      [[130, 650], [900, 650], [980, 620]],
      [[130, 625], [900, 625], [980, 595]],
      [[130, 600], [900, 600], [980, 570]],
    ],
    replenish: [
      [[1040, 150], [900, 150], [900, 240], [845, 240]],
      [[1100, 150], [930, 150], [930, 420], [845, 420]],
      [[1040, 175], [960, 175], [960, 575], [845, 575]],
    ],
    cleaning: [
      // Keep the cleaning loop on the outer right/bottom corridors. The
      // sorter uses the inner left corridor, so both flows can run without
      // meeting head-on at the former (260, 395) choke point.
      [[940, 180], [1080, 180], [1080, 680], [940, 680]],
      [[940, 240], [1100, 240], [1100, 620], [940, 620]],
      [[835, 575], [960, 575], [960, 240], [835, 240]],
    ],
    sorter: [
      [[385, 395], [270, 395], [270, 240], [855, 240], [855, 190]],
      [[565, 575], [470, 575], [470, 420], [855, 420], [855, 190]],
      [[745, 215], [835, 215], [855, 190]],
    ],
  };

  return (variants[flow.id] ?? []).map((waypoints) => ({ waypoints }));
}

function hospitalVariants(flow: Flow) {
  if (!flow.floorStops?.length) return [];
  const targets: [number, number][] = [
    [250, 150],   // отделение А
    [250, 540],   // отделение Б
    [560, 145],   // процедурная
    [560, 530],   // пост медсестры
    [1020, 140],  // служебная зона
    [1020, 540],  // этажная сервисная зона
  ];

  return targets.map((target) => ({
    label: `зона ${target[0]}×${target[1]}`,
    floorStops: flow.floorStops!.map((stop, index): FlowFloorStop => {
      const firstPoint = stop.waypoints[0];
      const isWardSource = flow.id === "samples" || flow.id === "waste";
      if (isWardSource && index === 0) {
        return {
          floorId: stop.floorId,
          waypoints: [target, ...stop.waypoints.slice(1)],
        };
      }
      if (stop.floorId !== "h1") {
        return {
          floorId: stop.floorId,
          waypoints: [firstPoint, target],
        };
      }
      return stop;
    }),
  }));
}