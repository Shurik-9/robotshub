// ============================================================
// Sim Renderer — отрисовка сцены на canvas (спрайты, свечение,
// шлейфы, зоны, маршруты). Вызывается из SimCanvas каждый кадр.
// Спрайты предзагружаются из /assets/tech/png/<key>.png (3x).
// ============================================================

import type { Sim, SimScene } from "./sim-engine";
import registry from "../assets/tech/registry.json" with { type: "json" };

const META = registry as unknown as Record<string, { len_px: number; wid_px: number }>;

const COLORS = {
  bg: "#0B1220", grid: "#141D31", zoneFill: "rgba(34,211,238,0.05)",
  zoneStroke: "#334155", zoneLabel: "#94A3B8", route: "#2A3A55",
  accent: "#22D3EE", money: "#FACC15", charge: "#FACC15",
};
const FLOW_COLORS = ["#22D3EE", "#F59E0B", "#34D399", "#A78BFA", "#FB7185", "#60A5FA"];

const SPRITE_KEYS = [
  "amr-pallet", "fmr-forklift", "scrubber", "shuttle",
  "tug", "truck", "delivery-bot", "medical-amr",
] as const;

export type SpriteBank = Partial<Record<string, HTMLImageElement>>;

export function preloadSprites(): SpriteBank {
  const bank: SpriteBank = {};
  for (const key of SPRITE_KEYS) {
    const img = new Image();
    img.src = `/assets/tech/png/${key}.png`;
    bank[key] = img;
  }
  return bank;
}

