// Фирменные иконки платформы (автогенерация: icons/_build.py).
// Сетка 24x24, stroke 1.75, скруглённые концы, цвет — currentColor
// (задаётся через CSS-класс, напр. className="text-cyan-400").
// Использование: <IconWarehouse size={20} className="text-slate-300" />
import type { SVGProps } from "react";

export type BrandIconProps = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 24, children, ...props }: BrandIconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {children}
    </svg>
  );
}

export function IconWarehouse(props: BrandIconProps) {
  return (
    <Svg {...props}>
      <path d="M3 21V9.5L12 4l9 5.5V21" />
<path d="M3 21h18" />
<path d="M6.5 21v-5h5v5" />
<path d="M13.5 21v-3.5h4V21" />
<path d="M13.5 17.5h4" />
    </Svg>
  );
}

export function IconAirportTower(props: BrandIconProps) {
  return (
    <Svg {...props}>
      <path d="M9 4h6l1.5 4.5h-9z" />
<path d="M9.5 6.2h5" />
<path d="M9.3 8.5 8 21" />
<path d="M14.7 8.5 16 21" />
<path d="M8.6 13h6.8" />
<path d="M8.2 17h7.6" />
<path d="M5 21h14" />
<path d="M12 4V2.5" />
    </Svg>
  );
}

export function IconMedical(props: BrandIconProps) {
  return (
    <Svg {...props}>
      <path d="M5 21V7h14v14" />
<path d="M3 21h18" />
<path d="M12 6.5v-3" />
<path d="M10.5 5h3" />
<path d="M12 10.5v5" />
<path d="M9.5 13h5" />
<path d="M10 21v-3h4v3" />
    </Svg>
  );
}

export function IconCustomObject(props: BrandIconProps) {
  return (
    <Svg {...props}>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.2" />
<circle cx="16.75" cy="7" r="3.5" />
<path d="M7 13.5 10.5 20h-7z" />
<path d="M16.75 13.6l3.15 3.15-3.15 3.15-3.15-3.15z" />
    </Svg>
  );
}

export function IconSelect(props: BrandIconProps) {
  return (
    <Svg {...props}>
      <path d="M4.5 4 12 20.5l2-7.5 7.5-2.5z" />
    </Svg>
  );
}

export function IconCompare(props: BrandIconProps) {
  return (
    <Svg {...props}>
      <path d="M12 4v16" />
<path d="M7 20h10" />
<path d="M5.5 7h13" />
<circle cx="12" cy="5.5" r="1.2" />
<path d="M5.5 7 3.5 11.5" />
<path d="M5.5 7l2 4.5" />
<path d="M3 11.5a2.7 2.7 0 0 0 5.4 0" />
<path d="M18.5 7l-2 4.5" />
<path d="M18.5 7l2 4.5" />
<path d="M15.8 11.5a2.7 2.7 0 0 0 5.4 0" />
    </Svg>
  );
}

export function IconCalculator(props: BrandIconProps) {
  return (
    <Svg {...props}>
      <rect x="5" y="3.5" width="14" height="17" rx="2" />
<path d="M8.5 7.5h7" />
<path d="M8.5 12h.01" />
<path d="M12 12h.01" />
<path d="M15.5 12h.01" />
<path d="M8.5 16.5h.01" />
<path d="M12 16.5h.01" />
<path d="M15.5 16.5h.01" />
    </Svg>
  );
}

export function IconVisualization(props: BrandIconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="4.5" width="18" height="12.5" rx="2" />
<path d="M12 17v3.5" />
<path d="M8.5 20.5h7" />
<path d="M10.4 8.1l4.2 2.65-4.2 2.65z" />
    </Svg>
  );
}

export function IconRobotAmr(props: BrandIconProps) {
  return (
    <Svg {...props}>
      <rect x="4" y="7.5" width="16" height="9" rx="2.2" />
<path d="M6.9 9.8v4.4" />
<path d="M17.1 9.8v4.4" />
<circle cx="12" cy="12" r="1.4" />
<path d="M12 4.9l1.4 1.9h-2.8z" />
    </Svg>
  );
}

export function IconRobotArm(props: BrandIconProps) {
  return (
    <Svg {...props}>
      <path d="M3.5 21h11" />
<path d="M5.5 21v-2.3h7V21" />
<circle cx="9" cy="16.6" r="1.4" />
<path d="M9.9 15.6 13.2 9.8" />
<circle cx="13.6" cy="9.1" r="1.4" />
<path d="M14.9 8.4l3.6-1.6" />
<circle cx="19.6" cy="6.3" r="1.1" />
<path d="M20.7 5.7l1.8-1.2" />
<path d="M20.9 6.9l2 .5" />
    </Svg>
  );
}

export function IconChartRoi(props: BrandIconProps) {
  return (
    <Svg {...props}>
      <path d="M3.5 20.5h17" />
<path d="M6.5 20.5v-5" />
<path d="M11 20.5v-8" />
<path d="M15.5 20.5V9" />
<path d="M4.5 12.5l5-3.8 3.6 2.2 6.4-5.4" />
<path d="M16.5 5.5h3v3" />
    </Svg>
  );
}

export function IconClockPayback(props: BrandIconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12.5" r="8" />
<path d="M12 12.5V8" />
<path d="M12 12.5l3.2 2.4" />
    </Svg>
  );
}

export function IconCoinsCapex(props: BrandIconProps) {
  return (
    <Svg {...props}>
      <ellipse cx="12" cy="5.5" rx="7" ry="2.5" />
<path d="M5 5.5v4c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-4" />
<path d="M5 9.5v4c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-4" />
<path d="M5 13.5v4c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-4" />
    </Svg>
  );
}

export function IconStaff(props: BrandIconProps) {
  return (
    <Svg {...props}>
      <circle cx="9" cy="8" r="3.5" />
<path d="M3.5 20c0-3 2.5-5.5 5.5-5.5s5.5 2.5 5.5 5.5" />
<circle cx="17" cy="9.5" r="2.5" />
<path d="M16.2 15.6c2.5.6 4.3 2.3 4.3 4.4" />
    </Svg>
  );
}

export function IconFloorPlan(props: BrandIconProps) {
  return (
    <Svg {...props}>
      <rect x="4" y="4" width="16" height="16" rx="1.5" />
<path d="M12 4v16" />
<path d="M4 12h8" />
<path d="M15.5 12h4.5" />
    </Svg>
  );
}

export function IconOperations(props: BrandIconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" />
<path d="M4 7.5l8 4.5 8-4.5" />
<path d="M12 12v9" />
    </Svg>
  );
}

export function IconSourceDoc(props: BrandIconProps) {
  return (
    <Svg {...props}>
      <path d="M7 3h7l4 4v14H7z" />
<path d="M14 3v4h4" />
<path d="M10 12h5" />
<path d="M10 16h5" />
<path d="M10 8h1.5" />
    </Svg>
  );
}

export function IconInfoAssumption(props: BrandIconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="8.5" />
<path d="M12 11v5" />
<path d="M12 7.8h.01" />
    </Svg>
  );
}

export function IconSliders(props: BrandIconProps) {
  return (
    <Svg {...props}>
      <path d="M4 7h3" />
<path d="M11 7h9" />
<circle cx="9" cy="7" r="2" />
<path d="M4 12h9" />
<path d="M15 12h5" />
<circle cx="15" cy="12" r="2" />
<path d="M4 17h1" />
<path d="M9 17h11" />
<circle cx="7" cy="17" r="2" />
    </Svg>
  );
}
