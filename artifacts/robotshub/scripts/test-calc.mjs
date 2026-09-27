import assert from "node:assert/strict";
import { test } from "node:test";
import warehouseTemplate from "../src/data/object-templates/warehouse.json" with { type: "json" };
import airportTemplate from "../src/data/object-templates/airport.json" with { type: "json" };
import medicalTemplate from "../src/data/object-templates/medical.json" with { type: "json" };
import assumptionsData from "../src/data/assumptions.json" with { type: "json" };
import {
  buildPaybackHistogram,
  formatPaybackYears,
  getPaybackRiskVerdict,
  simulatePaybackRisk,
} from "../src/lib/calc.ts";

const whatIf = {
  salaryMultiplier: 1,
  priceMultiplier: 1,
  volumeMultiplier: 1,
};

const profiles = [
  {
    name: "складской",
    template: warehouseTemplate,
    solution: {
      name: "Транспортный AMR для склада",
      scenario: "Внутрискладская логистика",
      description: "робот для транспортировки грузов на складе",
      price_rub: 2_700_000,
      specs: { runtime_h: 6, charge_time_min: 18 },
    },
  },
  {
    name: "аэропортовый",
    template: airportTemplate,
    solution: {
      name: "Транспортный AMR для аэропорта",
      scenario: "Логистика аэропорта",
      description: "робот для перемещения багажа в терминале",
      price_rub: 2_700_000,
      specs: { runtime_h: 6, charge_time_min: 18 },
    },
  },
  {
    name: "медицинский",
    template: medicalTemplate,
    solution: {
      name: "Транспортный AMR для больницы",
      scenario: "Медицинская логистика",
      description: "робот для транспортировки грузов в медицинском учреждении",
      price_rub: 2_700_000,
      specs: { runtime_h: 6, charge_time_min: 18 },
    },
  },
];

function baseObjectParams(template) {
  return Object.fromEntries(
    template.groups.flatMap((group) =>
      group.fields.map((field) => [field.key, field.base]),
    ),
  );
}

function simulateProfile(profile) {
  return simulatePaybackRisk({
    objectParams: baseObjectParams(profile.template),
    solution: profile.solution,
    whatIf,
  });
}

test("сценарий с отрицательным эффектом не считается окупаемым", () => {
  const objectParams = {
    ...baseObjectParams(warehouseTemplate),
    picker_salary_gross: 1,
  };
  const result = simulatePaybackRisk({
    objectParams,
    solution: profiles[0].solution,
    whatIf,
  });

  assert.equal(result.iterations, 1000);
  assert.equal(result.basePaybackYears, null);
  assert.equal(result.p10Years, null);
  assert.equal(result.medianYears, null);
  assert.equal(result.p90Years, null);
  assert.equal(result.probabilityWithinThreeYears, 0);
  assert.equal(result.nonPaybackProbability, 1);
  assert.equal(getPaybackRiskVerdict(result.nonPaybackProbability)?.label, "Не окупается");
  assert.equal(formatPaybackYears(result.basePaybackYears, result.nonPaybackProbability), "Не окупается");
  assert.equal(formatPaybackYears(result.p10Years, result.nonPaybackProbability), "Не окупается");
  assert.equal(formatPaybackYears(result.medianYears, result.nonPaybackProbability), "Не окупается");
  assert.equal(formatPaybackYears(result.p90Years, result.nonPaybackProbability), "Не окупается");
  assert.equal(
    result.histogram.at(-1)?.label,
    "Не окупается",
  );
  assert.equal(
    result.histogram.at(-1)?.count,
    result.iterations,
    "все итерации должны попасть в категорию «Не окупается»",
  );
  assert.equal(
    result.histogram.reduce((total, bin) => total + bin.count, 0),
    result.iterations,
    "сумма гистограммы должна равняться числу итераций",
  );
});