export function drawFrame(
  ctx: CanvasRenderingContext2D, sim: Sim, bank: SpriteBank, realDt: number
) {
  const sc: SimScene = sim.getFloorScene();
  const activeFloorId = sim.activeFloorId;
  const W = sc.width, H = sc.height;

  // фон + сетка
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= W; x += 40) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
  for (let y = 0; y <= H; y += 40) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
  ctx.stroke();

  // периметр (стены)
  if (sc.walls) {
    ctx.strokeStyle = "#3B4A63";
    ctx.lineWidth = 3;
    ctx.strokeRect(sc.walls.x, sc.walls.y, sc.walls.w, sc.walls.h);
    ctx.lineWidth = 1.5;
  }

  // ворота/доки (проёмы в стене)
  for (const d of sc.doors ?? []) {
    ctx.fillStyle = "#FACC15";
    ctx.globalAlpha = 0.75;
    ctx.fillRect(d.x, d.y, d.w, d.h);
    ctx.globalAlpha = 1;
    if (d.label) {
      ctx.fillStyle = COLORS.zoneLabel;
      ctx.font = "600 10px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.fillText(d.label.toUpperCase(), d.x + d.w / 2, d.y < 40 ? d.y - 5 : d.y + d.h + 12);
    }
  }

  // зоны
  for (const z of sc.zones) {
    ctx.fillStyle = COLORS.zoneFill;
    ctx.strokeStyle = COLORS.zoneStroke;
    ctx.lineWidth = 1.5;
    roundRect(ctx, z.x, z.y, z.w, z.h, 8);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = COLORS.zoneLabel;
    ctx.font = "600 11px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.fillText(z.label.toUpperCase(), z.x + z.w / 2, z.y + 14);
  }

  // стеллажные ряды
  for (const rk of sc.racks ?? []) {
    ctx.fillStyle = "#1C2740";
    ctx.strokeStyle = "#3B4A63";
    ctx.lineWidth = 1.2;
    ctx.fillRect(rk.x, rk.y, rk.w, rk.h);
    ctx.strokeRect(rk.x, rk.y, rk.w, rk.h);
    // секции
    ctx.strokeStyle = "#2A3A55";
    ctx.beginPath();
    const cells = Math.max(2, Math.round(rk.w / 26));
    for (let i = 1; i < cells; i++) {
      const cx = rk.x + (rk.w / cells) * i;
      ctx.moveTo(cx, rk.y + 2); ctx.lineTo(cx, rk.y + rk.h / 2 - 2);
      ctx.moveTo(cx, rk.y + rk.h / 2 + 2); ctx.lineTo(cx, rk.y + rk.h - 2);
    }
    ctx.moveTo(rk.x + 2, rk.y + rk.h / 2); ctx.lineTo(rk.x + rk.w - 2, rk.y + rk.h / 2);
    ctx.stroke();
  }

  // Все процессы объекта остаются на карте. Доступные текущему парку потоки
  // показаны цветом, недоступные — тонким серым пунктиром.
  for (let flowIndex = 0; flowIndex < sc.flows.length; flowIndex++) {
    const f = sc.flows[flowIndex];
    const paths = sim.getFlowPaths(f.id, activeFloorId);
    if (!paths.length) continue;
    const available = sim.flows.some((flow) => flow.id === f.id);
    const color = FLOW_COLORS[flowIndex % FLOW_COLORS.length];
    for (const path of paths) {
      ctx.setLineDash(available ? [9, 7] : [3, 9]);
      ctx.strokeStyle = available ? color : COLORS.route;
      ctx.globalAlpha = available ? 0.38 : 0.22;
      ctx.lineWidth = available ? 1.5 : 1;
      ctx.beginPath();
      ctx.moveTo(path[0][0], path[0][1]);
      for (let i = 1; i < path.length; i++) ctx.lineTo(path[i][0], path[i][1]);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    const path = paths[0];
    if (available && path.length > 1) {
      drawArrow(ctx, path, color);
      const start = path[0];
      ctx.globalAlpha = 0.95;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(start[0], start[1], 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#08111F";
      ctx.font = "700 9px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.fillText(String(flowIndex + 1), start[0], start[1] + 3);
    }
  }
  ctx.globalAlpha = 1;
  ctx.setLineDash([]);

  const focusRobot = sim.getFocusRobot();
  const focusPath = focusRobot?.path
    .slice(focusRobot.pathIdx)
    .filter((step) => step.kind === "move" && step.floorId === activeFloorId)
    .map((step) => step.kind === "move" ? step.point : [0, 0] as [number, number]) ?? [];
  if (
    focusRobot?.floorId === activeFloorId &&
    focusPath.length &&
    focusRobot.state !== "charging"
  ) {
    const focusFlowIndex = sc.flows.findIndex((flow) => flow.id === focusRobot.flow?.id);
    const focusColor = FLOW_COLORS[Math.max(0, focusFlowIndex) % FLOW_COLORS.length];
    ctx.strokeStyle = focusColor;
    ctx.lineWidth = 4;
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.moveTo(focusRobot.x, focusRobot.y);
    for (const point of focusPath) ctx.lineTo(point[0], point[1]);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // Вертикальные связи отображаются только на текущем этаже.
  for (const link of sc.verticalLinks ?? []) {
    const point = link.points[activeFloorId];
    if (!point) continue;
    const linkEnabled = link.enabled !== false;
    ctx.fillStyle = linkEnabled ? "rgba(96,165,250,0.14)" : "rgba(248,113,113,0.12)";
    ctx.strokeStyle = linkEnabled ? "#60A5FA" : "#F87171";
    ctx.lineWidth = 1.5;
    roundRect(ctx, point[0] - 22, point[1] - 22, 44, 44, 8);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = linkEnabled ? "#BFDBFE" : "#FCA5A5";
    ctx.font = "700 9px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.fillText(
      linkEnabled ? (link.kind === "elevator" ? "ЛИФТ" : "ПЕРЕХОД") : "НЕТ API",
      point[0],
      point[1] + 3,
    );
  }

  // стационарные установки (под роботами)
  for (const p of sc.props ?? []) {
    const img = bank[p.sprite];
    const meta = META[p.sprite];
    const lenPx = meta?.len_px ?? 60, widPx = meta?.wid_px ?? 60;
    if (img && img.complete && img.naturalWidth > 0) {
      ctx.drawImage(img, p.x - lenPx / 2, p.y - widPx / 2, lenPx, widPx);
    } else {
      ctx.fillStyle = "#1F2A3C";
      roundRect(ctx, p.x - lenPx / 2, p.y - widPx / 2, lenPx, widPx, 6);
      ctx.fill();
      ctx.strokeStyle = COLORS.zoneStroke; ctx.lineWidth = 1.5; ctx.stroke();
    }
    if (p.label) {
      ctx.fillStyle = "#7DD3FC";
      ctx.font = "600 10px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.fillText(p.label.toUpperCase(), p.x, p.y - widPx / 2 - 6);
    }
  }

  // зарядные станции
  for (const [cx, cy] of sc.charges) {
    ctx.strokeStyle = COLORS.charge;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(cx - 12, cy - 12, 24, 24);
    ctx.fillStyle = COLORS.charge;
    ctx.font = "bold 12px ui-monospace, monospace";
    ctx.fillText("⚡", cx, cy + 4);
  }

  // роботы: шлейф → спрайт
  for (const r of sim.robots) {
    if (r.floorId !== activeFloorId) continue;
    const flowIndex = sc.flows.findIndex((flow) => flow.id === r.flow?.id);
    const robotColor = FLOW_COLORS[Math.max(0, flowIndex) % FLOW_COLORS.length];
    const isFocus = r.id === focusRobot?.id;
    // шлейф
    for (let i = 0; i < r.trail.length; i++) {
      const t = r.trail[i];
      const a = (i / r.trail.length) * 0.28;
      ctx.globalAlpha = a;
      ctx.fillStyle = robotColor;
      ctx.beginPath();
      ctx.arc(t.x, t.y, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    const img = bank[r.sprite];
    const meta = META[r.sprite];
    // Icons fit the engine's 12px collision envelope, instead of visually
    // overlapping despite safe center distances.
    const iconScale = sc.id.startsWith("generated-")
      ? Math.min(1, 24 / Math.max(meta?.len_px ?? 46, meta?.wid_px ?? 32))
      : 1;
    const lenPx = (meta?.len_px ?? 46) * iconScale, widPx = (meta?.wid_px ?? 32) * iconScale;
    if (sc.id.startsWith("generated-") && r.state === "idle") {
      ctx.strokeStyle = "#64748B";
      ctx.lineWidth = 1;
      ctx.strokeRect(r.x - 15, r.y - 15, 30, 30);
    }
    ctx.save();
    ctx.translate(r.x, r.y);
    ctx.rotate(r.angle);
    if (img && img.complete && img.naturalWidth > 0) {
      ctx.shadowColor = robotColor;
      ctx.shadowBlur = isFocus ? 16 : 7;
      ctx.drawImage(img, -lenPx / 2, -widPx / 2, lenPx, widPx);
    } else {
      // fallback до загрузки спрайта: капсула с фарами
      ctx.shadowColor = COLORS.accent; ctx.shadowBlur = 8;
      ctx.fillStyle = "#263449";
      roundRect(ctx, -lenPx / 2, -widPx / 2, lenPx, widPx, 6);
      ctx.fill();
      ctx.fillStyle = "#FDE68A";
      ctx.fillRect(lenPx / 2 - 3, -widPx / 2 + 4, 3, 5);
      ctx.fillRect(lenPx / 2 - 3, widPx / 2 - 9, 3, 5);
    }
    ctx.restore();

    if (isFocus) {
      ctx.strokeStyle = robotColor;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(r.x, r.y, Math.max(lenPx, widPx) / 2 + 8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "#E2E8F0";
      ctx.font = "700 10px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.fillText(r.name, r.x, r.y + Math.max(lenPx, widPx) / 2 + 20);
    }

    // индикатор состояния
    if (r.state === "loading" || r.state === "unloading") {
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 180);
      ctx.strokeStyle = `rgba(250,204,21,${0.35 + pulse * 0.5})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(r.x, r.y, 26 + pulse * 3, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (r.state === "charging") {
      ctx.fillStyle = COLORS.charge;
      ctx.font = "bold 11px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.fillText("⚡", r.x, r.y - 22);
    }

    // батарея над роботом
    const bw = 22;
    ctx.fillStyle = "rgba(11,18,32,0.75)";
    ctx.fillRect(r.x - bw / 2, r.y - 30, bw, 4);
    ctx.fillStyle = r.battery < 20 ? "#F87171" : COLORS.accent;
    ctx.fillRect(r.x - bw / 2, r.y - 30, (bw * r.battery) / 100, 4);
  }
}

function drawArrow(
  ctx: CanvasRenderingContext2D,
  path: [number, number][],
  color: string,
) {
  const segmentIndex = Math.max(1, Math.floor(path.length / 2));
  const from = path[segmentIndex - 1];
  const to = path[segmentIndex];
  const angle = Math.atan2(to[1] - from[1], to[0] - from[0]);
  const x = (from[0] + to[0]) / 2;
  const y = (from[1] + to[1]) / 2;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(8, 0);
  ctx.lineTo(-5, -5);
  ctx.lineTo(-5, 5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function roundRect(
  ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
