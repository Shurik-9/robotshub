import assert from "node:assert/strict";
import { test } from "node:test";
import {
  computeFormulaVsSim,
  measureSteadyThroughput,
  measurementSecondsForFlow,
} from "../src/lib/formula-vs-sim.ts";

const sample = (elapsedSec, tasksDone, utilizationPct = 80, queueLen = 0) =>
  ({ elapsedSec, tasksDone, utilizationPct, queueLen });
const input = overrides => ({
  formulaRobots: 3,
  runRobots: 3,
  formulaUnitPriceRub: 2_000_000,
  runUnitPriceRub: 2_000_000,
  targetPerHour: 120,
  observedPerHour: 120,
  utilizationPct: 80,
  queueLen: 0,
  ...overrides,
});

test("no comparison before a full post-warmup window", () => {
  const samples = [sample(60, 0), sample(119, 2)];
  assert.equal(measureSteadyThroughput(samples, null).ready, false);
  assert.equal(measureSteadyThroughput(samples, 60).ready, false);
  assert.equal(computeFormulaVsSim(input({ observedPerHour: null })).ready, false);
});

test("throughput uses counter delta, not cumulative startup rate", () => {
  const samples = [sample(0, 0), sample(60, 3), sample(90, 4), sample(120, 5)];
  const result = measureSteadyThroughput(samples, 60);
  assert.equal(result.ready, true);
  assert.equal(result.observedPerHour, 120);
  assert.equal(result.windowSeconds, 60);
});

test("measurement rolls forward instead of retaining startup completions", () => {
  const samples = [sample(60, 3), sample(120, 20), sample(150, 21), sample(180, 22)];
  assert.equal(measureSteadyThroughput(samples, 60).observedPerHour, 120);
});

test("sparse sampling cannot create a false ready result", () => {
  assert.equal(measureSteadyThroughput([sample(120, 5)], 60).ready, false);
});

test("proportional estimate scales the actual run fleet, not formula fleet", () => {
  const result = computeFormulaVsSim(input({
    formulaRobots: 10, runRobots: 2, observedPerHour: 60, queueLen: 8,
  }));
  assert.equal(result.tone, "shortage");
  assert.equal(result.neededRobots, 4);
  assert.equal(result.deltaRobots, -6);
});

test("successful run reports tested fleet without claiming the formula count", () => {
  const result = computeFormulaVsSim(input({ formulaRobots: 5, runRobots: 2 }));
  assert.equal(result.tone, "ok");
  assert.equal(result.neededRobots, 2);
  assert.equal(result.deltaRobots, -3);
  assert.doesNotMatch(result.headline, /сошлись/);
});

test("low utilization does not recommend a proportionally enlarged fleet", () => {
  const result = computeFormulaVsSim(input({ observedPerHour: 20, utilizationPct: 12, queueLen: 8 }));
  assert.equal(result.tone, "layout");
  assert.equal(result.neededRobots, 3);
});

test("equipment cost uses the actual fleet price separately from formula price", () => {
  const result = computeFormulaVsSim(input({ runUnitPriceRub: 3_000_000 }));
  assert.equal(result.formulaCapexRub, 6_000_000);
  assert.equal(result.neededCapexRub, 9_000_000);
  assert.equal(result.deltaRub, 3_000_000);
});

test("zero output is capped and explicitly marked as an estimate limit", () => {
  const result = computeFormulaVsSim(input({ observedPerHour: 0, utilizationPct: 80 }));
  assert.equal(result.neededRobots, 80);
  assert.equal(result.estimateCapped, true);
});

test("rare flows require a longer observation window", () => {
  assert.equal(measurementSecondsForFlow(240), 60);
  assert.equal(measurementSecondsForFlow(17.5), 618);
  assert.equal(measurementSecondsForFlow(0.1), 900);
});
