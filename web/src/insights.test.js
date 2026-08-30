import { test } from "node:test";
import assert from "node:assert/strict";
import {
  relativeToBestOtherLine, salesBufferLine, monthlyCostDeltaLine, capitalLine, recoveryTargetLine,
} from "./insights.js";

test("relativeToBestOtherLine: regression for the reported unit-mismatch bug", () => {
  // Reported symptom: risk = {A:28.6%, B:21.9%, C:13.4%} (stored as 0-1 fractions,
  // as ml.closure_probability actually is) produced "0.2%p" instead of the real
  // ~15.2%p gap, because the diff was computed on raw fractions while labeled "%p".
  const riskFractions = { A: 0.286, B: 0.219, C: 0.134 };
  const line = relativeToBestOtherLine("A", riskFractions, { lowerIsBetter: true, unit: "%p", decimals: 1, scale: 100 });
  assert.equal(line, "후보 C보다 15.2%p 높음");
});

test("relativeToBestOtherLine: scale defaults to 1 for already-percentage values", () => {
  // district_trend.quarterly_growth_pct is already a percentage (not a 0-1 fraction).
  const trendPct = { A: 1.4, B: -0.6, C: 2.1 };
  const line = relativeToBestOtherLine("B", trendPct, { lowerIsBetter: false, unit: "%p", decimals: 1 });
  assert.equal(line, "후보 C보다 2.7%p 낮음");
});

test("relativeToBestOtherLine: lowerIsBetter=true picks the smallest other value as the bar to beat", () => {
  const values = { A: 0.30, B: 0.10, C: 0.20 };
  assert.equal(
    relativeToBestOtherLine("C", values, { lowerIsBetter: true, unit: "%p", decimals: 1, scale: 100 }),
    "후보 B보다 10.0%p 높음"
  );
});

test("relativeToBestOtherLine: near-equal values report 'similar' instead of a misleading tiny diff", () => {
  const values = { A: 0.2001, B: 0.2000 };
  assert.equal(
    relativeToBestOtherLine("A", values, { lowerIsBetter: true, unit: "%p", decimals: 1, scale: 100 }),
    "후보 B와 비슷함"
  );
});

test("relativeToBestOtherLine: returns null with no other candidates", () => {
  assert.equal(relativeToBestOtherLine("A", { A: 0.1 }, { scale: 100 }), null);
});

test("salesBufferLine: positive buffer states the surplus and ratio", () => {
  assert.equal(
    salesBufferLine(3171, 2962),
    "최소 필요매출보다 209만원 높아 약 7.1%의 매출 여유가 있습니다."
  );
});

test("salesBufferLine: negative buffer states the shortfall", () => {
  assert.equal(
    salesBufferLine(2000, 2500),
    "최소 필요매출보다 500만원 낮아 약 20.0% 매출을 더 올려야 합니다."
  );
});

test("monthlyCostDeltaLine: positive/negative/zero phrasing", () => {
  assert.match(monthlyCostDeltaLine(780), /\+780만원/);
  assert.match(monthlyCostDeltaLine(-300), /절감/);
  assert.equal(monthlyCostDeltaLine(0), "현재와 동일한 월 고정비입니다.");
});

test("capitalLine: no additional funding needed vs. needed", () => {
  assert.equal(capitalLine(1766, 0), "현재 입력한 자기자금 안에서 이전 가능합니다.");
  assert.match(capitalLine(1766, 753), /753만원이 추가로 필요합니다/);
});

test("recoveryTargetLine: surplus vs. shortfall against a target-period required sales", () => {
  assert.equal(recoveryTargetLine(3171, 3080), "목표 대비 +91만원 여유");
  assert.equal(recoveryTargetLine(2900, 3080), "목표에 180만원 부족");
});
