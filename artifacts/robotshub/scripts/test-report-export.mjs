import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSimulationKpiCsvSection } from "../src/lib/report-export.ts";

function parseCsvRows(csv) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < csv.length; index++) {
    const character = csv[index];
    if (character === '"') {
      if (quoted && csv[index + 1] === '"') {
        cell += '"';
        index++;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if (character === "\n" && !quoted) {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (character === "\r" && !quoted && csv[index + 1] === "\n") {
      continue;
    } else {
      cell += character;
    }
  }

  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows;
}

function dataRows(section) {
  return parseCsvRows(section.trim()).slice(2);
}

test("экспорт межэтажных KPI сохраняет seed, поездки и все этажи снимка", () => {
  const snapshot = {
    seed: 42,
    signature: "warehouse-signature",
    verticalTrips: 17,
    geometry: null,
    generatedAt: "2026-09-23T10:30:00.000Z",
    sceneInputs: {
      sceneKind: "warehouse",
      areaM2: 12000,
      floors: 3,
      rackRows: 12,
      docks: 4,
      chargeStations: 3,
      elevatorIntegrationReady: true,
    },
    floorStats: [
      { id: "warehouse-1", label: "1 этаж · операционная зона", tasks: 120, completed: 116 },
      { id: "warehouse-2", label: '2 этаж,\nзона "B", пользовательская', tasks: 90, completed: 84 },
      { id: "warehouse-3", label: "3 этаж · зона выдачи", tasks: 60, completed: 58 },
    ],
  };

  const section = buildSimulationKpiCsvSection(snapshot);
  const rows = dataRows(section);

  assert.equal(rows.length, snapshot.floorStats.length);
  assert.deepEqual(rows.map((row) => row[2]), snapshot.floorStats.map((floor) => floor.label));
  assert.deepEqual(rows.map((row) => Number(row[3])), snapshot.floorStats.map((floor) => floor.tasks));
  assert.deepEqual(rows.map((row) => Number(row[4])), snapshot.floorStats.map((floor) => floor.completed));
  assert.deepEqual(rows.map((row) => Number(row[0])), rows.map(() => snapshot.seed));
  assert.deepEqual(rows.map((row) => Number(row[1])), rows.map(() => snapshot.verticalTrips));
  assert.deepEqual(rows.map((row) => row[5]), rows.map(() => "3 этажа"));
  assert.ok(rows.every((row) => row[6].length > 0));
  assert.ok(rows.every((row) => row[7].includes("склад")));
  assert.match(section, /"2 этаж,\nзона ""B"", пользовательская"/);
});

test("одноэтажный снимок экспортирует явный ноль вертикальных поездок", () => {
  const snapshot = {
    seed: 42,
    signature: "warehouse-one-floor",
    verticalTrips: 0,
    geometry: null,
    floorStats: [
      { id: "warehouse-1", label: "1 этаж · операционная зона", tasks: 36, completed: 36 },
    ],
  };

  const section = buildSimulationKpiCsvSection(snapshot);
  const rows = dataRows(section);

  assert.equal(rows.length, 1);
  assert.equal(Number(rows[0][0]), 42);
  assert.equal(Number(rows[0][1]), 0);
  assert.equal(Number(rows[0][3]), 36);
  assert.equal(Number(rows[0][4]), 36);
  assert.doesNotMatch(section, /-,-,-,-,-/);
});

test("при отсутствии снимка экспорт сохраняет диагностическую строку", () => {
  const section = buildSimulationKpiCsvSection(null);

  assert.match(section, /Seed,Поездки через вертикальный переход,Этаж,Задачи назначено,Задачи выполнено/);
  assert.match(section, /-,-,-,-,-/);
});