test("симуляция окупаемости воспроизводима и сохраняет статистические инварианты", () => {
  assert.equal(assumptionsData.payback_simulation.iterations, 1000);
  assert.equal(
    assumptionsData.payback_simulation.seed,
    15485863,
    "seed должен оставаться стабильным для сравнимых отчётов",
  );

  for (const profile of profiles) {
    const first = simulateProfile(profile);
    const second = simulateProfile(profile);

    assert.deepEqual(
      second,
      first,
      `${profile.name}: повторный прогон должен совпадать с первым 1-в-1`,
    );
    assert.equal(
      first.iterations,
      1000,
      `${profile.name}: симуляция должна содержать 1000 итераций`,
    );
    assert.ok(
      first.p10Years !== null &&
        first.medianYears !== null &&
        first.p90Years !== null,
      `${profile.name}: перцентили должны быть рассчитаны`,
    );
    assert.ok(
      first.p10Years <= first.medianYears &&
        first.medianYears <= first.p90Years,
      `${profile.name}: ожидается P10 ≤ медиана ≤ P90`,
    );
    assert.equal(
      first.histogram.reduce((total, bin) => total + bin.count, 0),
      first.iterations,
      `${profile.name}: сумма гистограммы должна равняться числу итераций`,
    );
    assert.ok(
      first.basePaybackYears !== null,
      `${profile.name}: точечная оценка окупаемости должна быть рассчитана`,
    );
    const allowedDeviation = Math.max(0.25, first.basePaybackYears * 0.2);
    assert.ok(
      Math.abs(first.medianYears - first.basePaybackYears) <= allowedDeviation,
      `${profile.name}: медиана должна быть в пределах 20% или 0,25 года от точечной оценки`,
    );
  }
});

test("границы интервалов гистограммы не теряют сроки окупаемости", () => {
  const sampledPaybacks = [
    0,
    0.999999,
    1,
    1.999999,
    2,
    9.999999,
    10,
    10.000001,
  ];
  const histogram = buildPaybackHistogram(sampledPaybacks, 2);
  const counts = Object.fromEntries(histogram.map(bin => [bin.label, bin.count]));

  assert.equal(counts["0–1"], 2, "0 и значение ниже 1 года должны попасть в 0–1");
  assert.equal(counts["1–2"], 2, "ровно 1 год должен начать интервал 1–2");
  assert.equal(counts["2–3"], 1, "ровно 2 года должен начать интервал 2–3");
  assert.equal(counts["8–10"], 1, "значение ниже 10 лет должно попасть в 8–10");
  assert.equal(counts[">10"], 2, "10 лет и значения выше должны попасть в >10");
  assert.equal(
    counts["Не окупается"],
    2,
    "неокупаемые итерации должны остаться в отдельной корзине",
  );
  assert.equal(
    histogram.reduce((total, bin) => total + bin.count, 0),
    sampledPaybacks.length + 2,
    "сумма всех корзин должна равняться числу итераций",
  );
});

test("пустые интервалы гистограммы сохраняют подпись и нулевое значение", () => {
  const histogram = buildPaybackHistogram([0.4, 2.4], 0);
  const labels = histogram.map(bin => bin.label);
  const counts = Object.fromEntries(histogram.map(bin => [bin.label, bin.count]));

  assert.deepEqual(labels, [
    "0–1",
    "1–2",
    "2–3",
    "3–4",
    "4–5",
    "5–6",
    "6–8",
    "8–10",
    ">10",
    "Не окупается",
  ]);
  assert.equal(counts["1–2"], 0, "пустой интервал 1–2 должен остаться в данных графика");
  assert.equal(counts["3–4"], 0, "пустой интервал 3–4 должен остаться в данных графика");
  assert.equal(counts[">10"], 0, "пустой интервал >10 должен остаться в данных графика");
  assert.equal(
    histogram.reduce((total, bin) => total + bin.count, 0),
    2,
    "нулевые корзины не должны менять сумму итераций",
  );
});
